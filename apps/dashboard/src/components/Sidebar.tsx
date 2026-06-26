'use client';

import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  LayoutGrid, Fingerprint, TerminalSquare, FolderTree, Upload, ArrowLeftRight,
  Library, AppWindow, Layers, Sparkles, Gauge, LineChart, HeartPulse, FileText,
  Sprout, Zap, Settings2, Clock, CalendarDays, Combine, MonitorSmartphone, Boxes,
  BookOpen, Gift, Server, Bell, CreditCard, Users, Webhook, ScrollText, ShieldCheck,
  Settings, UserPlus, TrendingUp, DollarSign
} from 'lucide-react';
import { useI18n, LanguageSwitcher } from '../lib/i18n';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

type NavItem = {
  href: string;
  tkey: string;
  icon: ComponentType<{ size?: number | string }>;
};

type NavGroup = {
  tkey: string;
  items: NavItem[];
};

const NAV: NavGroup[] = [
  {
    tkey: 'group.primary',
    items: [
      { href: '/profiles', tkey: 'nav.profiles', icon: LayoutGrid },
      { href: '/fingerprints', tkey: 'nav.fingerprints', icon: Fingerprint },
      { href: '/console', tkey: 'nav.console', icon: TerminalSquare },
      { href: '/groups', tkey: 'nav.groups', icon: FolderTree },
      { href: '/distribute', tkey: 'nav.distribute', icon: Upload },
      { href: '/proxies', tkey: 'nav.proxies', icon: ArrowLeftRight },
      { href: '/library', tkey: 'nav.library', icon: Library },
      { href: '/applications', tkey: 'nav.applications', icon: AppWindow },
      { href: '/images', tkey: 'nav.images', icon: Layers },
      { href: '/ai', tkey: 'nav.ai', icon: Sparkles },
      { href: '/accounts', tkey: 'nav.accounts', icon: UserPlus }
    ]
  },
  {
    tkey: 'group.discover',
    items: [
      { href: '/', tkey: 'nav.overview', icon: Gauge },
      { href: '/analytics', tkey: 'nav.analytics', icon: LineChart },
      { href: '/trends', tkey: 'nav.trends', icon: TrendingUp },
      { href: '/costs', tkey: 'nav.costs', icon: DollarSign },
      { href: '/health', tkey: 'nav.health', icon: HeartPulse },
      { href: '/reports', tkey: 'nav.reports', icon: FileText },
      { href: '/farm', tkey: 'nav.farm', icon: Sprout },
      { href: '/automation', tkey: 'nav.automation', icon: Zap },
      { href: '/rpa', tkey: 'nav.rpa', icon: Settings2 },
      { href: '/scheduler', tkey: 'nav.scheduler', icon: Clock },
      { href: '/calendar', tkey: 'nav.calendar', icon: CalendarDays },
      { href: '/synchronizer', tkey: 'nav.synchronizer', icon: Combine },
      { href: '/wall', tkey: 'nav.wall', icon: MonitorSmartphone },
      { href: '/geehub', tkey: 'nav.geehub', icon: Boxes },
      { href: '/resources', tkey: 'nav.resources', icon: BookOpen },
      { href: '/referral', tkey: 'nav.referral', icon: Gift }
    ]
  },
  {
    tkey: 'group.team',
    items: [
      { href: '/hosts', tkey: 'nav.hosts', icon: Server },
      { href: '/alerts', tkey: 'nav.alerts', icon: Bell },
      { href: '/billing', tkey: 'nav.billing', icon: CreditCard },
      { href: '/members', tkey: 'nav.members', icon: Users },
      { href: '/webhooks', tkey: 'nav.webhooks', icon: Webhook },
      { href: '/logs', tkey: 'nav.logs', icon: ScrollText },
      { href: '/admin', tkey: 'nav.admin', icon: ShieldCheck },
      { href: '/settings', tkey: 'nav.settings', icon: Settings }
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
              const Icon = item.icon;
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
                    <Icon size={17} />
                  </span>
                  <span>{t(item.tkey)}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Plan/quota card is customer-facing chrome: show it ONLY for known
          non-admin roles. Admins (and self-hosted operators) are uncapped, and
          while the role is still loading (null) we hide it to avoid flashing a
          "Free / 2 phones" badge at an admin. */}
      {role && role !== 'admin' ? (
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

      <div className="sidebar-foot">
        <LanguageSwitcher />
        <button type="button" className="logout-btn" onClick={handleLogout}>
          ⎋ {t('common.signout')}
        </button>
      </div>
      </aside>
    </>
  );
}
