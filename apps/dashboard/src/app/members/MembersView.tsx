'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@heroui/react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export type Member = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  apiKeyCount: number;
  activityCount: number;
};

function roleBadge(role: string) {
  const cls = role === 'admin' ? 'role-admin' : role === 'viewer' ? 'role-viewer' : 'role-member';
  return <span className={`role-badge ${cls}`}>{role}</span>;
}

export function MembersView({ members }: { members: Member[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', password: '', role: 'member' });

  async function invite() {
    if (!form.email.trim() || form.password.length < 8) {
      setError('Valid email and password (min 8 chars) required.');
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
      if (!res.ok) throw new Error(json.error ?? `Failed (${res.status})`);
      setOpen(false);
      setForm({ email: '', password: '', role: 'member' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, email: string) {
    if (!confirm(`Remove ${email}?`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        setToast('Could not remove member');
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
      <PageHeader
        title="Members"
        subtitle="Team members, roles and permissions."
        actions={<Button type="button" variant="primary" className="btn-primary" onPress={() => setOpen(true)}>+ Add member</Button>}
      />

      <div className="profile-table-wrap">
        <table className="profile-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>API keys</th>
              <th>Activity</th>
              <th>Joined</th>
              <th>Operation</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="table-empty">
                    <div className="empty-art">☻</div>
                    <span>No members yet</span>
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
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      className="action-btn action-danger"
                      isDisabled={Boolean(busyId === m.id)}
                      onPress={() => remove(m.id, m.email)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {open ? (
        <div className="modal-overlay" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Add member</h2>
              <Button type="button" className="modal-close" onPress={() => !busy && setOpen(false)}>
                ✕
              </Button>
            </header>
            <label className="field">
              <span>Email</span>
              <Input className="field-input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="member@company.com" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Temporary password</span>
                <Input className="field-input" type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="min 8 chars" />
              </label>
              <label className="field">
                <span>Role</span>
                <select className="field-input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
              </label>
            </div>
            {error ? <p className="field-error">{error}</p> : null}
            <footer className="modal-foot">
              <Button type="button" variant="ghost" className="btn-ghost" onPress={() => !busy && setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" className="btn-primary" isDisabled={Boolean(busy)} onPress={invite}>
                {busy ? 'Adding…' : 'Add member'}
              </Button>
            </footer>
          </div>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </PageMotion>
  );
}
