'use client';

import { useEffect, useState, useCallback } from 'react';
import { BellRing, Plus, Trash2, Check, Mail, Activity, ShieldAlert, Radio, Zap, Send } from 'lucide-react';
import { PageMotion } from '../../components/Motion';
import { HoloHeader, HoloPanel, HoloStat, Reveal } from '../../components/hud';
import { NotificationChannels } from '../../components/NotificationChannels';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadEvents = useCallback(async () => {
    const r = await fetch('/api/alerts/events');
    if (!r.ok) throw new Error('events');
    const j = await r.json();
    setEvents(j.data ?? []);
  }, []);
  const loadRules = useCallback(async () => {
    const r = await fetch('/api/alerts/rules');
    if (!r.ok) throw new Error('rules');
    const j = await r.json();
    setRules(j.data ?? []);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const tr = await fetch('/api/alerts/triggers');
      if (!tr.ok) throw new Error('triggers');
      const tj = await tr.json();
      setTriggers(tj.data ?? []);
      await Promise.all([loadRules(), loadEvents()]);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [loadRules, loadEvents]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Live: refresh the event feed the instant an alert fires.
  useFleetEvents(['alert.fired'], () => { void loadEvents().catch(() => {}); });

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
      void loadRules().catch(() => {});
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
    void loadRules().catch(() => {});
  }

  async function toggleEmail(rule: Rule) {
    await fetch(`/api/alerts/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: !rule.email })
    });
    void loadRules().catch(() => {});
  }

  async function deleteRule(id: string) {
    await fetch(`/api/alerts/rules/${id}`, { method: 'DELETE' });
    void loadRules().catch(() => {});
  }

  // Derived telemetry for the stat deck (no new fetches).
  const activeRules = rules.filter((r) => r.active).length;
  const pausedRules = rules.length - activeRules;
  const emailRules = rules.filter((r) => r.email).length;
  const pendingEvents = events.filter((e) => !e.acknowledged).length;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="UYARI MERKEZİ"
        title="Uyarılar"
        subtitle={`${rules.length} kural · ${events.length} son olay`}
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Etkin kurallar"
            value={activeRules}
            sub={`${rules.length} toplam kural`}
            tone="success"
            icon={<Activity size={16} />}
          />
          <HoloStat
            label="Duraklatılan"
            value={pausedRules}
            sub="izleme dışı"
            tone="warning"
            icon={<Radio size={16} />}
          />
          <HoloStat
            label="E-posta tetikli"
            value={emailRules}
            sub="bildirim açık"
            tone="cyan"
            icon={<Mail size={16} />}
          />
          <HoloStat
            label="Bekleyen olay"
            value={pendingEvents}
            sub={`${events.length} son olay`}
            tone={pendingEvents > 0 ? 'warning' : 'neutral'}
            icon={<ShieldAlert size={16} />}
          />
        </div>
      </Reveal>

      <div className="holo-grid-2">
        <Reveal>
          <HoloPanel title="Uyarı kuralları" icon={<BellRing size={16} />}>
            <div className="panel-stack">
              {loading ? (
                <>
                  <div className="skeleton-row" />
                  <div className="skeleton-row" />
                  <div className="skeleton-row" />
                </>
              ) : error ? (
                <div className="form-status form-status--err" role="alert">
                  Kurallar yüklenemedi.
                  <button type="button" className="btn-ghost btn-xs" onClick={() => void loadAll()}>Tekrar dene</button>
                </div>
              ) : rules.length === 0 ? (
                <p className="helper">Henüz kural yok. Aşağıdan bir tane oluşturun.</p>
              ) : null}
              {!loading && !error && rules.map((r) => (
                <div className="row alert-rule-row" key={r.id}>
                  <div>
                    <strong>{r.name}</strong>
                    <div className="helper mono">
                      {triggers.find((t) => t.key === r.trigger)?.label ?? r.trigger}{r.threshold > 0 ? ` ≥ ${r.threshold}%` : ''} · {r.fireCount}× tetiklendi
                    </div>
                  </div>
                  <div className="alert-rule-actions">
                    <button
                      type="button"
                      className={`status-chip btn-xs ${r.email ? 'pill-on' : ''}`}
                      onClick={() => toggleEmail(r)}
                      title={r.email ? 'E-posta bildirimleri açık' : 'E-posta bildirimleri kapalı'}
                    >
                      <Mail size={12} /> E-posta
                    </button>
                    <button
                      type="button"
                      className={`status-chip btn-xs ${r.active ? 'pill-on' : ''}`}
                      onClick={() => toggleRule(r)}
                    >
                      <span className={`dot ${r.active ? 'dot-online' : 'dot-offline'}`} />
                      {r.active ? 'Etkin' : 'Duraklatıldı'}
                    </button>
                    <button type="button" className="btn-ghost btn-xs" onClick={() => deleteRule(r.id)} aria-label="Sil">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="alert-create field-row">
              <input
                className="field-input"
                placeholder="Kural adı (örn. Başarısızlıklarda bildir)"
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
                  className="field-input mono"
                  type="number"
                  min={1}
                  max={100}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  style={{ width: 80 }}
                />
              ) : null}
              <label className="alert-email-check" title="Bu kural tetiklendiğinde çalışma alanı yöneticilerine e-posta gönder">
                <input type="checkbox" className="admin-switch" checked={emailOnCreate} onChange={(e) => setEmailOnCreate(e.target.checked)} />
                <Mail size={13} /> E-posta
              </label>
              <button type="button" className="btn-primary" disabled={busy || !name.trim()} onClick={createRule}>
                <Plus size={15} /> Ekle
              </button>
            </div>
          </HoloPanel>
        </Reveal>

        <Reveal delay={0.08}>
          <HoloPanel title="Son uyarı olayları" icon={<Zap size={16} />}>
            <div className="list-grid">
              {loading ? (
                <>
                  <div className="skeleton-row" />
                  <div className="skeleton-row" />
                  <div className="skeleton-row" />
                </>
              ) : error ? (
                <div className="form-status form-status--err" role="alert">
                  Olaylar yüklenemedi.
                  <button type="button" className="btn-ghost btn-xs" onClick={() => void loadAll()}>Tekrar dene</button>
                </div>
              ) : events.length === 0 ? (
                <div className="log-card helper">Henüz tetiklenen uyarı yok.</div>
              ) : (
                events.map((e) => (
                  <article className="log-card" key={e.id}>
                    <div className="row">
                      <strong>{e.title}</strong>
                      {e.acknowledged ? <span className="status-chip pill-on"><Check size={12} /> onaylandı</span> : null}
                    </div>
                    <div className="helper">{e.detail}</div>
                    <div className="helper mono">
                      {e.rule?.name ?? '—'} · {new Date(e.createdAt).toLocaleString('tr-TR')}
                    </div>
                  </article>
                ))
              )}
            </div>
          </HoloPanel>
        </Reveal>
      </div>

      <Reveal delay={0.12}>
        <HoloPanel title="Bildirim kanalları" icon={<Send size={16} />}>
          <p className="helper" style={{ marginBottom: 12 }}>
            Uyarılar tetiklendiğinde Telegram, Slack veya Discord&apos;a anlık bildirim gönderin.
          </p>
          <NotificationChannels />
        </HoloPanel>
      </Reveal>
    </PageMotion>
  );
}
