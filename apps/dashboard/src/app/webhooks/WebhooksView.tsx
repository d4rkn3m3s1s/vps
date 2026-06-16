'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export type Webhook = {
  id: string;
  label: string;
  url: string;
  event: string;
  active: boolean;
  hasSecret: boolean;
  lastFiredAt: string | null;
  failCount: number;
};

type Toast = { kind: 'ok' | 'err'; text: string } | null;

export function WebhooksView({ webhooks }: { webhooks: Webhook[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [form, setForm] = useState({ label: '', url: '', event: 'ALL', secret: '' });

  function flash(t: Toast) {
    setToast(t);
    setTimeout(() => setToast(null), 3500);
  }

  async function create() {
    if (!form.label.trim() || !form.url.trim()) {
      flash({ kind: 'err', text: 'Label and URL are required.' });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: form.label.trim(),
          url: form.url.trim(),
          event: form.event,
          ...(form.secret.trim() ? { secret: form.secret.trim() } : {})
        })
      });
      if (!res.ok) throw new Error(`Create failed (${res.status})`);
      setOpen(false);
      setForm({ label: '', url: '', event: 'ALL', secret: '' });
      flash({ kind: 'ok', text: 'Webhook created.' });
      router.refresh();
    } catch (err) {
      flash({ kind: 'err', text: err instanceof Error ? err.message : 'Create failed' });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(hook: Webhook) {
    await fetch(`/api/webhooks/${hook.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !hook.active })
    });
    router.refresh();
  }

  async function remove(hook: Webhook) {
    if (!confirm(`Delete webhook "${hook.label}"?`)) return;
    await fetch(`/api/webhooks/${hook.id}`, { method: 'DELETE' });
    router.refresh();
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Webhooks"
        subtitle="Get notified on your own server when jobs complete or fail."
        actions={
          <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
            + New webhook
          </button>
        }
      />

      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}

      <div className="profile-table-wrap">
        <table className="profile-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>URL</th>
              <th>Event</th>
              <th>Signed</th>
              <th>Last fired</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {webhooks.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="table-empty">
                    <div className="empty-art">⇲</div>
                    <span>No webhooks yet</span>
                  </div>
                </td>
              </tr>
            ) : (
              webhooks.map((h) => (
                <tr key={h.id}>
                  <td>
                    <strong>{h.label}</strong>
                  </td>
                  <td className="mono helper">{h.url}</td>
                  <td>{h.event}</td>
                  <td>{h.hasSecret ? '🔒 HMAC' : '—'}</td>
                  <td className="mono helper">{h.lastFiredAt ? new Date(h.lastFiredAt).toLocaleString('tr-TR') : 'never'}</td>
                  <td>
                    <span className="status-chip">
                      <span className={h.active ? 'dot dot-online' : 'dot dot-offline'} />
                      {h.active ? 'Active' : 'Paused'}
                      {h.failCount > 0 ? <span className="helper"> · {h.failCount} fails</span> : null}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="action-btn" onClick={() => toggle(h)}>
                        {h.active ? 'Pause' : 'Resume'}
                      </button>
                      <button type="button" className="action-btn action-danger" onClick={() => remove(h)}>
                        Delete
                      </button>
                    </div>
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
              <h2>New webhook</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setOpen(false)}>
                ✕
              </button>
            </header>
            <label className="field">
              <span>Label</span>
              <input className="field-input" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="My server" />
            </label>
            <label className="field">
              <span>Endpoint URL</span>
              <input className="field-input mono" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://example.com/hook" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Event</span>
                <select className="field-input" value={form.event} onChange={(e) => setForm((f) => ({ ...f, event: e.target.value }))}>
                  <option value="ALL">All events</option>
                  <option value="JOB_COMPLETED">Job completed</option>
                  <option value="JOB_FAILED">Job failed</option>
                </select>
              </label>
              <label className="field">
                <span>Signing secret (optional)</span>
                <input className="field-input mono" value={form.secret} onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))} placeholder="HMAC secret" />
              </label>
            </div>
            <p className="helper">If a secret is set, each request includes an <span className="mono">X-Fleet-Signature</span> HMAC-SHA256 header.</p>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => !busy && setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={create}>
                {busy ? 'Creating…' : 'Create webhook'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
