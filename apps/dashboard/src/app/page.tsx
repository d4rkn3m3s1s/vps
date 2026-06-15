import { MetricCard } from '../components/MetricCard';
import { StatusPill } from '../components/StatusPill';

type Emulator = {
  id: string;
  name: string;
  status: string;
  image: string;
  adbHost?: string | null;
  adbPort?: number | null;
};

type Device = {
  id: string;
  uuid: string;
  name: string;
  status: string;
  ipAddress: string | null;
  adbPort: number | null;
  androidVersion: string | null;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  lastSeen: string | null;
};

type DeviceSummary = {
  online: number;
  offline: number;
  starting: number;
  stopping: number;
  error: number;
  updating: number;
  rebooting: number;
  total: number;
};

type Job = {
  id: string;
  type: string;
  status: string;
  createdAt: string;
};

type Plugin = {
  id: string;
  displayName: string;
  packageName: string;
  activity: string | null;
  canInstallFromApk: boolean;
};

type AuditLog = {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
  user?: {
    email: string;
  } | null;
};

type SystemOverview = {
  service: {
    name: string;
    nodeEnv: string;
    uptimeSeconds: number;
  };
  database: {
    status: string;
    emulators: number;
    jobs: number;
    auditLogs: number;
  };
  queue: {
    status: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  };
  docker: {
    status: string;
    totalContainers: number;
    runningContainers: number;
  };
  memory: {
    totalMb: number;
    freeMb: number;
    usedMb: number;
    usagePercent: number;
  };
  plugins: Plugin[];
};

type ApiResponse<T> = {
  data: T;
};

async function fetchJson<T>(path: string): Promise<T | null> {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:4000';
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      cache: 'no-store',
      headers: {
        'x-api-key': process.env.DEFAULT_API_KEY ?? 'replace-with-a-long-random-api-key'
      }
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const emulatorResponse = await fetchJson<ApiResponse<Emulator[]>>('/emulators');
  const deviceResponse = await fetchJson<ApiResponse<Device[]>>('/devices');
  const deviceSummaryResponse = await fetchJson<ApiResponse<DeviceSummary>>('/devices/status/summary');
  const jobResponse = await fetchJson<ApiResponse<Job[]>>('/jobs');
  const systemResponse = await fetchJson<ApiResponse<SystemOverview>>('/system/overview');
  const auditResponse = await fetchJson<ApiResponse<AuditLog[]>>('/audit?limit=6');

  const emulators = emulatorResponse?.data ?? [];
  const devices = deviceResponse?.data ?? [];
  const deviceSummary = deviceSummaryResponse?.data;
  const jobs = jobResponse?.data ?? [];
  const system = systemResponse?.data;
  const auditLogs = auditResponse?.data ?? [];
  const running = emulators.filter((emulator) => emulator.status === 'RUNNING').length;
  const pendingJobs = jobs.filter((job) => job.status === 'PENDING' || job.status === 'RUNNING').length;

  return (
    <main>
      <section className="hero">
        <div className="hero-card">
          <div className="badge">VPS Android Fleet Control</div>
          <h1 className="hero-title">Emulator operasyonlarını tek panelden yönet.</h1>
          <p className="hero-copy">
            Docker tabanlı Android emulator kümeleri, ADB kontrol katmanı, BullMQ job işleme ve sosyal medya modül
            altyapısı aynı akışta birleşir.
          </p>
          <div className="hero-badges">
            <span className="badge">JWT + Refresh</span>
            <span className="badge">API Key</span>
            <span className="badge">Rate Limiting</span>
            <span className="badge">Audit Log</span>
            <span className="badge">Winston</span>
          </div>
        </div>
        <aside className="sidebar">
          <div className="panel">
            <h2>System status</h2>
            <div className="panel-stack">
              <div className="row">
                <span className="helper">API</span>
                <StatusPill status={system?.database.status === 'degraded' ? 'failed' : 'running'} />
              </div>
              <div className="row">
                <span className="helper">Redis queue</span>
                <StatusPill status={system?.queue.status === 'degraded' ? 'failed' : 'running'} />
              </div>
              <div className="row">
                <span className="helper">PostgreSQL</span>
                <StatusPill status={system?.database.status === 'degraded' ? 'failed' : 'running'} />
              </div>
              <div className="row">
                <span className="helper">Docker</span>
                <StatusPill status={system?.docker.status === 'degraded' ? 'failed' : 'running'} />
              </div>
            </div>
          </div>
          <div className="panel">
            <h2>Operations</h2>
            <p className="helper">
              Emulator create, start, stop, delete, APK install and screenshot actions are enqueued as background jobs.
            </p>
            <p className="helper mono">
              Uptime {system ? `${system.service.uptimeSeconds}s` : 'n/a'} · Node {system?.service.nodeEnv ?? 'n/a'}
            </p>
          </div>
        </aside>
      </section>

      <section className="stats">
        <MetricCard label="Devices" value={String(deviceSummary?.total ?? devices.length)} hint="Registered device inventory" />
        <MetricCard label="Online" value={String(deviceSummary?.online ?? 0)} hint="Connected device endpoints" />
        <MetricCard label="Offline" value={String(deviceSummary?.offline ?? 0)} hint="Disconnected or idle devices" />
        <MetricCard label="Emulators" value={String(emulators.length)} hint="Registered fleet size" />
        <MetricCard label="Running" value={String(running)} hint="Live containers with ADB endpoints" />
        <MetricCard label="Jobs" value={String(jobs.length)} hint="Processed and queued tasks" />
        <MetricCard label="Pending" value={String(pendingJobs)} hint="Long-running operations in flight" />
        <MetricCard label="Plugins" value={String(system?.plugins.length ?? 0)} hint="Social media module count" />
        <MetricCard label="Audit" value={String(system?.database.auditLogs ?? 0)} hint="Logged security events" />
      </section>

      <section className="section section-grid">
        <div>
          <h2>Device inventory</h2>
          <div className="list-grid">
            {devices.length === 0 ? (
              <div className="job-card helper">No devices registered yet.</div>
            ) : (
              devices.slice(0, 6).map((device) => (
                <article className="job-card" key={device.id}>
                  <div className="row">
                    <strong>{device.name}</strong>
                    <StatusPill status={device.status} />
                  </div>
                  <div className="helper mono">{device.uuid}</div>
                  <div className="helper mono">
                    {device.ipAddress ?? 'n/a'}:{device.adbPort ?? 'n/a'} · Android {device.androidVersion ?? 'n/a'}
                  </div>
                  <div className="helper">
                    CPU {device.cpuUsage}% · RAM {device.memoryUsage}% · Disk {device.diskUsage}%
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
        <div>
          <h2>Platform telemetry</h2>
          <div className="list-grid">
            <div className="job-card">
              <div className="row">
                <strong>Database</strong>
                <StatusPill status={system?.database.status === 'degraded' ? 'failed' : 'running'} />
              </div>
              <p className="helper">
                Emulators: {system?.database.emulators ?? 'n/a'} · Jobs: {system?.database.jobs ?? 'n/a'} · Audit:{' '}
                {system?.database.auditLogs ?? 'n/a'}
              </p>
            </div>
            <div className="job-card">
              <div className="row">
                <strong>Queue</strong>
                <StatusPill status={system?.queue.status === 'degraded' ? 'failed' : 'running'} />
              </div>
              <p className="helper">
                Waiting: {system?.queue.waiting ?? 0} · Active: {system?.queue.active ?? 0} · Completed:{' '}
                {system?.queue.completed ?? 0} · Failed: {system?.queue.failed ?? 0}
              </p>
            </div>
            <div className="job-card">
              <div className="row">
                <strong>Memory</strong>
                <StatusPill status="running" />
              </div>
              <p className="helper">
                Used {system?.memory.usedMb ?? 0} MB of {system?.memory.totalMb ?? 0} MB ·{' '}
                {system?.memory.usagePercent ?? 0}%
              </p>
            </div>
          </div>
        </div>
        <div>
          <h2>Social modules</h2>
          <div className="list-grid">
            {(system?.plugins ?? []).length === 0 ? (
              <div className="job-card helper">No plugin modules detected.</div>
            ) : (
              (system?.plugins ?? []).map((plugin) => (
                <div className="job-card" key={plugin.id}>
                  <div className="row">
                    <strong>{plugin.displayName}</strong>
                    <StatusPill status={plugin.canInstallFromApk ? 'running' : 'warn'} />
                  </div>
                  <div className="helper mono">{plugin.packageName}</div>
                  <div className="helper">{plugin.activity ?? 'No explicit activity configured'}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Emulators</h2>
        <div className="list-grid">
          {emulators.length === 0 ? (
            <div className="emulator-card helper">No emulators returned yet. Create one from the API to populate the fleet view.</div>
          ) : (
            emulators.map((emulator) => (
              <article className="emulator-card" key={emulator.id}>
                <div className="row">
                  <div>
                    <strong>{emulator.name}</strong>
                    <div className="helper mono">{emulator.id}</div>
                  </div>
                  <StatusPill status={emulator.status} />
                </div>
                <p className="helper">Image: {emulator.image}</p>
                <p className="helper mono">
                  ADB: {emulator.adbHost ?? 'n/a'}:{emulator.adbPort ?? 'n/a'}
                </p>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="section section-grid">
        <div>
          <h2>Recent jobs</h2>
          <div className="list-grid">
            {jobs.length === 0 ? (
              <div className="job-card helper">No jobs yet.</div>
            ) : (
              jobs.slice(0, 6).map((job) => (
                <article className="job-card" key={job.id}>
                  <div className="row">
                    <strong>{job.type}</strong>
                    <StatusPill status={job.status} />
                  </div>
                  <div className="helper mono">{job.id}</div>
                  <div className="helper">Created at {new Date(job.createdAt).toLocaleString('tr-TR')}</div>
                </article>
              ))
            )}
          </div>
        </div>
        <div>
          <h2>Audit trail</h2>
          <div className="list-grid">
            {auditLogs.length === 0 ? (
              <div className="log-card helper">No audit records yet.</div>
            ) : (
              auditLogs.map((event) => (
                <article className="log-card" key={event.id}>
                  <div className="row">
                    <strong>{event.action}</strong>
                    <StatusPill status="running" />
                  </div>
                  <div className="helper mono">
                    {event.resourceType}:{event.resourceId ?? 'n/a'}
                  </div>
                  <div className="helper">
                    {event.user?.email ?? 'system'} · {new Date(event.createdAt).toLocaleString('tr-TR')}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
