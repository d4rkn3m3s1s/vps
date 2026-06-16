import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export const metadata = { title: 'Billing · VPS Fleet' };
export const dynamic = 'force-dynamic';

type SystemOverview = {
  database: { emulators: number; jobs: number; auditLogs: number };
  memory: { usagePercent: number };
};
type DeviceSummary = { total: number; online: number };
type ApiResponse<T> = { data: T };

async function fetchJson<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      cache: 'no-store',
      headers: { 'x-api-key': process.env.DEFAULT_API_KEY ?? '' }
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const PLAN_LIMIT = 2; // free plan device quota

const PLANS = [
  { name: 'Free', price: '$0', phones: '2 cloud phones', features: ['Basic automation', 'Community support'], cta: 'Current plan', current: true },
  { name: 'Pro', price: '$29', phones: '20 cloud phones', features: ['All templates', 'Proxy pool', 'Priority support'], cta: 'Upgrade', current: false },
  { name: 'Scale', price: '$99', phones: '100 cloud phones', features: ['Synchronizer', 'Analytics Pro', 'Dedicated infra'], cta: 'Upgrade', current: false }
];

export default async function BillingPage() {
  const [sys, devices] = await Promise.all([
    fetchJson<ApiResponse<SystemOverview>>('/system/overview'),
    fetchJson<ApiResponse<DeviceSummary>>('/devices/status/summary')
  ]);

  const deviceCount = devices?.data?.total ?? 0;
  const used = Math.min(100, Math.round((deviceCount / PLAN_LIMIT) * 100));
  const jobs = sys?.data?.database?.jobs ?? 0;
  const auditLogs = sys?.data?.database?.auditLogs ?? 0;

  return (
    <PageMotion className="page">
      <PageHeader title="Billing" subtitle="Plan, usage and quotas." />

      <div className="stats">
        <div className="metric">
          <p className="metric-label">Plan</p>
          <p className="metric-value">Free</p>
          <p className="metric-sub">Renews monthly</p>
        </div>
        <div className="metric">
          <p className="metric-label">Cloud phones</p>
          <p className="metric-value">
            {deviceCount} / {PLAN_LIMIT}
          </p>
          <div className="usage-bar">
            <div className="usage-fill" style={{ width: `${used}%` }} />
          </div>
        </div>
        <div className="metric">
          <p className="metric-label">Jobs run</p>
          <p className="metric-value">{jobs}</p>
          <p className="metric-sub">This billing period</p>
        </div>
        <div className="metric">
          <p className="metric-label">Audit events</p>
          <p className="metric-value">{auditLogs}</p>
          <p className="metric-sub">Logged actions</p>
        </div>
      </div>

      <h3 className="section-label">Plans</h3>
      <div className="plan-grid">
        {PLANS.map((p) => (
          <article key={p.name} className={`plan-tier${p.current ? ' plan-tier-current' : ''}`}>
            <div className="plan-tier-head">
              <h4>{p.name}</h4>
              <div className="plan-price">
                {p.price}
                <span>/mo</span>
              </div>
            </div>
            <p className="plan-phones">{p.phones}</p>
            <ul className="plan-features">
              {p.features.map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            <button type="button" className={p.current ? 'btn-ghost' : 'btn-primary'} disabled={p.current}>
              {p.cta}
            </button>
          </article>
        ))}
      </div>
    </PageMotion>
  );
}
