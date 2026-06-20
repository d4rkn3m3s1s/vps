import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../../lib/logger';

export type DeviceHubEvent = {
  type:
    | 'device.created'
    | 'device.updated'
    | 'device.deleted'
    | 'device.heartbeat'
    | 'job.created'
    | 'job.updated'
    | 'alert.fired';
  deviceId: string;
  payload: unknown;
  timestamp: string;
  // Optional workspace scope so clients can filter to their active workspace.
  workspaceId?: string | undefined;
};

export class DeviceHub {
  private readonly clients = new Set<WebSocket>();
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
    this.wss.on('connection', (socket) => {
      this.clients.add(socket);
      socket.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
      socket.on('close', () => this.clients.delete(socket));
      socket.on('error', (error) => logger.error('Device websocket error', { error: error.message }));
    });
  }

  // Called by StreamHub's upgrade router for the '/ws/devices' path.
  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    if (!this.wss) {
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss!.emit('connection', ws, req);
    });
  }

  broadcast(event: DeviceHubEvent): void {
    const message = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
}

export const deviceHub = new DeviceHub();
