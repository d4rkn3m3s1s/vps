'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Plus, Trash2, Clock, Send, XCircle, Image as ImageIcon, CalendarClock, ListChecks, CheckCircle2, AlertTriangle } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Holo3D, Reveal } from '../../components/hud';

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

const STATUS_DOT: Record<string, string> = {
  POSTED: 'dot-online',
  FAILED: 'dot-error',
  POSTING: 'dot-busy',
  SCHEDULED: 'dot-busy',
  CANCELED: 'dot-offline'
};

export function CalendarView({ posts, groups, flows }: { posts: Post[]; groups: CalGroup[]; flows: CalFlow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    caption: '', platform: 'tiktok', mediaUrl: '', groupId: '', rpaFlowId: '', scheduledFor: ''
  });

  function flash(text: string, kind: 'ok' | 'err' = 'ok') {
    setMsg({ text, kind });
    setTimeout(() => setMsg(null), 4000);
  }

  async function create() {
    if (!form.scheduledFor) return flash('Zaman seçin.', 'err');
    if (!form.caption.trim() && !form.mediaUrl.trim()) return flash('Başlık veya medya gerekli.', 'err');
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
      flash('Gönderi zamanlandı.', 'ok');
      router.refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Oluşturulamadı', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(p: Post) {
    setBusy(true);
    try {
      const res = await fetch(`/api/calendar/posts/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'CANCELED' }) });
      if (!res.ok) throw new Error('İptal edilemedi');
      flash('Gönderi iptal edildi.', 'ok');
      router.refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'İptal edilemedi', 'err');
    } finally { setBusy(false); }
  }

  async function remove(p: Post) {
    if (!confirm('Gönderi silinsin mi?')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/calendar/posts/${p.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Silinemedi');
      flash('Gönderi silindi.', 'ok');
      router.refresh();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Silinemedi', 'err');
    } finally { setBusy(false); }
  }

  // Group posts by calendar day for a timeline view (sorted chronologically first).
  const sortedPosts = [...posts].sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
  const byDay = new Map<string, Post[]>();
  for (const p of sortedPosts) {
    const key = new Date(p.scheduledFor).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(p);
  }

  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? null;

  // Derived summary counts for the holographic stat deck (no new fetches).
  const scheduledCount = posts.filter((p) => p.status === 'SCHEDULED').length;
  const postedCount = posts.filter((p) => p.status === 'POSTED').length;
  const failedCount = posts.filter((p) => p.status === 'FAILED').length;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="İÇERİK TAKVİMİ"
        title="İçerik Takvimi"
        subtitle="Çok hesaplı gönderileri zamanlayın; motor zamanı gelince ilgili telefonlarda yayınlar."
        actions={<button type="button" className="btn-primary" onClick={() => setOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plus size={14} /> Gönderi zamanla</button>}
      />

      <div className="holo-stats-grid">
        <HoloStat label="Toplam gönderi" value={<span className="mono">{posts.length}</span>} tone="cyan" icon={<CalendarDays size={15} />} />
        <HoloStat label="Zamanlandı" value={<span className="mono">{scheduledCount}</span>} tone="cyan" icon={<CalendarClock size={15} />} />
        <HoloStat label="Gönderildi" value={<span className="mono">{postedCount}</span>} tone="success" icon={<CheckCircle2 size={15} />} />
        <HoloStat label="Başarısız" value={<span className="mono">{failedCount}</span>} tone={failedCount > 0 ? 'error' : 'neutral'} icon={<AlertTriangle size={15} />} />
      </div>

      {msg ? <p className={`form-status form-status--${msg.kind}`} style={{ marginBottom: '0.75rem' }}>{msg.text}</p> : null}

      {posts.length === 0 ? (
        <HoloPanel title="Yayın Hattı" icon={<CalendarClock size={16} />}>
          <div className="table-empty" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
            <div style={{ fontSize: '2.5rem', lineHeight: 1, marginBottom: '0.5rem' }} aria-hidden>🗓</div>
            <h3 style={{ margin: '0 0 0.4rem' }}>Henüz zamanlanmış gönderi yok</h3>
            <p className="helper" style={{ margin: 0 }}>Bir cihaz grubunda ve posting akışıyla içerik yayınını planlamak için gönderi zamanlayın.</p>
          </div>
        </HoloPanel>
      ) : (
        <div className="cal-days">
          {Array.from(byDay.entries()).map(([day, items], di) => (
            <Reveal key={day} delay={di * 0.04}>
              <HoloPanel
                title={day}
                icon={<CalendarDays size={16} />}
                actions={<span className="status-chip mono"><ListChecks size={12} /> {items.length}</span>}
              >
                <div className="holo-grid-auto">
                  {items.map((p) => (
                    <Holo3D key={p.id} className={`cal-post cal-post-${p.status.toLowerCase()}`} max={5}>
                      <div className="cal-post-time"><Clock size={12} /> <span className="mono">{new Date(p.scheduledFor).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span></div>
                      <div className="cal-post-body">
                        <div className="cal-post-top">
                          <span className="cal-plat">{PLATFORMS.find((x) => x.v === p.platform)?.label ?? p.platform}</span>
                          <span className={`status-chip cal-status cal-status-${p.status.toLowerCase()}`}>
                            <span className={`dot ${STATUS_DOT[p.status.toUpperCase()] ?? 'dot-offline'}`} />
                            {STATUS_LABEL[p.status]}
                          </span>
                        </div>
                        {p.caption ? <p className="cal-caption">{p.caption}</p> : null}
                        <div className="cal-post-meta">
                          {p.mediaUrl ? <span><ImageIcon size={11} /> medya</span> : null}
                          {groupName(p.groupId) ? <span>{groupName(p.groupId)}</span> : null}
                          {p.deviceIds.length > 0 ? <span className="mono">{p.deviceIds.length} cihaz</span> : null}
                          {p.error ? <span className="cal-err">{p.error}</span> : null}
                        </div>
                      </div>
                      <div className="cal-post-actions">
                        {p.status === 'SCHEDULED' ? <button type="button" className="btn-ghost btn-xs" disabled={busy} onClick={() => cancel(p)} title="İptal"><XCircle size={13} /></button> : null}
                        <button type="button" className="btn-ghost btn-xs danger-btn" disabled={busy} onClick={() => remove(p)} title="Sil"><Trash2 size={13} /></button>
                      </div>
                    </Holo3D>
                  ))}
                </div>
              </HoloPanel>
            </Reveal>
          ))}
        </div>
      )}

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head"><h2><Send size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Gönderi zamanla</h2></header>
            <div className="modal-body farm-form">
              <div className="farm-form-row">
                <label className="distribute-field field">
                  <span className="helper">Platform</span>
                  <select className="field-input" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                    {PLATFORMS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                  </select>
                </label>
                <label className="distribute-field field">
                  <span className="helper">Zaman</span>
                  <input className="field-input mono" type="datetime-local" value={form.scheduledFor} onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })} />
                </label>
              </div>
              <label className="distribute-field field"><span className="helper">Başlık / metin</span><textarea className="field-input" rows={3} value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} /></label>
              <label className="distribute-field field"><span className="helper">Medya URL (opsiyonel)</span><input className="field-input mono" placeholder="https://… (cihaza yüklenir)" value={form.mediaUrl} onChange={(e) => setForm({ ...form, mediaUrl: e.target.value })} /></label>
              <div className="farm-form-row">
                <label className="distribute-field field">
                  <span className="helper">Hedef grup</span>
                  <select className="field-input" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                    <option value="">— grup seçin —</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
                <label className="distribute-field field">
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
