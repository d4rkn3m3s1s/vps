import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';
import { serverFetch } from '../../lib/serverFetch';

export const metadata = { title: 'Kaynaklar · VPS Fleet' };
export const dynamic = 'force-dynamic';

type Guide = { id: string; question: string; answer: string };

// The API docs are served by the backend itself. We expose a browser-reachable
// URL (defaults to localhost in dev) so the links work from the dashboard.
const API_PUBLIC_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Resource = {
  icon: string;
  title: string;
  desc: string;
  href: string;
  cta: string;
  external?: boolean;
};

const RESOURCES: Resource[] = [
  {
    icon: '⚡',
    title: 'API Referansı (Swagger)',
    desc: 'Etkileşimli OpenAPI gezgini — her uç noktayı token\'ınızla canlı olarak deneyin.',
    href: `${API_PUBLIC_URL}/docs`,
    cta: 'Swagger arayüzünü aç',
    external: true
  },
  {
    icon: '◇',
    title: 'OpenAPI Şeması',
    desc: 'Kod üretimi ve Postman içe aktarımı için ham, makine tarafından okunabilir şema.',
    href: `${API_PUBLIC_URL}/docs.json`,
    cta: 'Şemayı görüntüle',
    external: true
  },
  {
    icon: '▦',
    title: 'İlk profilinizi oluşturun',
    desc: 'Bir bulut telefon profili oluşturun, bir proxy atayın ve otomasyona başlayın.',
    href: '/profiles',
    cta: 'Profillere git'
  },
  {
    icon: '⇄',
    title: 'Bir proxy bağlayın',
    desc: 'SOCKS5/HTTP proxyler ekleyin ve atamadan önce çıkış IP\'lerini doğrulayın.',
    href: '/proxies',
    cta: 'Proxyleri yönet'
  },
  {
    icon: '✦',
    title: 'Fleet AI ile otomatikleştirin',
    desc: 'Yerleşik Claude asistanından cihaz görevlerini planlamasını ve betiklemesini isteyin.',
    href: '/ai',
    cta: 'Fleet AI\'yı aç'
  },
  {
    icon: '☻',
    title: 'Ekibinizi davet edin',
    desc: 'Rollerle üyeler ekleyin ve filoya erişimi paylaşın.',
    href: '/members',
    cta: 'Üyeleri yönet'
  }
];

export default async function ResourcesPage() {
  // FAQ guides are DB-backed (workspace-scoped, seeded on first read). The
  // quick-start cards below stay static — they're in-app navigation, not data.
  const res = await serverFetch<Guide[]>('/resources/guides');
  const guides = res?.data ?? [];
  return (
    <PageMotion className="page">
      <PageHeader title="Kaynaklar" subtitle="Rehberler, API belgeleri ve eğitimler." />

      <section>
        <h2 className="section-title">Hızlı başlangıç</h2>
        <div className="app-grid">
          {RESOURCES.map((r) => (
            <article className="app-card" key={r.title}>
              <div className="app-icon">{r.icon}</div>
              <div className="app-body">
                <strong>{r.title}</strong>
                <p className="helper">{r.desc}</p>
              </div>
              <a
                className="btn-ghost"
                href={r.href}
                {...(r.external ? { target: '_blank', rel: 'noreferrer' } : {})}
              >
                {r.cta}
              </a>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: '32px' }}>
        <h2 className="section-title">Sıkça Sorulan Sorular</h2>
        <div className="list-grid">
          {guides.length === 0 ? (
            <p className="helper">Henüz rehber yok.</p>
          ) : (
            guides.map((g) => (
              <article className="log-card" key={g.id}>
                <strong>{g.question}</strong>
                <p className="helper" style={{ marginTop: '6px' }}>{g.answer}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </PageMotion>
  );
}
