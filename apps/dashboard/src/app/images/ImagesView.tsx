'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, Copy, RotateCcw, Trash2, Globe, Lock, Users, Download, HardDrive, Clock, Boxes, CheckCircle2, Store } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, HoloTabs, Holo3D, Reveal } from '../../components/hud';

export type Snapshot = {
  id: string;
  name: string;
  description: string | null;
  sizeBytes: number;
  androidVersion: string | null;
  tags: string[];
  visibility: 'PRIVATE' | 'WORKSPACE' | 'PUBLIC';
  status: 'PENDING' | 'READY' | 'FAILED';
  installs: number;
  sourceDeviceName: string | null;
  metadata?: { manufacturer?: string; model?: string; osVersion?: string } | null;
  createdAt: string;
};
export type ImgDevice = { id: string; name: string };
export type ImgGroup = { id: string; name: string };

const VIS_LABEL: Record<Snapshot['visibility'], string> = { PRIVATE: 'Özel', WORKSPACE: 'Çalışma alanı', PUBLIC: 'Herkese açık' };
const STATUS_LABEL: Record<Snapshot['status'], string> = { PENDING: 'Yakalanıyor…', READY: 'Hazır', FAILED: 'Başarısız' };

function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function ImagesView({ snapshots, market, devices, groups }: { snapshots: Snapshot[]; market: Snapshot[]; devices: ImgDevice[]; groups: ImgGroup[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<'library' | 'market'>('library');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [restoreFor, setRestoreFor] = useState<Snapshot | null>(null);
  const [cloneFor, setCloneFor] = useState<Snapshot | null>(null);
  const [restoreDevice, setRestoreDevice] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneGroup, setCloneGroup] = useState('');

  function flash(text: string, kind: 'ok' | 'err' = 'ok') {
    setMsg({ text, kind });
    setTimeout(() => setMsg(null), 4000);
  }

  async function doRestore() {
    if (!restoreFor || !restoreDevice) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/snapshots/${restoreFor.id}/restore`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: restoreDevice })
      });
      if (!res.ok) throw new Error('Geri yükleme başarısız');
      flash('Geri yükleme sıraya alındı.', 'ok');
      setRestoreFor(null);
      setRestoreDevice('');
      router.refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Geri yükleme başarısız', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function doClone() {
    if (!cloneFor || !cloneName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/snapshots/${cloneFor.id}/clone`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cloneName.trim(), groupId: cloneGroup || undefined })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('Kopyalama başarısız');
      // Be honest: the snapshot artifact is host-local, so the image only applies
      // when the clone lands on a host (the source device's host). Without one the
      // device row is created but its contents are NOT restored.
      const restored = (json.data as { restoreDispatched?: boolean } | undefined)?.restoreDispatched;
      if (restored === false) {
        flash('Cihaz oluşturuldu ANCAK imaj içeriği uygulanmadı (kaynak cihazın host’u yok). Bir host atayıp geri yüklemeyi tekrar çalıştırın.', 'err');
      } else {
        flash('Yeni cihaz imajdan oluşturuldu, geri yükleme başlatıldı.', 'ok');
      }
      setCloneFor(null);
      setCloneName('');
      setCloneGroup('');
      router.refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Kopyalama başarısız', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function setVisibility(s: Snapshot, visibility: Snapshot['visibility']) {
    setBusy(true);
    try {
      const res = await fetch(`/api/snapshots/${s.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility }) });
      if (!res.ok) throw new Error('Görünürlük güncellenemedi');
      flash(`Görünürlük: ${VIS_LABEL[visibility]}`, 'ok');
      router.refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Görünürlük güncellenemedi', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Snapshot) {
    if (!confirm(`"${s.name}" imajı silinsin mi?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/snapshots/${s.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('İmaj silinemedi');
      flash('İmaj silindi.', 'ok');
      router.refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'İmaj silinemedi', 'err');
    } finally {
      setBusy(false);
    }
  }

  function startClone(s: Snapshot) {
    setCloneFor(s);
    setCloneName(`${s.name} kopyası`);
  }

  const list = tab === 'library' ? snapshots : market;

  const readyCount = snapshots.filter((s) => s.status === 'READY').length;
  const publicCount = snapshots.filter((s) => s.visibility === 'PUBLIC').length;
  const totalInstalls = snapshots.reduce((sum, s) => sum + s.installs, 0);

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="GÖRÜNTÜ PAZARI"
        title="İmaj Pazarı"
        subtitle="Cihaz anlık görüntülerini yakalayın, geri yükleyin, klonlayın ve paylaşın — tek tıkla yeni cihaz."
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat label="Kütüphanedeki imaj" value={<span className="mono">{snapshots.length}</span>} sub="toplam anlık görüntü" tone="info" icon={<Boxes size={16} />} />
          <HoloStat label="Hazır imaj" value={<span className="mono">{readyCount}</span>} sub="geri yüklemeye uygun" tone="success" icon={<CheckCircle2 size={16} />} />
          <HoloStat label="Pazardaki imaj" value={<span className="mono">{market.length}</span>} sub="herkese açık" tone="cyan" icon={<Store size={16} />} />
          <HoloStat label="Toplam yükleme" value={<span className="mono">{totalInstalls}</span>} sub={<span className="mono">{publicCount} herkese açık</span>} tone="violet" icon={<Download size={16} />} />
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <HoloTabs
          tabs={[
            { key: 'library', label: `Kütüphanem (${snapshots.length})`, icon: <Layers size={14} /> },
            { key: 'market', label: `Pazar (${market.length})`, icon: <Globe size={14} /> },
          ]}
          active={tab}
          onChange={setTab}
        />
      </Reveal>

      {msg ? <p className={`form-status form-status--${msg.kind}`} style={{ marginTop: '0.75rem', marginBottom: '0.75rem' }}>{msg.text}</p> : null}

      <Reveal delay={0.1}>
        <HoloPanel
          title={tab === 'library' ? 'Kütüphanem' : 'Pazar'}
          icon={tab === 'library' ? <Layers size={16} /> : <Store size={16} />}
        >
          {list.length === 0 ? (
            <div className="table-empty">
              <div className="empty-art">⬢</div>
              <h3>{tab === 'library' ? 'Henüz imaj yok' : 'Pazarda imaj yok'}</h3>
              <p className="helper">{tab === 'library' ? 'Bir cihazın detay sayfasından "Anlık görüntü al" ile başlayın.' : 'Herkese açık imajlar burada görünür.'}</p>
            </div>
          ) : (
            <div className="holo-grid-auto">
              {list.map((s) => (
                <Holo3D key={s.id} className="img-card holo-card" max={5}>
                  <div className="img-card-thumb">
                    <Layers size={28} />
                    <span className={`status-chip img-status-${s.status.toLowerCase()}`}>
                      <span className={`dot ${s.status === 'READY' ? 'dot-online' : s.status === 'FAILED' ? 'dot-error' : 'dot-offline'}`} />
                      {STATUS_LABEL[s.status]}
                    </span>
                  </div>
                  <div className="img-card-body">
                    <strong className="img-card-title">{s.name}</strong>
                    {s.description ? <p className="helper img-card-desc">{s.description}</p> : null}
                    <div className="img-card-meta mono">
                      <span><HardDrive size={11} /> {fmtSize(s.sizeBytes)}</span>
                      {s.androidVersion ? <span>Android {s.androidVersion}</span> : null}
                      {s.metadata?.model ? <span>{s.metadata.manufacturer} {s.metadata.model}</span> : null}
                      <span><Download size={11} /> {s.installs}</span>
                    </div>
                    {s.tags.length > 0 ? <div className="img-card-tags">{s.tags.map((t) => <span key={t} className="farm-tag-chip">{t}</span>)}</div> : null}
                    <div className="img-card-foot">
                      <span className="img-vis status-chip">
                        {s.visibility === 'PUBLIC' ? <Globe size={11} /> : s.visibility === 'WORKSPACE' ? <Users size={11} /> : <Lock size={11} />}
                        {VIS_LABEL[s.visibility]}
                      </span>
                      <span className="helper mono"><Clock size={10} /> {new Date(s.createdAt).toLocaleDateString('tr-TR')}</span>
                    </div>
                  </div>
                  <div className="img-card-actions">
                    <button type="button" className="btn-ghost btn-xs" disabled={busy || s.status !== 'READY'} onClick={() => startClone(s)} title="Bu imajdan yeni cihaz oluştur">
                      <Copy size={13} /> Klonla
                    </button>
                    {tab === 'library' ? (
                      <>
                        <button type="button" className="btn-ghost btn-xs" disabled={busy || s.status !== 'READY'} onClick={() => setRestoreFor(s)} title="Mevcut bir cihaza geri yükle">
                          <RotateCcw size={13} /> Geri yükle
                        </button>
                        <select className="inline-select" value={s.visibility} disabled={busy} onChange={(e) => setVisibility(s, e.target.value as Snapshot['visibility'])} title="Görünürlük">
                          <option value="PRIVATE">Özel</option>
                          <option value="WORKSPACE">Çalışma alanı</option>
                          <option value="PUBLIC">Herkese açık</option>
                        </select>
                        <button type="button" className="icon-btn danger-btn" disabled={busy} onClick={() => remove(s)} title="Sil"><Trash2 size={13} /></button>
                      </>
                    ) : null}
                  </div>
                </Holo3D>
              ))}
            </div>
          )}
        </HoloPanel>
      </Reveal>

      {/* Restore modal */}
      {restoreFor ? (
        <div className="modal-overlay" onClick={() => !busy && setRestoreFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><RotateCcw size={16} />"{restoreFor.name}" geri yükle</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setRestoreFor(null)} aria-label="Kapat">×</button>
            </header>
            <div className="modal-body">
              <p className="helper">İmaj seçili cihazın üzerine yazılacak. Hedef cihazı seçin:</p>
              <select className="field-input" value={restoreDevice} onChange={(e) => setRestoreDevice(e.target.value)}>
                <option value="">— cihaz seçin —</option>
                {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => setRestoreFor(null)} disabled={busy}>İptal</button>
              <button type="button" className="btn-primary" onClick={doRestore} disabled={busy || !restoreDevice}>{busy ? 'Sıraya alınıyor…' : 'Geri yükle'}</button>
            </footer>
          </div>
        </div>
      ) : null}

      {/* Clone modal */}
      {cloneFor ? (
        <div className="modal-overlay" onClick={() => !busy && setCloneFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Copy size={16} />"{cloneFor.name}" imajından yeni cihaz</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setCloneFor(null)} aria-label="Kapat">×</button>
            </header>
            <div className="modal-body farm-form">
              <label className="distribute-field">
                <span className="helper">Yeni cihaz adı</span>
                <input className="field-input" value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
              </label>
              <label className="distribute-field">
                <span className="helper">Grup (opsiyonel)</span>
                <select className="field-input" value={cloneGroup} onChange={(e) => setCloneGroup(e.target.value)}>
                  <option value="">— grupsuz —</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
              <p className="helper">Yeni cihaz benzersiz bir parmak iziyle oluşturulur; imaj bir sunucuya atandığında geri yüklenir.</p>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => setCloneFor(null)} disabled={busy}>İptal</button>
              <button type="button" className="btn-primary" onClick={doClone} disabled={busy || !cloneName.trim()}>{busy ? 'Oluşturuluyor…' : 'Cihaz oluştur'}</button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
