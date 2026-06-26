'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'tr';

// Translation dictionary. Keys are dotted; English is the source of truth and
// the fallback when a Turkish value is missing.
const DICT: Record<string, { en: string; tr: string }> = {
  // Sidebar groups
  'group.primary': { en: 'Primary', tr: 'Birincil' },
  'group.discover': { en: 'Discover', tr: 'Keşfet' },
  'group.team': { en: 'Team', tr: 'Takım' },
  // Nav items
  'nav.profiles': { en: 'Profiles', tr: 'Profiller' },
  'nav.fingerprints': { en: 'Identities', tr: 'Kimlikler' },
  'nav.console': { en: 'Console', tr: 'Konsol' },
  'nav.groups': { en: 'Groups', tr: 'Gruplar' },
  'nav.distribute': { en: 'Distribute', tr: 'Dağıt' },
  'nav.proxies': { en: 'Proxies', tr: 'Proxyler' },
  'nav.library': { en: 'Library', tr: 'Kütüphane' },
  'nav.applications': { en: 'Applications', tr: 'Uygulamalar' },
  'nav.images': { en: 'Image market', tr: 'İmaj Pazarı' },
  'nav.calendar': { en: 'Content calendar', tr: 'İçerik Takvimi' },
  'nav.ai': { en: 'Fleet AI', tr: 'Fleet AI' },
  'nav.accounts': { en: 'Account creator', tr: 'Hesap Üretici' },
  'nav.overview': { en: 'Overview', tr: 'Genel Bakış' },
  'nav.analytics': { en: 'Analytics', tr: 'Analitik' },
  'nav.trends': { en: 'Trends', tr: 'Trendler' },
  'nav.costs': { en: 'Cost & profit', tr: 'Maliyet & Kâr' },
  'nav.health': { en: 'Fleet health', tr: 'Filo Sağlığı' },
  'nav.reports': { en: 'Reports', tr: 'Raporlar' },
  'nav.farm': { en: 'Farm', tr: 'Çiftlik' },
  'nav.automation': { en: 'Automation', tr: 'Otomasyon' },
  'nav.rpa': { en: 'RPA Studio', tr: 'RPA Stüdyo' },
  'nav.scheduler': { en: 'Scheduler', tr: 'Zamanlayıcı' },
  'nav.synchronizer': { en: 'Synchronizer', tr: 'Senkronizatör' },
  'nav.wall': { en: 'Live wall', tr: 'Canlı Duvar' },
  'nav.geehub': { en: 'FleetHub', tr: 'FleetHub' },
  'nav.resources': { en: 'Resources', tr: 'Kaynaklar' },
  'nav.referral': { en: 'Referral', tr: 'Davet' },
  'nav.hosts': { en: 'Hosts', tr: 'Sunucular' },
  'nav.alerts': { en: 'Alerts', tr: 'Uyarılar' },
  'nav.billing': { en: 'Billing', tr: 'Faturalama' },
  'nav.members': { en: 'Members', tr: 'Üyeler' },
  'nav.webhooks': { en: 'Webhooks', tr: 'Webhook’lar' },
  'nav.jobs': { en: 'Jobs', tr: 'Görevler' },
  'nav.audit': { en: 'Audit', tr: 'Denetim' },
  'nav.logs': { en: 'Logs', tr: 'Kayıtlar' },
  'nav.admin': { en: 'Admin', tr: 'Yönetim' },
  'nav.settings': { en: 'Settings', tr: 'Ayarlar' },
  // Common
  'common.search': { en: 'Quick search', tr: 'Hızlı arama' },
  'common.signout': { en: 'Sign out', tr: 'Çıkış yap' },
  'common.upgrade': { en: 'Upgrade', tr: 'Yükselt' },
  'common.profiles': { en: 'profiles', tr: 'profil' }
};

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (key: string) => string };

const I18nCtx = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (k) => k });

export function I18nProvider({ children }: { children: ReactNode }) {
  // The product ships Turkish-first; English is a fallback only.
  const [lang, setLangState] = useState<Lang>('tr');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('fleet.lang') as Lang | null;
      if (saved === 'en' || saved === 'tr') setLangState(saved);
    } catch {
      /* ignore */
    }
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    try {
      localStorage.setItem('fleet.lang', l);
    } catch {
      /* ignore */
    }
  }

  function t(key: string): string {
    const entry = DICT[key];
    if (!entry) return key;
    return entry[lang] ?? entry.en;
  }

  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>;
}

export function useI18n(): Ctx {
  return useContext(I18nCtx);
}

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-switch">
      <button type="button" className={lang === 'en' ? 'lang-active' : ''} onClick={() => setLang('en')}>
        EN
      </button>
      <button type="button" className={lang === 'tr' ? 'lang-active' : ''} onClick={() => setLang('tr')}>
        TR
      </button>
    </div>
  );
}
