// Auto-proxy: pick the residential exit country from an account's phone number
// and route its device through a provider proxy BEFORE on-device registration.
//
// WhatsApp/Instagram flag registrations whose exit IP country ≠ the number's
// country ("Login not available for security reasons"), so a one-click register
// must silently attach a country-matched proxy. This maps the E.164 calling code
// to an ISO-2 country, finds a 'provider' proxy, and dispatches EMULATOR_SET_PROXY
// (the same path assignCountryProxy uses) so the agent's wd-proxy.sh builds the
// sticky -country-<CC> login.

import { prisma } from '../../db/prisma';
import { encryptString } from '../../lib/crypto';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';
import { proxyCredsFor } from './proxy-accounts';

// Longest-prefix E.164 calling-code → ISO-3166-1 alpha-2. Ordered so the matcher
// tries the longest codes first (e.g. 355 before 35, 1 last). Not exhaustive for
// NANP sub-regions (all +1 → US) but correct for country-level proxy routing.
const CC_TO_ISO: Record<string, string> = {
  '355': 'AL', '90': 'TR', '49': 'DE', '44': 'GB', '33': 'FR', '39': 'IT',
  '34': 'ES', '31': 'NL', '351': 'PT', '30': 'GR', '359': 'BG', '40': 'RO',
  '48': 'PL', '380': 'UA', '7': 'RU', '46': 'SE', '47': 'NO', '45': 'DK',
  '358': 'FI', '43': 'AT', '41': 'CH', '32': 'BE', '353': 'IE', '1': 'US',
  '55': 'BR', '52': 'MX', '54': 'AR', '91': 'IN', '62': 'ID', '63': 'PH',
  '84': 'VN', '66': 'TH', '60': 'MY', '65': 'SG', '880': 'BD', '92': 'PK',
  '971': 'AE', '966': 'SA', '20': 'EG', '27': 'ZA', '234': 'NG', '61': 'AU',
  '64': 'NZ', '81': 'JP', '386': 'SI', '385': 'HR', '381': 'RS', '389': 'MK',
  '382': 'ME', '383': 'XK', '387': 'BA', '420': 'CZ', '421': 'SK', '36': 'HU',
  '370': 'LT', '371': 'LV', '372': 'EE'
};

// Resolve the ISO-2 country from an E.164 number (with or without '+').
export function countryFromPhone(phone: string): string | null {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  // Try 3-, 2-, then 1-digit calling codes (longest prefix wins).
  for (const len of [3, 2, 1]) {
    const cc = digits.slice(0, len);
    if (CC_TO_ISO[cc]) return CC_TO_ISO[cc];
  }
  return null;
}

// Route a device through a country-matched provider proxy for the given phone
// number. Best-effort: returns the chosen country (or null) and never throws so a
// missing provider/country can't block the register itself. Dispatches
// EMULATOR_SET_PROXY (agent wd-proxy.sh appends -country-<CC>).
export async function autoAttachCountryProxy(
  deviceId: string,
  instance: string,
  phoneNumber: string,
  workspaceId?: string
): Promise<{ country: string } | null> {
  const cc = countryFromPhone(phoneNumber);
  if (!cc) return null;
  return autoAttachCountryProxyByCountry(deviceId, instance, cc, workspaceId);
}

// Same as above but with an explicit ISO-2 country (for flows without a phone
// number, e.g. Instagram email signups where the country is on the account).
export async function autoAttachCountryProxyByCountry(
  deviceId: string,
  instance: string,
  countryCode: string,
  workspaceId?: string
): Promise<{ country: string } | null> {
  try {
    const cc = String(countryCode || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return null;

    // ★ ACCOUNT SELECTION BY COUNTRY. Prefer the env-configured thordata account for
    // this country (proxyCredsFor: TR → mobile 9999, others → residential 5555). This
    // is the SAME selection provision uses, so the account attached when a WhatsApp
    // number is entered is guaranteed to match the number's country — a TR number can
    // never land on the (dead) residential pool. Without this, this flow did a plain
    // `findFirst(... orderBy createdAt desc)` that returned whatever proxy was added
    // LAST regardless of country: enter a TR number right after an AL provision and it
    // would route TR through the AL account → "Login not available".
    const creds = proxyCredsFor(cc);
    let host: string;
    let port: number;
    let username: string;
    let passwordEnc: string | undefined;
    if (creds) {
      host = creds.host;
      port = creds.port;
      username = creds.user;
      // proxyCredsFor returns the plaintext env password; encrypt it so the stored job
      // payload / GET /jobs/:id never expose it (agent decrypts at claim time).
      passwordEnc = creds.pass ? encryptString(creds.pass) : undefined;
    } else {
      // Fallback (no env proxy configured): accept BOTH provider groups. One-click
      // provision mirrors its country-matched exit as `group:'residential'`, manually
      // imported upstreams land as `group:'provider'`. Prefer a row whose countryCode
      // matches so we don't grab an unrelated country's proxy; fall back to the newest.
      // status:{not:'FAILED'} — never route through a proxy a health-check already
      // marked dead. Without it, if the newest matching row was FAILED (or an OK row
      // later flipped to FAILED), we'd send the register through a dead exit → the very
      // "Login not available"/ban this function exists to prevent. Prefer a country
      // match, then any healthy provider; newest first within each.
      const healthy = { status: { not: 'FAILED' as const } };
      const provider =
        (await prisma.proxy.findFirst({
          where: { group: { in: ['provider', 'residential'] }, countryCode: cc, ...healthy, ...(workspaceId ? { workspaceId } : {}) },
          orderBy: { createdAt: 'desc' }
        })) ??
        (await prisma.proxy.findFirst({
          where: { group: { in: ['provider', 'residential'] }, ...healthy, ...(workspaceId ? { workspaceId } : {}) },
          orderBy: { createdAt: 'desc' }
        }));
      if (!provider) {
        // ★A country WAS resolved (cc is valid) but NO healthy proxy exists for it and
        // no env account is configured. Returning null here makes the caller treat it as
        // "no proxy needed" and register on the raw datacenter IP → guaranteed country
        // mismatch/ban. We can't block from here (best-effort contract), but we make the
        // gap LOUD and durable: log it and stamp the device so the panel/operator can see
        // "no country proxy — datacenter IP" instead of a silent burn.
        console.warn(`[auto-proxy] ${cc} için sağlıklı proxy YOK ve env hesap tanımsız — cihaz ${deviceId} datacenter IP'de kayıt olur (ban riski)`);
        const warnMeta = (await prisma.device
          .findUnique({ where: { id: deviceId }, select: { metadata: true } })
          .catch(() => null))?.metadata as Record<string, unknown> | null | undefined;
        await prisma.device
          .update({ where: { id: deviceId }, data: { metadata: { ...(warnMeta ?? {}), proxyWarning: `no-proxy-${cc}` } as never } })
          .catch(() => undefined);
        return null;
      }
      host = provider.host;
      port = provider.port;
      username = provider.username ?? '';
      // Already ciphertext in the DB — carry as-is.
      passwordEnc = provider.password ?? undefined;
    }

    await createJobRecord(
      'EMULATOR_SET_PROXY',
      {
        deviceId,
        instance,
        country: cc,
        host,
        port,
        username,
        // Carry the ciphertext (not plaintext): agent.service.materializePayload
        // decrypts passwordEnc at claim time, so the stored payload / GET /jobs/:id
        // never expose the proxy password. Matches proxy/bulk/provision SET_PROXY.
        ...(passwordEnc ? { passwordEnc } : {})
      } as unknown as JobPayload,
      deviceId,
      workspaceId
    );
    // Persist the chosen country on the device so the panel shows it. MERGE into
    // the existing metadata — a bare `{ proxyCountry: cc }` write would REPLACE the
    // whole JSON column and wipe the load-bearing `metadata.instance` (the Waydroid
    // instance name), which the proxy/register/sleep/wake flows all read. Losing it
    // mid one-click register breaks the very flow that called this. Spread first,
    // matching proxy.service.assignCountryProxy.
    const cur = (await prisma.device
      .findUnique({ where: { id: deviceId }, select: { metadata: true } })
      .catch(() => null))?.metadata as Record<string, unknown> | null | undefined;
    await prisma.device
      .update({ where: { id: deviceId }, data: { metadata: { ...(cur ?? {}), proxyCountry: cc } as never } })
      .catch(() => undefined);
    return { country: cc };
  } catch {
    return null;
  }
}
