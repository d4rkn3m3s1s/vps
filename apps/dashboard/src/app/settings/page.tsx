import { PageMotion } from '../../components/Motion';
import { TwoFactorPanel } from '../../components/TwoFactorPanel';
import { WorkspaceMembers } from '../../components/WorkspaceMembers';
import { DangerZone } from '../../components/DangerZone';
import { HoloHeader, HoloPanel, HoloStat, Reveal } from '../../components/hud';
import { apiCall } from '../../lib/apiClient';
import {
  Activity,
  AlertTriangle,
  Boxes,
  Clock,
  Database,
  Layers,
  Server,
  ShieldCheck,
  UserCircle,
  Users
} from 'lucide-react';

export const metadata = { title: 'Ayarlar · VPS Fleet' };
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

  const services = [
    { status: sys?.database.status },
    { status: sys?.queue.status },
    { status: sys?.docker.status }
  ];
  const healthyCount = services.filter((s) => s.status === 'healthy').length;
  const healthTone = healthyCount === services.length ? 'success' : healthyCount === 0 ? 'error' : 'warning';
  const pluginCount = (sys?.plugins ?? []).length;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="AYARLAR"
        title="Ayarlar"
        subtitle="Çalışma alanı ve hesap yapılandırması."
      />

      <Reveal>
        <section className="holo-stats-grid">
          <HoloStat
            label="Rol"
            value={me?.role ?? '—'}
            sub={me?.email ?? 'oturum'}
            tone="info"
            icon={<UserCircle size={16} />}
          />
          <HoloStat
            label="Ortam"
            value={sys?.service.nodeEnv ?? '—'}
            sub="çalışma ortamı"
            tone="cyan"
            icon={<Server size={16} />}
          />
          <HoloStat
            label="API çalışma süresi"
            value={<span className="mono">{fmtUptime(sys?.service.uptimeSeconds)}</span>}
            sub="kesintisiz"
            tone="violet"
            icon={<Clock size={16} />}
          />
          <HoloStat
            label="Servis sağlığı"
            value={<span className="mono">{healthyCount}/{services.length}</span>}
            sub={`${pluginCount} modül yüklü`}
            tone={healthTone}
            icon={<Activity size={16} />}
          />
        </section>
      </Reveal>

      <Reveal delay={0.05}>
        <section className="holo-grid-2">
          <HoloPanel title="Hesap" icon={<UserCircle size={16} />} tilt>
            <div className="panel-stack">
              <div className="row">
                <span className="helper">E-posta</span>
                <span className="mono">{me?.email ?? '—'}</span>
              </div>
              <div className="row">
                <span className="helper">Rol</span>
                <span className={`role-badge role-${(me?.role ?? 'member').toLowerCase()}`}>{me?.role ?? '—'}</span>
              </div>
              <div className="row">
                <span className="helper">Kullanıcı kimliği</span>
                <span className="mono">{me?.id?.slice(0, 12) ?? '—'}</span>
              </div>
              <div className="row">
                <span className="helper">Üyelik tarihi</span>
                <span className="mono">{me?.createdAt ? new Date(me.createdAt).toLocaleDateString('tr-TR') : '—'}</span>
              </div>
            </div>
          </HoloPanel>

          <HoloPanel title="Çalışma Alanı" icon={<Layers size={16} />} tilt>
            <div className="panel-stack">
              <div className="row">
                <span className="helper">Ad</span>
                <span className="mono">VPS Fleet</span>
              </div>
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
          <HoloPanel title="Ekip · Çalışma alanı üyeleri" icon={<Users size={16} />}>
            <WorkspaceMembers />
          </HoloPanel>

          <HoloPanel title="Güvenlik · İki adımlı doğrulama (2FA)" icon={<ShieldCheck size={16} />}>
            <TwoFactorPanel enabled={Boolean(me?.twoFactorEnabled)} />
          </HoloPanel>

          <HoloPanel title="Sistem durumu" icon={<Activity size={16} />}>
            <div className="panel-stack">
              <div className="row">
                <span className="helper">
                  <Database size={14} style={{ verticalAlign: '-2px', marginRight: '6px' }} />
                  PostgreSQL
                </span>
                <span className="status-chip">
                  <span className={sys?.database.status === 'healthy' ? 'dot dot-online' : 'dot dot-error'} />
                  {sys?.database.status ?? 'bilinmiyor'}
                </span>
              </div>
              <div className="row">
                <span className="helper">
                  <Layers size={14} style={{ verticalAlign: '-2px', marginRight: '6px' }} />
                  Redis kuyruğu
                </span>
                <span className="status-chip">
                  <span className={sys?.queue.status === 'healthy' ? 'dot dot-online' : 'dot dot-error'} />
                  {sys?.queue.status ?? 'bilinmiyor'}
                </span>
              </div>
              <div className="row">
                <span className="helper">
                  <Boxes size={14} style={{ verticalAlign: '-2px', marginRight: '6px' }} />
                  Docker
                </span>
                <span className="status-chip">
                  <span className={sys?.docker.status === 'healthy' ? 'dot dot-online' : 'dot dot-error'} />
                  {sys?.docker.status ?? 'bilinmiyor'}
                </span>
              </div>
            </div>
          </HoloPanel>

          <HoloPanel title="Yüklü modüller" icon={<Boxes size={16} />}>
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
          </HoloPanel>
        </section>
      </Reveal>

      <Reveal delay={0.15}>
        <HoloPanel title="Tehlikeli bölge" icon={<AlertTriangle size={16} />} className="danger-panel" scan={false}>
          <DangerZone />
        </HoloPanel>
      </Reveal>
    </PageMotion>
  );
}
