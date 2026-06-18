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
      if (!res.ok) throw new Error(json.message ?? 'Anahtar oluşturulamadı');
      // API returns { key, plaintext }
      setRevealed(json.data?.plaintext ?? null);
      setName('');
      setScopes(['read']);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Anahtar oluşturulamadı');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKey) {
    if (!confirm(`"${key.name}" iptal edilsin mi? Bu anahtarı kullanan tüm çağrılar anında çalışmayı durduracaktır.`)) return;
    try {
      const res = await fetch(`/api/api-keys/${key.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? 'İptal edilemedi');
      }
      flash(`"${key.name}" iptal edildi`);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'İptal edilemedi');
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
          <KeyRound size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} /> API anahtarları
        </h2>
        <p className="helper" style={{ marginTop: '-0.25rem' }}>
          Harici entegrasyonlar için anahtar oluşturun. <span className="mono">x-api-key</span> başlığı olarak gönderin. Anahtarlar
          yalnızca oluşturulduğunda bir kez gösterilir — güvenli bir yerde saklayın.
        </p>

        <div className="panel-stack" style={{ marginTop: '1rem' }}>
          {keys.length === 0 ? <p className="helper">Henüz API anahtarı yok.</p> : null}
          {keys.map((k) => (
            <div className="row alert-rule-row" key={k.id}>
              <div>
                <strong>{k.name}</strong>{' '}
                {k.revoked ? <span className="policy-tag">İptal edildi</span> : null}
                <div className="helper mono">
                  {k.maskedKey} · {k.scopes.join(', ')} ·{' '}
                  {k.lastUsedAt ? `son kullanım ${new Date(k.lastUsedAt).toLocaleDateString('tr-TR')}` : 'hiç kullanılmadı'}
                </div>
              </div>
              {!k.revoked ? (
                <button type="button" className="icon-btn" onClick={() => revoke(k)} aria-label={`${k.name} anahtarını iptal et`} title="İptal et">
                  <Trash2 size={15} />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {msg ? <p className="helper" style={{ marginTop: '0.75rem' }}>{msg}</p> : null}
      </div>

      <div className="panel">
        <h2>Anahtar oluştur</h2>
        <div className="admin-form">
          <div className="admin-field">
            <label htmlFor="key-name">Ad</label>
            <input
              id="key-name"
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="örn. CI hattı, Zapier"
            />
          </div>
          <div className="admin-field">
            <label>Kapsamlar</label>
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
            <Plus size={15} /> {busy ? 'Oluşturuluyor…' : 'Anahtar oluştur'}
          </button>
        </div>
      </div>

      {revealed ? (
        <div className="modal-overlay" onClick={() => setRevealed(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2>Yeni API anahtarınız</h2>
              <button type="button" className="modal-close" onClick={() => setRevealed(null)}>
                ✕
              </button>
            </header>
            <p className="helper">
              Bunu şimdi kopyalayın — tekrar <strong>gösterilmeyecek</strong>. Kaybederseniz, iptal edip yeni bir tane oluşturun.
            </p>
            <div className="key-reveal">
              <code className="mono">{revealed}</code>
              <button type="button" className="btn-ghost" onClick={copyKey}>
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Kopyalandı' : 'Kopyala'}
              </button>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-primary" onClick={() => setRevealed(null)}>
                Tamam
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );
}
