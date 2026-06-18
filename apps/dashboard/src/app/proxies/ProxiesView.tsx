'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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

  // Default proxy mode for newly-created phones. Persisted as a real workspace
  // preference in localStorage and read back when the proxy form opens.
  const [proxyMode, setProxyMode] = useState('direct');
  const [savedMode, setSavedMode] = useState(false);
  useEffect(() => {
    try {
      const m = localStorage.getItem('fleet.defaultProxyMode');
      if (m) setProxyMode(m);
    } catch {
      /* ignore */
    }
  }, []);
  function saveProxyMode() {
    try {
      localStorage.setItem('fleet.defaultProxyMode', proxyMode);
      setSavedMode(true);
      setTimeout(() => setSavedMode(false), 2500);
    } catch {
      /* ignore */
    }
  }

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
        actions={<button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>+ Add proxy</button>}
      />

      <div className="tabs">
        <button type="button" className={tab === 'list' ? 'tab tab-active' : 'tab'} onClick={() => setTab('list')}>
          Proxy list
        </button>
        <button type="button" className={tab === 'config' ? 'tab tab-active' : 'tab'} onClick={() => setTab('config')}>
          Proxy configuration
        </button>
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
                        <button
                          type="button"
                          className="action-btn"
                          disabled={busyId === p.id}
                          onClick={() => checkProxy(p.id)}
                        >
                          {busyId === p.id ? '…' : 'Check'}
                        </button>
                        <button
                          type="button"
                          className="action-btn action-danger"
                          disabled={busyId === p.id}
                          onClick={() => deleteProxy(p.id)}
                        >
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
      ) : (
        <div className="config-card">
          <h3>Default proxy mode</h3>
          <p className="helper">Choose how new cloud phones connect to the internet.</p>
          <div className="radio-stack">
            <label className="radio-row">
              <input type="radio" name="proxymode" checked={proxyMode === 'direct'} onChange={() => setProxyMode('direct')} /> Direct (host network)
            </label>
            <label className="radio-row">
              <input type="radio" name="proxymode" checked={proxyMode === 'residential'} onChange={() => setProxyMode('residential')} /> Residential proxy pool
            </label>
            <label className="radio-row">
              <input type="radio" name="proxymode" checked={proxyMode === 'mobile'} onChange={() => setProxyMode('mobile')} /> Mobile (4G/5G) proxy
            </label>
          </div>
          <button type="button" className="btn-primary" onClick={saveProxyMode}>
            {savedMode ? 'Saved ✓' : 'Save configuration'}
          </button>
        </div>
      )}

      {addOpen ? (
        <div className="modal-overlay" onClick={() => !busy && setAddOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Add proxy</h2>
              <button type="button" className="modal-close" onClick={() => !busy && setAddOpen(false)}>
                ✕
              </button>
            </header>

            <label className="field">
              <span>Label</span>
              <input className="field-input" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. US residential 1" />
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
                <input className="field-input" value={form.group} onChange={(e) => setForm((f) => ({ ...f, group: e.target.value }))} placeholder="optional" />
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Host</span>
                <input className="field-input" value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} placeholder="proxy.example.com" />
              </label>
              <label className="field">
                <span>Port</span>
                <input className="field-input" type="number" value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))} />
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>Username</span>
                <input className="field-input" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} placeholder="optional" />
              </label>
              <label className="field">
                <span>Password</span>
                <input className="field-input" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="optional" />
              </label>
            </div>

            {error ? <p className="field-error">{error}</p> : null}

            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => !busy && setAddOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" disabled={busy} onClick={addProxy}>
                {busy ? 'Adding…' : 'Add proxy'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
