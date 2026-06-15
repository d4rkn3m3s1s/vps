import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '../../lib/logger';

export type DeviceHubEvent = {
  type: 'device.created' | 'device.updated' | 'device.deleted' | 'device.heartbeat';
  deviceId: string;
  payload: unknown;
  timestamp: string;
};

export class DeviceHub {
  private readonly clients = new Set<WebSocket>();
  private wss?: WebSocketServer;

  attach(server: HttpServer): void {
    if (this.wss) {
      return;
    }

    this.wss = new WebSocketServer({ server, path: '/ws/devices' });
    this.wss.on('connection', (socket) => {
      this.clients.add(socket);
      socket.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
      socket.on('close', () => this.clients.delete(socket));
      socket.on('error', (error) => logger.error('Device websocket error', { error: error.message }));
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
