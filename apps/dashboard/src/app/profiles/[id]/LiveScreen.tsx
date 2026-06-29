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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // WebCodecs H.264 decoder state (raw-stream fast path).
  const decoderRef = useRef<VideoDecoder | null>(null);
  const decoderError = useRef(false);
  const gotKeyframe = useRef(false);
  // Pointer-down position (in device coords) to distinguish tap from swipe.
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // Natural frame size, learned from the first decoded frame.
  const frameSize = useRef<{ w: number; h: number }>({ w: 1080, h: 1920 });
  const frameCount = useRef(0);
  // Single-frame decode pump for the JPEG path (keep only the newest frame).
  const jpegDecoding = useRef(false);
  const jpegPending = useRef<ArrayBuffer | null>(null);

  const cleanup = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    if (decoderRef.current) {
      try { decoderRef.current.close(); } catch { /* already closed */ }
      decoderRef.current = null;
    }
    gotKeyframe.current = false;
    jpegPending.current = null;
    jpegDecoding.current = false;
  }, []);

  // Paint any decoded source (ImageBitmap or VideoFrame) onto the ONE canvas.
  // Drawing to a canvas is atomic — the surface never blanks between frames, so
  // there's no black flicker on tap/motion (the old <img>.src swap blanked).
  const paint = useCallback((src: CanvasImageSource, w: number, h: number) => {
    const canvas = canvasRef.current;
    if (!canvas) { if (typeof (src as ImageBitmap).close === 'function') (src as ImageBitmap).close(); return; }
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w; canvas.height = h;
      frameSize.current = { w, h };
    }
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(src, 0, 0);
    if (typeof (src as ImageBitmap).close === 'function') (src as ImageBitmap).close();
    frameCount.current += 1;
    setState((s) => (s === 'live' ? s : 'live'));
  }, []);

  // JPEG/PNG pump: decode the latest frame off-thread (createImageBitmap), then
  // draw it. Stale frames are dropped so we never lag behind on motion.
  const pumpJpeg = useCallback(async () => {
    if (jpegDecoding.current) return;
    const buf = jpegPending.current;
    if (!buf) return;
    jpegPending.current = null;
    jpegDecoding.current = true;
    try {
      const bmp = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
      paint(bmp, bmp.width, bmp.height);
    } catch {
      /* dropped frame; next repaints */
    } finally {
      jpegDecoding.current = false;
      if (jpegPending.current) void pumpJpeg();
    }
  }, [paint]);

  // Feed one raw-H.264 access unit (flag byte + Annex-B bytes) into WebCodecs,
  // painting decoded frames to the same canvas. Drops deltas until the first key.
  const handleH264 = useCallback((payload: Uint8Array) => {
    if (decoderError.current) return;
    if (typeof VideoDecoder === 'undefined') { decoderError.current = true; return; }
    const flag = payload[0] ?? 0;
    const data = payload.subarray(1);
    const isKey = (flag & 1) === 1;
    if (!decoderRef.current) {
      try {
        const dec = new VideoDecoder({
          output: (frame) => paint(frame, frame.displayWidth, frame.displayHeight),
          error: () => { decoderError.current = true; }
        });
        dec.configure({ codec: 'avc1.42E01F', optimizeForLatency: true } as VideoDecoderConfig);
        decoderRef.current = dec;
      } catch {
        decoderError.current = true;
        return;
      }
    }
    const dec = decoderRef.current;
    if (!dec) return;
    if (isKey) gotKeyframe.current = true;
    if (!gotKeyframe.current) return;
    try {
      dec.decode(new EncodedVideoChunk({ type: isKey ? 'key' : 'delta', timestamp: performance.now() * 1000, data }));
    } catch {
      decoderError.current = true;
    }
  }, [paint]);

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
        // Binary frame. Both formats paint to the SAME canvas:
        //   - raw H.264: flag byte (0-3) + Annex-B start code → WebCodecs.
        //   - JPEG/PNG: anything else → createImageBitmap.
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        const isH264 =
          bytes.length > 5 &&
          bytes[0]! <= 3 &&
          ((bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0 && bytes[4] === 1) ||
            (bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 1));
        if (isH264 && typeof VideoDecoder !== 'undefined' && !decoderError.current) {
          handleH264(bytes);
          return;
        }
        // JPEG/PNG → keep only the latest frame; the pump decodes + draws it.
        jpegPending.current = ev.data as ArrayBuffer;
        void pumpJpeg();
      };
      ws.onclose = () => setState((s) => (s === 'live' || s === 'connecting' ? 'idle' : s));
      ws.onerror = () => setState('error');
    } catch {
      setState('error');
    }
  }, [deviceId, pumpJpeg, handleH264]);

  // FPS meter.
  useEffect(() => {
    const t = setInterval(() => {
      setFps(frameCount.current);
      frameCount.current = 0;
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  // Auto-start the stream once on mount when the device is online, so opening a
  // device goes straight to a live view. The user can still Stop/Start manually.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (online && !autoStarted.current) {
      autoStarted.current = true;
      void connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  function send(obj: Record<string, unknown>) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  // Map a browser pointer position to device coordinates (read from the canvas).
  function toDevice(e: React.PointerEvent): { x: number; y: number } {
    const surface = canvasRef.current;
    if (!surface) return { x: 0, y: 0 };
    const rect = surface.getBoundingClientRect();
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
        <div className="live-phone-frame">
        <div
          className={`live-screen-frame ${live ? 'is-live' : ''}`}
          tabIndex={0}
          role="application"
          aria-label="Cihaz ekranı — dokunmak için tıklayın, kaydırmak için sürükleyin"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <canvas
            ref={canvasRef}
            className="live-screen-img"
            style={{ display: live ? 'block' : 'none' }}
          />
          {!live ? (
            <div className="live-screen-placeholder">
              {state === 'connecting' ? (
                <>
                  <Loader2 size={36} className="spin" />
                  <p>Bağlanıyor…</p>
                </>
              ) : (
                <>
                  {online ? (
                    <button
                      type="button"
                      className="live-play-btn"
                      onClick={connect}
                      aria-label="Yayını başlat"
                      title="Yayını başlat"
                    >
                      <Play size={34} />
                    </button>
                  ) : (
                    <Maximize2 size={32} />
                  )}
                  <p>
                    {online
                      ? state === 'error'
                        ? 'Bağlantı hatası — tekrar denemek için oynata basın.'
                        : state === 'offline'
                          ? 'Cihaz bir sunucuya atanmamış.'
                          : 'Canlı görüntü için oynata basın.'
                      : 'Cihaz çevrimdışı görünüyor.'}
                  </p>
                </>
              )}
            </div>
          ) : null}
        </div>
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
