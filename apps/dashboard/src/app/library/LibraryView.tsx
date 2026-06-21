'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export type Asset = {
  id: string;
  name: string;
  type: string;
  sizeBytes: number;
  url: string | null;
  tags: string[];
  createdAt: string;
};

const TYPE_ICON: Record<string, string> = {
  IMAGE: '🖼',
  VIDEO: '🎞',
  APK: '📦',
  COOKIE: '🍪',
  OTHER: '❏'
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
      <PageHeader
        title="Kütüphane"
        subtitle="Paylaşılan medya, APK'ler, çerezler ve hesap varlıkları."
        actions={<button type="button" className="btn-primary" onClick={() => setOpen(true)}>+ Varlık ekle</button>}
      />

      {assets.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">◳</div>
          <h3>Henüz varlık yok</h3>
          <p>Bulut telefonlarınız arasında yeniden kullanmak için görseller, videolar, APK'ler veya çerez dosyaları ekleyin.</p>
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>+ Varlık ekle</button>
        </div>
      ) : (
        <div className="app-grid">
          {assets.map((a) => (
            <article className="app-card" key={a.id}>
              <div className="app-card-main">
                <span className="app-icon" style={{ background: 'rgba(124,140,255,0.18)', fontSize: '1.3rem' }}>
                  {TYPE_ICON[a.type] ?? '❏'}
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
                className="install-btn action-danger"
                disabled={busyId === a.id}
                onClick={() => remove(a.id)}
              >
                Sil
              </button>
            </article>
          ))}
        </div>
      )}

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Varlık ekle</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setOpen(false)}>
                ✕
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
