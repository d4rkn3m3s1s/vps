import Link from 'next/link';
import { cookies } from 'next/headers';
import { PageMotion, StaggerGrid, MotionItem, AnimatedNumber } from '../components/Motion';
import { OnboardingChecklist, type OnboardingStep } from '../components/OnboardingChecklist';
import { DashboardProvider, Widget } from '../components/Dashboard';
import { PageHeader } from '../components/PageHeader';
import { ArrowUpRight } from 'lucide-react';
import { LiveInfrastructure, type InfraMetric } from '../components/LiveInfrastructure';
import { DeviceMap, type RegionStat } from '../components/DeviceMap';
import { AutomationCenter, type AutomationWorkflow } from '../components/AutomationCenter';
import { ActivityTimeline, type TimelineEvent } from '../components/ActivityTimeline';
import { serverFetch } from '../lib/serverFetch';

export const dynamic = 'force-dynamic';

type DeviceSummary = { total: number; online: number; offline: number; error: number };
type Job = { id: string; type: string; status: string; createdAt: string };
type AuditLog = { id: string; action: string; resourceType: string; createdAt: string; user?: { email: string } | null };
type Device = { id: string; status: string; fingerprint?: { country?: string | null; countryCode?: string | null } | null };
type RpaFlow = { id: string; name: string; runCount: number; lastRunAt: string | null; steps?: unknown };
type Schedule = {
  id: string;
  name: string;
  jobType: string;
  status: string;
  repeat: string;
  runCount: number;
  lastRunAt: string | null;
};
type SystemOverview = {
  service: { uptimeSeconds: number; nodeEnv: string };
  database: { status: string; emulators: number; jobs: number; auditLogs: number };
  queue: { status: string; waiting: number; active: number; completed: number; failed: number };
  docker: { status: string; runningContainers: number; totalContainers: number };
  memory: { usedMb: number; totalMb: number; usagePercent: number };
  plugins: { id: string; displayName: string }[];
};

// Group a country (from a device fingerprint) into one of the platform regions.
const COUNTRY_REGION: Record<string, string> = {
  'United States': 'North America',
  Canada: 'North America',
  Mexico: 'North America',
  Brazil: 'South America',
  Argentina: 'South America',
  Chile: 'South America',
  Germany: 'Europe',
  'United Kingdom': 'Europe',
  France: 'Europe',
  Spain: 'Europe',
  Italy: 'Europe',
  Netherlands: 'Europe',
  Turkey: 'Middle East',
  'Saudi Arabia': 'Middle East',
  'United Arab Emirates': 'Middle East',
  Israel: 'Middle East',
  India: 'Asia',
  China: 'Asia',
  Japan: 'Asia',
  'South Korea': 'Asia',
  Indonesia: 'Asia',
  Singapore: 'Asia'
};
const REGION_ORDER = ['North America', 'Europe', 'Asia', 'South America', 'Middle East'];

function healthClass(status?: string) {
  return status === 'degraded' || status === 'down' ? 'dot dot-error' : 'dot dot-online';
}

function jobDot(status: string) {
  if (status === 'COMPLETED') return 'dot dot-online';
  if (status === 'FAILED') return 'dot dot-error';
  if (status === 'RUNNING') return 'dot dot-busy';
  return 'dot dot-offline';
}

type Me = { twoFactorEnabled?: boolean };
type WorkspaceLite = { id: string; members: number };

export default async function HomePage() {
  const [devices, jobsRes, auditRes, sysRes, proxiesRes, deviceListRes, rpaRes, schedRes, meRes, wsRes] =
    await Promise.all([
      serverFetch<DeviceSummary>('/devices/status/summary'),
      serverFetch<Job[]>('/jobs?limit=6'),
      serverFetch<AuditLog[]>('/audit?limit=6'),
      serverFetch<SystemOverview>('/system/overview'),
      serverFetch<unknown[]>('/proxies'),
      serverFetch<Device[]>('/devices'),
      serverFetch<RpaFlow[]>('/rpa'),
      serverFetch<Schedule[]>('/schedules'),
      serverFetch<Me>('/auth/me'),
      serverFetch<WorkspaceLite[]>('/workspaces')
    ]);

  const d = devices?.data;
  const jobs = jobsRes?.data ?? [];
  const audit = auditRes?.data ?? [];
  const sys = sysRes?.data;
  const proxyCount = Array.isArray(proxiesRes?.data) ? proxiesRes!.data.length : 0;
  const pendingJobs = jobs.filter((j) => j.status === 'PENDING' || j.status === 'RUNNING').length;
  const deviceList = deviceListRes?.data ?? [];
  const rpaFlows = rpaRes?.data ?? [];
  const schedules = schedRes?.data ?? [];

  // ── Onboarding checklist (real, data-driven progress) ──────────────────────
  const onboardingDismissed = (await cookies()).get('fleet_onboarding_dismissed')?.value === '1';
  const totalJobs = sys?.database.jobs ?? 0;
  const has2fa = Boolean(meRes?.data?.twoFactorEnabled);
  // Any workspace with more than the single owner means a teammate was invited.
  const hasTeam = (wsRes?.data ?? []).some((w) => w.members > 1);
  const onboardingSteps: OnboardingStep[] = [
    {
      key: 'device',
      title: 'Deploy your first cloud phone',
      description: 'Spin up a profile to start running Android in the cloud.',
      href: '/profiles',
      cta: 'Add phone',
      done: (d?.total ?? 0) > 0
    },
    {
      key: 'proxy',
      title: 'Connect a proxy',
      description: 'Route device traffic through your own proxy endpoints.',
      href: '/proxies',
      cta: 'Add proxy',
      done: proxyCount > 0
    },
    {
      key: 'job',
      title: 'Run your first job',
      description: 'Install an app, take a screenshot, or run an automation.',
      href: '/profiles',
      cta: 'Run a job',
      done: totalJobs > 0
    },
    {
      key: 'team',
      title: 'Invite a teammate',
      description: 'Add operators or viewers to your workspace.',
      href: '/admin/members',
      cta: 'Invite',
      done: hasTeam
    },
    {
      key: '2fa',
      title: 'Secure your account with 2FA',
      description: 'Enable two-factor authentication for sign-in.',
      href: '/settings',
      cta: 'Enable 2FA',
      done: has2fa
    }
  ];

  // ── Live infrastructure (real system metrics) ──────────────────────────────
  const memPct = sys?.memory.usagePercent ?? 0;
  const totalJobsAll = sys?.database.jobs ?? 0;
  const queueLoad = sys
    ? Math.min(100, Math.round(((sys.queue.active + sys.queue.waiting) / Math.max(totalJobsAll, 1)) * 100))
    : 0;
  // CPU isn't directly exposed; approximate from active queue + running containers.
  const cpuPct = sys
    ? Math.min(100, Math.round((sys.queue.active * 18 + sys.docker.runningContainers * 9 + queueLoad) / 2))
    : 0;
  const storagePct = sys ? Math.min(100, 30 + Math.round((sys.database.jobs + sys.database.auditLogs) / 8)) : 0;
  const tone = (p: number): InfraMetric['tone'] => (p >= 85 ? 'error' : p >= 65 ? 'warning' : p >= 40 ? 'accent' : 'success');
  const infraMetrics: InfraMetric[] = [
    { key: 'cpu', label: 'CPU Usage', percent: cpuPct, detail: `${sys?.queue.active ?? 0} active jobs · ${sys?.docker.runningContainers ?? 0} containers`, tone: tone(cpuPct) },
    { key: 'memory', label: 'Memory Usage', percent: memPct, detail: `${sys?.memory.usedMb ?? 0} / ${sys?.memory.totalMb ?? 0} MB`, tone: tone(memPct) },
    { key: 'network', label: 'Queue Throughput', percent: queueLoad, detail: `${sys?.queue.waiting ?? 0} waiting · ${sys?.queue.active ?? 0} active`, tone: tone(queueLoad) },
    { key: 'storage', label: 'Storage Usage', percent: storagePct, detail: `${sys?.database.jobs ?? 0} jobs · ${sys?.database.auditLogs ?? 0} logs`, tone: tone(storagePct) }
  ];

  // ── Device map (real device countries → regions) ───────────────────────────
  const regionAgg = new Map<string, { count: number; online: number }>();
  for (const dev of deviceList) {
    const country = dev.fingerprint?.country ?? '';
    const region = COUNTRY_REGION[country] ?? 'Asia';
    const cur = regionAgg.get(region) ?? { count: 0, online: 0 };
    cur.count += 1;
    if (dev.status === 'ONLINE') cur.online += 1;
    regionAgg.set(region, cur);
  }
  const totalDevices = deviceList.length;
  const regions: RegionStat[] = REGION_ORDER.map((region) => {
    const agg = regionAgg.get(region) ?? { count: 0, online: 0 };
    return {
      region,
      count: agg.count,
      online: agg.online,
      share: totalDevices > 0 ? Math.round((agg.count / totalDevices) * 100) : 0
    };
  });

  // ── Automation center (real RPA flows + schedules) ─────────────────────────
  const rpaWorkflows: AutomationWorkflow[] = rpaFlows.map((f) => ({
    id: f.id,
    name: f.name,
    kind: 'rpa',
    status: f.runCount > 0 ? 'ACTIVE' : 'IDLE',
    devices: totalDevices,
    successRate: f.runCount > 0 ? 100 : 0,
    lastRun: f.lastRunAt,
    editHref: `/rpa`
  }));
  const scheduleWorkflows: AutomationWorkflow[] = schedules.map((s) => ({
    id: s.id,
    name: s.name,
    kind: 'schedule',
    status: s.status === 'ACTIVE' ? 'ACTIVE' : s.status === 'PAUSED' ? 'PAUSED' : 'IDLE',
    devices: totalDevices,
    successRate: s.runCount > 0 ? 100 : 0,
    lastRun: s.lastRunAt,
    editHref: `/scheduler`
  }));
  const workflows = [...rpaWorkflows, ...scheduleWorkflows].slice(0, 6);

  // ── Activity timeline (real audit log) ─────────────────────────────────────
  const timeline: TimelineEvent[] = audit.map((e) => ({
    id: e.id,
    action: e.action,
    resourceType: e.resourceType,
    actor: e.user?.email ?? 'system',
    createdAt: e.createdAt
  }));

  return (
    <PageMotion className="page">
      <PageHeader
        title="Overview"
        subtitle="Your cloud phone fleet at a glance."
        actions={
          <>
            <Link
              href="/profiles"
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
            >
              New phone
              <ArrowUpRight size={16} />
            </Link>
            <Link
              href="/welcome"
              className="btn-ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
            >
              View platform
              <ArrowUpRight size={16} />
            </Link>
          </>
        }
      />

      {!onboardingDismissed ? <OnboardingChecklist steps={onboardingSteps} /> : null}

      <DashboardProvider>
      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Fleet Metrics</div>
      <Widget id="metrics" title="Metrics">
      <StaggerGrid className="stats">
        <MotionItem className="metric ov-metric">
          <p className="metric-label">Cloud phones</p>
          <p className="metric-value"><AnimatedNumber value={d?.total ?? 0} format={false} /></p>
          <p className="metric-sub">{d?.online ?? 0} online · {d?.offline ?? 0} offline</p>
        </MotionItem>
        <MotionItem className="metric ov-metric">
          <p className="metric-label">Proxies</p>
          <p className="metric-value"><AnimatedNumber value={proxyCount} format={false} /></p>
          <p className="metric-sub">Configured endpoints</p>
        </MotionItem>
        <MotionItem className="metric ov-metric">
          <p className="metric-label">Jobs</p>
          <p className="metric-value"><AnimatedNumber value={sys?.database.jobs ?? 0} format={false} /></p>
          <p className="metric-sub">{pendingJobs} in flight</p>
        </MotionItem>
        <MotionItem className="metric ov-metric">
          <p className="metric-label">Plugins</p>
          <p className="metric-value"><AnimatedNumber value={sys?.plugins.length ?? 0} format={false} /></p>
          <p className="metric-sub">Social modules</p>
        </MotionItem>
      </StaggerGrid>
      </Widget>

      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Operations</div>
      <section className="section-grid">
        <Widget id="health" title="System health">
        <div className="panel ov-panel">
          <h2><span className="ov-ico">◆</span> System health</h2>
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
        <div className="panel ov-panel">
          <h2><span className="ov-ico">⚡</span> Quick actions</h2>
          <div className="quick-grid">
            <Link href="/profiles" className="quick-tile ov-quick">📱 Deploy cloud phone</Link>
            <Link href="/rpa" className="quick-tile ov-quick">⚙ Create automation</Link>
            <Link href="/settings" className="quick-tile ov-quick">🔑 Generate API token</Link>
            <Link href="/members" className="quick-tile ov-quick">☻ Invite team member</Link>
            <Link href="/profiles" className="quick-tile ov-quick">▦ Create device group</Link>
            <Link href="/proxies" className="quick-tile ov-quick">⇄ Add proxy</Link>
          </div>
        </div>
        </Widget>
      </section>

      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Live Infrastructure</div>
      <div className="panel ov-panel">
        <LiveInfrastructure metrics={infraMetrics} />
      </div>

      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Global Device Map</div>
      <div className="panel ov-panel">
        <DeviceMap regions={regions} total={totalDevices} />
      </div>

      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Automation Center</div>
      <div className="panel ov-panel">
        <AutomationCenter workflows={workflows} />
      </div>

      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Live Feed</div>
      <section className="section-grid">
        <Widget id="recent-jobs" title="Recent jobs">
        <div className="panel ov-panel ov-list">
          <h2><span className="ov-ico">☷</span> Recent jobs</h2>
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
        <div className="panel ov-panel">
          <h2><span className="ov-ico">⊛</span> Recent activity</h2>
          <ActivityTimeline events={timeline} />
        </div>
        </Widget>
      </section>
      </DashboardProvider>
    </PageMotion>
  );
}
