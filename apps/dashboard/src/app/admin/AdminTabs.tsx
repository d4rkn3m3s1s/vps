'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings, Users, Server, CreditCard, KeyRound, ShieldCheck, Cpu } from 'lucide-react';

const TABS = [
  { href: '/admin', label: 'General', icon: Settings, exact: true },
  { href: '/admin/members', label: 'Members & roles', icon: Users, exact: false },
  { href: '/admin/permissions', label: 'Permissions', icon: ShieldCheck, exact: false },
  { href: '/admin/api-keys', label: 'API keys', icon: KeyRound, exact: false },
  { href: '/admin/servers', label: 'GPU servers (Vast.ai)', icon: Cpu, exact: false },
  { href: '/admin/system', label: 'System & infra', icon: Server, exact: false },
  { href: '/admin/billing', label: 'Billing & quota', icon: CreditCard, exact: false }
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="admin-tabs">
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        const Icon = tab.icon;
        return (
          <Link key={tab.href} href={tab.href} className={`admin-tab${active ? ' admin-tab-active' : ''}`}>
            <Icon size={15} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
