import { Activity, Boxes, Database, KeyRound, Layers, Radio, Server, ShieldCheck, Timer } from 'lucide-react';
import { apiCall } from '../../../lib/apiClient';
import { serverFetch } from '../../../lib/serverFetch';
import { HoloPanel, HoloStat, Reveal } from '../../../components/hud';

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

function statusLabel(status?: string | null): string {
  switch (status) {
    case 'healthy':
      return 'Sağlıklı';
    case 'degraded':
    case 'error':
      return 'Hata';
    case 'online':
    case 'ONLINE':
      return 'Çevrimiçi';
    case 'offline':
    case 'OFFLINE':
      return 'Çevrimdışı';
    case null:
    case undefined:
    case '':
      return 'Bilinmiyor';
    default:
      return status;
  }
}

export default async function AdminSystemPage() {
  const [sysRes, hostsRes] = await Promise.all([
    apiCall<SystemOverview>('/system/overview', { auth: false }),
    serverFetch<Host[]>('/hosts')
  ]);

  const sys = sysRes?.data;
  const hosts = hostsRes?.data ?? [];
  const onlineHosts = hosts.filter((h) => h.status === 'ONLINE').length;
  const runningPhones = hosts.reduce((sum, h) => sum + h.runningPhones, 0);
  const totalCapacity = hosts.reduce((sum, h) => sum + h.capacity, 0);
  const plugins = sys?.plugins ?? [];

  const healthy = (status?: string) => status === 'healthy';
  const coreHealthy = healthy(sys?.database.status) && healthy(sys?.queue.status) && healthy(sys?.docker.status);

  return (
    <section className="admin-stack">
      <Reveal>
        <section className="holo-stats-grid">
          <HoloStat
            label="Çekirdek altyapı"
            value={coreHealthy ? 'Sağlıklı' : 'Dikkat'}
            sub="PostgreSQL · Redis · Docker"
            tone={coreHealthy ? 'success' : 'warning'}
            icon={<ShieldCheck size={16} />}
          />
          <HoloStat
            label="Çevrimiçi ana makineler"
            value={<span className="mono">{onlineHosts} / {hosts.length}</span>}
            sub="aktif KVM düğümleri"
            tone="cyan"
            icon={<Server size={16} />}
          />
          <HoloStat
            label="Çalışan telefonlar"
            value={<span className="mono">{runningPhones} / {totalCapacity}</span>}
            sub="bulut cihaz kapasitesi"
            tone="violet"
            icon={<Radio size={16} />}
          />
          <HoloStat
            label="API çalışma süresi"
            value={<span className="mono">{fmtUptime(sys?.service.uptimeSeconds)}</span>}
            sub={sys?.service.nodeEnv ?? '—'}
            tone="cyan"
            icon={<Timer size={16} />}
          />
        </section>
      </Reveal>

      <Reveal delay={0.05}>
        <section className="holo-grid-2">
          <HoloPanel title="Altyapı sağlığı" icon={<Database size={16} />} tilt>
            <div className="panel-stack">
              {sys == null ? (
                <div className="row">
                  <span className="helper">Çekirdek altyapı</span>
                  <span className="status-chip">
                    <span className="dot dot-offline" />
                    Veri alınamadı
                  </span>
                </div>
              ) : (
                <>
                  <div className="row">
                    <span className="helper">PostgreSQL</span>
                    <span className="status-chip">
                      <span className={healthy(sys.database.status) ? 'dot dot-online' : 'dot dot-error'} />
                      {statusLabel(sys.database.status)}
                    </span>
                  </div>
                  <div className="row">
                    <span className="helper">Redis kuyruğu</span>
                    <span className="status-chip">
                      <span className={healthy(sys.queue.status) ? 'dot dot-online' : 'dot dot-error'} />
                      {statusLabel(sys.queue.status)}
                    </span>
                  </div>
                  <div className="row">
                    <span className="helper">Docker</span>
                    <span className="status-chip">
                      <span className={healthy(sys.docker.status) ? 'dot dot-online' : 'dot dot-error'} />
                      {statusLabel(sys.docker.status)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </HoloPanel>

          <HoloPanel title="Servis" icon={<Activity size={16} />} tilt>
            <div className="panel-stack">
              <div className="row">
                <span className="helper">Ortam</span>
                <span className="mono">{sys?.service.nodeEnv ?? '—'}</span>
              </div>
              <div className="row">
                <span className="helper">API çalışma süresi</span>
                <span className="mono">{fmtUptime(sys?.service.uptimeSeconds)}</span>
              </div>
              <div className="row">
                <span className="helper">Bölge</span>
                <span className="mono">kendi sunucumuzda</span>
              </div>
            </div>
          </HoloPanel>
        </section>
      </Reveal>

      <Reveal delay={0.1}>
        <section className="holo-grid-2">
          <HoloPanel title="Ana makineler" icon={<Server size={16} />} scan={false}>
            <div className="panel-stack">
              {hosts.length === 0 ? (
                <span className="helper">Kayıtlı ana makine yok.</span>
              ) : (
                hosts.map((h) => (
                  <div className="row" key={h.id}>
                    <span className="mono">{h.name}</span>
                    <span className="status-chip">
                      <span className={h.status === 'ONLINE' ? 'dot dot-online' : 'dot dot-error'} />
                      {statusLabel(h.status)} · {h.runningPhones}/{h.capacity} telefon · {h.cpuCores ?? '—'}c / {h.memoryGb ?? '—'}GB
                    </span>
                  </div>
                ))
              )}
            </div>
          </HoloPanel>

          <HoloPanel title="Yüklü modüller" icon={<Layers size={16} />} scan={false}>
            <div className="panel-stack">
              {plugins.length === 0 ? (
                <span className="helper">Yüklü sosyal modül yok.</span>
              ) : (
                plugins.map((p) => (
                  <div className="row" key={p.id}>
                    <span className="mono">{p.displayName}</span>
                    <span className="status-chip">
                      <span className="dot dot-online" /> etkin
                    </span>
                  </div>
                ))
              )}
            </div>
          </HoloPanel>
        </section>
      </Reveal>

      <Reveal delay={0.15}>
        <section className="holo-grid-2">
          <HoloPanel title="Aracı bağlantısı" icon={<KeyRound size={16} />}>
            <div className="panel-stack">
              <p className="helper">
                Ana makine aracıları, sunucu tarafında yapılandırılan API anahtarıyla kimlik doğrular. Anahtar hiçbir zaman
                panele açık edilmez ve bir ana makine kaydedildiğinde yalnızca bir kez sağlanır.
              </p>
              <div className="row">
                <span className="helper">Çevrimiçi ana makineler</span>
                <span className="mono">{onlineHosts} / {hosts.length}</span>
              </div>
            </div>
          </HoloPanel>

          <HoloPanel title="Kapasite özeti" icon={<Boxes size={16} />}>
            <div className="panel-stack">
              <div className="row">
                <span className="helper">Toplam kapasite</span>
                <span className="mono">{totalCapacity} telefon</span>
              </div>
              <div className="row">
                <span className="helper">Çalışan telefonlar</span>
                <span className="mono">{runningPhones} telefon</span>
              </div>
              <div className="row">
                <span className="helper">Yüklü modüller</span>
                <span className="mono">{plugins.length}</span>
              </div>
            </div>
          </HoloPanel>
        </section>
      </Reveal>
    </section>
  );
}
