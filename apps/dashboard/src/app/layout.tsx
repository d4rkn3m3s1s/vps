import type { Metadata } from 'next';
import { Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '../components/Sidebar';
import { CommandPalette } from '../components/CommandPalette';
import { NotificationCenter } from '../components/NotificationCenter';
import { I18nProvider, LanguageSwitcher } from '../lib/i18n';
import { MobileMenuButton } from '../components/MobileMenuButton';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-sans' });
const ibmPlexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'VPS Fleet · Cloud Phones',
  description: 'Manage and control Android cloud phone fleets from a secure dashboard.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body className={`${spaceGrotesk.variable} ${ibmPlexMono.variable}`}>
        <I18nProvider>
          <div className="app-shell">
            <Sidebar />
            <div className="app-content">
              <div className="topbar">
                <MobileMenuButton />
                <span className="topbar-spacer" />
                <LanguageSwitcher />
                <NotificationCenter />
              </div>
              {children}
            </div>
          </div>
          <CommandPalette />
        </I18nProvider>
      </body>
    </html>
  );
}
