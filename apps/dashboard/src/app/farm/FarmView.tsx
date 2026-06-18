'use client';

import { useEffect, useState } from 'react';
import { Sprout, Plus, Play, Pause, Trash2, Zap, Clock, Activity } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

type Flow = { id: string; name: string };
type Group = { id: string; name: string };
type Campaign = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  rpaFlowId: string | null;
  groupId: string | null;
  minIntervalMin: number;
  maxIntervalMin: number;
  maxActionsPerDay: number;
  activeFromHour: number;
  activeToHour: number;
  jitterPct: number;
  runCount: number;
  lastRunAt: string | null;
  nextRunAt: string;
  deviceCount?: number;
  rpaFlow?: { id: string; name: string } | null;
  group?: { id: string; name: string } | null;
};
type Account = {
  id: string;
  deviceId: string;
  warmupStage: number;
  daysActive: number;
  actionsToday: number;
  totalActions: number;
  healthScore: number;
  lastActionAt: string | null;
  device?: { id: string; name: string; status: string } | null;
};

const STAGE_LABEL = ['—', 'New', 'Warming', 'Building', 'Active', 'Mature'];

export function FarmView() {
  const [tab, setTab] = useState<'campaigns' | 'accounts'>('campaigns');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const [form, setForm] = useState({
    name: '',
    rpaFlowId: '',
    groupId: '',
    minIntervalMin: '45',
    maxIntervalMin: '180',
    maxActionsPerDay: '20',
    activeFromHour: '8',
    activeToHour: '23',
    jitterPct: '25'
  });

  function flash(t: string) {
    setMsg(t);
    setTimeout(() => setMsg(null), 4000);
  }

  async function loadAll() {
    try {
      const [cRes, fRes, gRes, aRes] = await Promise.all([
        fetch('/api/farm/campaigns'),
        fetch('/api/rpa'),
        fetch('/api/groups'),
        fetch('/api/farm/accounts')
      ]);
      const [cJson, fJson, gJson, aJson] = await Promise.all([cRes.json(), fRes.json(), gRes.json(), aRes.json()]);
      if (Array.isArray(cJson.data)) setCampaigns(cJson.data);
      if (Array.isArray(fJson.data)) setFlows(fJson.data);
      if (Array.isArray(gJson.data)) setGroups(gJson.data);
      if (Array.isArray(aJson.data)) setAccounts(aJson.data);
    } catch {
      flash('Could not load farm data.');
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function createCampaign() {
    if (!form.name.trim()) return flash('Campaign name is required.');
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        rpaFlowId: form.rpaFlowId || undefined,
        groupId: form.groupId || undefined,
        minIntervalMin: Number(form.minIntervalMin),
        maxIntervalMin: Number(form.maxIntervalMin),
        maxActionsPerDay: Number(form.maxActionsPerDay),
        activeFromHour: Number(form.activeFromHour),
        activeToHour: Number(form.activeToHour),
        jitterPct: Number(form.jitterPct)
      };
      const res = await fetch('/api/farm/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Could not create campaign');
      setCreateOpen(false);
      setForm({ ...form, name: '' });
      flash('Campaign created and running.');
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not create campaign');
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(c: Campaign) {
    const status = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setBusy(true);
    try {
      const res = await fetch(`/api/farm/campaigns/${c.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error('Could not update');
      await loadAll();
    } catch {
      flash('Could not update campaign.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Campaign) {
    if (!confirm(`Delete campaign "${c.name}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/farm/campaigns/${c.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete');
      flash('Campaign deleted.');
      await loadAll();
    } catch {
      flash('Could not delete campaign.');
    } finally {
      setBusy(false);
    }
  }

  async function runNow() {
    setBusy(true);
    try {
      const res = await fetch('/api/farm/tick', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Tick failed');
      flash(`Engine ran: ${json.data?.dispatched ?? 0} action(s) dispatched across ${json.data?.campaigns ?? 0} campaign(s).`);
      await loadAll();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Tick failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Farm"
        subtitle="Humanized, scheduled account warmup across your device fleet."
        actions={
          <>
            <button type="button" className="btn-ghost" disabled={busy} onClick={runNow} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Zap size={14} /> Run engine now
            </button>
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Plus size={14} /> New campaign
            </button>
          </>
        }
      />

      <div className="tabs">
        <button type="button" className={tab === 'campaigns' ? 'tab tab-active' : 'tab'} onClick={() => setTab('campaigns')}>
          Campaigns ({campaigns.length})
        </button>
        <button type="button" className={tab === 'accounts' ? 'tab tab-active' : 'tab'} onClick={() => setTab('accounts')}>
          Warmup accounts ({accounts.length})
        </button>
      </div>

      {msg ? <p className="helper" style={{ marginBottom: '0.75rem' }}>{msg}</p> : null}

      {tab === 'campaigns' ? (
        campaigns.length === 0 ? (
          <div className="empty-state">
            <div className="empty-art">🌱</div>
            <h3>No campaigns yet</h3>
            <p>Create a campaign to run an RPA flow across a device group on a humanized schedule.</p>
          </div>
        ) : (
          <div className="farm-grid">
            {campaigns.map((c) => (
              <article key={c.id} className="farm-card">
                <div className="farm-card-head">
                  <div>
                    <strong className="farm-card-title">{c.name}</strong>
                    <span className={`farm-status farm-status-${c.status.toLowerCase()}`}>{c.status.toLowerCase()}</span>
                  </div>
                  <div className="farm-card-actions">
                    <button type="button" className="icon-btn" disabled={busy} onClick={() => toggleStatus(c)} title={c.status === 'ACTIVE' ? 'Pause' : 'Resume'}>
                      {c.status === 'ACTIVE' ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button type="button" className="icon-btn danger-btn" disabled={busy} onClick={() => remove(c)} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="farm-card-meta">
                  <span><Sprout size={12} /> {c.rpaFlow?.name ?? <em className="farm-warn">no flow</em>}</span>
                  <span><Activity size={12} /> {c.group?.name ?? <em className="farm-warn">no group</em>} · {c.deviceCount ?? 0} phones</span>
                  <span><Clock size={12} /> every {c.minIntervalMin}–{c.maxIntervalMin}m · {c.activeFromHour}:00–{c.activeToHour}:00</span>
                  <span>≤ {c.maxActionsPerDay}/day · ±{c.jitterPct}% jitter</span>
                  <span className="helper">{c.runCount} runs · next {new Date(c.nextRunAt).toLocaleTimeString()}</span>
                </div>
              </article>
            ))}
          </div>
        )
      ) : (
        accounts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-art">📈</div>
            <h3>No warmup data yet</h3>
            <p>Accounts appear here automatically once a campaign starts farming their devices.</p>
          </div>
        ) : (
          <div className="panel">
            <div className="health-table">
              <div className="health-row health-head" style={{ gridTemplateColumns: '1.4fr 1fr 0.8fr 0.8fr 1fr 0.9fr' }}>
                <span>Device</span><span>Stage</span><span>Days</span><span>Today</span><span>Total</span><span>Health</span>
              </div>
              {accounts.map((a) => (
                <div key={a.id} className="health-row" style={{ gridTemplateColumns: '1.4fr 1fr 0.8fr 0.8fr 1fr 0.9fr' }}>
                  <span className="health-name">{a.device?.name ?? a.deviceId.slice(0, 8)}</span>
                  <span><span className={`farm-stage farm-stage-${a.warmupStage}`}>{STAGE_LABEL[a.warmupStage] ?? a.warmupStage}</span></span>
                  <span>{a.daysActive}</span>
                  <span>{a.actionsToday}</span>
                  <span>{a.totalActions}</span>
                  <span className="health-usage">
                    <span className="health-bar health-bar-sm">
                      <span className={`health-bar-fill ${a.healthScore >= 70 ? 'bar-ok' : a.healthScore >= 40 ? 'bar-warn' : 'bar-bad'}`} style={{ width: `${a.healthScore}%` }} />
                    </span>
                    <span className="health-usage-num mono">{a.healthScore}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      )}

      {createOpen ? (
        <div className="modal-overlay" onClick={() => !busy && setCreateOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head"><h2>New farm campaign</h2></header>
            <div className="modal-body farm-form">
              <label className="distribute-field">
                <span className="helper">Campaign name</span>
                <input className="field-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. TikTok warmup" />
              </label>
              <div className="farm-form-row">
                <label className="distribute-field">
                  <span className="helper">RPA flow (the actions)</span>
                  <select className="field-input" value={form.rpaFlowId} onChange={(e) => setForm({ ...form, rpaFlowId: e.target.value })}>
                    <option value="">— choose flow —</option>
                    {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </label>
                <label className="distribute-field">
                  <span className="helper">Target device group</span>
                  <select className="field-input" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                    <option value="">— choose group —</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="farm-form-row">
                <label className="distribute-field"><span className="helper">Min interval (min)</span><input className="field-input" type="number" value={form.minIntervalMin} onChange={(e) => setForm({ ...form, minIntervalMin: e.target.value })} /></label>
                <label className="distribute-field"><span className="helper">Max interval (min)</span><input className="field-input" type="number" value={form.maxIntervalMin} onChange={(e) => setForm({ ...form, maxIntervalMin: e.target.value })} /></label>
              </div>
              <div className="farm-form-row">
                <label className="distribute-field"><span className="helper">Max actions / day</span><input className="field-input" type="number" value={form.maxActionsPerDay} onChange={(e) => setForm({ ...form, maxActionsPerDay: e.target.value })} /></label>
                <label className="distribute-field"><span className="helper">Jitter %</span><input className="field-input" type="number" value={form.jitterPct} onChange={(e) => setForm({ ...form, jitterPct: e.target.value })} /></label>
              </div>
              <div className="farm-form-row">
                <label className="distribute-field"><span className="helper">Active from (hour)</span><input className="field-input" type="number" min={0} max={23} value={form.activeFromHour} onChange={(e) => setForm({ ...form, activeFromHour: e.target.value })} /></label>
                <label className="distribute-field"><span className="helper">Active to (hour)</span><input className="field-input" type="number" min={1} max={24} value={form.activeToHour} onChange={(e) => setForm({ ...form, activeToHour: e.target.value })} /></label>
              </div>
              <p className="helper">The engine runs the flow on one eligible phone per interval, never exceeding the daily cap or the device's warmup-stage limit, and only within active hours.</p>
            </div>
            <footer className="modal-foot">
              <button type="button" className="btn-ghost" onClick={() => setCreateOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary" onClick={createCampaign} disabled={busy || !form.name.trim()}>
                {busy ? 'Creating…' : 'Create campaign'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </PageMotion>
  );
}
