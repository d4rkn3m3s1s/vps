'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@heroui/react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export type Proxy = {
  id: string;
  label: string;
  type: string;
  host: string;
  port: number;
  group: string | null;
  isp: string | null;
  remarks: string | null;
  exportIp: string | null;
  status: string;
  lastCheckedAt: string | null;
};

function StatusDot({ status }: { status: string }) {
  const cls = status === 'OK' ? 'dot dot-online' : status === 'FAILED' ? 'dot dot-error' : 'dot dot-offline';
  const label = status === 'OK' ? 'Working' : status === 'FAILED' ? 'Failed' : 'Unchecked';
  return (
    <span className="status-chip">
      <span className={cls} />
      {label}
    </span>
  );
}

export function ProxiesView({ proxies }: { proxies: Proxy[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<'list' | 'config'>('list');
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ label: '', type: 'HTTP', host: '', port: '8080', username: '', password: '', group: '' });

  async function addProxy() {
    if (!form.label.trim() || !form.host.trim() || !form.port) {
      setError('Label, host and port are required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/proxies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: form.label.trim(),
          type: form.type,
          host: form.host.trim(),
          port: Number(form.port),
          username: form.username || undefined,
          password: form.password || undefined,
          group: form.group || undefined
        })
      });
      if (!res.ok) throw new Error(`Add failed (${res.status})`);
      setAddOpen(false);
      setForm({ label: '', type: 'HTTP', host: '', port: '8080', username: '', password: '', group: '' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  }

  async function checkProxy(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/proxies/${id}/check`, { method: 'POST' });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function deleteProxy(id: string) {
    if (!confirm('Delete this proxy?')) return;
    setBusyId(id);
    try {
      await fetch(`/api/proxies/${id}`, { method: 'DELETE' });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Proxies"
        subtitle="Assign residential or mobile proxies to your cloud phones."
        actions={<Button variant="primary" onPress={() => setAddOpen(true)}>+ Add proxy</Button>}
      />

      <div className="tabs">
        <Button type="button" className={tab === 'list' ? 'tab tab-active' : 'tab'} onPress={() => setTab('list')}>
          Proxy list
        </Button>
        <Button type="button" className={tab === 'config' ? 'tab tab-active' : 'tab'} onPress={() => setTab('config')}>
          Proxy configuration
        </Button>
      </div>

      {tab === 'list' ? (
        <div className="profile-table-wrap">
          <table className="profile-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Type</th>
                <th>Proxy info</th>
                <th>Export IP</th>
                <th>Group</th>
                <th>Status</th>
                <th>Operation</th>
              </tr>
            </thead>
            <tbody>
              {proxies.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="table-empty">
                      <div className="empty-art">⌖</div>
                      <span>No data now</span>
                    </div>
                  </td>
                </tr>
              ) : (
                proxies.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.label}</strong>
                    </td>
                    <td>{p.type}</td>
                    <td className="mono">
                      {p.host}:{p.port}
                    </td>
                    <td className="mono">{p.exportIp ?? '—'}</td>
                    <td>{p.group ?? 'Ungrouped'}</td>
                    <td>
                      <StatusDot status={p.status} />
                    </td>
                    <td>
                      <div className="action-buttons">
                        <Button
                          variant="ghost"
                          size="sm"
                          isDisabled={busyId === p.id}
                          onPress={() => checkProxy(p.id)}
                        >
                          {busyId === p.id ? '…' : 'Check'}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          isDisabled={busyId === p.id}
                          onPress={() => deleteProxy(p.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="config-card">
          <h3>Default proxy mode</h3>
          <p className="helper">Choose how new cloud phones connect to the internet.</p>
          <div className="radio-stack">
            <label className="radio-row">
              <input type="radio" name="proxymode" defaultChecked /> Direct (host network)
            </label>
            <label className="radio-row">
              <input type="radio" name="proxymode" /> Residential proxy pool
            </label>
            <label className="radio-row">
              <input type="radio" name="proxymode" /> Mobile (4G/5G) proxy
            </label>
          </div>
          <Button variant="primary" onPress={() => alert('Configuration saved (local).')}>
            Save configuration
          </Button>
        </div>
      )}

      {addOpen ? (
        <div className="modal-overlay" onClick={() => !busy && setAddOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Add proxy</h2>
              <Button type="button" className="modal-close" onPress={() => !busy && setAddOpen(false)}>
                ✕
              </Button>
            </header>

            <label className="field">
              <span>Label</span>
              <Input className="field-input" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. US residential 1" />
            </label>

            <div className="field-row">
              <label className="field">
                <span>Type</span>
                <select className="field-input" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  <option value="HTTP">HTTP</option>
                  <option value="HTTPS">HTTPS</option>
                  <option value="SOCKS5">SOCKS5</option>
                </select>
              </label>
              <label className="field">
                <span>Group</span>
                <Input className="field-input" value={form.group} onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))} placeholder="optional" />
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Host</span>
                <Input className="field-input" value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} placeholder="proxy.example.com" />
              </label>
              <label className="field">
                <span>Port</span>
                <Input className="field-input" type="number" value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))} />
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Username</span>
                <Input className="field-input" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder="optional" />
              </label>
              <label className="field">
                <span>Password</span>
                <Input className="field-input" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="optional" />
              </label>
            </div>

            {error ? <p className="field-error">{error}</p> : null}

            <footer className="modal-foot">
              <Button variant="ghost" onPress={() => !busy && setAddOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" isDisabled={busy} onPress={addProxy}>
                {busy ? 'Adding…' : 'Add proxy'}
              </Button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
