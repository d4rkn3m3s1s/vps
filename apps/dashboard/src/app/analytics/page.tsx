import { PageMotion } from '../../components/Motion';
import { apiCall } from '../../lib/apiClient';
import { HoloHeader, HoloPanel, HoloStat, Reveal } from '../../components/hud';
import {
  Activity,
  BarChart3,
  Smartphone,
  Sprout,
  Timer,
  ListChecks,
  Link2,
  Network
} from 'lucide-react';

export const metadata = { title: 'Analitik · VPS Fleet' };
export const dynamic = 'force-dynamic';

type SocialAccount = {
  id: string;
  provider: string;
  username: string | null;
  displayName: string | null;
  scopes: string[];
  tokenExpiresAt: string | null;
};

// Real fleet analytics — devices, jobs, farm accounts, usage.
type AnalyticsSummary = {
  totals: {
    devices: number;
    onlineDevices: number;
    jobs: number;
    jobsCompleted: number;
    jobsFailed: number;
    successRate: number;
    farmAccounts: number;
    avgHealthScore: number;
    onlineMinutes: number;
  };
  byJobType: Array<{ type: string; total: number; completed: number; failed: number; successRate: number }>;
  timeline: Array<{ date: string; jobs: number; completed: number; failed: number }>;
  farmByProvider: Array<{ provider: string; accounts: number; avgHealth: number; avgWarmupStage: number }>;
  topDevices: Array<{ deviceId: string; name: string; onlineMinutes: number; jobs: number }>;
};

const COLUMNS = ['Hesap', 'Platform', 'Kullanıcı adı', 'İzinler', 'Token durumu'];

function providerLabel(p: string): string {
  if (p === 'X') return 'X (Twitter)';
  if (p === 'META') return 'Meta / Facebook';
  if (p === 'INSTAGRAM') return 'Instagram';
  if (p === 'TIKTOK') return 'TikTok';
  if (p === 'FACEBOOK') return 'Facebook';
  return p;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function jobTypeLabel(t: string): string {
  return t.replace(/^EMULATOR_/, '').replace(/_/g, ' ').toLowerCase();
}

export default async function AnalyticsPage() {
  const [accountsRes, summaryRes] = await Promise.all([
    apiCall<SocialAccount[]>('/social', { auth: true }),
    apiCall<AnalyticsSummary>('/analytics/summary', { auth: true })
  ]);

  const accounts = accountsRes.ok && Array.isArray(accountsRes.data) ? accountsRes.data : [];
  const s = summaryRes.data;
  const maxJobs = s ? Math.max(...s.timeline.map((t) => t.jobs), 1) : 1;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="ANALİTİK"
        title="Analitik"
        subtitle="Gerçek filo performansı — cihazlar, işler, farm hesapları ve kullanım."
      />

      {s && (
        <>
          <Reveal className="holo-stats-grid">
            <HoloStat
              label="Cihazlar"
              value={<span className="mono">{fmt(s.totals.devices)}</span>}
              sub={`${fmt(s.totals.onlineDevices)} çevrimiçi`}
              tone="cyan"
              icon={<Smartphone size={16} />}
            />
            <HoloStat
              label="İşler (14g)"
              value={<span className="mono">{fmt(s.totals.jobs)}</span>}
              sub={`%${s.totals.successRate} başarı`}
              tone={s.totals.successRate >= 90 ? 'success' : s.totals.successRate >= 70 ? 'warning' : 'error'}
              icon={<Activity size={16} />}
            />
            <HoloStat
              label="Farm hesapları"
              value={<span className="mono">{fmt(s.totals.farmAccounts)}</span>}
              sub={`ort. sağlık ${s.totals.avgHealthScore}/100`}
              tone="violet"
              icon={<Sprout size={16} />}
            />
            <HoloStat
              label="Çevrimiçi süre (14g)"
              value={<span className="mono">{fmt(s.totals.onlineMinutes)}</span>}
              sub="dakika"
              tone="success"
              icon={<Timer size={16} />}
            />
          </Reveal>

          <Reveal className="holo-grid-2" delay={0.05}>
            <HoloPanel title="Günlük iş hacmi" icon={<BarChart3 size={16} />} tilt>
              {s.timeline.length === 0 ? (
                <p className="helper">Henüz iş yok.</p>
              ) : (
                <div className="bar-chart">
                  {s.timeline.map((t) => (
                    <div className="bar-col" key={t.date} title={`${t.date}: ${t.jobs} iş (${t.completed} tamam, ${t.failed} hata)`}>
                      <div className="bar-fill" style={{ height: `${Math.max(4, (t.jobs / maxJobs) * 100)}%` }} />
                      <span className="bar-label mono">{t.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              )}
            </HoloPanel>

            <HoloPanel title="İş tipine göre" icon={<ListChecks size={16} />} tilt>
              <div className="panel-stack">
                {s.byJobType.length === 0 ? (
                  <p className="helper">Henüz iş yok.</p>
                ) : (
                  s.byJobType.map((j) => (
                    <div className="row" key={j.type}>
                      <span>{jobTypeLabel(j.type)}</span>
                      <span className="mono helper">
                        {j.total} iş · %{j.successRate} başarı
                      </span>
                    </div>
                  ))
                )}
              </div>
            </HoloPanel>
          </Reveal>

          {s.farmByProvider.length > 0 && (
            <Reveal delay={0.1}>
              <HoloPanel title="Farm hesapları (platforma göre)" icon={<Network size={16} />}>
                <div className="panel-stack">
                  {s.farmByProvider.map((p) => (
                    <div className="row" key={p.provider}>
                      <span>{providerLabel(p.provider)}</span>
                      <span className="mono helper">
                        {p.accounts} hesap · sağlık {p.avgHealth}/100 · warmup {p.avgWarmupStage}/5
                      </span>
                    </div>
                  ))}
                </div>
              </HoloPanel>
            </Reveal>
          )}
        </>
      )}

      <Reveal delay={0.15}>
        <HoloPanel title="Bağlı hesaplar" icon={<Link2 size={16} />}>
          <div className="profile-table-wrap">
            <table className="profile-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length}>
                      <div className="table-empty">
                        <div className="empty-art">∿</div>
                        <span>Henüz bağlı hesap yok</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  accounts.map((a) => {
                    const expired = a.tokenExpiresAt ? new Date(a.tokenExpiresAt).getTime() < Date.now() : false;
                    return (
                      <tr key={a.id}>
                        <td>
                          <strong>{a.displayName ?? a.username ?? a.id.slice(0, 8)}</strong>
                        </td>
                        <td>{providerLabel(a.provider)}</td>
                        <td className="mono">{a.username ? `@${a.username}` : '—'}</td>
                        <td className="helper">{a.scopes.length > 0 ? a.scopes.join(', ') : '—'}</td>
                        <td>
                          <span className="status-chip">
                            <span className={expired ? 'dot dot-error' : 'dot dot-online'} />
                            {expired ? 'Süresi doldu' : 'Aktif'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </HoloPanel>
      </Reveal>
    </PageMotion>
  );
}
