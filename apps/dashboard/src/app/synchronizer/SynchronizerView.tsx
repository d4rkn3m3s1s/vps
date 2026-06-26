'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';
import {
  Radio,
  Trash2,
  Play,
  Crown,
  Smartphone,
  Activity,
  Users,
  Layers,
  CircleDot
} from 'lucide-react';

export type SyncDevice = {
  id: string;
  name: string;
  status: string;
  androidVersion: string | null;
};

type Toast = { kind: 'ok' | 'err'; text: string } | null;

export function SynchronizerView({ devices }: { devices: SyncDevice[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [leader, setLeader] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  function flash(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  }

  function toggle(id: string) {
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
  const canSync = selected.size >= 2 && leader !== null;

  async function startSync() {
    if (!canSync) return;
    setSyncing(true);
    try {
      // Mirror the leader's session across the selected followers by opening
      // each selected phone — real mirroring runs once the KVM host is attached.
      const followers = selectedList.filter((d) => d.id !== leader);
      const results = await Promise.all(
        selectedList.map((d) =>
          fetch('/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'EMULATOR_START',
              emulatorId: d.id,
              payload: { syncGroup: leader, role: d.id === leader ? 'leader' : 'follower' }
            })
          })
        )
      );
      const failed = results.filter((r) => !r.ok).length;
      if (failed > 0) {
        flash({ kind: 'err', text: `${failed} iş kuyruğa alınamadı.` });
      } else {
        flash({ kind: 'ok', text: `Senkronizasyon kuyruğa alındı: 1 lider + ${followers.length} takipçi.` });
        router.refresh();
      }
    } catch {
      flash({ kind: 'err', text: 'API\'ye ulaşılamadı.' });
    } finally {
      setSyncing(false);
    }
  }

  const onlineCount = devices.filter((d) => d.status === 'ONLINE').length;
  const followerCount = leader !== null ? Math.max(0, selected.size - 1) : 0;
  const leaderName = leader !== null ? (devices.find((d) => d.id === leader)?.name ?? '—') : '—';

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="SENKRONİZATÖR"
        title="Senkronize Edici"
        subtitle="Bir bulut telefonun eylemlerini gruptaki diğer tüm telefonlara yansıtın."
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => { setSelected(new Set()); setLeader(null); }}>
              <Trash2 size={15} /> Temizle
            </button>
            <button type="button" className="btn-primary" disabled={!canSync || syncing} onClick={startSync}>
              <Play size={15} />
              {syncing ? 'Başlatılıyor…' : `Senkronizasyonu başlat (${selected.size})`}
            </button>
          </>
        }
      />

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Toplam Telefon"
            value={<span className="mono">{devices.length}</span>}
            sub={`${onlineCount} çalışıyor`}
            tone="cyan"
            icon={<Smartphone size={16} />}
          />
          <HoloStat
            label="Seçili"
            value={<span className="mono">{selected.size}</span>}
            sub={canSync ? 'Senkronizasyona hazır' : 'En az 2 seçin'}
            tone={canSync ? 'success' : 'cyan'}
            icon={<Users size={16} />}
          />
          <HoloStat
            label="Lider"
            value={<span className="mono">{leader !== null ? leaderName : '—'}</span>}
            sub={leader !== null ? 'Kaynak cihaz' : 'Lider seçilmedi'}
            tone={leader !== null ? 'violet' : 'warning'}
            icon={<Crown size={16} />}
          />
          <HoloStat
            label="Takipçiler"
            value={<span className="mono">{followerCount}</span>}
            sub="Yansıtılan cihaz"
            tone="cyan"
            icon={<Layers size={16} />}
          />
        </div>
      </Reveal>

      {devices.length === 0 ? (
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
            actions={
              <span className="status-chip">
                <span className="dot dot-online" />
                <span className="mono">{onlineCount}</span> aktif
              </span>
            }
          >
            <p className="helper" style={{ marginBottom: '14px' }}>
              2 veya daha fazla telefon seçin, ardından birini <strong>lider</strong> olarak işaretleyin. Girişleri her takipçiye yansıtılır.
            </p>
            <div className="holo-grid-auto">
              {devices.map((d) => {
                const isSel = selected.has(d.id);
                const isLeader = leader === d.id;
                return (
                  <Holo3D
                    key={d.id}
                    className={`holo-card sync-card${isSel ? ' sync-card-selected' : ''}${isLeader ? ' sync-card-leader' : ''}`}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggle(d.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(d.id); } }}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="row">
                        <strong>
                          {isLeader && <Crown size={14} className="mono" style={{ marginRight: 4, verticalAlign: '-2px' }} />}
                          {d.name}
                        </strong>
                        <span className="status-chip">
                          <span className={d.status === 'ONLINE' ? 'dot dot-online' : 'dot dot-offline'} />
                          {d.status === 'ONLINE' ? 'Çalışıyor' : 'Durduruldu'}
                        </span>
                      </div>
                      <div className="helper" style={{ marginTop: 6 }}>
                        <Activity size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                        Android <span className="mono">{d.androidVersion ?? '—'}</span>
                      </div>
                      <div className="row" style={{ marginTop: '12px' }}>
                        <span className="helper">
                          <CircleDot size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                          {isSel ? 'Seçili' : 'Seçmek için dokun'}
                        </span>
                        {isSel && (
                          <button
                            type="button"
                            className={isLeader ? 'btn-primary btn-xs' : 'btn-ghost btn-xs'}
                            onClick={(e) => {
                              e.stopPropagation();
                              setLeader(d.id);
                            }}
                          >
                            <Crown size={12} />
                            {isLeader ? 'Lider' : 'Lider yap'}
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
