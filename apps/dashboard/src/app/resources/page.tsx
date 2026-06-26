import { PageMotion } from '../../components/Motion';
import { serverFetch } from '../../lib/serverFetch';
import { HoloHeader, HoloPanel, HoloStat, Reveal } from '../../components/hud';
import {
  BookOpen,
  Zap,
  FileJson,
  LayoutGrid,
  ArrowLeftRight,
  Sparkles,
  Users,
  HelpCircle,
  Rocket,
  ArrowUpRight,
  type LucideIcon
} from 'lucide-react';

export const metadata = { title: 'Kaynaklar · VPS Fleet' };
export const dynamic = 'force-dynamic';

type Guide = { id: string; question: string; answer: string };

// The API docs are served by the backend itself. We expose a browser-reachable
// URL (defaults to localhost in dev) so the links work from the dashboard.
const API_PUBLIC_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Resource = {
  icon: LucideIcon;
  title: string;
  desc: string;
  href: string;
  cta: string;
  external?: boolean;
};

const RESOURCES: Resource[] = [
  {
    icon: Zap,
    title: 'API Referansı (Swagger)',
    desc: 'Etkileşimli OpenAPI gezgini — her uç noktayı token\'ınızla canlı olarak deneyin.',
    href: `${API_PUBLIC_URL}/docs`,
    cta: 'Swagger arayüzünü aç',
    external: true
  },
  {
    icon: FileJson,
    title: 'OpenAPI Şeması',
    desc: 'Kod üretimi ve Postman içe aktarımı için ham, makine tarafından okunabilir şema.',
    href: `${API_PUBLIC_URL}/docs.json`,
    cta: 'Şemayı görüntüle',
    external: true
  },
  {
    icon: LayoutGrid,
    title: 'İlk profilinizi oluşturun',
    desc: 'Bir bulut telefon profili oluşturun, bir proxy atayın ve otomasyona başlayın.',
    href: '/profiles',
    cta: 'Profillere git'
  },
  {
    icon: ArrowLeftRight,
    title: 'Bir proxy bağlayın',
    desc: 'SOCKS5/HTTP proxyler ekleyin ve atamadan önce çıkış IP\'lerini doğrulayın.',
    href: '/proxies',
    cta: 'Proxyleri yönet'
  },
  {
    icon: Sparkles,
    title: 'Fleet AI ile otomatikleştirin',
    desc: 'Yerleşik Claude asistanından cihaz görevlerini planlamasını ve betiklemesini isteyin.',
    href: '/ai',
    cta: 'Fleet AI\'yı aç'
  },
  {
    icon: Users,
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

  const docCount = RESOURCES.filter((r) => r.external).length;
  const linkCount = RESOURCES.filter((r) => !r.external).length;

  return (
    <PageMotion className="page">
      <HoloHeader
        eyebrow="KAYNAKLAR"
        title="Kaynaklar"
        subtitle="Rehberler, API belgeleri ve eğitimler."
      />

      <Reveal>
        <div className="holo-stats-grid">
          <HoloStat
            label="Hızlı başlangıç"
            value={<span className="mono">{RESOURCES.length}</span>}
            sub="kısayol"
            tone="info"
            icon={<Rocket size={16} />}
          />
          <HoloStat
            label="API belgeleri"
            value={<span className="mono">{docCount}</span>}
            sub="canlı uç nokta"
            tone="cyan"
            icon={<FileJson size={16} />}
          />
          <HoloStat
            label="Filo bağlantıları"
            value={<span className="mono">{linkCount}</span>}
            sub="modül"
            tone="violet"
            icon={<LayoutGrid size={16} />}
          />
          <HoloStat
            label="SSS rehberleri"
            value={<span className="mono">{guides.length}</span>}
            sub="kayıt"
            tone="success"
            icon={<HelpCircle size={16} />}
          />
        </div>
      </Reveal>

      <Reveal delay={0.06}>
        <HoloPanel title="Hızlı başlangıç" icon={<Rocket size={16} />}>
          <div className="holo-grid-3">
            {RESOURCES.map((r) => {
              const Icon = r.icon;
              return (
                <article className="holo-panel holo-tone-cyan" key={r.title}>
                  <span className="holo-corner holo-corner-tl" aria-hidden />
                  <span className="holo-corner holo-corner-tr" aria-hidden />
                  <span className="holo-corner holo-corner-bl" aria-hidden />
                  <span className="holo-corner holo-corner-br" aria-hidden />
                  <div className="holo-panel-body">
                    <div className="holo-stat-ico"><Icon size={18} /></div>
                    <strong style={{ display: 'block', marginTop: '10px' }}>{r.title}</strong>
                    <p className="helper" style={{ marginTop: '6px' }}>{r.desc}</p>
                    <a
                      className="btn-ghost btn-xs"
                      style={{ marginTop: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                      href={r.href}
                      {...(r.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                    >
                      {r.cta}
                      {r.external ? <ArrowUpRight size={13} /> : null}
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        </HoloPanel>
      </Reveal>

      <Reveal delay={0.12}>
        <HoloPanel title="Sıkça Sorulan Sorular" icon={<HelpCircle size={16} />}>
          {guides.length === 0 ? (
            <p className="helper">Henüz rehber yok.</p>
          ) : (
            <div className="holo-grid-2">
              {guides.map((g) => (
                <article className="holo-panel holo-tone-violet" key={g.id}>
                  <span className="holo-corner holo-corner-tl" aria-hidden />
                  <span className="holo-corner holo-corner-tr" aria-hidden />
                  <span className="holo-corner holo-corner-bl" aria-hidden />
                  <span className="holo-corner holo-corner-br" aria-hidden />
                  <div className="holo-panel-body">
                    <strong style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <BookOpen size={15} />
                      {g.question}
                    </strong>
                    <p className="helper" style={{ marginTop: '6px' }}>{g.answer}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </HoloPanel>
      </Reveal>
    </PageMotion>
  );
}
