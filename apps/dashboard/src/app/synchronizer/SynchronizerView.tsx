'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

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

  return (
    <PageMotion className="page">
      <PageHeader
        title="Senkronize Edici"
        subtitle="Bir bulut telefonun eylemlerini gruptaki diğer tüm telefonlara yansıtın."
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => { setSelected(new Set()); setLeader(null); }}>
              Temizle
            </button>
            <button type="button" className="btn-primary" disabled={!canSync || syncing} onClick={startSync}>
              {syncing ? 'Başlatılıyor…' : `Senkronizasyonu başlat (${selected.size})`}
            </button>
          </>
        }
      />

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      {devices.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">⧉</div>
          <h3>Henüz bulut telefon yok</h3>
          <p>Önce profiller oluşturun, ardından girişlerini yansıtmak için burada iki veya daha fazlasını seçin.</p>
        </div>
      ) : (
        <>
          <p className="helper" style={{ marginBottom: '14px' }}>
            2 veya daha fazla telefon seçin, ardından birini <strong>lider</strong> olarak işaretleyin. Girişleri her takipçiye yansıtılır.
          </p>
          <div className="profile-grid">
            {devices.map((d) => {
              const isSel = selected.has(d.id);
              const isLeader = leader === d.id;
              return (
                <article
                  key={d.id}
                  className={`profile-card sync-card${isSel ? ' sync-card-selected' : ''}`}
                  onClick={() => toggle(d.id)}
                >
                  <div className="row">
                    <strong>{d.name}</strong>
                    <span className="status-chip">
                      <span className={d.status === 'ONLINE' ? 'dot dot-online' : 'dot dot-offline'} />
                      {d.status === 'ONLINE' ? 'Çalışıyor' : 'Durduruldu'}
                    </span>
                  </div>
                  <div className="helper">Android {d.androidVersion ?? '—'}</div>
                  <div className="row" style={{ marginTop: '10px' }}>
                    <span className="helper">{isSel ? 'Seçili' : 'Seçmek için dokun'}</span>
                    {isSel && (
                      <button
                        type="button"
                        className={isLeader ? 'btn-primary btn-xs' : 'btn-ghost btn-xs'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setLeader(d.id);
                        }}
                      >
                        {isLeader ? '★ Lider' : 'Lider yap'}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </PageMotion>
  );
}
