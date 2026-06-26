'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';
import { Library, Plus, Trash2, Image as ImageIcon, Film, Package, Cookie, File, Database, Tags, HardDrive, X } from 'lucide-react';

export type Asset = {
  id: string;
  name: string;
  type: string;
  sizeBytes: number;
  url: string | null;
  tags: string[];
  createdAt: string;
};

const TYPE_ICON: Record<string, ReactNode> = {
  IMAGE: <ImageIcon size={18} />,
  VIDEO: <Film size={18} />,
  APK: <Package size={18} />,
  COOKIE: <Cookie size={18} />,
  OTHER: <File size={18} />
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LibraryView({ assets }: { assets: Asset[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', type: 'IMAGE', url: '', tags: '' });

  const totalSize = assets.reduce((acc, a) => acc + a.sizeBytes, 0);
  const distinctTypes = new Set(assets.map((a) => a.type)).size;

  async function add() {
    if (!form.name.trim()) {
      setError('Ad zorunludur.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type,
          url: form.url || undefined,
          tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined
        })
      });
      if (!res.ok) throw new Error(`Başarısız (${res.status})`);
      setOpen(false);
      setForm({ name: '', type: 'IMAGE', url: '', tags: '' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Varlık eklenemedi');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Bu varlık silinsin mi?')) return;
    setBusyId(id);
    try {
      await fetch(`/api/library/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="VARLIK KÜTÜPHANESİ"
        title="Kütüphane"
        subtitle="Paylaşılan medya, APK'ler, çerezler ve hesap varlıkları."
        actions={
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            <Plus size={16} /> Varlık ekle
          </button>
        }
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Toplam Varlık"
            value={<span className="mono">{assets.length}</span>}
            sub="kayıtlı kaynak"
            tone="info"
            icon={<Database size={16} />}
          />
          <HoloStat
            label="Toplam Boyut"
            value={<span className="mono">{formatSize(totalSize)}</span>}
            sub="depolanan veri"
            tone="cyan"
            icon={<HardDrive size={16} />}
          />
          <HoloStat
            label="Tür Çeşidi"
            value={<span className="mono">{distinctTypes}</span>}
            sub="farklı format"
            tone="violet"
            icon={<Tags size={16} />}
          />
        </div>
      </Reveal>

      {assets.length === 0 ? (
        <Reveal delay={0.05}>
          <HoloPanel title="Henüz varlık yok" icon={<Library size={18} />}>
            <div className="empty-state">
              <div className="empty-art">◳</div>
              <h3>Kütüphane boş</h3>
              <p>Bulut telefonlarınız arasında yeniden kullanmak için görseller, videolar, APK'ler veya çerez dosyaları ekleyin.</p>
              <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
                <Plus size={16} /> Varlık ekle
              </button>
            </div>
          </HoloPanel>
        </Reveal>
      ) : (
        <Reveal delay={0.05}>
          <div className="holo-grid-auto">
            {assets.map((a) => (
              <Holo3D className="holo-panel" key={a.id} max={5}>
                <span className="holo-corner holo-corner-tl" aria-hidden />
                <span className="holo-corner holo-corner-tr" aria-hidden />
                <span className="holo-corner holo-corner-bl" aria-hidden />
                <span className="holo-corner holo-corner-br" aria-hidden />
                <div className="holo-panel-body">
                  <div className="app-card-main">
                    <span className="holo-panel-ico" style={{ fontSize: '1.1rem' }}>
                      {TYPE_ICON[a.type] ?? <File size={18} />}
                    </span>
                    <div className="app-meta">
                      <strong>{a.name}</strong>
                      <span className="helper mono">
                        {a.type} · {formatSize(a.sizeBytes)}
                      </span>
                      {a.tags.length > 0 ? (
                        <span className="helper">{a.tags.map((t) => `#${t}`).join(' ')}</span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost btn-xs action-danger"
                    disabled={busyId === a.id}
                    onClick={() => remove(a.id)}
                  >
                    <Trash2 size={14} /> Sil
                  </button>
                </div>
              </Holo3D>
            ))}
          </div>
        </Reveal>
      )}

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><Plus size={16} /> Varlık ekle</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setOpen(false)}>
                <X size={16} />
              </button>
            </header>
            <label className="field">
              <span>Ad</span>
              <input className="field-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="örn. profile-avatar.png" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Tür</span>
                <select className="field-input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  <option value="IMAGE">Görsel</option>
                  <option value="VIDEO">Video</option>
                  <option value="APK">APK</option>
                  <option value="COOKIE">Çerez</option>
                  <option value="OTHER">Diğer</option>
                </select>
              </label>
              <label className="field">
                <span>Etiketler (virgülle ayrılmış)</span>
                <input className="field-input" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="us, instagram" />
              </label>
            </div>
            <label className="field">
              <span>URL (isteğe bağlı)</span>
              <input className="field-input" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://…" />
            </label>
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => !busy && setOpen(false)}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={add}>
                {busy ? 'Ekleniyor…' : 'Varlık ekle'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
