'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Grid3x3, Play, Square, Link2, Crown, ChevronLeft, Circle, Square as SquareIcon,
  Radio, MonitorPlay, Layers, Maximize2, X, GripVertical, Keyboard
} from 'lucide-react';
import { HoloHeader, HoloPanel, HoloStat, Holo3D } from '../../components/hud';
import { PageMotion } from '../../components/Motion';
import { useDeviceStream } from './useDeviceStream';

export type WallDevice = { id: string; name: string; status: string; groupId?: string | null; group?: { id: string; name: string } | null };
export type WallGroup = { id: string; name: string };

const KEY = { BACK: 4, HOME: 3, RECENTS: 187 } as const;
const ORDER_KEY = 'wall.order.v1';

export function WallView({ devices, groups }: { devices: WallDevice[]; groups: WallGroup[] }) {
  const [groupFilter, setGroupFilter] = useState('all');
  // Bulk control is a one-shot signal: each tick tells every cell to start or
  // stop. Cells also have their own Play/Stop button for per-device control, so
  // `bulk` only nudges them — it doesn't lock their individual state.
  const [bulk, setBulk] = useState<{ cmd: 'start' | 'stop'; n: number }>({ cmd: 'stop', n: 0 });
  const [liveCount, setLiveCount] = useState(0);
  const [syncMode, setSyncMode] = useState(false);
  const [leader, setLeader] = useState<string | null>(null);
  const [cols, setCols] = useState(4);
  // Focus mode (tekli açma / odak): one device blown up in an overlay.
  const [focusId, setFocusId] = useState<string | null>(null);
  // User-defined ordering (tutup sürükleme). Persisted to localStorage so a
  // hand-arranged wall survives reloads. Devices not in the saved order append.
  const [order, setOrder] = useState<string[]>([]);
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Restore saved order once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (raw) setOrder(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
  }, []);

  const persistOrder = useCallback((next: string[]) => {
    setOrder(next);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const filtered = useMemo(
    () => devices.filter((d) => groupFilter === 'all' || (d.groupId ?? d.group?.id) === groupFilter),
    [devices, groupFilter]
  );

  // Apply the saved order, then append any devices not yet in it.
  const shown = useMemo(() => {
    const pos = new Map(order.map((id, i) => [id, i]));
    return [...filtered].sort((a, b) => {
      const ai = pos.has(a.id) ? pos.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const bi = pos.has(b.id) ? pos.get(b.id)! : Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }, [filtered, order]);
  const shownIds = shown.map((d) => d.id);

  // When sync mode is on with a leader, followers are every other shown device.
  const followers = syncMode && leader ? shownIds.filter((id) => id !== leader) : [];

  const focusDevice = focusId ? devices.find((d) => d.id === focusId) ?? null : null;

  // ── Drag-to-reorder ────────────────────────────────────────────────────────
  function onDragStart(id: string) { dragId.current = id; }
  function onDragOver(e: React.DragEvent, overId: string) {
    e.preventDefault();
    if (overId !== dragOverId) setDragOverId(overId);
  }
  function onDrop(overId: string) {
    const from = dragId.current;
    dragId.current = null;
    setDragOverId(null);
    if (!from || from === overId) return;
    const ids = shown.map((d) => d.id);
    const fromIdx = ids.indexOf(from);
    const toIdx = ids.indexOf(overId);
    if (fromIdx < 0 || toIdx < 0) return;
    const next = [...ids];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, from);
    persistOrder(next);
  }

  // Escape closes focus mode.
  useEffect(() => {
    if (!focusId) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setFocusId(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusId]);

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="CİHAZ DUVARI"
        title="Canlı Duvar"
        subtitle={`Telefonları tek tek veya toplu canlı izleyin${liveCount > 0 ? ` · ${liveCount} canlı` : ''}. Hücreyi sürükleyip dizin, çift tıkla büyüt.`}
        actions={
          <>
            <select className="inline-select" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
              <option value="all">Tüm cihazlar ({devices.length})</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select className="inline-select" value={String(cols)} onChange={(e) => setCols(Number(e.target.value))} title="Sütun sayısı">
              {[2, 3, 4, 5, 6].map((c) => <option key={c} value={String(c)}>{c} sütun</option>)}
            </select>
            <button type="button" className={syncMode ? 'btn-primary' : 'btn-ghost'} onClick={() => { setSyncMode((s) => !s); setLeader(null); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Link2 size={14} /> Senkron {syncMode ? 'açık' : 'kapalı'}
            </button>
            <button type="button" className="btn-primary" disabled={shown.length === 0} onClick={() => setBulk((b) => ({ cmd: 'start', n: b.n + 1 }))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Play size={14} /> Hepsini başlat</button>
            <button type="button" className="btn-ghost" disabled={shown.length === 0} onClick={() => setBulk((b) => ({ cmd: 'stop', n: b.n + 1 }))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Square size={14} /> Hepsini durdur</button>
          </>
        }
      />

      <div className="holo-stats-grid" style={{ marginBottom: '1rem' }}>
        <HoloStat
          label="Gösterilen cihaz"
          value={<span className="mono">{shown.length}</span>}
          sub={`Toplam ${devices.length} cihaz`}
          tone="cyan"
          icon={<MonitorPlay size={16} />}
        />
        <HoloStat
          label="Canlı yayın"
          value={<span className="mono">{liveCount}</span>}
          sub={liveCount > 0 ? 'akış aktif' : 'beklemede'}
          tone={liveCount > 0 ? 'success' : 'cyan'}
          icon={<Radio size={16} />}
        />
        <HoloStat
          label="Izgara"
          value={<span className="mono">{cols}×</span>}
          sub="sütun düzeni"
          tone="violet"
          icon={<Grid3x3 size={16} />}
        />
        <HoloStat
          label="Senkron mod"
          value={<span className="mono">{syncMode ? (leader ? followers.length + 1 : 'AÇIK') : 'KAPALI'}</span>}
          sub={syncMode ? (leader ? `${followers.length} takipçi` : 'lider bekleniyor') : 'pasif'}
          tone={syncMode ? 'warning' : 'cyan'}
          icon={<Layers size={16} />}
        />
      </div>

      {syncMode ? (
        <p className="helper" style={{ marginBottom: '0.75rem' }}>
          <Crown size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {leader ? `Lider seçildi — bu ekrandaki dokunuşlar ${followers.length} takipçiye yansır.` : 'Bir hücreyi lider seçin; dokunuşları diğer tüm telefonlara yansıyacak.'}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <HoloPanel title="Cihaz duvarı" icon={<MonitorPlay size={16} />}>
          <div className="empty-state">
            <div className="empty-art">▦</div>
            <h3>Gösterilecek cihaz yok</h3>
            <p>Bir grup seçin veya önce profil oluşturun.</p>
          </div>
        </HoloPanel>
      ) : (
        <HoloPanel
          title="Cihaz duvarı"
          icon={<MonitorPlay size={16} />}
          actions={<span className="status-chip"><span className="dot dot-live" /> {liveCount} canlı · {shown.length} cihaz</span>}
        >
          <div className="wall-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {shown.map((d) => (
              <WallCell
                key={d.id}
                device={d}
                bulk={bulk}
                syncMode={syncMode}
                isLeader={leader === d.id}
                followers={leader === d.id ? followers : []}
                dragOver={dragOverId === d.id}
                onMakeLeader={() => setLeader(d.id)}
                onFocus={() => setFocusId(d.id)}
                onLiveChange={(isLive) => setLiveCount((c) => Math.max(0, c + (isLive ? 1 : -1)))}
                onDragStart={() => onDragStart(d.id)}
                onDragOver={(e) => onDragOver(e, d.id)}
                onDrop={() => onDrop(d.id)}
                onDragEnd={() => { dragId.current = null; setDragOverId(null); }}
              />
            ))}
          </div>
        </HoloPanel>
      )}

      {focusDevice ? (
        <FocusOverlay
          device={focusDevice}
          onClose={() => setFocusId(null)}
        />
      ) : null}
    </PageMotion>
  );
}

function WallCell({
  device, bulk, syncMode, isLeader, followers, dragOver,
  onMakeLeader, onFocus, onLiveChange, onDragStart, onDragOver, onDrop, onDragEnd
}: {
  device: WallDevice;
  bulk: { cmd: 'start' | 'stop'; n: number };
  syncMode: boolean;
  isLeader: boolean;
  followers: string[];
  dragOver: boolean;
  onMakeLeader: () => void;
  onFocus: () => void;
  onLiveChange: (isLive: boolean) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { state, fps, start, stop, send, toDevice } = useDeviceStream(device.id, canvasRef);
  const down = useRef<{ x: number; y: number; t: number } | null>(null);

  // React to bulk start/stop nudges from the toolbar. Each bulk click bumps
  // bulk.n so the same command can fire repeatedly; we skip the initial mount.
  const lastBulk = useRef(0);
  useEffect(() => {
    if (bulk.n === 0 || bulk.n === lastBulk.current) return;
    lastBulk.current = bulk.n;
    if (bulk.cmd === 'start') void start(); else stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulk]);

  // Report live/offline transitions up so the toolbar can show a count.
  const wasLive = useRef(false);
  useEffect(() => {
    const isLive = state === 'live';
    if (isLive !== wasLive.current) {
      wasLive.current = isLive;
      onLiveChange(isLive);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Keep the leader's mirror set in sync with the follower list.
  useEffect(() => {
    if (state !== 'live') return;
    send({ type: 'mirror', deviceIds: isLeader ? followers : [] });
  }, [state, isLeader, followers, send]);

  // Only the leader (sync on) or any cell (sync off) accepts input.
  const interactive = state === 'live' && (!syncMode || isLeader);

  function onPointerDown(e: React.PointerEvent) {
    if (!interactive) return;
    const p = toDevice(e.clientX, e.clientY);
    down.current = { ...p, t: Date.now() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!interactive || !down.current) return;
    const up = toDevice(e.clientX, e.clientY);
    const d0 = down.current;
    down.current = null;
    const dist = Math.hypot(up.x - d0.x, up.y - d0.y);
    if (dist < 12) send({ type: 'tap', x: up.x, y: up.y });
    else send({ type: 'swipe', x: d0.x, y: d0.y, x2: up.x, y2: up.y, ms: Math.min(800, Math.max(80, Date.now() - d0.t)) });
  }

  const live = state === 'live';
  const connecting = state === 'connecting';
  // Drag-to-reorder is armed ONLY while grabbing the grip handle. A cell-wide
  // `draggable` swallows pointer/touch events on the canvas (the browser treats
  // every press as the start of a drag), which broke tapping the live screen.
  // So the wrapper is draggable only after pointerdown on the grip.
  const [dragArmed, setDragArmed] = useState(false);
  return (
    <div
      className={`wall-cell-drag ${dragOver ? 'wall-cell-dragover' : ''}`}
      draggable={dragArmed}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={() => { setDragArmed(false); onDragEnd(); }}
    >
    <Holo3D
      className={`wall-cell ${isLeader ? 'wall-cell-leader' : ''}`}
      max={5}
      glare={false}
    >
      <span className="holo-corner holo-corner-tl" aria-hidden />
      <span className="holo-corner holo-corner-tr" aria-hidden />
      <span className="holo-corner holo-corner-bl" aria-hidden />
      <span className="holo-corner holo-corner-br" aria-hidden />
      <div className="wall-cell-head">
        <span
          className="wall-cell-grip"
          title="Sürükleyerek taşı"
          onPointerDown={() => setDragArmed(true)}
          onPointerUp={() => setDragArmed(false)}
        ><GripVertical size={13} /></span>
        <span className="wall-cell-name">{device.name}</span>
        {live ? (
          <span className="wall-cell-fps mono"><span className="dot dot-live" />{fps}fps</span>
        ) : (
          <span className="wall-cell-state">{connecting ? '…' : state === 'offline' ? 'sunucu yok' : state === 'error' ? 'hata' : '—'}</span>
        )}
        <button type="button" className="wall-cell-expand" title="Büyüt / odakla" aria-label="Büyüt" onClick={onFocus}>
          <Maximize2 size={13} />
        </button>
      </div>
      <div
        className={`wall-cell-frame ${interactive ? 'is-interactive' : ''}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onDoubleClick={onFocus}
      >
        <span className="holo-scan" aria-hidden />
        <canvas
          ref={canvasRef}
          className="wall-cell-img"
          /* Hidden until the first frame paints so the empty canvas never shows. */
          style={{ display: live ? 'block' : 'none' }}
        />
        {!live ? (
          <div className="wall-cell-placeholder">
            {connecting ? (
              '…'
            ) : (
              <button type="button" className="wall-cell-play" onClick={() => void start()} title="Yayını başlat" aria-label="Yayını başlat">
                <Play size={20} />
              </button>
            )}
          </div>
        ) : null}
        {isLeader ? <span className="wall-cell-badge"><Crown size={11} /> Lider</span> : null}
      </div>
      <div className="wall-cell-foot">
        {/* Per-device Play/Stop — each cell opens/closes independently. */}
        {live || connecting ? (
          <button type="button" className="btn-ghost btn-xs" onClick={() => stop()} title="Durdur"><Square size={11} /> Durdur</button>
        ) : (
          <button type="button" className="btn-ghost btn-xs" onClick={() => void start()} title="Başlat"><Play size={11} /> Başlat</button>
        )}
        {syncMode && !isLeader && live ? (
          <button type="button" className="btn-ghost btn-xs" onClick={onMakeLeader}><Crown size={11} /> Lider yap</button>
        ) : null}
        {interactive ? (
          <span className="wall-cell-nav">
            <button type="button" className="live-nav-btn" title="Geri" onClick={() => send({ type: 'key', keycode: KEY.BACK })}><ChevronLeft size={14} /></button>
            <button type="button" className="live-nav-btn" title="Ana ekran" onClick={() => send({ type: 'key', keycode: KEY.HOME })}><Circle size={12} /></button>
            <button type="button" className="live-nav-btn" title="Son uygulamalar" onClick={() => send({ type: 'key', keycode: KEY.RECENTS })}><SquareIcon size={12} /></button>
          </span>
        ) : null}
      </div>
    </Holo3D>
    </div>
  );
}

// Focus overlay (tekli açma + odak): a single device blown up large, auto-started,
// with full touch + physical-keyboard input and a back/home/recents bar.
function FocusOverlay({ device, onClose }: { device: WallDevice; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { state, fps, start, stop, send, toDevice } = useDeviceStream(device.id, canvasRef, true);
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const live = state === 'live';
  const interactive = live;

  function onPointerDown(e: React.PointerEvent) {
    if (!interactive) return;
    const p = toDevice(e.clientX, e.clientY);
    down.current = { ...p, t: Date.now() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!interactive || !down.current) return;
    const up = toDevice(e.clientX, e.clientY);
    const d0 = down.current;
    down.current = null;
    const dist = Math.hypot(up.x - d0.x, up.y - d0.y);
    if (dist < 12) send({ type: 'tap', x: up.x, y: up.y });
    else send({ type: 'swipe', x: d0.x, y: d0.y, x2: up.x, y2: up.y, ms: Math.min(800, Math.max(80, Date.now() - d0.t)) });
  }

  // Physical keyboard → device. Backspace/Enter map to keycodes; printable
  // characters are sent as text. Captured while the overlay surface is focused.
  function onKeyDown(e: React.KeyboardEvent) {
    if (!interactive) return;
    if (e.key === 'Backspace') { e.preventDefault(); send({ type: 'key', keycode: 67 }); return; }
    if (e.key === 'Enter') { e.preventDefault(); send({ type: 'key', keycode: 66 }); return; }
    if (e.key === 'Tab') { return; }
    if (e.key.length === 1) { e.preventDefault(); send({ type: 'text', text: e.key }); }
  }

  // Auto-focus the surface so the physical keyboard works immediately.
  useEffect(() => { surfaceRef.current?.focus(); }, []);

  return (
    <div className="focus-overlay" onClick={onClose}>
      <div className="focus-shell" onClick={(e) => e.stopPropagation()}>
        <header className="focus-head">
          <div className="focus-title">
            <MonitorPlay size={16} />
            <strong>{device.name}</strong>
            {live ? <span className="wall-cell-fps mono"><span className="dot dot-live" />{fps}fps</span> : <span className="wall-cell-state">{state === 'connecting' ? 'bağlanıyor…' : state === 'offline' ? 'sunucu yok' : state === 'error' ? 'hata' : '—'}</span>}
            {live ? <span className="focus-hint"><Keyboard size={12} /> Fiziksel klavye aktif</span> : null}
          </div>
          <button type="button" className="modal-close" aria-label="Kapat" onClick={onClose}><X size={16} /></button>
        </header>
        <div
          ref={surfaceRef}
          className={`focus-surface ${interactive ? 'is-interactive' : ''}`}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <canvas ref={canvasRef} className="focus-canvas" style={{ display: live ? 'block' : 'none' }} />
          {!live ? (
            <div className="focus-placeholder">
              {state === 'connecting' ? <span className="helper">Bağlanıyor…</span> : (
                <button type="button" className="btn-primary" onClick={() => void start()}><Play size={16} /> Yayını başlat</button>
              )}
            </div>
          ) : null}
        </div>
        <footer className="focus-foot">
          <span className="focus-nav">
            <button type="button" className="live-nav-btn" title="Geri" onClick={() => send({ type: 'key', keycode: KEY.BACK })} disabled={!interactive}><ChevronLeft size={16} /></button>
            <button type="button" className="live-nav-btn" title="Ana ekran" onClick={() => send({ type: 'key', keycode: KEY.HOME })} disabled={!interactive}><Circle size={14} /></button>
            <button type="button" className="live-nav-btn" title="Son uygulamalar" onClick={() => send({ type: 'key', keycode: KEY.RECENTS })} disabled={!interactive}><SquareIcon size={14} /></button>
          </span>
          {live ? (
            <button type="button" className="btn-ghost btn-xs" onClick={() => stop()}><Square size={11} /> Durdur</button>
          ) : (
            <button type="button" className="btn-ghost btn-xs" onClick={() => void start()}><Play size={11} /> Başlat</button>
          )}
        </footer>
      </div>
    </div>
  );
}
