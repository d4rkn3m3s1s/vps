'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Copy, Check, Loader2, ShieldCheck, Activity, Ban, Sparkles, X } from 'lucide-react';
import { HoloPanel, HoloStat, Reveal } from '../../../components/hud';

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
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [busy, setBusy] = useState(false);
  // id of the key currently being revoked, so its row button disables + spins.
  const [revokingId, setRevokingId] = useState<string | null>(null);
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
    } finally {
      setLoading(false);
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
    if (revokingId) return; // guard against concurrent revokes
    if (!confirm(`"${key.name}" iptal edilsin mi? Bu anahtarı kullanan tüm çağrılar anında çalışmayı durduracaktır.`)) return;
    setRevokingId(key.id);
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
    } finally {
      setRevokingId(null);
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

  const activeCount = keys.filter((k) => !k.revoked).length;
  const revokedCount = keys.filter((k) => k.revoked).length;
  const usedCount = keys.filter((k) => k.lastUsedAt).length;

  return (
    <section className="admin-stack">
      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat label="Toplam anahtar" value={<span className="mono">{keys.length}</span>} tone="info" icon={<KeyRound size={15} />} />
          <HoloStat label="Aktif" value={<span className="mono">{activeCount}</span>} sub="çalışan anahtar" tone="success" icon={<ShieldCheck size={15} />} />
          <HoloStat label="Kullanımda" value={<span className="mono">{usedCount}</span>} sub="en az bir kez çağrıldı" tone="cyan" icon={<Activity size={15} />} />
          <HoloStat label="İptal edildi" value={<span className="mono">{revokedCount}</span>} tone={revokedCount > 0 ? 'warning' : 'violet'} icon={<Ban size={15} />} />
        </div>
      </Reveal>

      <div className="holo-grid-2">
        <Reveal delay={0.05}>
          <HoloPanel title="Etkin anahtarlar" icon={<KeyRound size={16} />}>
            <div className="panel-stack">
              {loading
                ? [0, 1, 2].map((i) => <div key={`sk-${i}`} className="skeleton skeleton-row" />)
                : null}
              {!loading && keys.length === 0 ? <p className="helper">Henüz API anahtarı yok.</p> : null}
              {keys.map((k) => (
                <div className="row alert-rule-row" key={k.id}>
                  <div>
                    <strong>{k.name}</strong>{' '}
                    {k.revoked ? <span className="status-chip"><span className="dot dot-error" />İptal edildi</span> : <span className="status-chip"><span className="dot dot-success" />Aktif</span>}
                    <div className="helper mono">
                      {k.maskedKey} · {k.scopes.join(', ')} ·{' '}
                      {k.lastUsedAt ? `son kullanım ${new Date(k.lastUsedAt).toLocaleDateString('tr-TR')}` : 'hiç kullanılmadı'}
                    </div>
                  </div>
                  {!k.revoked ? (
                    <button type="button" className="icon-btn" disabled={revokingId === k.id} onClick={() => revoke(k)} aria-label={`${k.name} anahtarını iptal et`} title="İptal et">
                      {revokingId === k.id ? <Loader2 size={15} className="spin" /> : <Trash2 size={15} />}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            {msg ? <p className="helper helper--note">{msg}</p> : null}
          </HoloPanel>
        </Reveal>

        <Reveal delay={0.1}>
          <HoloPanel title="Anahtar oluştur" icon={<Sparkles size={16} />} scan>
            <div className="admin-form">
              <div className="admin-field field">
                <label htmlFor="key-name">Ad</label>
                <input
                  id="key-name"
                  className="field-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="örn. CI hattı, Zapier"
                />
              </div>
              <div className="admin-field field">
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
          </HoloPanel>
        </Reveal>
      </div>

      {revealed ? (
        <div className="modal-overlay" onClick={() => setRevealed(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h2><KeyRound size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />Yeni API anahtarınız</h2>
              <button type="button" className="modal-close" onClick={() => setRevealed(null)} aria-label="Kapat">
                <X size={16} />
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
