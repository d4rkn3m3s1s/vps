'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useI18n } from '../lib/i18n';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

type NavItem = {
  href: string;
  tkey: string;
  icon: string;
};

type NavGroup = {
  tkey: string;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    tkey: 'group.primary',
    items: [
      { href: '/profiles', tkey: 'nav.profiles', icon: '▦' },
      { href: '/fingerprints', tkey: 'nav.fingerprints', icon: '◉' },
      { href: '/console', tkey: 'nav.console', icon: '▸' },
      { href: '/groups', tkey: 'nav.groups', icon: '▣' },
      { href: '/proxies', tkey: 'nav.proxies', icon: '⇄' },
      { href: '/library', tkey: 'nav.library', icon: '◳' },
      { href: '/applications', tkey: 'nav.applications', icon: '▤' },
      { href: '/ai', tkey: 'nav.ai', icon: '✦' }
    ]
  },
  {
    tkey: 'group.discover',
    items: [
      { href: '/', tkey: 'nav.overview', icon: '◴' },
      { href: '/analytics', tkey: 'nav.analytics', icon: '∿' },
      { href: '/reports', tkey: 'nav.reports', icon: '▦' },
      { href: '/automation', tkey: 'nav.automation', icon: '⚡' },
      { href: '/rpa', tkey: 'nav.rpa', icon: '⚙' },
      { href: '/scheduler', tkey: 'nav.scheduler', icon: '⏱' },
      { href: '/synchronizer', tkey: 'nav.synchronizer', icon: '⧉' },
      { href: '/geehub', tkey: 'nav.geehub', icon: '◈' },
      { href: '/resources', tkey: 'nav.resources', icon: '❏' },
      { href: '/referral', tkey: 'nav.referral', icon: '$' }
    ]
  },
  {
    tkey: 'group.team',
    items: [
      { href: '/hosts', tkey: 'nav.hosts', icon: '🖥' },
      { href: '/alerts', tkey: 'nav.alerts', icon: '🔔' },
      { href: '/billing', tkey: 'nav.billing', icon: '▭' },
      { href: '/members', tkey: 'nav.members', icon: '☻' },
      { href: '/webhooks', tkey: 'nav.webhooks', icon: '⇲' },
      { href: '/logs', tkey: 'nav.logs', icon: '☰' },
      { href: '/admin', tkey: 'nav.admin', icon: '⛨' },
      { href: '/settings', tkey: 'nav.settings', icon: '⚙' }
    ]
  }
];

export function Sidebar({ activeWorkspaceId }: { activeWorkspaceId?: string | undefined }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  // Look up the current user's role in the active workspace. The plan/quota card
  // is customer-facing chrome and must NOT show for admins.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json) return;
        const list: { id: string; role: string }[] = json.data ?? json ?? [];
        const active = list.find((w) => w.id === activeWorkspaceId) ?? list[0];
        setRole(active?.role ?? null);
      })
      .catch(() => {
        /* ignore — leave role null, card stays hidden until known */
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId]);

  // The topbar hamburger fires this event; the drawer also closes on navigation.
  useEffect(() => {
    function onToggle() {
      setMobileOpen((v) => !v);
    }
    window.addEventListener('fleet:toggle-sidebar', onToggle);
    return () => window.removeEventListener('fleet:toggle-sidebar', onToggle);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <>
      {mobileOpen ? <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} /> : null}
      <aside className={`app-sidebar${mobileOpen ? ' app-sidebar-open' : ''}`}>
      <div className="brand">
        <span className="brand-mark">V</span>
        <div className="brand-text">
          <strong>VPS Fleet</strong>
          <span className="brand-sub">Cloud Phones</span>
        </div>
      </div>

      <WorkspaceSwitcher activeId={activeWorkspaceId} />

      <button
        type="button"
        className="cmdk-hint"
        onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
      >
        <span>⌕ {t('common.search')}</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="nav">
        {NAV.map((group) => (
          <div className="nav-group" key={group.tkey}>
            <span className="nav-group-title">{t(group.tkey)}</span>
            {group.items.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} className={`nav-item${active ? ' nav-item-active' : ''}`}>
                  {active && (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="nav-active-pill"
                      transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                    />
                  )}
                  <span className="nav-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span>{t(item.tkey)}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {role !== 'admin' ? (
        <div className="plan-card">
          <div className="plan-head">
            <span className="plan-badge">Free</span>
            <span className="plan-quota">1 / 2 {t('common.profiles')}</span>
          </div>
          <Link href="/billing" className="plan-upgrade">
            {t('common.upgrade')}
          </Link>
        </div>
      ) : null}

      <button type="button" className="logout-btn" onClick={handleLogout}>
        ⎋ {t('common.signout')}
      </button>
      </aside>
    </>
  );
}
