import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';
import { TwoFactorPanel } from '../../components/TwoFactorPanel';
import { WorkspaceMembers } from '../../components/WorkspaceMembers';
import { apiCall } from '../../lib/apiClient';

export const metadata = { title: 'Settings · VPS Fleet' };
export const dynamic = 'force-dynamic';

type CurrentUser = {
  id: string;
  email: string;
  role: string;
  twoFactorEnabled?: boolean;
  createdAt?: string;
};

type SystemOverview = {
  service: { uptimeSeconds: number; nodeEnv: string };
  database: { status: string };
  queue: { status: string };
  docker: { status: string };
  plugins: { id: string; displayName: string }[];
};

function fmtUptime(seconds?: number): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default async function SettingsPage() {
  const [meRes, sysRes] = await Promise.all([
    apiCall<CurrentUser>('/auth/me', { auth: true }),
    apiCall<SystemOverview>('/system/overview', { auth: false })
  ]);

  const me = meRes.data;
  const sys = sysRes.data;

  return (
    <PageMotion className="page">
      <PageHeader title="Settings" subtitle="Workspace and account configuration." />

      <section className="section-grid">
        <div className="panel">
          <h2>Account</h2>
          <div className="panel-stack">
            <div className="row">
              <span className="helper">Email</span>
              <span className="mono">{me?.email ?? '—'}</span>
            </div>
            <div className="row">
              <span className="helper">Role</span>
              <span className={`role-badge role-${(me?.role ?? 'member').toLowerCase()}`}>{me?.role ?? '—'}</span>
            </div>
            <div className="row">
              <span className="helper">User ID</span>
              <span className="mono">{me?.id?.slice(0, 12) ?? '—'}</span>
            </div>
            <div className="row">
              <span className="helper">Member since</span>
              <span className="mono">{me?.createdAt ? new Date(me.createdAt).toLocaleDateString('tr-TR') : '—'}</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>Workspace</h2>
          <div className="panel-stack">
            <div className="row">
              <span className="helper">Name</span>
              <span className="mono">VPS Fleet</span>
            </div>
            <div className="row">
              <span className="helper">Environment</span>
              <span className="mono">{sys?.service.nodeEnv ?? '—'}</span>
            </div>
            <div className="row">
              <span className="helper">API uptime</span>
              <span className="mono">{fmtUptime(sys?.service.uptimeSeconds)}</span>
            </div>
            <div className="row">
              <span className="helper">Region</span>
              <span className="mono">self-hosted</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section-grid">
        <div className="panel">
          <h2>Team · Workspace members</h2>
          <WorkspaceMembers />
        </div>

        <div className="panel">
          <h2>Security · Two-factor authentication</h2>
          <TwoFactorPanel enabled={Boolean(me?.twoFactorEnabled)} />
        </div>

        <div className="panel">
          <h2>System status</h2>
          <div className="panel-stack">
            <div className="row">
              <span className="helper">PostgreSQL</span>
              <span className="status-chip">
                <span className={sys?.database.status === 'healthy' ? 'dot dot-online' : 'dot dot-error'} />
                {sys?.database.status ?? 'unknown'}
              </span>
            </div>
            <div className="row">
              <span className="helper">Redis queue</span>
              <span className="status-chip">
                <span className={sys?.queue.status === 'healthy' ? 'dot dot-online' : 'dot dot-error'} />
                {sys?.queue.status ?? 'unknown'}
              </span>
            </div>
            <div className="row">
              <span className="helper">Docker</span>
              <span className="status-chip">
                <span className={sys?.docker.status === 'healthy' ? 'dot dot-online' : 'dot dot-error'} />
                {sys?.docker.status ?? 'unknown'}
              </span>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>Installed modules</h2>
          <div className="panel-stack">
            {(sys?.plugins ?? []).length === 0 ? (
              <span className="helper">No social modules installed.</span>
            ) : (
              (sys?.plugins ?? []).map((p) => (
                <div className="row" key={p.id}>
                  <span className="mono">{p.displayName}</span>
                  <span className="status-chip">
                    <span className="dot dot-online" /> active
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel danger-panel">
        <h2>Danger zone</h2>
        <p className="helper">These actions are irreversible. Proceed with caution.</p>
        <div className="quick-grid">
          <button type="button" className="btn-ghost danger-btn" disabled>
            Reset workspace data
          </button>
          <button type="button" className="btn-ghost danger-btn" disabled>
            Delete account
          </button>
        </div>
        <p className="helper" style={{ marginTop: '12px' }}>
          Destructive operations are disabled in this build. Enable them once a backup policy is configured.
        </p>
      </section>
    </PageMotion>
  );
}
