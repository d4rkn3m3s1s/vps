'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';
import { useDeviceStream } from '../wall/useDeviceStream';
import {
  Radio, Trash2, Play, Square, Crown, Smartphone, Activity, Users, Layers,
  CircleDot, ChevronLeft, Circle, Square as SquareIcon, MonitorPlay
} from 'lucide-react';

export type SyncDevice = {
  id: string;
  name: string;
  status: string;
  androidVersion: string | null;
};

type Toast = { kind: 'ok' | 'err'; text: string } | null;
const KEY = { BACK: 4, HOME: 3, RECENTS: 187 } as const;

export function SynchronizerView({ devices }: { devices: SyncDevice[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [leader, setLeader] = useState<string | null>(null);
  // When live, the leader device streams and its input mirrors to followers via
  // the real stream.hub `mirror` mechanism (the same one the wall uses).
  const [live, setLive] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  function flash(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  }

  function toggle(id: string) {
    if (live) return; // can't change the set mid-session
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (leader === id) setLeader(null);
      } else {
        next.add(id);
        if (!leader) setLeader(id);
      }
      return next;
    });
  }

  const selectedList = useMemo(() => devices.filter((d) => selected.has(d.id)), [devices, selected]);
  const followers = useMemo(() => selectedList.filter((d) => d.id !== leader).map((d) => d.id), [selectedList, leader]);
  const canSync = selected.size >= 2 && leader !== null;

  const onlineCount = devices.filter((d) => d.status === 'ONLINE').length;
  const followerCount = leader !== null ? Math.max(0, selected.size - 1) : 0;
  const leaderName = leader !== null ? (devices.find((d) => d.id === leader)?.name ?? '—') : '—';

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="SENKRONİZATÖR"
        title="Senkronize Edici"
        subtitle="Lider telefonun canlı ekranına dokunun; her dokunuş/kaydırma tüm takipçilere ANINDA yansır (gerçek giriş aynalama)."
        actions={
          <>
            <button type="button" className="btn-ghost" disabled={live} onClick={() => { setSelected(new Set()); setLeader(null); }}>
              <Trash2 size={15} /> Temizle
            </button>
            {!live ? (
              <button type="button" className="btn-primary" disabled={!canSync} onClick={() => { setLive(true); flash({ kind: 'ok', text: `Aynalama başladı: 1 lider → ${followers.length} takipçi.` }); }}>
                <Play size={15} /> Senkronizasyonu başlat ({selected.size})
              </button>
            ) : (
              <button type="button" className="btn-ghost" onClick={() => { setLive(false); flash({ kind: 'ok', text: 'Aynalama durduruldu.' }); }}>
                <Square size={15} /> Durdur
              </button>
            )}
          </>
        }
      />

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat label="Toplam Telefon" value={<span className="mono">{devices.length}</span>} sub={`${onlineCount} çalışıyor`} tone="cyan" icon={<Smartphone size={16} />} />
          <HoloStat label="Seçili" value={<span className="mono">{selected.size}</span>} sub={canSync ? 'Senkronizasyona hazır' : 'En az 2 seçin'} tone={canSync ? 'success' : 'cyan'} icon={<Users size={16} />} />
          <HoloStat label="Lider" value={<span className="mono">{leader !== null ? leaderName : '—'}</span>} sub={leader !== null ? 'Kaynak cihaz' : 'Lider seçilmedi'} tone={leader !== null ? 'violet' : 'warning'} icon={<Crown size={16} />} />
          <HoloStat label="Takipçiler" value={<span className="mono">{followerCount}</span>} sub={live ? 'canlı yansıtılıyor' : 'Yansıtılan cihaz'} tone={live ? 'success' : 'cyan'} icon={<Layers size={16} />} />
        </div>
      </Reveal>

      {live && leader ? (
        <Reveal>
          <LeaderMirror
            deviceId={leader}
            deviceName={leaderName}
            followers={followers}
            followerNames={selectedList.filter((d) => d.id !== leader).map((d) => d.name)}
          />
        </Reveal>
      ) : devices.length === 0 ? (
        <Reveal>
          <HoloPanel title="Bulut telefon yok" icon={<Radio size={16} />} scan>
            <div className="table-empty">
              <h3>Henüz bulut telefon yok</h3>
              <p>Önce profiller oluşturun, ardından girişlerini yansıtmak için burada iki veya daha fazlasını seçin.</p>
            </div>
          </HoloPanel>
        </Reveal>
      ) : (
        <Reveal>
          <HoloPanel
            title="Senkronizasyon Filosu"
            icon={<Radio size={16} />}
            tilt
            scan
            actions={<span className="status-chip"><span className="dot dot-online" /> <span className="mono">{onlineCount}</span> aktif</span>}
          >
            <p className="helper" style={{ marginBottom: '14px' }}>
              2 veya daha fazla telefon seçin, ardından birini <strong>lider</strong> olarak işaretleyin. Başlatınca liderin canlı ekranına dokunuşlarınız takipçilere yansır.
            </p>
            <div className="holo-grid-auto">
              {devices.map((d) => {
                const isSel = selected.has(d.id);
                const isLeader = leader === d.id;
                return (
                  <Holo3D key={d.id} className={`holo-card sync-card${isSel ? ' sync-card-selected' : ''}${isLeader ? ' sync-card-leader' : ''}`}>
                    <div role="button" tabIndex={0} onClick={() => toggle(d.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(d.id); } }} style={{ cursor: 'pointer' }}>
                      <div className="row">
                        <strong>{isLeader && <Crown size={14} className="mono" style={{ marginRight: 4, verticalAlign: '-2px' }} />}{d.name}</strong>
                        <span className="status-chip"><span className={d.status === 'ONLINE' ? 'dot dot-online' : 'dot dot-offline'} />{d.status === 'ONLINE' ? 'Çalışıyor' : 'Durduruldu'}</span>
                      </div>
                      <div className="helper" style={{ marginTop: 6 }}><Activity size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />Android <span className="mono">{d.androidVersion ?? '—'}</span></div>
                      <div className="row" style={{ marginTop: '12px' }}>
                        <span className="helper"><CircleDot size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />{isSel ? 'Seçili' : 'Seçmek için dokun'}</span>
                        {isSel && (
                          <button type="button" className={isLeader ? 'btn-primary btn-xs' : 'btn-ghost btn-xs'} onClick={(e) => { e.stopPropagation(); setLeader(d.id); }}>
                            <Crown size={12} />{isLeader ? 'Lider' : 'Lider yap'}
                          </button>
                        )}
                      </div>
                    </div>
                  </Holo3D>
                );
              })}
            </div>
          </HoloPanel>
        </Reveal>
      )}
    </PageMotion>
  );
}

// Live leader screen whose input is mirrored to the followers via the real
// stream.hub `mirror` message — identical mechanism to the wall's leader cell.
function LeaderMirror({ deviceId, deviceName, followers, followerNames }: {
  deviceId: string; deviceName: string; followers: string[]; followerNames: string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { state, fps, start, stop, send, toDevice } = useDeviceStream(deviceId, canvasRef, true);
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const liveOn = state === 'live';

  // Push the mirror set to the hub whenever it (or the connection) changes — this
  // is what makes the leader's taps fan out to the followers server-side.
  useEffect(() => {
    if (state !== 'live') return;
    send({ type: 'mirror', deviceIds: followers });
  }, [state, followers, send]);

  function onPointerDown(e: React.PointerEvent) {
    if (!liveOn) return;
    const p = toDevice(e.clientX, e.clientY);
    down.current = { ...p, t: Date.now() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!liveOn || !down.current) return;
    const up = toDevice(e.clientX, e.clientY);
    const d0 = down.current;
    down.current = null;
    const dist = Math.hypot(up.x - d0.x, up.y - d0.y);
    if (dist < 12) send({ type: 'tap', x: up.x, y: up.y });
    else send({ type: 'swipe', x: d0.x, y: d0.y, x2: up.x, y2: up.y, ms: Math.min(800, Math.max(80, Date.now() - d0.t)) });
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (!liveOn) return;
    if (e.key === 'Backspace') { e.preventDefault(); send({ type: 'key', keycode: 67 }); return; }
    if (e.key === 'Enter') { e.preventDefault(); send({ type: 'key', keycode: 66 }); return; }
    if (e.key === 'Tab') return;
    if (e.key.length === 1) { e.preventDefault(); send({ type: 'text', text: e.key }); }
  }

  useEffect(() => { surfaceRef.current?.focus(); }, []);

  return (
    <HoloPanel title={`Lider: ${deviceName}`} icon={<MonitorPlay size={16} />} actions={
      <span className="status-chip"><span className="dot dot-live" /> {followers.length} takipçiye yansıyor</span>
    }>
      <div className="sync-stage">
        <div
          ref={surfaceRef}
          className={`focus-surface ${liveOn ? 'is-interactive' : ''}`}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
          style={{ maxWidth: 360, margin: '0 auto', borderRadius: 14, overflow: 'hidden', aspectRatio: '9 / 19.5' }}
        >
          <canvas ref={canvasRef} className="focus-canvas" style={{ display: liveOn ? 'block' : 'none' }} />
          {!liveOn ? (
            <div className="focus-placeholder">
              {state === 'connecting' ? <span className="helper">Bağlanıyor…</span> : (
                <button type="button" className="btn-primary" onClick={() => void start()}><Play size={16} /> Lideri başlat</button>
              )}
            </div>
          ) : null}
        </div>
        <div className="sync-stage-foot">
          <span className="focus-nav">
            <button type="button" className="live-nav-btn" title="Geri" onClick={() => send({ type: 'key', keycode: KEY.BACK })} disabled={!liveOn}><ChevronLeft size={16} /></button>
            <button type="button" className="live-nav-btn" title="Ana ekran" onClick={() => send({ type: 'key', keycode: KEY.HOME })} disabled={!liveOn}><Circle size={14} /></button>
            <button type="button" className="live-nav-btn" title="Son uygulamalar" onClick={() => send({ type: 'key', keycode: KEY.RECENTS })} disabled={!liveOn}><SquareIcon size={14} /></button>
          </span>
          {liveOn ? <span className="wall-cell-fps mono"><span className="dot dot-live" />{fps}fps</span> : null}
          {liveOn ? <button type="button" className="btn-ghost btn-xs" onClick={() => stop()}><Square size={11} /> Yayını durdur</button> : null}
        </div>
        <p className="helper" style={{ textAlign: 'center', marginTop: 8 }}>
          Takipçiler: {followerNames.join(', ') || '—'}
        </p>
      </div>
    </HoloPanel>
  );
}
