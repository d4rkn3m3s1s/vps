import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../../lib/logger';
import { verifyAccessToken } from '../../lib/jwt';

// A dashboard client socket, tagged with the authenticated viewer's workspace so
// broadcast() can fan events only to same-tenant clients (no cross-tenant leak).
type ClientSocket = WebSocket & { workspaceId?: string | undefined };

export type DeviceHubEvent = {
  type:
    | 'device.created'
    | 'device.updated'
    | 'device.deleted'
    | 'device.heartbeat'
    | 'job.created'
    | 'job.updated'
    | 'alert.fired'
    | 'whatsapp.message'
    | 'whatsapp.media'
    | 'provision.progress'
    | 'whatsapp.register.progress'
    | 'instagram.register.progress';
  deviceId: string;
  payload: unknown;
  timestamp: string;
  // Optional workspace scope so clients can filter to their active workspace.
  workspaceId?: string | undefined;
};

export class DeviceHub {
  private readonly clients = new Set<ClientSocket>();
  private wss?: WebSocketServer;

  attach(_server: HttpServer): void {
    if (this.wss) {
      return;
    }
    // noServer mode: a SINGLE upgrade router (in StreamHub) owns the HTTP
    // 'upgrade' event and dispatches by path. If we used { server, path } here,
    // ws would install its own upgrade listener that destroys sockets for paths
    // it doesn't own (e.g. /ws/agent-stream, /ws/stream) — which broke streaming.
    // StreamHub calls handleDeviceUpgrade() for '/ws/devices'.
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (socket: ClientSocket, req: IncomingMessage) => {
      // The upgrade handler stashed the verified workspaceId on the request; carry
      // it onto the socket so broadcast() can scope events to this tenant.
      const workspaceId = (req as IncomingMessage & { workspaceId?: string }).workspaceId;
      if (workspaceId) socket.workspaceId = workspaceId;
      this.clients.add(socket);
      socket.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
      socket.on('close', () => this.clients.delete(socket));
      socket.on('error', (error) => logger.error('Device websocket error', { error: error.message }));
    });
  }

  // Called by StreamHub's upgrade router for the '/ws/devices' path. Authenticates
  // the viewer via JWT (query ?token= or Sec-WebSocket-Protocol) and binds the
  // resolved workspace to the socket so events never cross tenants. No token → reject.
  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    if (!this.wss) {
      socket.destroy();
      return;
    }
    let token = '';
    try {
      token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? '';
    } catch {
      token = '';
    }
    // Fall back to the WS subprotocol header (same pattern StreamHub viewers use).
    if (!token) {
      const proto = req.headers['sec-websocket-protocol'];
      if (typeof proto === 'string' && proto.trim()) token = proto.split(',')[0]!.trim();
    }
    if (!token) {
      logger.warn('[devices] ws rejected: missing token');
      socket.destroy();
      return;
    }
    let workspaceId: string | undefined;
    try {
      workspaceId = verifyAccessToken(token).workspaceId;
    } catch (err) {
      logger.warn(`[devices] ws rejected: bad token (${(err as Error).message})`);
      socket.destroy();
      return;
    }
    // Stash on the request so the 'connection' handler can bind it to the socket.
    if (workspaceId) (req as IncomingMessage & { workspaceId?: string }).workspaceId = workspaceId;
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss!.emit('connection', ws, req);
    });
  }

  broadcast(event: DeviceHubEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      // Scope events to their workspace: a client only receives events for its own
      // tenant. FAIL-CLOSED: once an event carries a workspaceId, deliver it ONLY to
      // clients of THAT workspace — a client with no/other workspaceId is skipped.
      // (Previously the guard also required client.workspaceId to be set, so a tagged
      // event still leaked to any untagged client. Untagged events remain system-wide.)
      if (event.workspaceId && client.workspaceId !== event.workspaceId) continue;
      if (client.readyState === WebSocket.OPEN) {
        // Guard each send: a socket can flip OPEN → CLOSING between the check and
        // the send (or send can throw on a half-dead peer). Without this, one bad
        // client would abort the loop and starve every remaining client of the
        // broadcast. Swallow + continue so delivery is best-effort per client.
        try {
          client.send(message);
        } catch {
          // dead/closing peer — skip; the ws 'close' handler removes it from the set
        }
      }
    }
  }
}

export const deviceHub = new DeviceHub();
