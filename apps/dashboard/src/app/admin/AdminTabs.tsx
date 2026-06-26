'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings, Users, Server, CreditCard, KeyRound, ShieldCheck, Cpu } from 'lucide-react';

const TABS = [
  { href: '/admin', label: 'Genel', icon: Settings, exact: true },
  { href: '/admin/members', label: 'Üyeler & roller', icon: Users, exact: false },
  { href: '/admin/permissions', label: 'İzinler', icon: ShieldCheck, exact: false },
  { href: '/admin/api-keys', label: 'API anahtarları', icon: KeyRound, exact: false },
  { href: '/admin/servers', label: 'GPU sunucuları (Vast.ai)', icon: Cpu, exact: false },
  { href: '/admin/system', label: 'Sistem & altyapı', icon: Server, exact: false },
  { href: '/admin/billing', label: 'Faturalama & kota', icon: CreditCard, exact: false }
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="admin-tabs" aria-label="Yönetim sekmeleri">
      {TABS.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`admin-tab${active ? ' admin-tab-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={15} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
