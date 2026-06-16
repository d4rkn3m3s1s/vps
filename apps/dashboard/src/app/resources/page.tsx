import { PageHeader } from '../../components/PageHeader';
import { PageMotion } from '../../components/Motion';

export const metadata = { title: 'Resources · VPS Fleet' };
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
    title: 'API Reference (Swagger)',
    desc: 'Interactive OpenAPI explorer — try every endpoint live with your token.',
    href: `${API_PUBLIC_URL}/docs`,
    cta: 'Open Swagger UI',
    external: true
  },
  {
    icon: '◇',
    title: 'OpenAPI Spec',
    desc: 'Raw machine-readable schema for code generation and Postman import.',
    href: `${API_PUBLIC_URL}/docs.json`,
    cta: 'View spec',
    external: true
  },
  {
    icon: '▦',
    title: 'Create your first profile',
    desc: 'Spin up a cloud phone profile, assign a proxy and start automating.',
    href: '/profiles',
    cta: 'Go to Profiles'
  },
  {
    icon: '⇄',
    title: 'Connect a proxy',
    desc: 'Add SOCKS5/HTTP proxies and verify their exit IP before assigning.',
    href: '/proxies',
    cta: 'Manage proxies'
  },
  {
    icon: '✦',
    title: 'Automate with Fleet AI',
    desc: 'Ask the built-in Claude assistant to plan and script device tasks.',
    href: '/ai',
    cta: 'Open Fleet AI'
  },
  {
    icon: '☻',
    title: 'Invite your team',
    desc: 'Add members with roles and share access to the fleet.',
    href: '/members',
    cta: 'Manage members'
  }
];

const GUIDES = [
  { q: 'Why does “Start” keep a phone in PENDING?', a: 'Cloud phones run on a KVM-enabled host. Until you attach an Android host, jobs are recorded but not executed. See the server setup guide.' },
  { q: 'How do I add a proxy?', a: 'Go to Proxies → Add proxy. Enter host/port/credentials, then hit Check to confirm the exit IP.' },
  { q: 'Where are my API keys?', a: 'API keys are issued per user. Backend writes require a JWT exchanged from your API key automatically.' },
  { q: 'How does the Synchronizer work?', a: 'Select two or more phones, mark one as leader, and its inputs mirror to the followers in real time once the host is attached.' }
];

export default function ResourcesPage() {
  return (
    <PageMotion className="page">
      <PageHeader title="Resources" subtitle="Guides, API docs and tutorials." />

      <section>
        <h2 className="section-title">Quick start</h2>
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
        <h2 className="section-title">FAQ</h2>
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
