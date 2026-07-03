import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from './errors';

// SSRF guard for user-supplied URLs that the HOST AGENT later fetches
// server-side (e.g. calendar mediaUrl / files push → EMULATOR_PUSH_FILE →
// agent download()). Without this, a workspace member can point a media URL at
// internal services or cloud metadata (169.254.169.254) and have the host fetch
// it. We validate at the API boundary (job-creation time) so the agent stays
// dependency-free.

// Block: loopback, RFC1918 private, link-local (incl. cloud metadata
// 169.254.169.254), CGNAT, and unique-local IPv6.
function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const o = ip.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const a = o[0] ?? 0;
    const b = o[1] ?? 0;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
    if (lower.startsWith('::ffff:')) {
      // IPv4-mapped — re-check the embedded v4 address.
      const v4 = lower.slice(7);
      if (isIP(v4) === 4) return isBlockedIp(v4);
    }
    return false;
  }
  return true; // not a valid IP literal
}

// Validate a public URL: only http/https, hostname must NOT resolve to a
// private/loopback/link-local address. Throws AppError(400) when unsafe.
export async function assertSafePublicUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError('Geçersiz URL', 400, 'INVALID_URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('Yalnızca http/https URL kabul edilir', 400, 'INVALID_URL_SCHEME');
  }
  const host = url.hostname;

  // Literal IP in the host → check directly (also catches decimal/hex via isIP).
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new AppError('İç ağ adreslerine izin verilmez', 400, 'BLOCKED_URL');
    return;
  }

  // Block obvious localhost aliases before DNS.
  const lowerHost = host.toLowerCase();
  if (lowerHost === 'localhost' || lowerHost.endsWith('.localhost') || lowerHost.endsWith('.local')) {
    throw new AppError('İç ağ adreslerine izin verilmez', 400, 'BLOCKED_URL');
  }

  // Resolve the hostname and reject if ANY resolved address is blocked
  // (defends against DNS records that point at internal IPs).
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new AppError('URL adresi çözümlenemedi', 400, 'UNRESOLVABLE_URL');
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedIp(a.address))) {
    throw new AppError('İç ağ adreslerine izin verilmez', 400, 'BLOCKED_URL');
  }
}
