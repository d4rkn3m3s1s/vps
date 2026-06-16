import Link from 'next/link';
import { PageHeader } from '../components/PageHeader';
import { PageMotion, StaggerGrid, MotionItem, AnimatedNumber } from '../components/Motion';
import { DashboardProvider, Widget } from '../components/Dashboard';

export const dynamic = 'force-dynamic';

type ApiResponse<T> = { data: T };

type DeviceSummary = { total: number; online: number; offline: number; error: number };
type Job = { id: string; type: string; status: string; createdAt: string };
type AuditLog = { id: string; action: string; resourceType: string; createdAt: string; user?: { email: string } | null };
type SystemOverview = {
  service: { uptimeSeconds: number; nodeEnv: string };
  database: { status: string; emulators: number; jobs: number; auditLogs: number };
  queue: { status: string; waiting: number; active: number; completed: number; failed: number };
  docker: { status: string; runningContainers: number; totalContainers: number };
  memory: { usedMb: number; totalMb: number; usagePercent: number };
  plugins: { id: string; displayName: string }[];
};

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

function healthClass(status?: string) {
  return status === 'degraded' || status === 'down' ? 'dot dot-error' : 'dot dot-online';
}

function jobDot(status: string) {
  if (status === 'COMPLETED') return 'dot dot-online';
  if (status === 'FAILED') return 'dot dot-error';
  if (status === 'RUNNING') return 'dot dot-busy';
  return 'dot dot-offline';
}

export default async function HomePage() {
  const [devices, jobsRes, auditRes, sysRes, proxiesRes] = await Promise.all([
    fetchJson<ApiResponse<DeviceSummary>>('/devices/status/summary'),
    fetchJson<ApiResponse<Job[]>>('/jobs?limit=6'),
    fetchJson<ApiResponse<AuditLog[]>>('/audit?limit=6'),
    fetchJson<ApiResponse<SystemOverview>>('/system/overview'),
    fetchJson<ApiResponse<unknown[]>>('/proxies')
  ]);

  const d = devices?.data;
  const jobs = jobsRes?.data ?? [];
  const audit = auditRes?.data ?? [];
  const sys = sysRes?.data;
  const proxyCount = Array.isArray(proxiesRes?.data) ? proxiesRes!.data.length : 0;
  const pendingJobs = jobs.filter((j) => j.status === 'PENDING' || j.status === 'RUNNING').length;

  return (
    <PageMotion className="page">
      <PageHeader
        title="Overview"
        subtitle="Live status of your cloud phone fleet."
        actions={
          <>
            <Link href="/profiles" className="btn-ghost">Profiles</Link>
            <Link href="/profiles" className="btn-primary">+ New profile</Link>
          </>
        }
      />

      <DashboardProvider>
      <Widget id="metrics" title="Metrics">
      <StaggerGrid className="stats">
        <MotionItem className="metric">
          <p className="metric-label">Cloud phones</p>
          <p className="metric-value"><AnimatedNumber value={d?.total ?? 0} format={false} /></p>
          <p className="metric-sub">{d?.online ?? 0} online · {d?.offline ?? 0} offline</p>
        </MotionItem>
        <MotionItem className="metric">
          <p className="metric-label">Proxies</p>
          <p className="metric-value"><AnimatedNumber value={proxyCount} format={false} /></p>
          <p className="metric-sub">Configured endpoints</p>
        </MotionItem>
        <MotionItem className="metric">
          <p className="metric-label">Jobs</p>
          <p className="metric-value"><AnimatedNumber value={sys?.database.jobs ?? 0} format={false} /></p>
          <p className="metric-sub">{pendingJobs} in flight</p>
        </MotionItem>
        <MotionItem className="metric">
          <p className="metric-label">Plugins</p>
          <p className="metric-value"><AnimatedNumber value={sys?.plugins.length ?? 0} format={false} /></p>
          <p className="metric-sub">Social modules</p>
        </MotionItem>
      </StaggerGrid>
      </Widget>

      <section className="section-grid">
        <Widget id="health" title="System health">
        <div className="panel">
          <h2>System health</h2>
          <div className="panel-stack">
            <div className="row">
              <span className="helper">PostgreSQL</span>
              <span className="status-chip"><span className={healthClass(sys?.database.status)} /> {sys?.database.status ?? 'unknown'}</span>
            </div>
            <div className="row">
              <span className="helper">Redis queue</span>
              <span className="status-chip"><span className={healthClass(sys?.queue.status)} /> {sys?.queue.status ?? 'unknown'}</span>
            </div>
            <div className="row">
              <span className="helper">Docker</span>
              <span className="status-chip"><span className={healthClass(sys?.docker.status)} /> {sys?.docker.status ?? 'unknown'}</span>
            </div>
            <div className="row">
              <span className="helper">Memory</span>
              <span className="mono">{sys?.memory.usagePercent ?? 0}% · {sys?.memory.usedMb ?? 0}/{sys?.memory.totalMb ?? 0} MB</span>
            </div>
            <div className="row">
              <span className="helper">Queue</span>
              <span className="mono">
                {sys?.queue.waiting ?? 0} waiting · {sys?.queue.active ?? 0} active · {sys?.queue.failed ?? 0} failed
              </span>
            </div>
          </div>
        </div>
        </Widget>

        <Widget id="quick-actions" title="Quick actions">
        <div className="panel">
          <h2>Quick actions</h2>
          <div className="quick-grid">
            <Link href="/profiles" className="quick-tile">▦ New profile</Link>
            <Link href="/proxies" className="quick-tile">⇄ Add proxy</Link>
            <Link href="/applications" className="quick-tile">▤ Install app</Link>
            <Link href="/automation" className="quick-tile">⚡ Run task</Link>
            <Link href="/ai" className="quick-tile">✦ Ask Fleet AI</Link>
            <Link href="/members" className="quick-tile">☻ Invite member</Link>
          </div>
        </div>
        </Widget>
      </section>

      <section className="section-grid">
        <Widget id="recent-jobs" title="Recent jobs">
        <div className="panel">
          <h2>Recent jobs</h2>
          <div className="list-grid">
            {jobs.length === 0 ? (
              <div className="job-card helper">No jobs yet.</div>
            ) : (
              jobs.map((job) => (
                <article className="job-card" key={job.id}>
                  <div className="row">
                    <strong>{job.type}</strong>
                    <span className="status-chip"><span className={jobDot(job.status)} /> {job.status}</span>
                  </div>
                  <div className="helper">{new Date(job.createdAt).toLocaleString('tr-TR')}</div>
                </article>
              ))
            )}
          </div>
        </div>
        </Widget>

        <Widget id="recent-activity" title="Recent activity">
        <div className="panel">
          <h2>Recent activity</h2>
          <div className="list-grid">
            {audit.length === 0 ? (
              <div className="log-card helper">No activity yet.</div>
            ) : (
              audit.map((e) => (
                <article className="log-card" key={e.id}>
                  <div className="row">
                    <strong>{e.action}</strong>
                    <span className="helper mono">{e.resourceType}</span>
                  </div>
                  <div className="helper">
                    {e.user?.email ?? 'system'} · {new Date(e.createdAt).toLocaleString('tr-TR')}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
        </Widget>
      </section>
      </DashboardProvider>
    </PageMotion>
  );
}
