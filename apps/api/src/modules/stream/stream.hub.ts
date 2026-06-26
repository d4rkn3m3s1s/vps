import type { Server as HttpServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { prisma } from '../../db/prisma';
import { logger } from '../../lib/logger';
import { sha256 } from '../../lib/crypto';
import { verifyAccessToken } from '../../lib/jwt';
import { deviceHub } from '../devices/device.hub';

// ── Live screen streaming + remote control ──────────────────────────────────
//
// Two WebSocket endpoints bridge here:
//   /ws/agent-stream   — opened by a KVM host agent (authed by x-agent-key via
//                        query param). The agent receives "control" messages
//                        (start/stop capture, inject input) and pushes back
//                        binary JPEG frames tagged with the device id.
//   /ws/stream         — opened by a dashboard viewer (authed by JWT). It
//                        receives frames for one device and sends control
//                        events (tap/swipe/key/text) back.
//
// The hub fans a device's frames out to every viewer watching it, and asks the
// owning host's agent to start/stop capturing based on whether anyone is
// watching — so idle devices cost nothing. This is intentionally codec-free
// (throttled JPEG over WS) so the zero-dependency host agent needs no scrcpy /
// ffmpeg binaries, while still feeling instant on a LAN/datacenter link.

type AgentSocket = WebSocket & { hostId?: string };
// A viewer may declare a `mirror` set: device ids that should receive a copy of
// every control event this viewer sends (Synchronizer leader → followers). We
// cache each mirror target's hostId+serial so input fan-out needs no DB hit.
type MirrorTarget = { deviceId: string; hostId: string | null; serial: string | null };
type ViewerSocket = WebSocket & {
  deviceId?: string;
  userId?: string;
  workspaceId?: string;
  mirror?: MirrorTarget[];
};

// A control message the API sends down to a host agent.
type AgentControl =
  | { type: 'stream.start'; deviceId: string; serial: string | null; fps?: number; quality?: number }
  | { type: 'stream.stop'; deviceId: string; serial: string | null }
  | { type: 'input.tap'; deviceId: string; serial: string | null; x: number; y: number }
  | { type: 'input.swipe'; deviceId: string; serial: string | null; x: number; y: number; x2: number; y2: number; ms?: number }
  | { type: 'input.key'; deviceId: string; serial: string | null; keycode: number }
  | { type: 'input.text'; deviceId: string; serial: string | null; text: string };

const FRAME_PREFIX = Buffer.from('FRM:'); // binary frame framing: "FRM:" + <36-char deviceId> + jpeg bytes

export class StreamHub {
  private agentWss?: WebSocketServer;
  private viewerWss?: WebSocketServer;
  // hostId -> agent socket
  private readonly agents = new Map<string, AgentSocket>();
  // deviceId -> set of viewer sockets watching it
  private readonly viewers = new Map<string, Set<ViewerSocket>>();

  attach(server: HttpServer): void {
    if (this.agentWss || this.viewerWss) return;

    // noServer mode so we can route both paths off one HTTP upgrade handler and
    // run our own auth before accepting the socket.
    this.agentWss = new WebSocketServer({ noServer: true });
    this.viewerWss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      let pathname = '';
      try {
        pathname = new URL(req.url ?? '', 'http://localhost').pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname === '/ws/agent-stream') {
        void this.handleAgentUpgrade(req, socket as never, head);
      } else if (pathname === '/ws/stream') {
        void this.handleViewerUpgrade(req, socket as never, head);
      } else if (pathname === '/ws/devices') {
        // deviceHub runs in noServer mode; this single upgrade router owns the
        // server's 'upgrade' event and dispatches /ws/devices to it.
        deviceHub.handleUpgrade(req, socket as never, head);
      } else {
        socket.destroy();
      }
    });

    logger.info('Stream hub attached (/ws/agent-stream, /ws/stream, /ws/devices)');
  }

  // ── Agent side ────────────────────────────────────────────────────────────
  private async handleAgentUpgrade(req: IncomingMessage, socket: never, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '', 'http://localhost');
    const agentKey = url.searchParams.get('key') ?? req.headers['x-agent-key'];
    const rawSocket = socket as unknown as import('node:net').Socket;
    if (!agentKey || typeof agentKey !== 'string') {
      rawSocket.destroy();
      return;
    }
    const host = await prisma.host.findFirst({ where: { agentKeyHash: sha256(agentKey) } }).catch(() => null);
    if (!host) {
      rawSocket.destroy();
      return;
    }
    this.agentWss!.handleUpgrade(req, rawSocket, head, (ws) => {
      const a = ws as AgentSocket;
      a.hostId = host.id;
      this.agents.set(host.id, a);
      logger.info('Stream agent connected', { hostId: host.id });
      a.on('message', (data, isBinary) => this.onAgentMessage(a, data as Buffer, isBinary));
      a.on('close', () => {
        if (this.agents.get(host.id) === a) this.agents.delete(host.id);
      });
      a.on('error', () => undefined);
    });
  }

  // Agent frames arrive as binary: "FRM:" + deviceId(36) + jpeg. We slice the
  // device id and fan the JPEG bytes out to that device's viewers untouched.
  private onAgentMessage(_agent: AgentSocket, data: Buffer, isBinary: boolean): void {
    if (!isBinary || data.length < FRAME_PREFIX.length + 36) return;
    if (!data.subarray(0, FRAME_PREFIX.length).equals(FRAME_PREFIX)) return;
    // The agent right-pads the device id to a fixed 36 chars (cuids are ~25), so
    // trim it back before looking up viewers — otherwise the padded id never
    // matches the real key and every frame is silently dropped.
    const deviceId = data.subarray(FRAME_PREFIX.length, FRAME_PREFIX.length + 36).toString('utf8').trim();
    const frame = data.subarray(FRAME_PREFIX.length + 36);
    const set = this.viewers.get(deviceId);
    if (!set || set.size === 0) return;
    for (const v of set) {
      // Per-viewer backpressure: skip a slow viewer instead of letting its send
      // queue grow unbounded (which head-of-lines fast viewers on the wall and
      // grows API memory). A dropped frame just means the next one is fresher.
      if (v.readyState === WebSocket.OPEN && v.bufferedAmount < 4_000_000) {
        v.send(frame, { binary: true });
      }
    }
  }

  // ── Viewer side ───────────────────────────────────────────────────────────
  private async handleViewerUpgrade(req: IncomingMessage, socket: never, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token') ?? '';
    const deviceId = url.searchParams.get('deviceId') ?? '';
    const rawSocket = socket as unknown as import('node:net').Socket;
    if (!token || !deviceId) {
      logger.warn('[stream] viewer rejected: missing token/deviceId');
      rawSocket.destroy();
      return;
    }
    let userId: string;
    let workspaceId: string | undefined;
    try {
      const claims = verifyAccessToken(token);
      userId = claims.sub;
      workspaceId = claims.workspaceId;
    } catch (err) {
      logger.warn(`[stream] viewer rejected: bad token (${(err as Error).message})`);
      rawSocket.destroy();
      return;
    }
    // Authorize: the device must exist and (when scoped) belong to the viewer's
    // workspace. Cross-workspace peeking is rejected.
    const device = await prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, hostId: true, workspaceId: true, ipAddress: true, adbPort: true } }).catch(() => null);
    if (!device || (workspaceId && device.workspaceId && device.workspaceId !== workspaceId)) {
      logger.warn(`[stream] viewer rejected: device=${device ? 'found' : 'MISSING'} dws=${device?.workspaceId} vws=${workspaceId}`);
      rawSocket.destroy();
      return;
    }
    logger.info(`[stream] viewer accepted for device ${deviceId} (host=${device.hostId ?? 'none'})`);

    this.viewerWss!.handleUpgrade(req, rawSocket, head, (ws) => {
      const v = ws as ViewerSocket;
      v.deviceId = deviceId;
      v.userId = userId;
      if (workspaceId) v.workspaceId = workspaceId;
      this.addViewer(deviceId, v);

      const serial = device.ipAddress && device.adbPort ? `${device.ipAddress}:${device.adbPort}` : null;
      // First viewer for this device → tell the host to start capturing.
      if ((this.viewers.get(deviceId)?.size ?? 0) === 1) {
        // Ask for 20fps; the agent caps at 30 and drops frames under backpressure,
        // so requesting more here lifts the whole pipeline off the old 12fps pin.
        this.toAgent(device.hostId, { type: 'stream.start', deviceId, serial, fps: 20, quality: 60 });
      }

      v.on('message', (raw) => this.onViewerMessage(v, raw as Buffer, device.hostId, serial));
      v.on('close', () => this.removeViewer(deviceId, v, device.hostId, serial));
      v.on('error', () => undefined);
      v.send(JSON.stringify({ type: 'stream.connected', deviceId, hasHost: Boolean(device.hostId) }));
    });
  }

  // Viewer → control event (tap/swipe/key/text) or a `mirror` config message.
  // Input is relayed to the owning agent and, when a mirror set is configured,
  // to every follower device too (Synchronizer: one leader drives many phones).
  private onViewerMessage(v: ViewerSocket, raw: Buffer, hostId: string | null, serial: string | null): void {
    let msg: {
      type?: string;
      x?: number; y?: number; x2?: number; y2?: number; ms?: number;
      keycode?: number; text?: string;
      deviceIds?: string[];
    };
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return;
    }

    // Configure (or clear) this viewer's mirror set. Resolves each follower's
    // host + ADB serial once and caches it on the socket.
    if (msg.type === 'mirror') {
      void this.setMirror(v, Array.isArray(msg.deviceIds) ? msg.deviceIds : []);
      return;
    }

    const deviceId = v.deviceId!;
    // The leader device plus any configured followers.
    const targets: MirrorTarget[] = [{ deviceId, hostId, serial }, ...(v.mirror ?? [])];

    for (const t of targets) {
      switch (msg.type) {
        case 'tap':
          if (typeof msg.x === 'number' && typeof msg.y === 'number')
            this.toAgent(t.hostId, { type: 'input.tap', deviceId: t.deviceId, serial: t.serial, x: msg.x, y: msg.y });
          break;
        case 'swipe':
          if (typeof msg.x === 'number' && typeof msg.y === 'number' && typeof msg.x2 === 'number' && typeof msg.y2 === 'number')
            this.toAgent(t.hostId, { type: 'input.swipe', deviceId: t.deviceId, serial: t.serial, x: msg.x, y: msg.y, x2: msg.x2, y2: msg.y2, ...(typeof msg.ms === 'number' ? { ms: msg.ms } : {}) });
          break;
        case 'key':
          if (typeof msg.keycode === 'number') this.toAgent(t.hostId, { type: 'input.key', deviceId: t.deviceId, serial: t.serial, keycode: msg.keycode });
          break;
        case 'text':
          if (typeof msg.text === 'string') this.toAgent(t.hostId, { type: 'input.text', deviceId: t.deviceId, serial: t.serial, text: msg.text });
          break;
        default:
          break;
      }
    }
  }

  // Resolve follower devices to host+serial and store on the viewer socket.
  // Cross-workspace devices are dropped. The leader's own device is excluded.
  private async setMirror(v: ViewerSocket, deviceIds: string[]): Promise<void> {
    const followers = deviceIds.filter((id) => id && id !== v.deviceId);
    if (followers.length === 0) {
      v.mirror = [];
      return;
    }
    const devices = await prisma.device
      .findMany({ where: { id: { in: followers } }, select: { id: true, hostId: true, workspaceId: true, ipAddress: true, adbPort: true } })
      .catch(() => []);
    v.mirror = devices
      .filter((d) => !v.workspaceId || !d.workspaceId || d.workspaceId === v.workspaceId)
      .map((d) => ({
        deviceId: d.id,
        hostId: d.hostId,
        serial: d.ipAddress && d.adbPort ? `${d.ipAddress}:${d.adbPort}` : null
      }));
  }

  private addViewer(deviceId: string, v: ViewerSocket): void {
    let set = this.viewers.get(deviceId);
    if (!set) {
      set = new Set();
      this.viewers.set(deviceId, set);
    }
    set.add(v);
  }

  private removeViewer(deviceId: string, v: ViewerSocket, hostId: string | null, serial: string | null): void {
    const set = this.viewers.get(deviceId);
    if (!set) return;
    set.delete(v);
    if (set.size === 0) {
      this.viewers.delete(deviceId);
      // Last viewer left → tell the host to stop capturing (saves CPU).
      this.toAgent(hostId, { type: 'stream.stop', deviceId, serial });
    }
  }

  private toAgent(hostId: string | null, control: AgentControl): void {
    if (!hostId) return;
    const a = this.agents.get(hostId);
    if (a && a.readyState === WebSocket.OPEN) a.send(JSON.stringify(control));
  }

  // Live counts for the system/health UI.
  stats(): { agents: number; watchedDevices: number; viewers: number } {
    let viewers = 0;
    for (const s of this.viewers.values()) viewers += s.size;
    return { agents: this.agents.size, watchedDevices: this.viewers.size, viewers };
  }
}

export const streamHub = new StreamHub();
