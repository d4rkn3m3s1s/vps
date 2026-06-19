'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, ChevronLeft, Circle, Square as SquareIcon, Power, Volume2, Volume1, Maximize2, Loader2 } from 'lucide-react';

// Android keyevent codes used by the nav bar.
const KEY = { BACK: 4, HOME: 3, RECENTS: 187, POWER: 26, VOL_UP: 24, VOL_DOWN: 25 } as const;

type ConnState = 'idle' | 'connecting' | 'live' | 'offline' | 'error';

// Live, interactive mirror of a cloud phone's screen. Streams JPEG/PNG frames
// over a WebSocket and maps pointer gestures back to ADB input on the device.
// A tap is a click; a drag becomes a swipe. Coordinates are scaled from the
// rendered <img> back to the device's real resolution so taps land precisely
// regardless of how the frame is sized in the layout.
export function LiveScreen({ deviceId, online }: { deviceId: string; online: boolean }) {
  const [state, setState] = useState<ConnState>('idle');
  const [fps, setFps] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const objUrlRef = useRef<string | null>(null);
  // Pointer-down position (in device coords) to distinguish tap from swipe.
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // Natural frame size, learned from the first decoded frame.
  const frameSize = useRef<{ w: number; h: number }>({ w: 1080, h: 1920 });
  const frameCount = useRef(0);

  const cleanup = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    if (objUrlRef.current) {
      URL.revokeObjectURL(objUrlRef.current);
      objUrlRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    setState('connecting');
    try {
      const res = await fetch(`/api/devices/${deviceId}/stream-token`, { method: 'POST' });
      const json = await res.json();
      const data = json.data as { token: string; wsBase: string; online: boolean } | null;
      if (!res.ok || !data?.token) {
        setState('error');
        return;
      }
      const url = `${data.wsBase}/ws/stream?token=${encodeURIComponent(data.token)}&deviceId=${encodeURIComponent(deviceId)}`;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          // Control/handshake JSON.
          try {
            const m = JSON.parse(ev.data);
            if (m.type === 'stream.connected' && !m.hasHost) setState('offline');
          } catch {
            /* ignore */
          }
          return;
        }
        // Binary frame → render. Reuse one object URL to avoid GC churn.
        const blob = new Blob([ev.data as ArrayBuffer], { type: 'image/png' });
        const next = URL.createObjectURL(blob);
        const img = imgRef.current;
        if (img) {
          const prev = objUrlRef.current;
          img.onload = () => {
            if (img.naturalWidth) frameSize.current = { w: img.naturalWidth, h: img.naturalHeight };
            if (prev) URL.revokeObjectURL(prev);
          };
          img.src = next;
          objUrlRef.current = next;
        } else {
          URL.revokeObjectURL(next);
        }
        frameCount.current += 1;
        if (state !== 'live') setState('live');
      };
      ws.onclose = () => setState((s) => (s === 'live' || s === 'connecting' ? 'idle' : s));
      ws.onerror = () => setState('error');
    } catch {
      setState('error');
    }
  }, [deviceId, state]);

  // FPS meter.
  useEffect(() => {
    const t = setInterval(() => {
      setFps(frameCount.current);
      frameCount.current = 0;
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  function send(obj: Record<string, unknown>) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  // Map a browser pointer position to device coordinates.
  function toDevice(e: React.PointerEvent): { x: number; y: number } {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    return {
      x: Math.round(Math.min(1, Math.max(0, fx)) * frameSize.current.w),
      y: Math.round(Math.min(1, Math.max(0, fy)) * frameSize.current.h)
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (state !== 'live') return;
    const p = toDevice(e);
    downRef.current = { ...p, t: Date.now() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerUp(e: React.PointerEvent) {
    if (state !== 'live' || !downRef.current) return;
    const up = toDevice(e);
    const down = downRef.current;
    downRef.current = null;
    const dist = Math.hypot(up.x - down.x, up.y - down.y);
    const dt = Date.now() - down.t;
    if (dist < 12) {
      send({ type: 'tap', x: up.x, y: up.y });
    } else {
      send({ type: 'swipe', x: down.x, y: down.y, x2: up.x, y2: up.y, ms: Math.min(800, Math.max(80, dt)) });
    }
  }

  // Forward physical keyboard typing to the device while focused.
  function onKeyDown(e: React.KeyboardEvent) {
    if (state !== 'live') return;
    if (e.key === 'Backspace') {
      send({ type: 'key', keycode: 67 });
      e.preventDefault();
    } else if (e.key === 'Enter') {
      send({ type: 'key', keycode: 66 });
      e.preventDefault();
    } else if (e.key.length === 1) {
      send({ type: 'text', text: e.key });
      e.preventDefault();
    }
  }

  const live = state === 'live';

  return (
    <div className="panel live-screen-panel">
      <div className="live-screen-head">
        <h2>Canlı ekran</h2>
        <div className="live-screen-meta">
          {live ? <span className="live-badge"><span className="live-dot" /> CANLI · {fps} fps</span> : null}
          {state === 'connecting' ? <span className="helper"><Loader2 size={13} className="spin" /> bağlanıyor…</span> : null}
          {state === 'offline' ? <span className="helper">cihaz bir sunucuya atanmamış</span> : null}
          {state === 'error' ? <span className="helper live-err">bağlantı hatası</span> : null}
          {live ? (
            <button type="button" className="btn-ghost" onClick={() => { cleanup(); setState('idle'); }}><Square size={13} /> Durdur</button>
          ) : (
            <button type="button" className="btn-primary" disabled={state === 'connecting'} onClick={connect}><Play size={13} /> Yayını başlat</button>
          )}
        </div>
      </div>

      <div className="live-screen-stage">
        <div
          className={`live-screen-frame ${live ? 'is-live' : ''}`}
          tabIndex={0}
          role="application"
          aria-label="Cihaz ekranı — dokunmak için tıklayın, kaydırmak için sürükleyin"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} alt="Canlı cihaz ekranı" className="live-screen-img" draggable={false} />
          {!live ? (
            <div className="live-screen-placeholder">
              {state === 'idle' || state === 'error' || state === 'offline' ? (
                <>
                  <Maximize2 size={32} />
                  <p>{online ? 'Cihazı canlı görmek ve uzaktan kontrol etmek için yayını başlatın.' : 'Cihaz çevrimdışı görünüyor.'}</p>
                </>
              ) : (
                <Loader2 size={32} className="spin" />
              )}
            </div>
          ) : null}
        </div>

        {/* Android navigation bar — works whenever the stream is live. */}
        <div className="live-screen-nav">
          <button type="button" className="live-nav-btn" disabled={!live} title="Geri" onClick={() => send({ type: 'key', keycode: KEY.BACK })}><ChevronLeft size={18} /></button>
          <button type="button" className="live-nav-btn" disabled={!live} title="Ana ekran" onClick={() => send({ type: 'key', keycode: KEY.HOME })}><Circle size={16} /></button>
          <button type="button" className="live-nav-btn" disabled={!live} title="Son uygulamalar" onClick={() => send({ type: 'key', keycode: KEY.RECENTS })}><SquareIcon size={15} /></button>
          <span className="live-nav-sep" />
          <button type="button" className="live-nav-btn" disabled={!live} title="Ses +" onClick={() => send({ type: 'key', keycode: KEY.VOL_UP })}><Volume2 size={16} /></button>
          <button type="button" className="live-nav-btn" disabled={!live} title="Ses −" onClick={() => send({ type: 'key', keycode: KEY.VOL_DOWN })}><Volume1 size={16} /></button>
          <button type="button" className="live-nav-btn" disabled={!live} title="Güç" onClick={() => send({ type: 'key', keycode: KEY.POWER })}><Power size={16} /></button>
        </div>
      </div>
      <p className="helper live-screen-hint">İpucu: ekrana tıklayın = dokunma, sürükleyin = kaydırma. Çerçeveye odaklanınca klavyeyle yazabilirsiniz.</p>
    </div>
  );
}
