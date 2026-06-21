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
          <h2>Altyapı sağlığı</h2>
          <div className="panel-stack">
            <div className="row">
              <span className="helper">PostgreSQL</span>
              <span className="status-chip">
                <span className={sys?.database.status === 'healthy' ? 'dot dot-online' : 'dot dot-error'} />
                {sys?.database.status ?? 'bilinmiyor'}
              </span>
            </div>
            <div className="row">
              <span className="helper">Redis kuyruğu</span>
              <span className="status-chip">
                <span className={sys?.queue.status === 'healthy' ? 'dot dot-online' : 'dot dot-error'} />
                {sys?.queue.status ?? 'bilinmiyor'}
              </span>
            </div>
            <div className="row">
              <span className="helper">Docker</span>
              <span className="status-chip">
                <span className={sys?.docker.status === 'healthy' ? 'dot dot-online' : 'dot dot-error'} />
                {sys?.docker.status ?? 'bilinmiyor'}
              </span>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>Servis</h2>
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
        </div>
      </section>

      <section className="section-grid">
        <div className="panel">
          <h2>Ana makineler</h2>
          <div className="panel-stack">
            {hosts.length === 0 ? (
              <span className="helper">Kayıtlı ana makine yok.</span>
            ) : (
              hosts.map((h) => (
                <div className="row" key={h.id}>
                  <span className="mono">{h.name}</span>
                  <span className="status-chip">
                    <span className={h.status === 'ONLINE' ? 'dot dot-online' : 'dot dot-error'} />
                    {h.status} · {h.runningPhones}/{h.capacity} telefon · {h.cpuCores ?? '—'}c / {h.memoryGb ?? '—'}GB
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="panel">
          <h2>Yüklü modüller</h2>
          <div className="panel-stack">
            {(sys?.plugins ?? []).length === 0 ? (
              <span className="helper">Yüklü sosyal modül yok.</span>
            ) : (
              (sys?.plugins ?? []).map((p) => (
                <div className="row" key={p.id}>
                  <span className="mono">{p.displayName}</span>
                  <span className="status-chip">
                    <span className="dot dot-online" /> etkin
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="section-grid">
        <div className="panel">
          <h2>Aracı bağlantısı</h2>
          <div className="panel-stack">
            <p className="helper">
              Ana makine aracıları, sunucu tarafında yapılandırılan API anahtarıyla kimlik doğrular. Anahtar hiçbir zaman
              panele açık edilmez ve bir ana makine kaydedildiğinde yalnızca bir kez sağlanır.
            </p>
            <div className="row">
              <span className="helper">Çevrimiçi ana makineler</span>
              <span className="role-badge">{onlineHosts} / {hosts.length}</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
