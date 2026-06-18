import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export const metadata = { title: 'Kaynaklar · VPS Fleet' };
export const dynamic = 'force-dynamic';

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

const GUIDES = [
  { q: '“Başlat” neden bir telefonu PENDING durumunda tutuyor?', a: 'Bulut telefonlar KVM destekli bir sunucuda çalışır. Bir Android sunucu bağlayana kadar işler kaydedilir ancak çalıştırılmaz. Sunucu kurulum rehberine bakın.' },
  { q: 'Nasıl proxy eklerim?', a: 'Proxyler → Proxy ekle bölümüne gidin. Sunucu/port/kimlik bilgilerini girin, ardından çıkış IP\'sini doğrulamak için Kontrol et\'e basın.' },
  { q: 'API anahtarlarım nerede?', a: 'API anahtarları kullanıcı başına verilir. Arka uç yazma işlemleri, API anahtarınızdan otomatik olarak alınan bir JWT gerektirir.' },
  { q: 'Senkronizatör nasıl çalışır?', a: 'İki veya daha fazla telefon seçin, birini lider olarak işaretleyin; sunucu bağlandıktan sonra liderin girişleri gerçek zamanlı olarak takipçilere yansıtılır.' }
];

export default function ResourcesPage() {
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
          {GUIDES.map((g) => (
            <article className="log-card" key={g.q}>
              <strong>{g.q}</strong>
              <p className="helper" style={{ marginTop: '6px' }}>{g.a}</p>
            </article>
          ))}
        </div>
      </section>
    </PageMotion>
  );
}
