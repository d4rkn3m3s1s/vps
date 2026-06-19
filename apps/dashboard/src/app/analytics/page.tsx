import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';
import { apiCall } from '../../lib/apiClient';

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

type AnalyticsSummary = {
  totals: { posts: number; likes: number; comments: number; shares: number; reach: number; followers: number };
  byProvider: Array<{ provider: string; posts: number; likes: number; comments: number; followers: number; engagementRate: number }>;
  timeline: Array<{ date: string; posts: number; likes: number; reach: number }>;
  topAccounts: Array<{ accountId: string | null; provider: string; followers: number; engagementRate: number }>;
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

export default async function AnalyticsPage() {
  const [accountsRes, summaryRes] = await Promise.all([
    apiCall<SocialAccount[]>('/social', { auth: true }),
    apiCall<AnalyticsSummary>('/analytics/summary', { auth: false })
  ]);

  const accounts = accountsRes.ok && Array.isArray(accountsRes.data) ? accountsRes.data : [];
  const s = summaryRes.data;
  const maxReach = s ? Math.max(...s.timeline.map((t) => t.reach), 1) : 1;

  return (
    <PageMotion className="page">
      <PageHeader
        title="Analitik"
        subtitle="İçerik performansı ve bağlı sosyal medya hesapları."
      />

      {s && (
        <>
          <div className="stats">
            <div className="metric">
              <p className="metric-label">Toplam erişim (14g)</p>
              <p className="metric-value">{fmt(s.totals.reach)}</p>
              <p className="metric-sub">{fmt(s.totals.followers)} takipçi</p>
            </div>
            <div className="metric">
              <p className="metric-label">Gönderiler</p>
              <p className="metric-value">{fmt(s.totals.posts)}</p>
              <p className="metric-sub">tüm platformlarda</p>
            </div>
            <div className="metric">
              <p className="metric-label">Beğeniler</p>
              <p className="metric-value">{fmt(s.totals.likes)}</p>
              <p className="metric-sub">{fmt(s.totals.comments)} yorum</p>
            </div>
            <div className="metric">
              <p className="metric-label">Paylaşımlar</p>
              <p className="metric-value">{fmt(s.totals.shares)}</p>
              <p className="metric-sub">yeniden paylaşımlar</p>
            </div>
          </div>

          <section className="section-grid">
            <div className="panel">
              <h2>Zaman içinde erişim</h2>
              <div className="bar-chart">
                {s.timeline.map((t) => (
                  <div className="bar-col" key={t.date} title={`${t.date}: ${fmt(t.reach)} erişim`}>
                    <div className="bar-fill" style={{ height: `${Math.max(4, (t.reach / maxReach) * 100)}%` }} />
                    <span className="bar-label">{t.date.slice(5)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel">
              <h2>Platforma göre</h2>
              <div className="panel-stack">
                {s.byProvider.map((p) => (
                  <div className="row" key={p.provider}>
                    <span>{providerLabel(p.provider)}</span>
                    <span className="mono helper">
                      {fmt(p.followers)} takipçi · %{p.engagementRate} etkileşim
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      <h2 className="section-title" style={{ marginTop: '8px' }}>Bağlı hesaplar</h2>
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
    </PageMotion>
  );
}
