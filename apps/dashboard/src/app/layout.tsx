import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { AppChrome } from '../components/AppChrome';
import { I18nProvider } from '../lib/i18n';
import { LiveProvider } from '../lib/live';
import { Preloader } from '../components/Preloader';

// NOTE: We intentionally do NOT use next/font/google or external <link> font
// stylesheets. The dev server runs in WSL with no outbound internet, so Google
// Fonts (and onlinewebfonts) fail to load — which made the WHOLE dashboard fall
// back to Trebuchet/monospace and look "cheap/broken". --font-sans / --font-mono
// are defined in globals.css as a modern SYSTEM font stack that always renders,
// offline, with native quality. CSS that referenced 'Manrope'/'Inter' falls back
// to var(--font-sans) automatically.

export const metadata: Metadata = {
  title: 'VPS Fleet · Bulut Telefonlar',
  description: 'Android bulut telefon filolarınızı güvenli bir panelden yönetin ve kontrol edin.'
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const activeWorkspaceId = (await cookies()).get('fleet_workspace')?.value;
  return (
    <html lang="tr" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Preloader />
        <I18nProvider>
          <LiveProvider>
            <AppChrome {...(activeWorkspaceId ? { activeWorkspaceId } : {})}>
              {children}
            </AppChrome>
          </LiveProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
