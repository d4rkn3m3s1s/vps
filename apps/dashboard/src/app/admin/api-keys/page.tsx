'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Copy, Check } from 'lucide-react';

type ApiKey = {
  id: string;
  name: string;
  maskedKey: string;
  scopes: string[];
  lastUsedAt: string | null;
  revoked: boolean;
  createdAt: string;
};

const ALL_SCOPES = ['read', 'write', 'admin'] as const;

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // The freshly created plaintext key — shown exactly once.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 3000);
  }

  async function load() {
    try {
      const res = await fetch('/api/api-keys');
      const json = await res.json();
      if (Array.isArray(json.data)) setKeys(json.data);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function toggleScope(s: string) {
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), scopes: scopes.length ? scopes : ['read'] })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Could not create key');
      // API returns { key, plaintext }
      setRevealed(json.data?.plaintext ?? null);
      setName('');
      setScopes(['read']);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not create key');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKey) {
    if (!confirm(`Revoke "${key.name}"? Any caller using it will stop working immediately.`)) return;
    try {
      const res = await fetch(`/api/api-keys/${key.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'Could not revoke');
      }
      flash(`"${key.name}" revoked`);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not revoke');
    }
  }

  async function copyKey() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked; user can select manually */
    }
  }

  return (
    <section className="section-grid">
      <div className="panel">
        <h2>
          <KeyRound size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> API keys
        </h2>
        <p className="helper" style={{ marginTop: '-0.25rem' }}>
          Issue keys for external integrations. Send as the <span className="mono">x-api-key</span> header. Keys are shown
          once at creation — store them securely.
        </p>

        <div className="panel-stack" style={{ marginTop: '1rem' }}>
          {keys.length === 0 ? <p className="helper">No API keys yet.</p> : null}
          {keys.map((k) => (
            <div className="row alert-rule-row" key={k.id}>
              <div>
                <strong>{k.name}</strong>{' '}
                {k.revoked ? <span className="policy-tag">Revoked</span> : null}
                <div className="helper mono">
                  {k.maskedKey} · {k.scopes.join(', ')} ·{' '}
                  {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString('tr-TR')}` : 'never used'}
                </div>
              </div>
              {!k.revoked ? (
                <button type="button" className="icon-btn" onClick={() => revoke(k)} aria-label={`Revoke ${k.name}`} title="Revoke">
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {msg ? <p className="helper" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
      </div>

      <div className="panel">
        <h2>Create a key</h2>
        <div className="admin-form">
          <div className="admin-field">
            <label htmlFor="key-name">Name</label>
            <input
              id="key-name"
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CI pipeline, Zapier"
            />
          </div>
          <div className="admin-field">
            <label>Scopes</label>
            <div className="scope-row">
              {ALL_SCOPES.map((s) => (
                <label key={s} className={`scope-chip${scopes.includes(s) ? ' scope-chip-on' : ''}`}>
                  <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <button type="button" className="btn-primary" disabled={busy || !name.trim()} onClick={create}>
            <Plus size={15} /> {busy ? 'Creating…' : 'Create key'}
          </button>
        </div>
      </div>

      {revealed ? (
        <div className="modal-overlay" onClick={() => setRevealed(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Your new API key</h2>
              <button type="button" className="modal-close" onClick={() => setRevealed(null)}>
                ✕
              </button>
            </header>
            <p className="helper">
              Copy this now — it will <strong>not</strong> be shown again. If you lose it, revoke and create a new one.
            </p>
            <div className="key-reveal">
              <code className="mono">{revealed}</code>
              <button type="button" className="btn-ghost" onClick={copyKey}>
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-primary" onClick={() => setRevealed(null)}>
                Done
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
