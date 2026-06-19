'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type StreamState = 'idle' | 'connecting' | 'live' | 'offline' | 'error';

// Reusable live-stream client for one device: fetches a viewer token, opens the
// /ws/stream socket, renders frames into the given <img>, and exposes a sender
// for control events. Shared by the single-device viewer and the wall grid.
export function useDeviceStream(deviceId: string, imgRef: React.RefObject<HTMLImageElement | null>, autoStart = false) {
  const [state, setState] = useState<StreamState>('idle');
  const [fps, setFps] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const objUrlRef = useRef<string | null>(null);
  const frameSize = useRef<{ w: number; h: number }>({ w: 1080, h: 1920 });
  const frameCount = useRef(0);

  const stop = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    if (objUrlRef.current) {
      URL.revokeObjectURL(objUrlRef.current);
      objUrlRef.current = null;
    }
    setState('idle');
  }, []);

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
        setState((s) => (s === 'live' ? s : 'live'));
      };
      ws.onclose = () => setState((s) => (s === 'live' || s === 'connecting' ? 'idle' : s));
      ws.onerror = () => setState('error');
    } catch {
      setState('error');
    }
  }, [deviceId, imgRef]);

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
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    const fx = (clientX - rect.left) / rect.width;
    const fy = (clientY - rect.top) / rect.height;
    return {
      x: Math.round(Math.min(1, Math.max(0, fx)) * frameSize.current.w),
      y: Math.round(Math.min(1, Math.max(0, fy)) * frameSize.current.h)
    };
  }, [imgRef]);

  return { state, fps, start, stop, send, toDevice };
}
