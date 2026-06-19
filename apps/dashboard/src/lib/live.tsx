'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type FleetEvent = {
  type:
    | 'connected'
    | 'device.created'
    | 'device.updated'
    | 'device.deleted'
    | 'device.heartbeat'
    | 'job.created'
    | 'job.updated'
    | 'alert.fired';
  deviceId?: string;
  payload?: unknown;
  timestamp?: string;
  workspaceId?: string;
};

type Listener = (e: FleetEvent) => void;

type LiveCtx = {
  connected: boolean;
  subscribe: (fn: Listener) => () => void;
};

const Ctx = createContext<LiveCtx>({ connected: false, subscribe: () => () => {} });

// Single shared WebSocket to the API event hub. Auto-reconnects with backoff.
// Broadcasts only non-sensitive event metadata (ids/status), so a direct browser
// connection is safe.
export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const listeners = useRef<Set<Listener>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_WS_URL;
    if (!url) return undefined;

    let stopped = false;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (stopped) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url as string);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        scheduleReconnect();
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data as string) as FleetEvent;
          listeners.current.forEach((fn) => fn(event));
        } catch {
          /* ignore malformed */
        }
      };
    }

    function scheduleReconnect() {
      if (stopped) return;
      retry = Math.min(retry + 1, 6);
      const delay = Math.min(1000 * 2 ** retry, 15000);
      reconnectTimer = setTimeout(connect, delay);
    }

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  function subscribe(fn: Listener) {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }

  return <Ctx.Provider value={{ connected, subscribe }}>{children}</Ctx.Provider>;
}

export function useLive(): LiveCtx {
  return useContext(Ctx);
}

// Convenience hook: run a callback for every event of the given types.
export function useFleetEvents(types: FleetEvent['type'][], handler: Listener) {
  const { subscribe } = useLive();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    return subscribe((e) => {
      if (types.includes(e.type)) handlerRef.current(e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, types.join(',')]);
}
