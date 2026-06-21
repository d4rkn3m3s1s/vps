'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3x3, Play, Square, Link2, Crown, ChevronLeft, Circle, Square as SquareIcon } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';
import { useDeviceStream } from './useDeviceStream';

export type WallDevice = { id: string; name: string; status: string; groupId?: string | null; group?: { id: string; name: string } | null };
export type WallGroup = { id: string; name: string };

const KEY = { BACK: 4, HOME: 3, RECENTS: 187 } as const;

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

  const shown = useMemo(
    () => devices.filter((d) => groupFilter === 'all' || (d.groupId ?? d.group?.id) === groupFilter),
    [devices, groupFilter]
  );
  const shownIds = shown.map((d) => d.id);

  // When sync mode is on with a leader, followers are every other shown device.
  const followers = syncMode && leader ? shownIds.filter((id) => id !== leader) : [];

  return (
    <PageMotion className="page">
      <PageHeader
        title="Canlı Duvar"
        subtitle={`Telefonları tek tek veya toplu canlı izleyin${liveCount > 0 ? ` · ${liveCount} canlı` : ''}. Senkron modda bir lider tüm filoyu sürer.`}
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

      {syncMode ? (
        <p className="helper" style={{ marginBottom: '0.75rem' }}>
          <Crown size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {leader ? `Lider seçildi — bu ekrandaki dokunuşlar ${followers.length} takipçiye yansır.` : 'Bir hücreyi lider seçin; dokunuşları diğer tüm telefonlara yansıyacak.'}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">▦</div>
          <h3>Gösterilecek cihaz yok</h3>
          <p>Bir grup seçin veya önce profil oluşturun.</p>
        </div>
      ) : (
        <div className="wall-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {shown.map((d) => (
            <WallCell
              key={d.id}
              device={d}
              bulk={bulk}
              syncMode={syncMode}
              isLeader={leader === d.id}
              followers={leader === d.id ? followers : []}
              onMakeLeader={() => setLeader(d.id)}
              onLiveChange={(isLive) => setLiveCount((c) => Math.max(0, c + (isLive ? 1 : -1)))}
            />
          ))}
        </div>
      )}
    </PageMotion>
  );
}

function WallCell({
  device, bulk, syncMode, isLeader, followers, onMakeLeader, onLiveChange
}: {
  device: WallDevice;
  bulk: { cmd: 'start' | 'stop'; n: number };
  syncMode: boolean;
  isLeader: boolean;
  followers: string[];
  onMakeLeader: () => void;
  onLiveChange: (isLive: boolean) => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const { state, fps, start, stop, send, toDevice } = useDeviceStream(device.id, imgRef);
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
  return (
    <div className={`wall-cell ${isLeader ? 'wall-cell-leader' : ''}`}>
      <div className="wall-cell-head">
        <span className="wall-cell-name">{device.name}</span>
        {live ? (
          <span className="wall-cell-fps">{fps}fps</span>
        ) : (
          <span className="wall-cell-state">{connecting ? '…' : state === 'offline' ? 'sunucu yok' : state === 'error' ? 'hata' : '—'}</span>
        )}
      </div>
      <div
        className={`wall-cell-frame ${interactive ? 'is-interactive' : ''}`}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} alt={device.name} className="wall-cell-img" draggable={false} />
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
    </div>
  );
}
