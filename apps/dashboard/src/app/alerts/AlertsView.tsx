'use client';

import { useEffect, useState, useCallback } from 'react';
import { BellRing, Plus, Trash2, Check, Mail } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';
import { useFleetEvents } from '../../lib/live';

type Trigger = { key: string; label: string; hasThreshold: boolean };
type Rule = {
  id: string;
  name: string;
  trigger: string;
  threshold: number;
  notify: boolean;
  webhook: boolean;
  email: boolean;
  active: boolean;
  fireCount: number;
  lastFiredAt: string | null;
};
type AlertEvent = {
  id: string;
  title: string;
  detail: string;
  acknowledged: boolean;
  createdAt: string;
  rule?: { name: string; trigger: string } | null;
};

export function AlertsView() {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('JOB_FAILED');
  const [threshold, setThreshold] = useState(80);
  const [emailOnCreate, setEmailOnCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadEvents = useCallback(() => {
    fetch('/api/alerts/events').then((r) => r.json()).then((j) => setEvents(j.data ?? [])).catch(() => {});
  }, []);
  const loadRules = useCallback(() => {
    fetch('/api/alerts/rules').then((r) => r.json()).then((j) => setRules(j.data ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/alerts/triggers').then((r) => r.json()).then((j) => setTriggers(j.data ?? [])).catch(() => {});
    loadRules();
    loadEvents();
  }, [loadRules, loadEvents]);

  // Live: refresh the event feed the instant an alert fires.
  useFleetEvents(['alert.fired'], () => loadEvents());

  const activeTrigger = triggers.find((t) => t.key === trigger);

  async function createRule() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await fetch('/api/alerts/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          trigger,
          email: emailOnCreate,
          ...(activeTrigger?.hasThreshold ? { threshold } : {})
        })
      });
      setName('');
      setEmailOnCreate(false);
      loadRules();
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(rule: Rule) {
    await fetch(`/api/alerts/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !rule.active })
    });
    loadRules();
  }

  async function toggleEmail(rule: Rule) {
    await fetch(`/api/alerts/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: !rule.email })
    });
    loadRules();
  }

  async function deleteRule(id: string) {
    await fetch(`/api/alerts/rules/${id}`, { method: 'DELETE' });
    loadRules();
  }

  return (
    <PageMotion className="page">
      <PageHeader title="Alerts" subtitle={`${rules.length} rules · ${events.length} recent events`} />

      <div className="section-grid">
        <div className="panel">
          <h2><BellRing size={16} style={{ marginRight: 6 }} /> Alert rules</h2>
          <div className="panel-stack">
            {rules.length === 0 ? <p className="helper">No rules yet. Create one below.</p> : null}
            {rules.map((r) => (
              <div className="row alert-rule-row" key={r.id}>
                <div>
                  <strong>{r.name}</strong>
                  <div className="helper">
                    {r.trigger}{r.threshold > 0 ? ` ≥ ${r.threshold}%` : ''} · fired {r.fireCount}×
                  </div>
                </div>
                <div className="alert-rule-actions">
                  <button
                    type="button"
                    className={`pill ${r.email ? 'pill-on' : ''}`}
                    onClick={() => toggleEmail(r)}
                    title={r.email ? 'Email notifications on' : 'Email notifications off'}
                  >
                    <Mail size={12} /> Email
                  </button>
                  <button
                    type="button"
                    className={`pill ${r.active ? 'pill-on' : ''}`}
                    onClick={() => toggleRule(r)}
                  >
                    {r.active ? 'Active' : 'Paused'}
                  </button>
                  <button type="button" className="icon-btn" onClick={() => deleteRule(r.id)} aria-label="Delete">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="alert-create">
            <input
              className="field-input"
              placeholder="Rule name (e.g. Notify on failures)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select className="inline-select" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {triggers.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            {activeTrigger?.hasThreshold ? (
              <input
                className="inline-select"
                type="number"
                min={1}
                max={100}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                style={{ width: 80 }}
              />
            ) : null}
            <label className="alert-email-check" title="Email workspace admins when this rule fires">
              <input type="checkbox" checked={emailOnCreate} onChange={(e) => setEmailOnCreate(e.target.checked)} />
              <Mail size={13} /> Email
            </label>
            <button type="button" className="btn-primary" disabled={busy || !name.trim()} onClick={createRule}>
              <Plus size={15} /> Add
            </button>
          </div>
        </div>

        <div className="panel">
          <h2>Recent alert events</h2>
          <div className="list-grid">
            {events.length === 0 ? (
              <div className="log-card helper">No alerts fired yet.</div>
            ) : (
              events.map((e) => (
                <article className="log-card" key={e.id}>
                  <div className="row">
                    <strong>{e.title}</strong>
                    {e.acknowledged ? <span className="pill pill-on"><Check size={12} /> ack</span> : null}
                  </div>
                  <div className="helper">{e.detail}</div>
                  <div className="helper mono">
                    {e.rule?.name ?? '—'} · {new Date(e.createdAt).toLocaleString('tr-TR')}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </PageMotion>
  );
}
