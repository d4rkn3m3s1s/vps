'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type StreamState = 'idle' | 'connecting' | 'live' | 'offline' | 'error';

// Reusable live-stream client for one device: fetches a viewer token, opens the
// /ws/stream socket, and paints frames into the given <canvas>. Frames arrive as
// JPEG/PNG (the ffmpeg→MJPEG path) or, when the agent runs the raw-H.264 path,
// as Annex-B chunks (decoded via WebCodecs). Painting to a canvas via
// createImageBitmap (decoded off-thread, drawn atomically) means the surface
// NEVER blanks between frames — no black flicker on tap/motion. Exposes a sender
// for control events + a coordinate mapper. Shared by the wall grid and the
// single-device viewer.
export function useDeviceStream(deviceId: string, canvasRef: React.RefObject<HTMLCanvasElement | null>, autoStart = false) {
  const [state, setState] = useState<StreamState>('idle');
  const [fps, setFps] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const frameSize = useRef<{ w: number; h: number }>({ w: 1080, h: 1920 });
  const frameCount = useRef(0);
  // Single-frame decode pump: keep only the newest frame, decode one at a time.
  const pending = useRef<ArrayBuffer | null>(null);
  const decoding = useRef(false);
  // WebCodecs H.264 decoder (raw path); null until a raw-H.264 frame is seen.
  const decoderRef = useRef<VideoDecoder | null>(null);
  const decoderError = useRef(false);
  const gotKeyframe = useRef(false);

  const stop = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    pending.current = null;
    decoding.current = false;
    gotKeyframe.current = false;
    if (decoderRef.current) { try { decoderRef.current.close(); } catch { /* closed */ } decoderRef.current = null; }
    setState('idle');
  }, []);

  // Paint a decoded bitmap/frame onto the canvas, sizing it on first paint.
  const paintBitmap = useCallback((bmp: ImageBitmap | VideoFrame, w: number, h: number) => {
    const canvas = canvasRef.current;
    if (!canvas) { if ('close' in bmp) bmp.close(); return; }
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w; canvas.height = h;
      frameSize.current = { w, h };
    }
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(bmp as CanvasImageSource, 0, 0);
    if ('close' in bmp) bmp.close();
    frameCount.current += 1;
    setState((s) => (s === 'live' ? s : 'live'));
  }, [canvasRef]);

  // JPEG/PNG pump: decode the latest pending frame off-thread via
  // createImageBitmap, then draw it. Drops stale frames so we never lag.
  const pump = useCallback(async () => {
    if (decoding.current) return;
    const buf = pending.current;
    if (!buf) return;
    pending.current = null;
    decoding.current = true;
    try {
      const bmp = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
      paintBitmap(bmp, bmp.width, bmp.height);
    } catch {
      /* a dropped frame is fine; the next one repaints */
    } finally {
      decoding.current = false;
      if (pending.current) void pump();
    }
  }, [paintBitmap]);

  // Raw-H.264 access unit (flag byte + Annex-B). Lazily configures the decoder;
  // drops deltas until the first keyframe so it never stalls to black.
  const handleH264 = useCallback((payload: Uint8Array) => {
    if (decoderError.current || typeof VideoDecoder === 'undefined') { decoderError.current = true; return; }
    const flag = payload[0] ?? 0;
    const data = payload.subarray(1);
    const isKey = (flag & 1) === 1;
    if (!decoderRef.current) {
      try {
        const dec = new VideoDecoder({
          output: (frame) => paintBitmap(frame, frame.displayWidth, frame.displayHeight),
          error: () => { decoderError.current = true; }
        });
        dec.configure({ codec: 'avc1.42E01F', optimizeForLatency: true } as VideoDecoderConfig);
        decoderRef.current = dec;
      } catch { decoderError.current = true; return; }
    }
    const dec = decoderRef.current;
    if (!dec) return;
    if (isKey) gotKeyframe.current = true;
    if (!gotKeyframe.current) return;
    try {
      dec.decode(new EncodedVideoChunk({ type: isKey ? 'key' : 'delta', timestamp: performance.now() * 1000, data }));
    } catch { decoderError.current = true; }
  }, [paintBitmap]);

  const start = useCallback(async () => {
    if (wsRef.current) return;
    setState('connecting');
    try {
      const res = await fetch(`/api/devices/${deviceId}/stream-token`, { method: 'POST' });
      const json = await res.json();
      const data = json.data as { token: string; wsBase: string } | null;
      if (!res.ok || !data?.token) { setState('error'); return; }
      const url = `${data.wsBase}/ws/stream?token=${encodeURIComponent(data.token)}&deviceId=${encodeURIComponent(deviceId)}`;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          try {
            const m = JSON.parse(ev.data);
            if (m.type === 'stream.connected' && !m.hasHost) setState('offline');
          } catch { /* ignore */ }
          return;
        }
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        // Raw H.264? flag byte (0-3) then an Annex-B start code.
        const isH264 = bytes.length > 5 && bytes[0]! <= 3 &&
          ((bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0 && bytes[4] === 1) ||
            (bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 1));
        if (isH264 && typeof VideoDecoder !== 'undefined' && !decoderError.current) {
          handleH264(bytes);
          return;
        }
        pending.current = ev.data as ArrayBuffer;
        void pump();
      };
      ws.onclose = () => setState((s) => (s === 'live' || s === 'connecting' ? 'idle' : s));
      ws.onerror = () => setState('error');
    } catch {
      setState('error');
    }
  }, [deviceId, pump, handleH264]);

  // FPS meter.
  useEffect(() => {
    const t = setInterval(() => { setFps(frameCount.current); frameCount.current = 0; }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (autoStart) void start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback((obj: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const toDevice = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    return {
      x: Math.round(Math.min(1, Math.max(0, fx)) * frameSize.current.w),
      y: Math.round(Math.min(1, Math.max(0, fy)) * frameSize.current.h)
    };
  }, [canvasRef]);

  return { state, fps, start, stop, send, toDevice };
}
