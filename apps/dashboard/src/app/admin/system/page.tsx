import { apiCall } from '../../../lib/apiClient';
import { serverFetch } from '../../../lib/serverFetch';

export const dynamic = 'force-dynamic';

type SystemOverview = {
  service: { uptimeSeconds: number; nodeEnv: string };
  database: { status: string };
  queue: { status: string };
  docker: { status: string };
  plugins: { id: string; displayName: string }[];
};

type Host = {
  id: string;
  name: string;
  address: string;
  region: string | null;
  status: string;
  capacity: number;
  runningPhones: number;
  cpuCores: number | null;
  memoryGb: number | null;
  kvm: boolean;
  lastSeenAt: string | null;
};

function fmtUptime(seconds?: number): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default async function AdminSystemPage() {
  const [sysRes, hostsRes] = await Promise.all([
    apiCall<SystemOverview>('/system/overview', { auth: false }),
    serverFetch<Host[]>('/hosts')
  ]);

  const sys = sysRes?.data;
  const hosts = hostsRes?.data ?? [];
  const onlineHosts = hosts.filter((h) => h.status === 'ONLINE').length;

  return (
    <>
      <section className="section-grid">
        <div className="panel">
          <h2>Infrastructure health</h2>
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
          <h2>Service</h2>
          <div className="panel-stack">
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
          <h2>Hosts</h2>
          <div className="panel-stack">
            {hosts.length === 0 ? (
              <span className="helper">No hosts registered.</span>
            ) : (
              hosts.map((h) => (
                <div className="row" key={h.id}>
                  <span className="mono">{h.name}</span>
                  <span className="status-chip">
                    <span className={h.status === 'ONLINE' ? 'dot dot-online' : 'dot dot-error'} />
                    {h.status} · {h.runningPhones}/{h.capacity} phones · {h.cpuCores ?? '—'}c / {h.memoryGb ?? '—'}GB
                  </span>
                </div>
              ))
            )}
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

      <section className="section-grid">
        <div className="panel">
          <h2>Agent connectivity</h2>
          <div className="panel-stack">
            <p className="helper">
              Host agents authenticate with the API key configured server-side. The key is never exposed to the
              dashboard and is provisioned once when a host is registered.
            </p>
            <div className="row">
              <span className="helper">Online hosts</span>
              <span className="role-badge">{onlineHosts} / {hosts.length}</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
