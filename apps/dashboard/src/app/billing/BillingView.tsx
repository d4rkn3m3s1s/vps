'use client';

import { useEffect, useState } from 'react';
import { Check, Zap, ExternalLink } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

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

export function BillingView() {
  const [billing, setBilling] = useState<Billing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/billing')
      .then((r) => r.json())
      .then((j) => setBilling(j.data ?? null))
      .catch(() => setError('Faturalama bilgileri yüklenemedi'));
  }, []);

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
      throw new Error(json.message ?? 'Ödeme başlatılamadı');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ödeme başarısız oldu');
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy('portal');
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      const json = await res.json();
      if (json.url) window.location.href = json.url;
      else throw new Error(json.message ?? 'Henüz bir faturalama hesabı yok');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Portal açılamadı');
      setBusy(null);
    }
  }

  return (
    <PageMotion className="page">
      <PageHeader
        title="Faturalama"
        subtitle={billing ? `Mevcut plan: ${billing.planName} · ${billing.status}` : 'Planlar, kullanım & abonelik'}
        actions={
          billing?.plan !== 'free' ? (
            <button type="button" className="btn-ghost" disabled={busy === 'portal'} onClick={openPortal}>
              <ExternalLink size={15} /> Aboneliği yönet
            </button>
          ) : undefined
        }
      />

      {!billing?.billingConfigured ? (
        <div className="panel" style={{ borderColor: 'rgba(245,158,11,0.4)' }}>
          <p className="helper">
            ⚠ Stripe henüz yapılandırılmadı. Gerçek ödemeyi etkinleştirmek için API <code>.env</code> dosyasına <code>STRIPE_SECRET_KEY</code>
            ve fiyat kimliklerini ekleyin. Planlar ve kota uygulaması hâlihazırda çalışmaktadır.
          </p>
        </div>
      ) : null}

      {error ? <div className="toast toast-error">{error}</div> : null}

      {billing ? (
        <>
          <div className="panel">
            <h2>Kullanım</h2>
            <div className="usage-grid">
              <UsageBar label="Bulut telefonlar" used={billing.usage.devices.used} limit={billing.usage.devices.limit} />
              <UsageBar label="Ekip üyeleri" used={billing.usage.members.used} limit={billing.usage.members.limit} />
            </div>
          </div>

          <div className="plans-grid">
            {billing.plans.map((p) => {
              const current = p.key === billing.plan;
              return (
                <div key={p.key} className={`plan-tier${current ? ' plan-tier-current' : ''}`}>
                  {current ? <span className="plan-tier-badge">Mevcut</span> : null}
                  <h3>{p.name}</h3>
                  <div className="plan-tier-price">{p.priceLabel}</div>
                  <ul className="plan-tier-features">
                    {p.features.map((f) => (
                      <li key={f}><Check size={14} /> {f}</li>
                    ))}
                  </ul>
                  {current ? (
                    <button type="button" className="btn-ghost" disabled>Mevcut plan</button>
                  ) : p.purchasable ? (
                    <button type="button" className="btn-primary" disabled={busy === p.key} onClick={() => upgrade(p.key)}>
                      <Zap size={15} /> {busy === p.key ? 'Yönlendiriliyor…' : `${p.name} planına yükselt`}
                    </button>
                  ) : (
                    <button type="button" className="btn-ghost" disabled>Portalda düşür</button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="panel"><p className="helper">Faturalama bilgileri yükleniyor…</p></div>
      )}
    </PageMotion>
  );
}
