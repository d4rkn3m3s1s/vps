'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { CommandPalette } from './CommandPalette';
import { NotificationCenter } from './NotificationCenter';
import { MobileMenuButton } from './MobileMenuButton';
import { LiveIndicator } from './LiveIndicator';

/**
 * AppChrome — decides whether a route gets the dashboard shell (fixed sidebar +
 * topbar + command palette) or renders full-bleed with no chrome.
 *
 * Public, marketing-style routes (the landing + login) must NOT show the operator
 * sidebar — otherwise the landing page renders *inside* the dashboard rail (the
 * "landing + dashboard mixed together" bug). Everything else is an authenticated
 * dashboard page and gets the full shell.
 */
const BARE_ROUTES = ['/welcome', '/login'];

export function AppChrome({
  activeWorkspaceId,
  children
}: {
  activeWorkspaceId?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || '/';
  const isBare = BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));

  if (isBare) {
    // Full-screen public route — no sidebar, no topbar, no command palette.
    return <>{children}</>;
  }

  return (
    <>
      <div className="app-shell">
        <Sidebar activeWorkspaceId={activeWorkspaceId} />
        <div className="app-content">
          <div className="topbar">
            <MobileMenuButton />
            <span className="topbar-spacer" />
            <LiveIndicator />
            <NotificationCenter />
          </div>
          {children}
        </div>
      </div>
      <CommandPalette />
    </>
  );
}
