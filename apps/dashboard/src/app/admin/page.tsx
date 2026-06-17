'use client';

import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Button, Input, Switch } from '@heroui/react';

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
    title: 'Require 2FA for all members',
    description: 'Members without two-factor enabled are blocked from switching into this workspace.',
    enforced: true
  },
  {
    key: 'restrictInvites',
    title: 'Restrict invites to admins',
    description: 'When off, operators can also invite members. Viewers never can.',
    enforced: true
  },
  {
    key: 'strongPasswords',
    title: 'Enforce strong passwords',
    description: 'Reject weak passwords during sign-up and reset. (Advisory — applied on next reset.)',
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
    fetch('/api/workspaces')
      .then((r) => r.json())
      .then((j) => {
        const list = (Array.isArray(j.data) ? j.data : []) as Workspace[];
        if (list[0]) {
          setWorkspace(list[0]);
          setName(list[0].name);
          fetch(`/api/workspaces/${list[0].id}/settings`)
            .then((r) => r.json())
            .then((sj) => {
              if (sj.data) setSettings(sj.data as Settings);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
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
      if (!res.ok) throw new Error(json.message ?? 'Could not save changes');
      const updated = (json.data ?? {}) as Partial<Workspace>;
      setWorkspace({ ...workspace, ...updated, name: updated.name ?? trimmed });
      setName(updated.name ?? trimmed);
      flash('Workspace settings saved');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save changes');
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
      if (!res.ok) throw new Error(json.message ?? 'Could not update policy');
      if (json.data) setSettings(json.data as Settings);
      flash('Policy updated');
    } catch (e) {
      setSettings(prev); // revert
      flash(e instanceof Error ? e.message : 'Could not update policy');
    } finally {
      setPolicyBusy(null);
    }
  }

  // Persists the session-expiry number on blur (admins only, validated range).
  async function saveSessionExpiry(hours: number) {
    if (!workspace || !settings || !isAdmin) return;
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
      flash('Session expiry must be between 1 and 720 hours');
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
      if (!res.ok) throw new Error(json.message ?? 'Could not save');
      if (json.data) setSettings(json.data as Settings);
      flash('Policy updated');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save');
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
        <h2>Workspace</h2>
        <div className="admin-form">
          <div className="admin-field">
            <label htmlFor="workspace-name">Workspace name</label>
            <Input
              id="workspace-name"
              type="text"
              value={name}
              placeholder="Workspace name"
              disabled={!isAdmin || busy}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="row">
            <Button
              variant="primary"
              isDisabled={!isAdmin || busy || !trimmedName || unchanged}
              onPress={save}
            >
              <Save size={15} /> Save changes
            </Button>
            {msg ? <span className="helper">{msg}</span> : null}
          </div>

          {!isAdmin ? <p className="helper">Only workspace admins can edit settings.</p> : null}
        </div>

        <div className="panel-stack" style={{ marginTop: '1.25rem' }}>
          <div className="row">
            <span className="helper">Workspace slug</span>
            <span className="mono">{workspace?.slug ?? '—'}</span>
          </div>
          <div className="row">
            <span className="helper">Members</span>
            <span className="mono">{workspace?.members ?? '—'}</span>
          </div>
          <div className="row">
            <span className="helper">Devices</span>
            <span className="mono">{workspace?.devices ?? '—'}</span>
          </div>
          <div className="row">
            <span className="helper">Your role</span>
            <span className={`role-badge role-${role}`}>{role}</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Security policy</h2>
        <div className="panel-stack">
          {POLICY_META.map((policy) => (
            <div className="admin-toggle-row" key={policy.key}>
              <span className="toggle-meta">
                <strong>
                  {policy.title}{' '}
                  {policy.enforced ? (
                    <span className="policy-tag policy-tag-on">Enforced</span>
                  ) : (
                    <span className="policy-tag">Advisory</span>
                  )}
                </strong>
                <span>{policy.description}</span>
              </span>
              <Switch
                isSelected={settings ? Boolean(settings[policy.key]) : false}
                isDisabled={!isAdmin || !settings || policyBusy === policy.key}
                onChange={(v: boolean) => togglePolicy(policy.key, v)}
                aria-label={policy.title}
              />
            </div>
          ))}

          <div className="admin-toggle-row">
            <span className="toggle-meta">
              <strong>Session expiry (hours)</strong>
              <span>How long an idle session stays valid. (Advisory — applied on next login.)</span>
            </span>
            <Input
              style={{ width: '5rem' }}
              type="number"
              min={1}
              max={720}
              value={String(settings?.sessionExpiryHrs ?? 12)}
              disabled={!isAdmin || !settings || policyBusy === 'sessionExpiryHrs'}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (settings) setSettings({ ...settings, sessionExpiryHrs: v });
              }}
              onBlur={(e) => void saveSessionExpiry(Number(e.target.value))}
              aria-label="Session expiry hours"
            />
          </div>
        </div>
        {!isAdmin ? (
          <p className="helper" style={{ marginTop: '0.75rem' }}>
            Only workspace admins can change security policy.
          </p>
        ) : (
          <p className="helper" style={{ marginTop: '0.75rem' }}>
            <strong>Enforced</strong> policies take effect immediately. Advisory ones are applied at the next login or
            password reset.
          </p>
        )}
      </div>
    </section>
  );
}
