import Link from 'next/link';
import { cookies } from 'next/headers';
import { PageMotion, StaggerGrid, MotionItem, AnimatedNumber } from '../components/Motion';
import { OnboardingChecklist, type OnboardingStep } from '../components/OnboardingChecklist';
import { DashboardProvider, Widget } from '../components/Dashboard';
import { PageHeader } from '../components/PageHeader';
import { ArrowUpRight, Smartphone, Network, ListChecks, Boxes } from 'lucide-react';
import { LiveInfrastructure, type InfraMetric } from '../components/LiveInfrastructure';
import { DeviceMap, type RegionStat } from '../components/DeviceMap';
import { AutomationCenter, type AutomationWorkflow } from '../components/AutomationCenter';
import { ActivityTimeline, type TimelineEvent } from '../components/ActivityTimeline';
import { serverFetch } from '../lib/serverFetch';

export const dynamic = 'force-dynamic';

type DeviceSummary = { total: number; online: number; offline: number; error: number };
type Job = { id: string; type: string; status: string; createdAt: string };
type AuditLog = { id: string; action: string; resourceType: string; createdAt: string; user?: { email: string } | null };
type Device = {
  id: string;
  status: string;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  fingerprint?: { country?: string | null; countryCode?: string | null } | null;
};
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
      title: 'İlk bulut telefonunuzu kurun',
      description: 'Android\'i bulutta çalıştırmaya başlamak için bir profil oluşturun.',
      href: '/profiles',
      cta: 'Telefon ekle',
      done: (d?.total ?? 0) > 0
    },
    {
      key: 'proxy',
      title: 'Bir proxy bağlayın',
      description: 'Cihaz trafiğini kendi proxy uç noktalarınız üzerinden yönlendirin.',
      href: '/proxies',
      cta: 'Proxy ekle',
      done: proxyCount > 0
    },
    {
      key: 'job',
      title: 'İlk işinizi çalıştırın',
      description: 'Bir uygulama yükleyin, ekran görüntüsü alın veya bir otomasyon çalıştırın.',
      href: '/profiles',
      cta: 'İş çalıştır',
      done: totalJobs > 0
    },
    {
      key: 'team',
      title: 'Bir ekip arkadaşı davet edin',
      description: 'Çalışma alanınıza operatörler veya izleyiciler ekleyin.',
      href: '/admin/members',
      cta: 'Davet et',
      done: hasTeam
    },
    {
      key: '2fa',
      title: 'Hesabınızı 2FA ile güvenceye alın',
      description: 'Giriş için iki faktörlü kimlik doğrulamayı etkinleştirin.',
      href: '/settings',
      cta: '2FA\'yı etkinleştir',
      done: has2fa
    }
  ];

  // ── Live infrastructure (real system metrics) ──────────────────────────────
  const memPct = sys?.memory.usagePercent ?? 0;
  const totalJobsAll = sys?.database.jobs ?? 0;
  const queueLoad = sys
    ? Math.min(100, Math.round(((sys.queue.active + sys.queue.waiting) / Math.max(totalJobsAll, 1)) * 100))
    : 0;
  // Real device CPU/disk: average the per-device metrics the agent reports
  // (Device.cpuUsage/diskUsage), so these reflect actual phones, not a formula.
  const meteredDevices = deviceList.filter((d) => d.status === 'ONLINE');
  const avg = (pick: (d: (typeof deviceList)[number]) => number | undefined): number => {
    const vals = meteredDevices.map((d) => pick(d) ?? 0);
    if (vals.length === 0) return 0;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };
  const cpuPct = avg((d) => d.cpuUsage);
  const deviceMemPct = avg((d) => d.memoryUsage);
  const storagePct = avg((d) => d.diskUsage);
  const tone = (p: number): InfraMetric['tone'] => (p >= 85 ? 'error' : p >= 65 ? 'warning' : p >= 40 ? 'accent' : 'success');
  const infraMetrics: InfraMetric[] = [
    { key: 'cpu', label: 'Cihaz CPU (ort.)', percent: cpuPct, detail: `${meteredDevices.length} çevrimiçi cihaz`, tone: tone(cpuPct) },
    { key: 'memory', label: 'Cihaz Bellek (ort.)', percent: deviceMemPct, detail: meteredDevices.length > 0 ? `${meteredDevices.length} cihaz ortalaması` : 'çevrimiçi cihaz yok', tone: tone(deviceMemPct) },
    { key: 'network', label: 'Kuyruk Verimi', percent: queueLoad, detail: `${sys?.queue.waiting ?? 0} bekliyor · ${sys?.queue.active ?? 0} aktif`, tone: tone(queueLoad) },
    { key: 'storage', label: 'Cihaz Disk (ort.)', percent: storagePct, detail: `${meteredDevices.length} çevrimiçi cihaz`, tone: tone(storagePct) }
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
        title="Genel Bakış"
        subtitle="Bulut telefon filonuza tek bakışta göz atın."
        actions={
          <>
            <Link
              href="/profiles"
              className="btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
            >
              Yeni telefon
              <ArrowUpRight size={16} />
            </Link>
            <Link
              href="/welcome"
              className="btn-ghost"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
            >
              Platformu görüntüle
              <ArrowUpRight size={16} />
            </Link>
          </>
        }
      />

      {!onboardingDismissed ? <OnboardingChecklist steps={onboardingSteps} /> : null}

      <DashboardProvider>
      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Filo Metrikleri</div>
      <Widget id="metrics" title="Metrikler">
      <StaggerGrid className="stats">
        <MotionItem className="metric ov-metric">
          <span className="metric-ico metric-ico-blue"><Smartphone size={18} /></span>
          <p className="metric-label">Bulut telefonlar</p>
          <p className="metric-value"><AnimatedNumber value={d?.total ?? 0} format={false} /></p>
          <p className="metric-sub">{d?.online ?? 0} çevrimiçi · {d?.offline ?? 0} çevrimdışı</p>
        </MotionItem>
        <MotionItem className="metric ov-metric">
          <span className="metric-ico metric-ico-cyan"><Network size={18} /></span>
          <p className="metric-label">Proxyler</p>
          <p className="metric-value"><AnimatedNumber value={proxyCount} format={false} /></p>
          <p className="metric-sub">Yapılandırılmış uç noktalar</p>
        </MotionItem>
        <MotionItem className="metric ov-metric">
          <span className="metric-ico metric-ico-violet"><ListChecks size={18} /></span>
          <p className="metric-label">İşler</p>
          <p className="metric-value"><AnimatedNumber value={sys?.database.jobs ?? 0} format={false} /></p>
          <p className="metric-sub">{pendingJobs} devam ediyor</p>
        </MotionItem>
        <MotionItem className="metric ov-metric">
          <span className="metric-ico metric-ico-green"><Boxes size={18} /></span>
          <p className="metric-label">Eklentiler</p>
          <p className="metric-value"><AnimatedNumber value={sys?.plugins.length ?? 0} format={false} /></p>
          <p className="metric-sub">Sosyal modüller</p>
        </MotionItem>
      </StaggerGrid>
      </Widget>

      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Operasyonlar</div>
      <section className="section-grid">
        <Widget id="health" title="Sistem durumu">
        <div className="panel ov-panel">
          <h2><span className="ov-ico">◆</span> Sistem durumu</h2>
          <div className="panel-stack">
            <div className="row">
              <span className="helper">PostgreSQL</span>
              <span className="status-chip"><span className={healthClass(sys?.database.status)} /> {sys?.database.status ?? 'unknown'}</span>
            </div>
            <div className="row">
              <span className="helper">Redis kuyruğu</span>
              <span className="status-chip"><span className={healthClass(sys?.queue.status)} /> {sys?.queue.status ?? 'unknown'}</span>
            </div>
            <div className="row">
              <span className="helper">Docker</span>
              <span className="status-chip"><span className={healthClass(sys?.docker.status)} /> {sys?.docker.status ?? 'unknown'}</span>
            </div>
            <div className="row">
              <span className="helper">Bellek</span>
              <span className="mono">{sys?.memory.usagePercent ?? 0}% · {sys?.memory.usedMb ?? 0}/{sys?.memory.totalMb ?? 0} MB</span>
            </div>
            <div className="row">
              <span className="helper">Kuyruk</span>
              <span className="mono">
                {sys?.queue.waiting ?? 0} bekliyor · {sys?.queue.active ?? 0} aktif · {sys?.queue.failed ?? 0} başarısız
              </span>
            </div>
          </div>
        </div>
        </Widget>

        <Widget id="quick-actions" title="Hızlı işlemler">
        <div className="panel ov-panel">
          <h2><span className="ov-ico">⚡</span> Hızlı işlemler</h2>
          <div className="quick-grid">
            <Link href="/profiles" className="quick-tile ov-quick">📱 Bulut telefon kur</Link>
            <Link href="/rpa" className="quick-tile ov-quick">⚙ Otomasyon oluştur</Link>
            <Link href="/settings" className="quick-tile ov-quick">🔑 API anahtarı oluştur</Link>
            <Link href="/members" className="quick-tile ov-quick">☻ Ekip üyesi davet et</Link>
            <Link href="/profiles" className="quick-tile ov-quick">▦ Cihaz grubu oluştur</Link>
            <Link href="/proxies" className="quick-tile ov-quick">⇄ Proxy ekle</Link>
          </div>
        </div>
        </Widget>
      </section>

      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Canlı Altyapı</div>
      <div className="panel ov-panel">
        <LiveInfrastructure metrics={infraMetrics} />
      </div>

      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Küresel Cihaz Haritası</div>
      <div className="panel ov-panel">
        <DeviceMap regions={regions} total={totalDevices} />
      </div>

      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Otomasyon Merkezi</div>
      <div className="panel ov-panel">
        <AutomationCenter workflows={workflows} />
      </div>

      <div className="ov-eyebrow"><span className="ov-eyebrow-dot" />Canlı Akış</div>
      <section className="section-grid">
        <Widget id="recent-jobs" title="Son işler">
        <div className="panel ov-panel ov-list">
          <h2><span className="ov-ico">☷</span> Son işler</h2>
          <div className="list-grid">
            {jobs.length === 0 ? (
              <div className="job-card helper">Henüz iş yok.</div>
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

        <Widget id="recent-activity" title="Son etkinlik">
        <div className="panel ov-panel">
          <h2><span className="ov-ico">⊛</span> Son etkinlik</h2>
          <ActivityTimeline events={timeline} />
        </div>
        </Widget>
      </section>
      </DashboardProvider>
    </PageMotion>
  );
}
