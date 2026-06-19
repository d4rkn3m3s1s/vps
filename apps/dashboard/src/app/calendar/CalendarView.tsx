'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Plus, Trash2, Clock, Send, XCircle, Image as ImageIcon } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export type Post = {
  id: string;
  caption: string;
  platform: string;
  mediaUrl: string | null;
  groupId: string | null;
  deviceIds: string[];
  rpaFlowId: string | null;
  scheduledFor: string;
  status: 'SCHEDULED' | 'POSTING' | 'POSTED' | 'FAILED' | 'CANCELED';
  postedAt: string | null;
  error: string | null;
};
export type CalGroup = { id: string; name: string };
export type CalFlow = { id: string; name: string };

const PLATFORMS = [
  { v: 'tiktok', label: 'TikTok' },
  { v: 'instagram', label: 'Instagram' },
  { v: 'x', label: 'X (Twitter)' },
  { v: 'meta', label: 'Facebook' },
  { v: 'youtube', label: 'YouTube' },
  { v: 'other', label: 'Diğer' }
];

const STATUS_LABEL: Record<Post['status'], string> = {
  SCHEDULED: 'Zamanlandı',
  POSTING: 'Gönderiliyor',
  POSTED: 'Gönderildi',
  FAILED: 'Başarısız',
  CANCELED: 'İptal'
};

export function CalendarView({ posts, groups, flows }: { posts: Post[]; groups: CalGroup[]; flows: CalFlow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    caption: '', platform: 'tiktok', mediaUrl: '', groupId: '', rpaFlowId: '', scheduledFor: ''
  });

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 4000);
  }

  async function create() {
    if (!form.scheduledFor) return flash('Zaman seçin.');
    if (!form.caption.trim() && !form.mediaUrl.trim()) return flash('Başlık veya medya gerekli.');
    setBusy(true);
    try {
      const body = {
        caption: form.caption,
        platform: form.platform,
        mediaUrl: form.mediaUrl.trim() || undefined,
        groupId: form.groupId || undefined,
        rpaFlowId: form.rpaFlowId || undefined,
        scheduledFor: new Date(form.scheduledFor).toISOString()
      };
      const res = await fetch('/api/calendar/posts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.data?.message ?? 'Oluşturulamadı');
      setOpen(false);
      setForm({ caption: '', platform: 'tiktok', mediaUrl: '', groupId: '', rpaFlowId: '', scheduledFor: '' });
      flash('Gönderi zamanlandı.');
      router.refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Oluşturulamadı');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(p: Post) {
    setBusy(true);
    try {
      await fetch(`/api/calendar/posts/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'CANCELED' }) });
      flash('Gönderi iptal edildi.');
      router.refresh();
    } finally { setBusy(false); }
  }

  async function remove(p: Post) {
    if (!confirm('Gönderi silinsin mi?')) return;
    setBusy(true);
    try {
      await fetch(`/api/calendar/posts/${p.id}`, { method: 'DELETE' });
      flash('Gönderi silindi.');
      router.refresh();
    } finally { setBusy(false); }
  }

  // Group posts by calendar day for a timeline view.
  const byDay = new Map<string, Post[]>();
  for (const p of posts) {
    const key = new Date(p.scheduledFor).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(p);
  }

  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? null;

  return (
    <PageMotion className="page">
      <PageHeader
        title="İçerik Takvimi"
        subtitle="Çok hesaplı gönderileri zamanlayın; motor zamanı gelince ilgili telefonlarda yayınlar."
        actions={<button type="button" className="btn-primary" onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> Gönderi zamanla</button>}
      />

      {msg ? <p className="helper" style={{ marginBottom: '0.75rem' }}>{msg}</p> : null}

      {posts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-art">🗓</div>
          <h3>Henüz zamanlanmış gönderi yok</h3>
          <p>Bir cihaz grubunda ve posting akışıyla içerik yayınını planlamak için gönderi zamanlayın.</p>
        </div>
      ) : (
        <div className="cal-days">
          {Array.from(byDay.entries()).map(([day, items]) => (
            <div key={day} className="cal-day">
              <h3 className="cal-day-head"><CalendarDays size={14} /> {day}</h3>
              <div className="cal-day-list">
                {items.map((p) => (
                  <article key={p.id} className={`cal-post cal-post-${p.status.toLowerCase()}`}>
                    <div className="cal-post-time"><Clock size={12} /> {new Date(p.scheduledFor).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="cal-post-body">
                      <div className="cal-post-top">
                        <span className="cal-plat">{PLATFORMS.find((x) => x.v === p.platform)?.label ?? p.platform}</span>
                        <span className={`cal-status cal-status-${p.status.toLowerCase()}`}>{STATUS_LABEL[p.status]}</span>
                      </div>
                      {p.caption ? <p className="cal-caption">{p.caption}</p> : null}
                      <div className="cal-post-meta">
                        {p.mediaUrl ? <span><ImageIcon size={11} /> medya</span> : null}
                        {groupName(p.groupId) ? <span>{groupName(p.groupId)}</span> : null}
                        {p.deviceIds.length > 0 ? <span>{p.deviceIds.length} cihaz</span> : null}
                        {p.error ? <span className="cal-err">{p.error}</span> : null}
                      </div>
                    </div>
                    <div className="cal-post-actions">
                      {p.status === 'SCHEDULED' ? <button type="button" className="btn-ghost" disabled={busy} onClick={() => cancel(p)} title="İptal"><XCircle size={13} /></button> : null}
                      <button type="button" className="icon-btn danger-btn" disabled={busy} onClick={() => remove(p)} title="Sil"><Trash2 size={13} /></button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head"><h2><Send size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Gönderi zamanla</h2></header>
            <div className="modal-body farm-form">
              <div className="farm-form-row">
                <label className="distribute-field">
                  <span className="helper">Platform</span>
                  <select className="field-input" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                    {PLATFORMS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                  </select>
                </label>
                <label className="distribute-field">
                  <span className="helper">Zaman</span>
                  <input className="field-input" type="datetime-local" value={form.scheduledFor} onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })} />
                </label>
              </div>
              <label className="distribute-field"><span className="helper">Başlık / metin</span><textarea className="field-input" rows={3} value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} /></label>
              <label className="distribute-field"><span className="helper">Medya URL (opsiyonel)</span><input className="field-input" placeholder="https://… (cihaza yüklenir)" value={form.mediaUrl} onChange={(e) => setForm({ ...form, mediaUrl: e.target.value })} /></label>
              <div className="farm-form-row">
                <label className="distribute-field">
                  <span className="helper">Hedef grup</span>
                  <select className="field-input" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                    <option value="">— grup seçin —</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
                <label className="distribute-field">
                  <span className="helper">Posting akışı (RPA)</span>
                  <select className="field-input" value={form.rpaFlowId} onChange={(e) => setForm({ ...form, rpaFlowId: e.target.value })}>
                    <option value="">— akış seçin —</option>
                    {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
              </div>
              <p className="helper">Zamanı geldiğinde medya hedef cihazlara yüklenir ve seçilen posting akışı her cihazda çalıştırılır.</p>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => setOpen(false)} disabled={busy}>İptal</button>
              <button type="button" className="btn-primary" onClick={create} disabled={busy}>{busy ? 'Zamanlanıyor…' : 'Zamanla'}</button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
