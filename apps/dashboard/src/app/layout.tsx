import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { AppChrome } from '../components/AppChrome';
import { I18nProvider } from '../lib/i18n';
import { LiveProvider } from '../lib/live';
import { Preloader } from '../components/Preloader';

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-sans' });
const ibmPlexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'VPS Fleet · Bulut Telefonlar',
  description: 'Android bulut telefon filolarınızı güvenli bir panelden yönetin ve kontrol edin.'
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const activeWorkspaceId = (await cookies()).get('fleet_workspace')?.value;
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        {/* Hero fonts: PODIUM (display) + Inter (body/UI) used by the landing,
            login, and dashboard welcome strip. */}
        <link
          rel="stylesheet"
          href="https://db.onlinewebfonts.com/c/8b75d9dcff6a48c35a46656192adf019?family=FSP+DEMO+-+PODIUM+Sharp+4.11"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Manrope:wght@200;400;600;700;800&display=swap"
        />
      </head>
      <body className={`${spaceGrotesk.variable} ${ibmPlexMono.variable}`} suppressHydrationWarning>
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
