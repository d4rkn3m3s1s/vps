import Link from 'next/link';
import { cookies } from 'next/headers';
import { PageMotion } from '../components/Motion';
import { OnboardingChecklist, type OnboardingStep } from '../components/OnboardingChecklist';
import { PageHeader } from '../components/PageHeader';
import { ArrowUpRight } from 'lucide-react';
import { CommandDeck } from '../components/CommandDeck';
import { FleetHero3D } from '../components/FleetHero3D';
import type { InfraMetric } from '../components/LiveInfrastructure';
import { serverFetch } from '../lib/serverFetch';

export const dynamic = 'force-dynamic';

type DeviceSummary = { total: number; online: number; offline: number; error: number };
type Job = { id: string; type: string; status: string; createdAt: string };
type Device = {
  id: string;
  status: string;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  fingerprint?: { country?: string | null; countryCode?: string | null } | null;
};
type SystemOverview = {
  service: { uptimeSeconds: number; nodeEnv: string };
  database: { status: string; emulators: number; jobs: number; auditLogs: number };
  queue: { status: string; waiting: number; active: number; completed: number; failed: number };
  docker: { status: string; runningContainers: number; totalContainers: number };
  memory: { usedMb: number; totalMb: number; usagePercent: number };
  plugins: { id: string; displayName: string }[];
};


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
  const [devices, jobsRes, sysRes, proxiesRes, deviceListRes, meRes, wsRes] =
    await Promise.all([
      serverFetch<DeviceSummary>('/devices/status/summary'),
      serverFetch<Job[]>('/jobs?limit=6'),
      serverFetch<SystemOverview>('/system/overview'),
      serverFetch<unknown[]>('/proxies'),
      serverFetch<Device[]>('/devices'),
      serverFetch<Me>('/auth/me'),
      serverFetch<WorkspaceLite[]>('/workspaces')
    ]);

  const d = devices?.data;
  const jobs = jobsRes?.data ?? [];
  const sys = sysRes?.data;
  const proxyCount = Array.isArray(proxiesRes?.data) ? proxiesRes!.data.length : 0;
  const pendingJobs = jobs.filter((j) => j.status === 'PENDING' || j.status === 'RUNNING').length;
  const deviceList = deviceListRes?.data ?? [];

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
  // Distinct geographies across the fleet (for the hero "Bölge" counter).
  const regionCount = new Set(
    deviceList
      .map((dev) => dev.fingerprint?.countryCode || dev.fingerprint?.country)
      .filter((c): c is string => Boolean(c))
  ).size;

  const tone = (p: number): InfraMetric['tone'] => (p >= 85 ? 'error' : p >= 65 ? 'warning' : p >= 40 ? 'info' : 'success');
  const infraMetrics: InfraMetric[] = [
    { key: 'cpu', label: 'Cihaz CPU (ort.)', percent: cpuPct, detail: `${meteredDevices.length} çevrimiçi cihaz`, tone: tone(cpuPct) },
    { key: 'memory', label: 'Cihaz Bellek (ort.)', percent: deviceMemPct, detail: meteredDevices.length > 0 ? `${meteredDevices.length} cihaz ortalaması` : 'çevrimiçi cihaz yok', tone: tone(deviceMemPct) },
    { key: 'network', label: 'Kuyruk Verimi', percent: queueLoad, detail: `${sys?.queue.waiting ?? 0} bekliyor · ${sys?.queue.active ?? 0} aktif`, tone: tone(queueLoad) },
    { key: 'storage', label: 'Cihaz Disk (ort.)', percent: storagePct, detail: `${meteredDevices.length} çevrimiçi cihaz`, tone: tone(storagePct) }
  ];


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

      <FleetHero3D
        online={d?.online ?? 0}
        total={d?.total ?? 0}
        regions={regionCount}
        stats={[
          { key: 'phones', label: 'Bulut telefon', value: d?.total ?? 0, icon: 'phone' },
          { key: 'jobs', label: 'Aktif iş', value: pendingJobs, icon: 'live' },
          { key: 'proxies', label: 'Proxy uç noktası', value: proxyCount, icon: 'globe' },
          { key: 'plugins', label: 'Sosyal modül', value: sys?.plugins.length ?? 0, icon: 'ai' }
        ]}
      />

      {!onboardingDismissed && (d?.total ?? 0) === 0 ? <OnboardingChecklist steps={onboardingSteps} /> : null}

      <CommandDeck
        telemetry={{
          online: d?.online ?? 0,
          total: d?.total ?? 0,
          errors: d?.error ?? 0,
          healthPct: (d?.total ?? 0) > 0 ? Math.round(((d?.online ?? 0) / (d!.total)) * 100) : 100,
          jobsRunning: pendingJobs,
          queueWaiting: sys?.queue.waiting ?? 0
        }}
        kpis={[
          { key: 'phones', label: 'Bulut Telefonlar', value: d?.total ?? 0, sub: `${d?.online ?? 0} çevrimiçi · ${d?.offline ?? 0} çevrimdışı`, tone: 'cyan', icon: 'phone', spark: deckSpark(d?.online ?? 0) },
          { key: 'proxies', label: 'Proxyler', value: proxyCount, sub: 'Yapılandırılmış uç noktalar', tone: 'cyan', icon: 'proxy', spark: deckSpark(proxyCount) },
          { key: 'jobs', label: 'Toplam İş', value: sys?.database.jobs ?? 0, sub: `${pendingJobs} devam ediyor`, tone: 'violet', icon: 'jobs', spark: deckSpark(sys?.database.jobs ?? 0) },
          { key: 'plugins', label: 'Eklentiler', value: sys?.plugins.length ?? 0, sub: 'Sosyal modüller', tone: 'success', icon: 'plugins' }
        ]}
        devices={deviceList.map((dev) => ({
          id: dev.id,
          status: dev.status,
          label: dev.id.slice(0, 8),
          ...(dev.fingerprint?.country ? { region: dev.fingerprint.country } : {})
        }))}
        metrics={infraMetrics.map((m) => ({ key: m.key, label: m.label, percent: m.percent, detail: m.detail, tone: m.tone }))}
        jobs={jobs.map((j) => ({ id: j.id, type: j.type, status: j.status, createdAt: j.createdAt }))}
        servicesOffline={!sysRes}
        services={[
          { label: 'PostgreSQL', status: sys?.database.status, icon: 'db' },
          { label: 'Redis Kuyruğu', status: sys?.queue.status, icon: 'queue' },
          { label: 'Docker', status: sys?.docker.status, icon: 'docker' }
        ]}
      />
    </PageMotion>
  );
}

// Deterministic faux-trend for KPI sparklines (no time-series store yet): a
// gentle ramp toward the current value so tiles read as "trending", not flat.
function deckSpark(value: number): number[] {
  const base = Math.max(value, 1);
  return [0.55, 0.62, 0.58, 0.7, 0.66, 0.78, 0.84, 1].map((f) => Math.round(base * f));
}
