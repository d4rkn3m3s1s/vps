'use client';

import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  LayoutGrid, Fingerprint, TerminalSquare, FolderTree, Upload, ArrowLeftRight,
  AppWindow, Layers, Sparkles, Gauge, LineChart, HeartPulse, FileText,
  Sprout, Settings2, Clock, CalendarDays, Combine, MonitorSmartphone,
  BookOpen, Server, Bell, CreditCard, Users, Webhook, ScrollText, ShieldCheck,
  Settings, UserPlus, Bot, MessageCircle, Code2
} from 'lucide-react';
import { useI18n, LanguageSwitcher } from '../lib/i18n';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { BrandLogo } from './BrandLogo';

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
      { href: '/applications', tkey: 'nav.applications', icon: AppWindow },
      { href: '/images', tkey: 'nav.images', icon: Layers },
      { href: '/ai', tkey: 'nav.ai', icon: Sparkles },
      { href: '/ai-agent', tkey: 'nav.aiAgent', icon: Bot },
      { href: '/accounts', tkey: 'nav.accounts', icon: UserPlus },
      { href: '/whatsapp', tkey: 'nav.whatsapp', icon: MessageCircle }
    ]
  },
  {
    tkey: 'group.discover',
    items: [
      { href: '/', tkey: 'nav.overview', icon: Gauge },
      { href: '/analytics', tkey: 'nav.analytics', icon: LineChart },
      { href: '/health', tkey: 'nav.health', icon: HeartPulse },
      { href: '/reports', tkey: 'nav.reports', icon: FileText },
      { href: '/farm', tkey: 'nav.farm', icon: Sprout },
      { href: '/rpa', tkey: 'nav.rpa', icon: Settings2 },
      { href: '/scheduler', tkey: 'nav.scheduler', icon: Clock },
      { href: '/calendar', tkey: 'nav.calendar', icon: CalendarDays },
      { href: '/synchronizer', tkey: 'nav.synchronizer', icon: Combine },
      { href: '/wall', tkey: 'nav.wall', icon: MonitorSmartphone },
      { href: '/resources', tkey: 'nav.resources', icon: BookOpen }
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
      { href: '/api-docs', tkey: 'nav.apiDocs', icon: Code2 },
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
        <span className="brand-mark brand-mark-svg"><BrandLogo size={38} /></span>
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
