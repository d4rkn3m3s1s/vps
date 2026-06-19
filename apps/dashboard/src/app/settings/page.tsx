import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';
import { TwoFactorPanel } from '../../components/TwoFactorPanel';
import { WorkspaceMembers } from '../../components/WorkspaceMembers';
import { apiCall } from '../../lib/apiClient';

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

  return (
    <PageMotion className="page">
      <PageHeader title="Ayarlar" subtitle="Çalışma alanı ve hesap yapılandırması." />

      <section className="section-grid">
        <div className="panel">
          <h2>Hesap</h2>
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
        </div>

        <div className="panel">
          <h2>Çalışma Alanı</h2>
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
        </div>
      </section>

      <section className="section-grid">
        <div className="panel">
          <h2>Ekip · Çalışma alanı üyeleri</h2>
          <WorkspaceMembers />
        </div>

        <div className="panel">
          <h2>Güvenlik · İki adımlı doğrulama (2FA)</h2>
          <TwoFactorPanel enabled={Boolean(me?.twoFactorEnabled)} />
        </div>

        <div className="panel">
          <h2>Sistem durumu</h2>
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

      <section className="panel danger-panel">
        <h2>Tehlikeli bölge</h2>
        <p className="helper">Bu işlemler geri alınamaz. Dikkatli ilerleyin.</p>
        <div className="quick-grid">
          <button type="button" className="btn-ghost danger-btn" disabled>
            Çalışma alanı verilerini sıfırla
          </button>
          <button type="button" className="btn-ghost danger-btn" disabled>
            Hesabı sil
          </button>
        </div>
        <p className="helper" style={{ marginTop: '12px' }}>
          Yıkıcı işlemler bu sürümde devre dışıdır. Bir yedekleme politikası yapılandırıldığında bunları etkinleştirin.
        </p>
      </section>
    </PageMotion>
  );
}
