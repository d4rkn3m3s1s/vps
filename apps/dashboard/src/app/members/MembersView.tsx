'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, ShieldCheck, Eye, UserPlus, UserCog, Trash2, X, KeyRound } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Reveal } from '../../components/hud';

export type Member = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  apiKeyCount: number;
  activityCount: number;
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'Yönetici',
  viewer: 'İzleyici',
  member: 'Üye'
};

function roleBadge(role: string) {
  const cls = role === 'admin' ? 'role-admin' : role === 'viewer' ? 'role-viewer' : 'role-member';
  return <span className={`role-badge ${cls}`}>{ROLE_LABEL[role] ?? role}</span>;
}

export function MembersView({ members }: { members: Member[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', password: '', role: 'member' });

  const total = members.length;
  const adminCount = members.filter((m) => m.role === 'admin').length;
  const viewerCount = members.filter((m) => m.role === 'viewer').length;
  const memberCount = members.filter((m) => m.role !== 'admin' && m.role !== 'viewer').length;
  const keyTotal = members.reduce((acc, m) => acc + m.apiKeyCount, 0);

  async function invite() {
    if (!form.email.trim() || form.password.length < 8) {
      setError('Geçerli bir e-posta ve parola (en az 8 karakter) gereklidir.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Başarısız (${res.status})`);
      setOpen(false);
      setForm({ email: '', password: '', role: 'member' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Üye eklenemedi');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, email: string) {
    if (!confirm(`${email} kaldırılsın mı?`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setToast('Üye kaldırılamadı');
      } else {
        router.refresh();
      }
    } finally {
      setBusyId(null);
      setTimeout(() => setToast(null), 2500);
    }
  }

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="EKİP"
        title="Üyeler"
        subtitle="Ekip üyeleri, roller ve izinler."
        actions={
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            <UserPlus size={15} /> Üye ekle
          </button>
        }
      />

      <Reveal className="holo-stats-grid">
        <HoloStat label="Toplam üye" value={<span className="mono">{total}</span>} tone="cyan" icon={<Users size={16} />} />
        <HoloStat label="Yönetici" value={<span className="mono">{adminCount}</span>} tone="info" icon={<ShieldCheck size={16} />} />
        <HoloStat label="İzleyici" value={<span className="mono">{viewerCount}</span>} tone="violet" icon={<Eye size={16} />} />
        <HoloStat label="Üye" value={<span className="mono">{memberCount}</span>} sub={<span>API anahtarı: <span className="mono">{keyTotal}</span></span>} tone="success" icon={<UserCog size={16} />} />
      </Reveal>

      <Reveal delay={0.08}>
        <HoloPanel title="Ekip üyeleri" icon={<Users size={16} />}>
          <div className="profile-table-wrap">
            <table className="profile-table">
              <thead>
                <tr>
                  <th>E-posta</th>
                  <th>Rol</th>
                  <th>API anahtarları</th>
                  <th>Etkinlik</th>
                  <th>Katıldığı tarih</th>
                  <th>İşlem</th>
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="table-empty">
                        <div className="empty-art">☻</div>
                        <span>Henüz üye yok</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  members.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.email}</strong>
                      </td>
                      <td>{roleBadge(m.role)}</td>
                      <td className="mono">{m.apiKeyCount}</td>
                      <td className="mono">{m.activityCount}</td>
                      <td className="helper">{new Date(m.createdAt).toLocaleDateString('tr-TR')}</td>
                      <td>
                        <button
                          type="button"
                          className="action-btn action-danger"
                          disabled={busyId === m.id}
                          onClick={() => remove(m.id, m.email)}
                        >
                          <Trash2 size={13} /> Kaldır
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </HoloPanel>
      </Reveal>

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><UserPlus size={16} /> Üye ekle</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setOpen(false)}>
                <X size={16} />
              </button>
            </header>
            <label className="field">
              <span>E-posta</span>
              <input className="field-input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="uye@sirket.com" />
            </label>
            <div className="field-row">
              <label className="field">
                <span><KeyRound size={12} /> Geçici parola</span>
                <input className="field-input" type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="en az 8 karakter" />
              </label>
              <label className="field">
                <span>Rol</span>
                <select className="field-input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                  <option value="member">Üye</option>
                  <option value="admin">Yönetici</option>
                  <option value="viewer">İzleyici</option>
                </select>
              </label>
            </div>
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => !busy && setOpen(false)}>
                İptal
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={invite}>
                {busy ? 'Ekleniyor…' : 'Üye ekle'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </PageMotion>
  );
}
