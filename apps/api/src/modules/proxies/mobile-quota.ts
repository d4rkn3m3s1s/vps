import { promises as fsp } from 'node:fs';
import { prisma } from '../../db/prisma';
import { logger } from '../../lib/logger';
import { alertsService } from '../alerts/alerts.service';
import { notificationsService } from '../notifications/notifications.service';

// ★2026-10-04 MOBİL PROXY KOTASI.
// NEDEN: 4 Eki 20:05 TSİ mobil trafik bitti → 154 cihaz 2+ saat internetsiz kaldı; kimse
// önceden bilmedi. Thordata API'si mobil paketin KALAN kotasını VERMİYOR (account/traffic-
// balance yalnız residential'ı döner; proxy_type parametresini yok sayar) ve kullanıcı başına
// `traffic_balance` alanı çalışan hesapta bile 0 gelir. Ama kullanıcının ÖMÜR BOYU kullanımını
// (`total_usage_traffic`, KB) ve günlük kullanımını veriyor. Kalan = paket − (şimdi − alım anı).
// Paket boyutu + alım anındaki toplam bir durum dosyasında tutulur (`/mobilpaket <GB>` ile
// sıfırlanır). Ayrıca yenilemede Thordata mobil kullanıcının ADINI DEĞİŞTİREBİLİYOR (4 Eki:
// AowfUs… → UGrVtx…, aynı geçmiş) — sistemdeki ad Thordata listesinde yoksa ANINDA uyarılır.
// Thordata'da mobil = proxy_type 3 (SDK'daki 5 değil; canlı doğrulandı).

const API = 'https://openapi.thordata.com/api';
const STATE_FILE = process.env.FLEET_MOBILE_PACKAGE_FILE || '/opt/fleet-agent/state/mobile-package.json';
const KB_PER_GB = 1048576;

type PackageState = { packageGb: number; baselineKb: number; setAt: string; username?: string };
export type MobileQuota = {
  ok: boolean;
  error?: string;
  configuredUser: string | null;
  thordataUsers: Array<{ username: string; active: boolean }>;
  userMismatch: boolean;
  activeUser: string | null;
  packageGb: number | null;
  usedGb: number | null;
  remainingGb: number | null;
  avgDailyGb: number | null;
  daysLeft: number | null;
  todayGb: number | null;
  lastDays: Array<{ date: string; gb: number }>;
  packageSetAt: string | null;
  checkedAt: string;
  stale?: boolean; // Thordata o an cevap vermedi → son başarılı okuma gösteriliyor
};

function creds(): { token: string; key: string } {
  return { token: process.env.FLEET_THORDATA_TOKEN || '', key: process.env.FLEET_THORDATA_KEY || '' };
}
function configuredUser(): string | null {
  const u = (process.env.FLEET_PROXY_MOBILE_USER || '').trim();
  return u ? u.replace(/^td-customer-/, '') : null;
}
async function tget<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const { token, key } = creds();
  if (!token) return null;
  const q = new URLSearchParams({ token, ...(key ? { key } : {}), ...params });
  // Thordata ardışık çağrıda 10011 "Frequent operations" döner (canlı: user-list'in hemen
  // ardından usage-statistics) → artan aralıkla (3 sn, 6 sn) iki kez daha dene.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API}${path}?${q.toString()}`, { signal: AbortSignal.timeout(12000) });
      const json = (await res.json()) as { code?: number; data?: T; msg?: string };
      if (json.code === 200) return (json.data ?? null) as T | null;
      if (json.code === 10011 && attempt < 2) { await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); continue; }
      logger.warn('thordata api', { path, code: json.code, msg: json.msg });
      return null;
    } catch {
      return null;
    }
  }
  return null;
}
async function readState(): Promise<PackageState | null> {
  try {
    const s = JSON.parse(await fsp.readFile(STATE_FILE, 'utf8')) as PackageState;
    return typeof s.packageGb === 'number' && typeof s.baselineKb === 'number' ? s : null;
  } catch {
    return null;
  }
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

let cache: { at: number; value: MobileQuota } | null = null;
let lastGood: MobileQuota | null = null;
// Aynı anda gelen sorgular (panel + Telegram + 30 dk kontrolü) Thordata'ya ayrı ayrı gidip
// 10011'e takılıyordu (canlı: 4 Eki 19:42, 4 sn arayla iki çağrı) → uçuştaki tek sorguyu paylaş.
let inflight: Promise<MobileQuota> | null = null;

// Thordata o an cevap vermezse "okunamadı" yerine son başarılı değeri (6 saate kadar) göster.
export async function getMobileQuota(force = false): Promise<MobileQuota> {
  if (inflight) return inflight;
  inflight = getMobileQuotaOnce(force).finally(() => { inflight = null; });
  return inflight;
}

async function getMobileQuotaOnce(force: boolean): Promise<MobileQuota> {
  const v = await readMobileQuota(force);
  if (v.ok && v.remainingGb !== null) { lastGood = v; return v; }
  if (!v.ok && lastGood && Date.now() - new Date(lastGood.checkedAt).getTime() < 6 * 3600 * 1000) {
    return { ...lastGood, stale: true, userMismatch: v.userMismatch || lastGood.userMismatch };
  }
  return v;
}

async function readMobileQuota(force = false): Promise<MobileQuota> {
  // Thordata sık sorguda 10011 döner → 10 dk önbellek.
  if (!force && cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.value;
  const base: MobileQuota = {
    ok: false, configuredUser: configuredUser(), thordataUsers: [], userMismatch: false, activeUser: null,
    packageGb: null, usedGb: null, remainingGb: null, avgDailyGb: null, daysLeft: null, todayGb: null,
    lastDays: [], packageSetAt: null, checkedAt: new Date().toISOString()
  };
  if (!creds().token) return { ...base, error: 'FLEET_THORDATA_TOKEN yok' };

  const list = await tget<{ list?: Array<{ username: string; status: boolean }> | null }>('/proxy-users/user-list', { proxy_type: '3' });
  if (!list) return { ...base, error: 'Thordata kullanıcı listesi okunamadı' };
  const users = (list.list ?? []).map((u) => ({ username: u.username, active: !!u.status }));
  const cfg = base.configuredUser;
  const mismatch = !!cfg && users.length > 0 && !users.some((u) => u.username === cfg);
  const active = cfg && users.some((u) => u.username === cfg) ? cfg : users.find((u) => u.active)?.username ?? null;
  const v: MobileQuota = { ...base, thordataUsers: users, userMismatch: mismatch, activeUser: active };
  if (!active) { cache = { at: Date.now(), value: { ...v, error: 'mobil kullanıcı yok' } }; return cache.value; }

  await new Promise((r) => setTimeout(r, 1200)); // ardışık çağrı 10011'e takılmasın
  const from = new Date(Date.now() - 7 * 86400000);
  const stats = await tget<{ total_usage_traffic?: number; data?: Array<{ date: string; usage_traffic: number }> }>(
    '/proxy-users/usage-statistics', { proxy_type: '3', username: active, from_date: ymd(from), to_date: ymd(new Date()) }
  );
  if (!stats) { cache = { at: Date.now(), value: { ...v, error: 'kullanım okunamadı' } }; return cache.value; }
  const days = (stats.data ?? []).map((d) => ({ date: d.date, gb: d.usage_traffic / KB_PER_GB }));
  const today = ymd(new Date());
  const full = days.filter((d) => d.date < today).slice(-3);
  const avg = full.length ? full.reduce((a, d) => a + d.gb, 0) / full.length : null;
  const total = Number(stats.total_usage_traffic ?? 0);
  const st = await readState();
  const used = st ? Math.max(0, (total - st.baselineKb) / KB_PER_GB) : null;
  const remaining = st && used !== null ? Math.max(0, st.packageGb - used) : null;
  cache = {
    at: Date.now(),
    value: {
      ...v, ok: true,
      packageGb: st?.packageGb ?? null,
      usedGb: used,
      remainingGb: remaining,
      avgDailyGb: avg,
      daysLeft: remaining !== null && avg && avg > 0.05 ? remaining / avg : null,
      todayGb: days.find((d) => d.date === today)?.gb ?? null,
      lastDays: days,
      packageSetAt: st?.setAt ?? null
    }
  };
  return cache.value;
}

// Yeni paket alındığında: sayacı sıfırla (taban = şu anki ömür boyu kullanım).
export async function setMobilePackage(packageGb: number): Promise<MobileQuota> {
  const q = await getMobileQuota(true);
  if (!q.activeUser) throw new Error(q.error || 'mobil kullanıcı bulunamadı');
  const stats = await tget<{ total_usage_traffic?: number }>('/proxy-users/usage-statistics', {
    proxy_type: '3', username: q.activeUser, from_date: ymd(new Date()), to_date: ymd(new Date())
  });
  if (!stats || typeof stats.total_usage_traffic !== 'number') throw new Error('Thordata kullanım verisi okunamadı (birkaç sn sonra tekrar deneyin)');
  const state: PackageState = { packageGb, baselineKb: stats.total_usage_traffic, setAt: new Date().toISOString(), username: q.activeUser };
  const tmp = `${STATE_FILE}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
  await fsp.rename(tmp, STATE_FILE);
  logger.info('mobile package set', state);
  cache = null;
  return getMobileQuota(true);
}

// 30 dk'da bir: az kaldıysa / kullanıcı adı değiştiyse uyar (her tür için 6 saatte bir).
const lastWarn = new Map<string, number>();
export async function checkMobileQuota(): Promise<void> {
  try {
    const q = await getMobileQuota(true);
    const ws = await prisma.workspace.findFirst({ select: { id: true } });
    if (!ws) return;
    const fire = (kind: string, title: string, detail: string, value?: number) => {
      if (Date.now() - (lastWarn.get(kind) ?? 0) < 6 * 3600 * 1000) return;
      lastWarn.set(kind, Date.now());
      logger.warn('mobile quota alert', { kind, title });
      void alertsService.evaluate(ws.id, 'PROXY_CREDIT_LOW', { title, detail, ...(value !== undefined ? { value } : {}) }).catch(() => undefined);
      void notificationsService.dispatch(ws.id, { title, detail }).catch(() => undefined);
    };
    if (q.userMismatch) {
      fire('mismatch', '🚨 Mobil proxy kullanıcısı DEĞİŞMİŞ',
        `Sistem "${q.configuredUser}" kullanıyor ama Thordata'daki mobil kullanıcı: ${q.thordataUsers.map((u) => u.username).join(', ') || '(yok)'}. Paket yenilemede kullanıcı adı/şifre değişmiş olabilir — cihazlar çıkış alamaz. Yeni bilgileri sisteme girin.`);
    }
    const lowGb = Number(process.env.FLEET_MOBILE_LOW_GB || 15);
    const lowDays = Number(process.env.FLEET_MOBILE_LOW_DAYS || 3);
    if (q.remainingGb !== null && (q.remainingGb < lowGb || (q.daysLeft !== null && q.daysLeft < lowDays))) {
      const left = q.daysLeft !== null ? ` (~${q.daysLeft.toFixed(1)} gün)` : '';
      fire('low', `⚠️ Mobil proxy kotası azaldı: ${q.remainingGb.toFixed(1)} GB${left}`,
        `Mobil pakette ${q.remainingGb.toFixed(1)} GB kaldı${left}; filo günde ~${(q.avgDailyGb ?? 0).toFixed(1)} GB harcıyor. Bitince TÜM cihazlar internetsiz kalır (4 Eki'de 2 saat kesinti). Thordata'dan mobil trafik yükleyin, sonra Telegram'da /mobilpaket <GB> yazın.`,
        q.remainingGb);
    }
  } catch (e) {
    logger.warn('mobile quota check failed', { error: e instanceof Error ? e.message : String(e) });
  }
}
