'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Zap, ExternalLink, XCircle, RotateCcw } from 'lucide-react';

type PlanCard = {
  key: string;
  name: string;
  priceLabel: string;
  deviceLimit: number;
  memberLimit: number;
  features: string[];
  purchasable: boolean;
};
type Billing = {
  plan: string;
  planName: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  usage: { devices: { used: number; limit: number }; members: { used: number; limit: number } };
  plans: PlanCard[];
  billingConfigured: boolean;
};

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone = pct >= 100 ? '#EF4444' : pct >= 80 ? '#F59E0B' : '#4F7CFF';
  return (
    <div className="usage-row">
      <div className="usage-head">
        <span>{label}</span>
        <span className="mono">{used} / {limit}</span>
      </div>
      <div className="infra-track">
        <div className="infra-fill" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${tone}66, ${tone})` }} />
      </div>
    </div>
  );
}

export default function AdminBillingPage() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const loadBilling = useCallback(async () => {
    try {
      const res = await fetch('/api/billing');
      const json: { data?: Billing } = await res.json();
      setBilling(json.data ?? null);
    } catch {
      setError('Could not load billing');
    }
  }, []);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  async function upgrade(plan: string) {
    setBusy(plan);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan })
      });
      const json = await res.json();
      if (json.url) {
        window.location.href = json.url; // redirect to Stripe Checkout
        return;
      }
      throw new Error(json.message ?? 'Could not start checkout');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout failed');
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy('portal');
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const json = await res.json();
      if (json.url) window.location.href = json.url;
      else throw new Error(json.message ?? 'No billing account yet');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open portal');
      setBusy(null);
    }
  }

  async function cancelSubscription() {
    if (!window.confirm('Cancel your subscription? You keep access until the end of the current period.')) return;
    setBusy('cancel');
    setError(null);
    setFlash(null);
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST' });
      if (!res.ok) {
        const json: { message?: string } = await res.json();
        throw new Error(json.message ?? 'Could not cancel subscription');
      }
      await loadBilling();
      setFlash('Subscription set to cancel at period end.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel subscription');
    } finally {
      setBusy(null);
    }
  }

  async function resumeSubscription() {
    setBusy('resume');
    setError(null);
    setFlash(null);
    try {
      const res = await fetch('/api/billing/resume', { method: 'POST' });
      if (!res.ok) {
        const json: { message?: string } = await res.json();
        throw new Error(json.message ?? 'Could not resume subscription');
      }
      await loadBilling();
      setFlash('Subscription resumed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resume subscription');
    } finally {
      setBusy(null);
    }
  }

  const isPaid = billing != null && billing.plan !== 'free';
  const periodEndLabel = billing?.currentPeriodEnd
    ? new Date(billing.currentPeriodEnd).toLocaleDateString('tr-TR')
    : null;

  return (
    <>
      {!billing?.billingConfigured ? (
        <div className="panel" style={{ borderColor: 'rgba(245,158,11,0.4)' }}>
          <p className="helper">
            ⚠ Stripe is not configured yet. Add <code>STRIPE_SECRET_KEY</code> + price IDs to the API <code>.env</code> to
            enable real checkout. Plans and quota enforcement already work.
          </p>
        </div>
      ) : null}

      {error ? <div className="toast toast-error">{error}</div> : null}
      {flash ? <div className="toast">{flash}</div> : null}

      {billing ? (
        <>
          <div className="panel">
            <h2>Usage</h2>
            <div className="usage-grid">
              <UsageBar label="Cloud phones" used={billing.usage.devices.used} limit={billing.usage.devices.limit} />
              <UsageBar label="Team members" used={billing.usage.members.used} limit={billing.usage.members.limit} />
            </div>
          </div>

          {isPaid ? (
            <div className="panel panel-stack">
              <h2>Subscription</h2>
              {billing.cancelAtPeriodEnd ? (
                <div className="cancel-banner">
                  <p className="helper">
                    Your subscription is scheduled to cancel
                    {periodEndLabel ? ` at the end of the current period (${periodEndLabel})` : ' at the end of the current period'}.
                    You keep access until then.
                  </p>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy === 'resume'}
                    onClick={resumeSubscription}
                  >
                    <RotateCcw size={15} /> {busy === 'resume' ? 'Resuming…' : 'Keep subscription'}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                  <button type="button" className="btn-ghost" disabled={busy === 'portal'} onClick={openPortal}>
                    <ExternalLink size={15} /> Manage subscription
                  </button>
                  <button
                    type="button"
                    className="btn-ghost danger-btn"
                    disabled={busy === 'cancel'}
                    onClick={cancelSubscription}
                  >
                    <XCircle size={15} /> {busy === 'cancel' ? 'Cancelling…' : 'Cancel subscription'}
                  </button>
                </div>
              )}
            </div>
          ) : null}

          <div className="plans-grid">
            {billing.plans.map((p) => {
              const current = p.key === billing.plan;
              return (
                <div key={p.key} className={`plan-tier${current ? ' plan-tier-current' : ''}`}>
                  {current ? <span className="plan-tier-badge">Current</span> : null}
                  <h3>{p.name}</h3>
                  <div className="plan-tier-price">{p.priceLabel}</div>
                  <ul className="plan-tier-features">
                    {p.features.map((f) => (
                      <li key={f}><Check size={14} /> {f}</li>
                    ))}
                  </ul>
                  {current ? (
                    <button type="button" className="btn-ghost" disabled>Current plan</button>
                  ) : p.purchasable ? (
                    <button type="button" className="btn-primary" disabled={busy === p.key} onClick={() => upgrade(p.key)}>
                      <Zap size={15} /> {busy === p.key ? 'Redirecting…' : `Upgrade to ${p.name}`}
                    </button>
                  ) : (
                    <button type="button" className="btn-ghost" disabled>Downgrade in portal</button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="panel"><p className="helper">Loading billing…</p></div>
      )}
    </>
  );
}
