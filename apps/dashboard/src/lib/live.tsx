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
    | 'alert.fired'
    | 'notification.created'
    | 'whatsapp.message'
    | 'provision.progress'
    | 'whatsapp.register.progress'
    | 'instagram.register.progress';
  deviceId?: string;
  payload?: unknown;
  timestamp?: string;
  workspaceId?: string;
};

type Listener = (e: FleetEvent) => void;

// Bağlantının kullanıcıya gösterilebilir durumu.
//   connecting — ilk bağlantı ya da yeniden deneme sürüyor
//   open       — canlı
//   offline    — koptu, otomatik yeniden deneniyor
//   unauthorized — oturum geçersiz; yeniden denemek düzeltmez, giriş gerekir
export type LiveStatus = 'connecting' | 'open' | 'offline' | 'unauthorized';

type LiveCtx = {
  connected: boolean;
  status: LiveStatus;
  // Bir sonraki otomatik denemeyi beklemeden hemen bağlan (panelde "Yeniden bağlan").
  reconnect: () => void;
  subscribe: (fn: Listener) => () => void;
};

const Ctx = createContext<LiveCtx>({
  connected: false,
  status: 'connecting',
  reconnect: () => {},
  subscribe: () => () => {}
});

// Sunucu bu aralıkta hiçbir şey göndermezse bağlantıyı ÖLÜ kabul edip kapatırız.
// Hub 30 sn'de bir heartbeat/olay yayar; 70 sn tam sessizlik = zombie soket.
const SILENCE_TIMEOUT_MS = 70_000;

// Single shared WebSocket to the API event hub. Auto-reconnects with backoff.
// Broadcasts only non-sensitive event metadata (ids/status), so a direct browser
// connection is safe.
//
// ★2026-07-29 DAYANIKLILIK: eskiden token alınamadığında (oturum süresi dolunca
// /api/ws-token 307 → /welcome HTML döndürüyordu) kod TOKENSİZ bağlanmaya
// çalışıyordu; API bunu reddediyor, soket sonsuza kadar kopuk kalıyor ve kendi
// kendine ASLA düzelmiyordu — kullanıcı da hiçbir şey göremiyordu. Artık:
//   • token yoksa HİÇ bağlanmayız (boşuna 502 üretmeyiz), durum dışarı verilir
//   • yönlendirme takip edilmez (HTML token sanılmaz)
//   • sekmeye dönünce / ağ gelince anında yeniden denenir
//   • sunucu sessizliği (zombie soket) tespit edilip kapatılır
export function LiveProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const listeners = useRef<Set<Listener>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  // connect() referansını dışarı (reconnect) taşımak için.
  const connectRef = useRef<() => void>(() => {});

  useEffect(() => {
    const baseUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!baseUrl) return undefined;

    let stopped = false;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let silenceTimer: ReturnType<typeof setTimeout> | undefined;

    function clearTimers() {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (silenceTimer) clearTimeout(silenceTimer);
      reconnectTimer = undefined;
      silenceTimer = undefined;
    }

    // Sunucudan her mesaj geldiğinde sessizlik sayacını sıfırla. Süre dolarsa
    // soket "açık" görünse bile ölüdür (TCP yarı-açık kalabilir) → kapat, yeniden bağlan.
    function armSilenceTimer(ws: WebSocket) {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, SILENCE_TIMEOUT_MS);
    }

    // Kısa ömürlü JWT'yi sunucu tarafından al. Yönlendirme TAKİP EDİLMEZ:
    // aksi halde /welcome HTML'i 200 döner, `res.ok` true olur ve HTML token
    // sanılır (yaşanan bug). 401 → oturum gerçekten geçersiz.
    async function fetchToken(): Promise<{ token: string | null; unauthorized: boolean }> {
      try {
        const res = await fetch('/api/ws-token', { method: 'POST', redirect: 'manual' });
        if (res.status === 401) return { token: null, unauthorized: true };
        // redirect:'manual' → yönlendirme "opaqueredirect" olarak gelir (status 0).
        if (!res.ok || res.type === 'opaqueredirect') return { token: null, unauthorized: false };
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('application/json')) return { token: null, unauthorized: false };
        const { data } = (await res.json()) as { data: { token?: string } | null };
        return { token: data?.token ?? null, unauthorized: false };
      } catch {
        return { token: null, unauthorized: false };
      }
    }

    async function connect() {
      if (stopped) return;
      clearTimers();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
      setStatus((s) => (s === 'open' ? s : 'connecting'));

      const { token, unauthorized } = await fetchToken();
      if (stopped) return;

      if (!token) {
        // Tokensiz bağlanmak anlamsız: hub upgrade'i reddeder ve sonsuz 502 üretiriz.
        setStatus(unauthorized ? 'unauthorized' : 'offline');
        scheduleReconnect();
        return;
      }

      let ws: WebSocket;
      try {
        ws = new WebSocket(`${baseUrl}?token=${encodeURIComponent(token)}`);
      } catch {
        setStatus('offline');
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setStatus('open');
        armSilenceTimer(ws);
      };
      ws.onclose = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        if (wsRef.current === ws) wsRef.current = null;
        setStatus('offline');
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
        armSilenceTimer(ws);
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
      if (reconnectTimer) clearTimeout(reconnectTimer);
      retry = Math.min(retry + 1, 6);
      const delay = Math.min(1000 * 2 ** retry, 15000);
      reconnectTimer = setTimeout(() => void connect(), delay);
    }

    // Elle / olay tetikli anında deneme: backoff sayacını sıfırlar.
    function connectNow() {
      if (stopped) return;
      retry = 0;
      void connect();
    }
    connectRef.current = connectNow;

    // Sekmeye geri dönüldüğünde veya ağ geri geldiğinde beklemeden dene. Uyuyan
    // sekmede soket sessizce ölmüş olabilir; kullanıcı geri geldiğinde panelin
    // canlı olmasını bekler.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== WebSocket.OPEN) connectNow();
    };
    const onOnline = () => connectNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onVisible);

    void connect();

    return () => {
      stopped = true;
      clearTimers();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onVisible);
      wsRef.current?.close();
    };
  }, []);

  function subscribe(fn: Listener) {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }

  const reconnect = () => connectRef.current();

  return (
    <Ctx.Provider value={{ connected: status === 'open', status, reconnect, subscribe }}>{children}</Ctx.Provider>
  );
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
