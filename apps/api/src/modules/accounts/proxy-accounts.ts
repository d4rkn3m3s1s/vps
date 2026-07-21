// Country → thordata account selection, shared by every flow that attaches a
// country-matched proxy (provision, one-click WhatsApp register auto-proxy, …).
//
// TWO thordata accounts, picked by country: RESIDENTIAL (default: AL/BG/US) and
// MOBILE. TR's residential pool is dead, so TR numbers MUST exit through the mobile
// account or WhatsApp sees a country mismatch and blocks registration
// ("Login not available"). Keeping this in ONE place means the account chosen at
// provision time and the account re-applied when a WhatsApp number is entered can
// never disagree.
//
// Credentials come from env so they aren't baked into the repo; the username
// country suffix (-country-<cc>) is appended host-side by wd-proxy.sh.

// Residential account (default; AL/BG/US).
const PROXY_HOST = process.env.FLEET_PROXY_HOST || '';
const PROXY_PORT = Number(process.env.FLEET_PROXY_PORT || 5555);
const PROXY_USER = process.env.FLEET_PROXY_USER || '';
const PROXY_PASS = process.env.FLEET_PROXY_PASS || '';

// Mobile account (TR). Falls back to the residential creds if the mobile env vars
// aren't set, so an incomplete deployment degrades to the old behaviour rather than
// producing a proxy with empty credentials.
const PROXY_MOBILE_HOST = process.env.FLEET_PROXY_MOBILE_HOST || PROXY_HOST;
const PROXY_MOBILE_PORT = Number(process.env.FLEET_PROXY_MOBILE_PORT || 9999);
const PROXY_MOBILE_USER = process.env.FLEET_PROXY_MOBILE_USER || PROXY_USER;
const PROXY_MOBILE_PASS = process.env.FLEET_PROXY_MOBILE_PASS || PROXY_PASS;

// Countries that must use the mobile account (residential pool dead/unavailable).
const MOBILE_PROXY_COUNTRIES = new Set(
  (process.env.FLEET_PROXY_MOBILE_COUNTRIES || 'TR')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
);

export type ProxyCreds = {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** Which account was chosen — for logging/panel display. */
  account: 'mobile' | 'residential';
};

/** True when this country must route through the mobile account. */
export function isMobileProxyCountry(country: string): boolean {
  return MOBILE_PROXY_COUNTRIES.has(String(country || '').trim().toUpperCase());
}

// Pick the right thordata account for a country. Returns null when no proxy is
// configured at all (host/user empty) so the caller can skip proxy assignment.
export function proxyCredsFor(country: string): ProxyCreds | null {
  const cc = String(country || '').trim().toUpperCase();
  if (isMobileProxyCountry(cc)) {
    if (!PROXY_MOBILE_HOST || !PROXY_MOBILE_USER) return null;
    return {
      host: PROXY_MOBILE_HOST,
      port: PROXY_MOBILE_PORT,
      user: PROXY_MOBILE_USER,
      pass: PROXY_MOBILE_PASS,
      account: 'mobile'
    };
  }
  if (!PROXY_HOST || !PROXY_USER) return null;
  return {
    host: PROXY_HOST,
    port: PROXY_PORT,
    user: PROXY_USER,
    pass: PROXY_PASS,
    account: 'residential'
  };
}
