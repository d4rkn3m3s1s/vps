'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  role: string;
  members: number;
  devices: number;
};

type Settings = {
  require2fa: boolean;
  restrictInvites: boolean;
  strongPasswords: boolean;
  sessionExpiryHrs: number;
};

// Which policies the API actually enforces today (vs. advisory preferences).
type PolicyKey = 'require2fa' | 'restrictInvites' | 'strongPasswords';
const POLICY_META: { key: PolicyKey; title: string; description: string; enforced: boolean }[] = [
  {
    key: 'require2fa',
    title: 'Tüm üyeler için 2FA zorunlu kıl',
    description: 'İki adımlı doğrulaması etkin olmayan üyeler bu çalışma alanına geçiş yapamaz.',
    enforced: true
  },
  {
    key: 'restrictInvites',
    title: 'Davetleri yalnızca yöneticilerle sınırla',
    description: 'Kapalıyken operatörler de üye davet edebilir. İzleyiciler hiçbir zaman davet edemez.',
    enforced: true
  },
  {
    key: 'strongPasswords',
    title: 'Güçlü parola zorunlu kıl',
    description: 'Kayıt ve sıfırlama sırasında zayıf parolaları reddet. (Tavsiye niteliğinde — bir sonraki sıfırlamada uygulanır.)',
    enforced: false
  }
];

export default function AdminGeneralPage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [name, setName] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [policyBusy, setPolicyBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Resolve the ACTIVE workspace (from the fleet_workspace cookie), not the
        // first one — otherwise admin edits the wrong workspace after switching.
        const [wsRes, activeRes] = await Promise.all([
          fetch('/api/workspaces'),
          fetch('/api/workspaces/active')
        ]);
        const [wsJson, activeJson] = await Promise.all([wsRes.json(), activeRes.json()]);
        const list = (Array.isArray(wsJson.data) ? wsJson.data : []) as Workspace[];
        const activeId: string | null = activeJson?.data?.activeId ?? null;
        const ws = list.find((w) => w.id === activeId) ?? list[0];
        if (ws) {
          setWorkspace(ws);
          setName(ws.name);
          const sj = await fetch(`/api/workspaces/${ws.id}/settings`).then((r) => r.json()).catch(() => ({}));
          if (sj.data) setSettings(sj.data as Settings);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 3000);
  }

  async function save() {
    if (!workspace) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === workspace.name) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Değişiklikler kaydedilemedi');
      const updated = (json.data ?? {}) as Partial<Workspace>;
      setWorkspace({ ...workspace, ...updated, name: updated.name ?? trimmed });
      setName(updated.name ?? trimmed);
      flash('Çalışma alanı ayarları kaydedildi');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Değişiklikler kaydedilemedi');
    } finally {
      setBusy(false);
    }
  }

  // Persist a single policy toggle immediately (optimistic, reverts on failure).
  async function togglePolicy(key: PolicyKey, value: boolean) {
    if (!workspace || !settings) return;
    const prev = settings;
    setSettings({ ...settings, [key]: value });
    setPolicyBusy(key);
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Politika güncellenemedi');
      if (json.data) setSettings(json.data as Settings);
      flash('Politika güncellendi');
    } catch (e) {
      setSettings(prev); // revert
      flash(e instanceof Error ? e.message : 'Politika güncellenemedi');
    } finally {
      setPolicyBusy(null);
    }
  }

  // Persists the session-expiry number on blur (admins only, validated range).
  async function saveSessionExpiry(hours: number) {
    if (!workspace || !settings || !isAdmin) return;
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
      flash('Oturum süresi 1 ile 720 saat arasında olmalıdır');
      setSettings({ ...settings }); // force re-render to reset invalid input
      return;
    }
    if (hours === settings.sessionExpiryHrs) return;
    setPolicyBusy('sessionExpiryHrs');
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionExpiryHrs: hours })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Kaydedilemedi');
      if (json.data) setSettings(json.data as Settings);
      flash('Politika güncellendi');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Kaydedilemedi');
    } finally {
      setPolicyBusy(null);
    }
  }

  const isAdmin = workspace?.role === 'admin';
  const trimmedName = name.trim();
  const unchanged = !workspace || trimmedName === workspace.name;
  const role = workspace?.role ?? 'viewer';

  return (
    <section className="section-grid">
      <div className="panel">
        <h2>Çalışma Alanı</h2>
        <div className="admin-form">
          <div className="admin-field">
            <label htmlFor="workspace-name">Çalışma alanı adı</label>
            <input
              id="workspace-name"
              className="field-input"
              type="text"
              value={name}
              placeholder="Çalışma alanı adı"
              disabled={!isAdmin || busy}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="row">
            <button
              type="button"
              className="btn-primary"
              disabled={!isAdmin || busy || !trimmedName || unchanged}
              onClick={save}
            >
              <Save size={15} /> Değişiklikleri kaydet
            </button>
            {msg ? <span className="helper">{msg}</span> : null}
          </div>

          {!isAdmin ? <p className="helper">Ayarları yalnızca çalışma alanı yöneticileri düzenleyebilir.</p> : null}
        </div>

        <div className="panel-stack" style={{ marginTop: '1.25rem' }}>
          <div className="row">
            <span className="helper">Çalışma alanı kısa adı</span>
            <span className="mono">{workspace?.slug ?? '—'}</span>
          </div>
          <div className="row">
            <span className="helper">Üyeler</span>
            <span className="mono">{workspace?.members ?? '—'}</span>
          </div>
          <div className="row">
            <span className="helper">Cihazlar</span>
            <span className="mono">{workspace?.devices ?? '—'}</span>
          </div>
          <div className="row">
            <span className="helper">Rolünüz</span>
            <span className={`role-badge role-${role}`}>{role}</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Güvenlik politikası</h2>
        <div className="panel-stack">
          {POLICY_META.map((policy) => (
            <div className="admin-toggle-row" key={policy.key}>
              <span className="toggle-meta">
                <strong>
                  {policy.title}{' '}
                  {policy.enforced ? (
                    <span className="policy-tag policy-tag-on">Zorunlu</span>
                  ) : (
                    <span className="policy-tag">Tavsiye</span>
                  )}
                </strong>
                <span>{policy.description}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={settings ? settings[policy.key] : false}
                disabled={!isAdmin || !settings || policyBusy === policy.key}
                onChange={(e) => togglePolicy(policy.key, e.target.checked)}
                aria-label={policy.title}
              />
            </div>
          ))}

          <div className="admin-toggle-row">
            <span className="toggle-meta">
              <strong>Oturum süresi (saat)</strong>
              <span>Boştaki bir oturumun ne kadar süre geçerli kalacağı. (Tavsiye niteliğinde — bir sonraki girişte uygulanır.)</span>
            </span>
            <input
              className="field-input"
              style={{ width: '5rem' }}
              type="number"
              min={1}
              max={720}
              value={settings?.sessionExpiryHrs ?? 12}
              disabled={!isAdmin || !settings || policyBusy === 'sessionExpiryHrs'}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (settings) setSettings({ ...settings, sessionExpiryHrs: v });
              }}
              onBlur={(e) => void saveSessionExpiry(Number(e.target.value))}
              aria-label="Oturum süresi saat"
            />
          </div>
        </div>
        {!isAdmin ? (
          <p className="helper" style={{ marginTop: '0.75rem' }}>
            Güvenlik politikasını yalnızca çalışma alanı yöneticileri değiştirebilir.
          </p>
        ) : (
          <p className="helper" style={{ marginTop: '0.75rem' }}>
            <strong>Zorunlu</strong> politikalar anında yürürlüğe girer. Tavsiye niteliğindekiler bir sonraki girişte veya
            parola sıfırlamada uygulanır.
          </p>
        )}
      </div>
    </section>
  );
}
