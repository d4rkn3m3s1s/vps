// ★2026-09-30 /saglik v2 — Telegram filo sağlık raporu.
//
// NEDEN YENİDEN YAZILDI: eski /saglik WhatsApp hesaplarını TÜM ZAMANLARDAN sayıyordu
// (479 hesap, "🔴 89 yasaklı · 🟠 9 çıkış") — bunların neredeyse tamamı çoktan SİLİNMİŞ
// cihazlara ait eski kayıtlardı; operatör 155 cihazlık filoyu 89 banlı sanıyordu.
// Ayrıca proxy/kota, internet çıkışı, bekçi turu, mesaj başarısı gibi asıl sorulan
// bilgiler hiç yoktu. Bu sürüm yalnızca YAŞAYAN filoyu sayar ve tek ekranda özetler.
//
// Veri kaynakları (hepsi best-effort — biri düşerse o bölüm "?" gösterir, rapor düşmez):
//   • DB: cihazlar, WA hesapları (yalnız yaşayan cihazlarınki), son 24s işler/mesajlar
//   • /opt/fleet-agent/state/saglik.out: bekçinin cihaz başına çıkış taraması
//   • /var/log/wd-health-watch.log: bekçinin son tur özeti (TAMAM satırı)
//   • /etc/fleet-proxy.env + /etc/redsocks-inst-*.conf: hangi cihaz hangi proxy hesabında
//   • openapi.thordata.com: kalan kota + günlük kullanım (15 dk önbellek — sık istek limiti)
//   • /proc: yük, RAM, swap; statfs: disk
import { readFile, readdir, stat, statfs } from 'node:fs/promises';
import { networkInterfaces, cpus } from 'node:os';
import { prisma } from '../../db/prisma';
import { fleetHealthService } from '../fleet-health/fleet-health.service';

const GB_KB = 1048576; // thordata usage-statistics birimi KB

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtAge(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'az önce';
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} sa ${m % 60} dk önce` : `${Math.floor(h / 24)} gün önce`;
}
function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n * 100) / d) : 0;
}
// Görsel ilerleme çubuğu: ▰▰▰▰▰▰▱▱▱▱ (10 hücre, sabit genişlik için <code> içinde).
function bar(p: number | null, width = 10): string {
  if (p === null || !Number.isFinite(p)) return `<code>${'▱'.repeat(width)}</code>`;
  const n = Math.max(0, Math.min(width, Math.round((p / 100) * width)));
  return `<code>${'▰'.repeat(n)}${'▱'.repeat(width - n)}</code>`;
}
// Doluluk (kötü = yüksek) ve sağlık (iyi = yüksek) için renk noktası.
const fillDot = (p: number | null, warn: number, crit: number) => (p === null ? '⚪️' : p >= crit ? '🔴' : p >= warn ? '🟡' : '🟢');
const goodDot = (p: number | null, warn: number, crit: number) => (p === null ? '⚪️' : p <= crit ? '🔴' : p <= warn ? '🟡' : '🟢');

// ── yardımcı okumalar ────────────────────────────────────────────────────────
async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null);
}

async function tailFile(path: string, bytes = 96 * 1024): Promise<string> {
  const buf = await readFile(path).catch(() => null);
  if (!buf) return '';
  return buf.subarray(Math.max(0, buf.length - bytes)).toString('utf8');
}

function publicIPv4s(): Set<string> {
  const out = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
      out.add(a.address);
    }
  }
  return out;
}

async function envValue(key: string): Promise<string | null> {
  const t = await readText('/etc/fleet-proxy.env');
  const m = t?.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m?.[1]?.trim() || null;
}

// ── thordata kota (15 dk önbellek) ───────────────────────────────────────────
type Quota = { balanceGb: number; expiration: string; yesterdayGb: number | null; avg3Gb: number | null; days: Array<{ date: string; gb: number }> };
let quotaCache: { at: number; value: Quota | null } | null = null;

async function thordataQuota(): Promise<Quota | null> {
  if (quotaCache && Date.now() - quotaCache.at < 15 * 60 * 1000) return quotaCache.value;
  const token = process.env.FLEET_THORDATA_TOKEN || '';
  let value: Quota | null = null;
  if (token) {
    try {
      const today = new Date();
      const from = new Date(today.getTime() - 8 * 86400000).toISOString().slice(0, 10);
      const to = today.toISOString().slice(0, 10);
      const [balRes, useRes] = await Promise.all([
        fetch(`https://openapi.thordata.com/api/account/traffic-balance?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(12000) }),
        fetch(`https://openapi.thordata.com/api/account/usage-statistics?token=${encodeURIComponent(token)}&from_date=${from}&to_date=${to}`, { signal: AbortSignal.timeout(12000) })
      ]);
      const bal = (await balRes.json()) as { code?: number; data?: { traffic_balance?: number; expiration_time?: string } };
      const use = (await useRes.json().catch(() => ({}))) as { code?: number; data?: { data?: Array<{ date: string; usage_traffic: number }> } };
      if (bal.code === 200 && typeof bal.data?.traffic_balance === 'number') {
        const rows = use.code === 200 ? (use.data?.data ?? []) : [];
        // Bugünün yarım günü hariç son tam günler.
        const full = rows.filter((r) => r.date < to);
        const last = full[full.length - 1];
        const last3 = full.slice(-3);
        value = {
          balanceGb: bal.data.traffic_balance / 1024, // traffic-balance ucu MB döner
          expiration: String(bal.data.expiration_time ?? '?'),
          yesterdayGb: last ? last.usage_traffic / GB_KB : null,
          avg3Gb: last3.length ? last3.reduce((a, r) => a + r.usage_traffic, 0) / last3.length / GB_KB : null,
          days: rows.map((r) => ({ date: r.date, gb: r.usage_traffic / GB_KB }))
        };
      }
    } catch {
      value = null;
    }
  }
  quotaCache = { at: Date.now(), value };
  return value;
}

// ── proxy hesap dağılımı (config'ten) ────────────────────────────────────────
// Cihaz başına: hangi paket (port'tan) + hangi ülke (login'deki -country-XX).
// Şifre/login'in KENDİSİ asla dışarı çıkmaz — yalnız sınıflandırma.
type ProxyConf = { kind: 'mobil' | 'residential' | 'diğer'; cc: string };
async function proxyConfigs(): Promise<Map<string, ProxyConf> | null> {
  try {
    const mport = (await envValue('FLEET_PROXY_MOBILE_PORT')) ?? '5555';
    const rport = (await envValue('FLEET_PROXY_PORT')) ?? '9999';
    const files = (await readdir('/etc')).filter((f) => /^redsocks-inst-.+\.conf$/.test(f));
    const out = new Map<string, ProxyConf>();
    for (const f of files) {
      const t = (await readText(`/etc/${f}`)) ?? '';
      const port = t.match(/^\s*port = (\d+);/m)?.[1];
      const cc = (t.match(/-country-([a-z]{2})/i)?.[1] ?? '??').toUpperCase();
      out.set(f.replace(/^redsocks-inst-|\.conf$/g, ''), { kind: port === mport ? 'mobil' : port === rport ? 'residential' : 'diğer', cc });
    }
    return out;
  } catch {
    return null;
  }
}
async function proxySplit(): Promise<{ mobile: number; residential: number; other: number } | null> {
  const confs = await proxyConfigs();
  if (!confs) return null;
  let mobile = 0, residential = 0, other = 0;
  for (const c of confs.values()) {
    if (c.kind === 'mobil') mobile++;
    else if (c.kind === 'residential') residential++;
    else other++;
  }
  return { mobile, residential, other };
}

// ── bekçi (wd-health-watch) ──────────────────────────────────────────────────
type Watch = { at: Date; healthy: number; leak: number; unreachable: number; deadExit: number } | null;
async function lastWatchRun(): Promise<Watch> {
  const tail = await tailFile('/var/log/wd-health-watch.log');
  const lines = tail.split('\n').filter((l) => l.includes('TAMAM:'));
  const l = lines[lines.length - 1];
  if (!l) return null;
  const m = l.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) TAMAM: (\d+) sağlıklı, (\d+) sızıntı-düzeltildi, \d+ reconnect, (\d+) erişilemez, (\d+) çıkış-ölü/);
  if (!m) return null;
  // Log satırı sunucunun yerel saatinde (UTC).
  return { at: new Date(`${m[1]!.replace(' ', 'T')}Z`), healthy: +m[2]!, leak: +m[3]!, unreachable: +m[4]!, deadExit: +m[5]! };
}

// saglik.out: inst|ip|boot|adb|dns|cikisIP  (bekçinin ~2.5 dk'lık derin taraması)
async function deepScan(liveInstances: Set<string>): Promise<{ boot: number; adb: number; exit: number; leak: number; scanned: number; ageMs: number } | null> {
  const path = '/opt/fleet-agent/state/saglik.out';
  const [text, st] = await Promise.all([readText(path), stat(path).catch(() => null)]);
  if (!text || !st) return null;
  const host = publicIPv4s();
  let boot = 0, adb = 0, exit = 0, leak = 0, scanned = 0;
  for (const line of text.split('\n')) {
    const [inst, , b, a, , ip] = line.split('|');
    if (!inst || !liveInstances.has(inst)) continue;
    scanned++;
    if (b === '1') boot++;
    if (a === 'device') adb++;
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
      exit++;
      if (host.has(ip)) leak++;
    }
  }
  return { boot, adb, exit, leak, scanned, ageMs: Date.now() - st.mtimeMs };
}

async function hostVitals(): Promise<{ load1: number | null; cores: number; ramFreeGb: number | null; ramTotalGb: number | null; swapUsedPct: number | null; diskFreeGb: number | null; diskUsedPct: number | null }> {
  const [loadavg, meminfo, fsst] = await Promise.all([
    readText('/proc/loadavg'),
    readText('/proc/meminfo'),
    statfs('/').catch(() => null)
  ]);
  const kb = (k: string): number | null => {
    const m = meminfo?.match(new RegExp(`^${k}:\\s+(\\d+) kB`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const avail = kb('MemAvailable');
  const swT = kb('SwapTotal');
  const swF = kb('SwapFree');
  const diskFreeGb = fsst ? (fsst.bavail * fsst.bsize) / 1073741824 : null;
  const diskUsedPct = fsst && fsst.blocks > 0 ? Math.round(((fsst.blocks - fsst.bfree) * 100) / fsst.blocks) : null;
  return {
    load1: loadavg ? Number(loadavg.split(' ')[0]) : null,
    cores: cpus().length,
    ramFreeGb: avail !== null ? avail / 1048576 : null,
    ramTotalGb: kb('MemTotal') !== null ? kb('MemTotal')! / 1048576 : null,
    swapUsedPct: swT && swF !== null && swT > 0 ? Math.round(((swT - swF) * 100) / swT) : null,
    diskFreeGb,
    diskUsedPct
  };
}

// ── rapor ────────────────────────────────────────────────────────────────────
const ACC_RANK: Record<string, number> = { ACTIVE: 4, RESTRICTED: 3, LOGGED_OUT: 2, BANNED: 1 };

export async function renderFleetHealthV2(workspaceId: string): Promise<string> {
  const since24 = new Date(Date.now() - 24 * 3600 * 1000);
  const wsFilter = workspaceId ? { workspaceId } : {};

  const [base, devices, watch, split, quota, vitals] = await Promise.all([
    fleetHealthService.health(workspaceId).catch(() => null),
    prisma.device.findMany({ where: { ...wsFilter, metadata: { path: ['instance'], not: null } as never }, select: { id: true, name: true, status: true, metadata: true } }),
    lastWatchRun().catch(() => null),
    proxySplit(),
    thordataQuota(),
    hostVitals()
  ]);

  const live = devices;
  const liveIds = live.map((d) => d.id);
  const liveInst = new Set(live.map((d) => String((d.metadata as { instance?: string } | null)?.instance ?? '')).filter(Boolean));

  const [accounts, sends, msgIn, msgOut, bans24, scan] = await Promise.all([
    prisma.generatedAccount.findMany({
      where: { platform: 'whatsapp', deviceId: { in: liveIds }, status: { in: ['ACTIVE', 'RESTRICTED', 'LOGGED_OUT', 'BANNED'] } },
      select: { deviceId: true, status: true }
    }),
    sendStats(workspaceId, since24),
    prisma.whatsappMessage.count({ where: { ...wsFilter, direction: 'IN', createdAt: { gte: since24 } } }),
    prisma.whatsappMessage.count({ where: { ...wsFilter, direction: 'OUT', createdAt: { gte: since24 } } }),
    // GERÇEK yeni ban: yalnız YAŞAYAN cihazların hesapları (silinen cihaz kayıtları hariç).
    prisma.generatedAccount.count({ where: { platform: 'whatsapp', status: 'BANNED', deviceId: { in: liveIds }, updatedAt: { gte: since24 } } }),
    deepScan(liveInst)
  ]);

  // Cihaz başına EN İYİ hesap durumu (aynı cihazda eski LOGGED_OUT + yeni ACTIVE olabilir).
  const best = new Map<string, string>();
  for (const a of accounts) {
    if (!a.deviceId) continue;
    const cur = best.get(a.deviceId);
    if (!cur || (ACC_RANK[a.status] ?? 0) > (ACC_RANK[cur] ?? 0)) best.set(a.deviceId, a.status);
  }
  const wa = { ACTIVE: 0, RESTRICTED: 0, LOGGED_OUT: 0, BANNED: 0 } as Record<string, number>;
  for (const s of best.values()) wa[s] = (wa[s] ?? 0) + 1;
  const noAccount = live.length - best.size;

  const sendFail = sends.fail;
  const median = sends.medianSec;

  const online = live.filter((d) => d.status === 'ONLINE').length;
  const offline = live.length - online;

  // ── uyarılar ──
  const warn: string[] = [];
  const crit: string[] = [];
  if (offline > 0) (offline >= 5 ? crit : warn).push(`${offline} cihaz çevrimdışı → /cihazlar`);
  if (scan && scan.scanned > 0) {
    const noExit = scan.scanned - scan.exit;
    if (noExit > 0) (pct(noExit, scan.scanned) >= 20 ? crit : warn).push(`${noExit} cihazın internet çıkışı yok → /proxy`);
    if (scan.leak > 0) crit.push(`${scan.leak} cihaz SUNUCU IP'siyle çıkıyor (sızıntı!) → /proxy`);
    if (scan.ageMs > 15 * 60000) warn.push(`derin tarama bayat (${fmtAge(scan.ageMs)})`);
  }
  if (!watch) warn.push('bekçi turu okunamadı');
  else if (Date.now() - watch.at.getTime() > 25 * 60000) crit.push(`bekçi ${fmtAge(Date.now() - watch.at.getTime())} tur atmadı (durdu mu?)`);
  if (quota) {
    const daysLeftExp = Math.ceil((new Date(`${quota.expiration}T23:59:59Z`).getTime() - Date.now()) / 86400000);
    const rate = quota.avg3Gb ?? quota.yesterdayGb;
    const daysByGb = rate && rate > 0.3 ? quota.balanceGb / rate : null;
    if (daysLeftExp <= 3) crit.push(`proxy paketi ${daysLeftExp} gün içinde bitiyor (${quota.expiration})`);
    if (daysByGb !== null && daysByGb < 3) crit.push(`proxy kotası ~${daysByGb.toFixed(1)} günde biter`);
  }
  if (split && split.mobile + split.residential > 0 && pct(Math.max(split.mobile, split.residential), split.mobile + split.residential) >= 95) {
    warn.push('filonun tamamı TEK proxy hesabında — o hesap düşerse filo çıkışsız kalır');
  }
  if (bans24 >= 3) crit.push(`son 24 saatte ${bans24} yeni ban → /banlar`);
  else if (bans24 > 0) warn.push(`son 24 saatte ${bans24} yeni ban → /banlar`);
  if (sends.total >= 20 && pct(sendFail, sends.total) >= 15) {
    const top = sends.reasons[0];
    (pct(sendFail, sends.total) >= 35 ? crit : warn).push(`gitmeyen gönderim: %${pct(sendFail, sends.total)}${top ? ` (en çok: ${reasonLabel(top[0])})` : ''}${sends.peakFail && sends.peakFail.n >= sendFail * 0.3 ? ` · yoğunluk ${sends.peakFail.hour}` : ''}`);
  }
  if (sends.lastHourFail >= 10) crit.push(`son 1 saatte ${sends.lastHourFail} gönderim başarısız — şu an sürüyor`);
  if (vitals.ramFreeGb !== null && vitals.ramFreeGb < 20) crit.push(`boş RAM düşük: ${vitals.ramFreeGb.toFixed(0)} GB`);
  if (vitals.diskUsedPct !== null && vitals.diskUsedPct >= 85) warn.push(`disk %${vitals.diskUsedPct} dolu`);

  const head = crit.length ? '🔴 <b>SORUN VAR</b>' : warn.length ? '🟡 <b>DİKKAT</b>' : '🟢 <b>SAĞLIKLI</b>';
  const now = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

  const L: string[] = [];
  L.push(`<b>🩺 Filo Sağlığı</b> — ${head}`);
  L.push(`<i>${esc(now)} · yalnız yaşayan filo</i>`);

  if (crit.length || warn.length) {
    L.push('');
    for (const c of crit) L.push(`🔴 ${esc(c)}`);
    for (const w of warn) L.push(`🟡 ${esc(w)}`);
  }

  // Cihazlar
  L.push('', '<b>📱 Cihazlar</b>');
  const onPct = pct(online, live.length);
  L.push(`${goodDot(onPct, 97, 80)} Açık    ${bar(onPct)} <b>${online}</b>/${live.length}${offline ? ` · ⚪️ ${offline} kapalı` : ''}`);
  if (scan) {
    const exPct = pct(scan.exit, scan.scanned);
    L.push(`${goodDot(exPct, 97, 80)} İnternet ${bar(exPct)} <b>${scan.exit}</b>/${scan.scanned}`);
    L.push(`${scan.leak ? '🔴' : '🛡'} Sızıntı <b>${scan.leak}</b> · Android ${scan.boot} · ADB ${scan.adb} · tarama ${fmtAge(scan.ageMs)}`);
  }

  // WhatsApp
  L.push('', '<b>💬 WhatsApp</b> <i>(yaşayan cihazlar)</i>');
  const waPct = pct(wa.ACTIVE ?? 0, live.length);
  L.push(`${goodDot(waPct, 90, 70)} Aktif   ${bar(waPct)} <b>${wa.ACTIVE}</b>/${live.length}`);
  const waBad = [wa.RESTRICTED ? `🟡 ${wa.RESTRICTED} kısıtlı` : '', wa.LOGGED_OUT ? `🟠 ${wa.LOGGED_OUT} çıkış` : '', wa.BANNED ? `⛔️ ${wa.BANNED} banlı` : '', noAccount ? `🔘 ${noAccount} hesapsız` : ''].filter(Boolean);
  if (waBad.length) L.push(`   ${waBad.join(' · ')}`);
  L.push(`${bans24 ? '🔴' : '🟢'} Son 24 saat yeni ban: <b>${bans24}</b>`);

  // Mesaj
  L.push('', '<b>✉️ Mesajlar</b> <i>(24 saat)</i>');
  if (sends.total) {
    const okPct = pct(sends.ok, sends.total);
    L.push(`${goodDot(okPct, 90, 75)} Teslim  ${bar(okPct)} <b>${sends.ok}</b>/${sends.total} <i>(%${sends.rate})</i>`);
    if (sends.reasons.length) {
      L.push(`   Gitmeyen: ${sends.reasons.slice(0, 3).map(([c, n]) => `${esc(reasonLabel(c))} <b>${n}</b>`).join(' · ')}`);
      if (sends.peakFail && sends.peakFail.n >= 5) L.push(`   <i>En kötü saat: ${esc(sends.peakFail.hour)} (${sends.peakFail.n} başarısız) · son 1 saat: ${sends.lastHourFail}</i>`);
    }
  } else {
    L.push('⚪️ Gönderim yok');
  }
  L.push(`   Giden ${msgOut} · Gelen ${msgIn}${median !== null ? ` · medyan ${Math.round(median)} sn` : ''}`);

  // Proxy
  L.push('', '<b>🌐 Proxy</b>');
  if (split) L.push(`📡 Mobil <b>${split.mobile}</b> · Residential <b>${split.residential}</b>${split.other ? ` · diğer ${split.other}` : ''}`);
  if (quota) {
    const rate = quota.avg3Gb ?? quota.yesterdayGb;
    const daysByGb = rate && rate > 0.3 ? quota.balanceGb / rate : null;
    const daysLeftExp = Math.ceil((new Date(`${quota.expiration}T23:59:59Z`).getTime() - Date.now()) / 86400000);
    const dot = quota.balanceGb < 10 || daysLeftExp <= 3 ? '🔴' : quota.balanceGb < 30 || daysLeftExp <= 7 ? '🟡' : '🟢';
    // Token'ın gösterdiği hesap residential ürünü; filo mobil pakette çalışıyorsa bu sayı
    // FİLONUN kotası DEĞİLDİR — aksi halde "25 gün yeter" gibi yanıltıcı bir güven verir.
    const fleetOnMobile = !!split && split.mobile > split.residential;
    L.push(`${dot} Residential kota: <b>${quota.balanceGb.toFixed(1)} GB</b> · bitiş ${esc(quota.expiration)} (${daysLeftExp} gün)`);
    if (rate !== null && !fleetOnMobile) L.push(`   Günlük ~${rate.toFixed(1)} GB${daysByGb !== null ? ` · bu hızla ~${daysByGb.toFixed(1)} gün yeter` : ''}`);
    if (fleetOnMobile) L.push('   ⚠️ <i>Filo MOBİL pakette — mobil kota bu token\'da görünmüyor, Thordata panelinden bakın (filo günde ~10 GB harcar)</i>');
  } else {
    L.push('⚪️ Kota okunamadı (token yok / Thordata cevap vermedi)');
  }

  // Sunucu
  L.push('', '<b>🖥 Sunucu</b>');
  const sat = vitals.load1 !== null && vitals.cores ? Math.round((vitals.load1 / vitals.cores) * 100) : null;
  L.push(`${fillDot(sat, 70, 90)} CPU     ${bar(sat)} %${sat ?? '?'} <i>(yük ${vitals.load1?.toFixed(1) ?? '?'}/${vitals.cores})</i>`);
  const ramUsedPct = vitals.ramFreeGb !== null && vitals.ramTotalGb ? Math.round(100 - (vitals.ramFreeGb * 100) / vitals.ramTotalGb) : null;
  L.push(`${fillDot(ramUsedPct, 85, 92)} RAM     ${bar(ramUsedPct)} ${vitals.ramFreeGb?.toFixed(0) ?? '?'} GB boş`);
  L.push(`${fillDot(vitals.diskUsedPct, 80, 90)} Disk    ${bar(vitals.diskUsedPct)} %${vitals.diskUsedPct ?? '?'} · ${vitals.diskFreeGb?.toFixed(0) ?? '?'} GB boş`);
  L.push(`${vitals.swapUsedPct !== null && vitals.swapUsedPct >= 95 && ramUsedPct !== null && ramUsedPct >= 85 ? '🔴' : '⚪️'} Swap    ${bar(vitals.swapUsedPct)} %${vitals.swapUsedPct ?? '?'} <i>(RAM boşken sorun değil)</i>`);
  if (watch) {
    const age = Date.now() - watch.at.getTime();
    L.push(`${age > 25 * 60000 ? '🔴' : '🟢'} Bekçi: son tur ${fmtAge(age)} · ${watch.healthy} sağlıklı${watch.deadExit ? ` · ${watch.deadExit} çıkış-ölü` : ''}${watch.unreachable ? ` · ${watch.unreachable} erişilemez` : ''}`);
  }
  if (base?.hosts?.some((h) => h.monitorStale)) L.push('🔴 Sunucu izleme sinyali bayat');

  return L.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// ★2026-09-30 GÖNDERİM İSTATİSTİĞİ — iş durumu COMPLETED ≠ "mesaj gitti".
// Agent işi her zaman COMPLETED bitirir; gerçek sonuç result.status'tadır
// (CANLI 24 saat: 712 işin 711'i COMPLETED ama yalnız 524'ü SENT → gerçek %74,
// eski ekran "%99,9" diyordu). Başarı yalnız SENT/OK/DELIVERED.
// ════════════════════════════════════════════════════════════════════════════
const SEND_OK = new Set(['SENT', 'OK', 'DELIVERED', 'READ']);
export const SEND_REASON_TR: Record<string, string> = {
  CONNECTION_FAILED: 'bağlantı kurulamadı',
  CHAT_NOT_OPENED: 'sohbet açılamadı',
  INVALID_RECIPIENT: 'numara WhatsApp\'ta yok',
  ACCOUNT_BANNED: 'hesap banlı',
  ACCOUNT_RESTRICTED: 'hesap kısıtlı',
  COMPOSE_FAILED: 'mesaj yazılamadı',
  NOT_REGISTERED: 'hesap kayıtlı değil',
  DEVICE_OFFLINE: 'cihaz kapalı',
  TIMEOUT: 'zaman aşımı',
  FAILED: 'iş çöktü'
};
export type SendStats = { total: number; ok: number; fail: number; rate: string; reasons: Array<[string, number]>; medianSec: number | null; lastHourFail: number; peakFail: { hour: string; n: number } | null };
export async function sendStats(workspaceId: string, since: Date): Promise<SendStats> {
  const wsFilter = workspaceId ? { workspaceId } : {};
  const jobs = await prisma.job.findMany({
    where: { ...wsFilter, type: 'WHATSAPP_SEND', createdAt: { gte: since }, status: { in: ['COMPLETED', 'FAILED'] } },
    select: { status: true, result: true, createdAt: true, startedAt: true, finishedAt: true, updatedAt: true },
    take: 20000
  });
  let ok = 0;
  let lastHourFail = 0;
  const hourAgo = Date.now() - 3600_000;
  const reasons = new Map<string, number>();
  const durs: number[] = [];
  const failByHour = new Map<string, number>();
  const hourKey = (d: Date) => d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit' }).replace(/\s+/g, ' ') + ':00';
  for (const j of jobs) {
    const st = String((j.result as { status?: unknown } | null)?.status ?? (j.status === 'FAILED' ? 'FAILED' : 'UNKNOWN')).toUpperCase();
    if (j.status === 'COMPLETED' && SEND_OK.has(st)) {
      ok++;
      if (j.startedAt) {
        const d = ((j.finishedAt ?? j.updatedAt).getTime() - j.startedAt.getTime()) / 1000;
        if (d >= 0 && d < 900) durs.push(d);
      }
    } else {
      reasons.set(st, (reasons.get(st) ?? 0) + 1);
      if (j.createdAt.getTime() >= hourAgo) lastHourFail++;
      const hk = hourKey(j.createdAt);
      failByHour.set(hk, (failByHour.get(hk) ?? 0) + 1);
    }
  }
  durs.sort((a, b) => a - b);
  const total = jobs.length;
  return {
    total,
    ok,
    fail: total - ok,
    rate: total ? ((ok * 100) / total).toFixed(1).replace('.', ',').replace(/,0$/, '') : '—',
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
    medianSec: durs.length ? durs[Math.floor(durs.length / 2)]! : null,
    lastHourFail,
    peakFail: [...failByHour.entries()].sort((a, b) => b[1] - a[1]).map(([hour, n]) => ({ hour, n }))[0] ?? null
  };
}
export function reasonLabel(code: string): string {
  return SEND_REASON_TR[code] ?? code.toLowerCase().replace(/_/g, ' ');
}

// ════════════════════════════════════════════════════════════════════════════
// ★2026-09-30 /durum · /cihazlar · /hesaplar · /banlar v2
// Hepsi aynı hatayı taşıyordu: TÜM ZAMANLARIN kayıtlarını sayıyorlardı (silinmiş
// cihazların hesapları, eski başarısız kayıt denemeleri). Artık ortak bir "yaşayan
// filo" görünümünden besleniyorlar; sorunlular üstte, görünüm tutarlı.
// ════════════════════════════════════════════════════════════════════════════

type LiveDevice = {
  id: string;
  name: string;
  inst: string;
  online: boolean;
  account: string | null; // cihazdaki EN İYİ WA hesap durumu (ACTIVE > RESTRICTED > LOGGED_OUT > BANNED)
  phone: string | null;
  exitIp: string | null;  // bekçi derin taraması (saglik.out); null = çıkış yok / taranmadı
  scanned: boolean;
};

async function collectLive(workspaceId: string): Promise<LiveDevice[]> {
  const wsFilter = workspaceId ? { workspaceId } : {};
  const devices = await prisma.device.findMany({
    where: { ...wsFilter, metadata: { path: ['instance'], not: null } as never },
    select: { id: true, name: true, status: true, metadata: true }
  });
  const accounts = await prisma.generatedAccount.findMany({
    where: { platform: 'whatsapp', deviceId: { in: devices.map((d) => d.id) }, status: { in: ['ACTIVE', 'RESTRICTED', 'LOGGED_OUT', 'BANNED'] } },
    select: { deviceId: true, status: true, phoneNumber: true }
  });
  const best = new Map<string, { status: string; phone: string | null }>();
  for (const a of accounts) {
    if (!a.deviceId) continue;
    const cur = best.get(a.deviceId);
    if (!cur || (ACC_RANK[a.status] ?? 0) > (ACC_RANK[cur.status] ?? 0)) best.set(a.deviceId, { status: a.status, phone: a.phoneNumber });
  }
  const scan = new Map<string, string | null>();
  const text = await readText('/opt/fleet-agent/state/saglik.out');
  for (const line of (text ?? '').split('\n')) {
    const [inst, , , , , ip] = line.split('|');
    if (inst) scan.set(inst, ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null);
  }
  return devices
    .map((d) => {
      const inst = String((d.metadata as { instance?: string } | null)?.instance ?? '');
      const b = best.get(d.id);
      return {
        id: d.id,
        name: d.name,
        inst,
        online: d.status === 'ONLINE',
        account: b?.status ?? null,
        phone: b?.phone ?? null,
        exitIp: scan.get(inst) ?? null,
        scanned: scan.has(inst)
      };
    })
    .sort((a, b) => Number(a.inst.replace(/\D/g, '')) - Number(b.inst.replace(/\D/g, '')));
}

// Bir cihazın tek bakışta durumu: kötü olan kazanır.
function deviceDot(d: LiveDevice): string {
  if (!d.online) return '⚪️';
  if (d.scanned && !d.exitIp) return '🔴';
  if (d.account === 'BANNED') return '⛔️';
  if (d.account === 'RESTRICTED' || d.account === 'LOGGED_OUT') return '🟡';
  if (!d.account) return '🔘';
  return '🟢';
}
function problemOf(d: LiveDevice): string | null {
  if (!d.online) return 'kapalı / çevrimdışı';
  if (d.scanned && !d.exitIp) return 'internet çıkışı yok';
  if (d.account === 'BANNED') return 'WhatsApp banlı';
  if (d.account === 'RESTRICTED') return 'WhatsApp kısıtlı';
  if (d.account === 'LOGGED_OUT') return 'WhatsApp oturumu kapalı';
  if (!d.account) return 'WhatsApp hesabı yok';
  return null;
}
const LEGEND = '🟢 sağlam · 🟡 kısıtlı/çıkış · ⛔️ banlı · 🔘 hesapsız · 🔴 internetsiz · ⚪️ kapalı';

// /durum — tek ekran, en kritik 5 sayı.
export async function renderStatusV2(workspaceId: string): Promise<string> {
  const wsFilter = workspaceId ? { workspaceId } : {};
  const since24 = new Date(Date.now() - 24 * 3600 * 1000);
  const [live, watch, sends, msgIn, unread] = await Promise.all([
    collectLive(workspaceId),
    lastWatchRun().catch(() => null),
    sendStats(workspaceId, since24),
    prisma.whatsappMessage.count({ where: { ...wsFilter, direction: 'IN', createdAt: { gte: since24 } } }),
    prisma.whatsappConversation.aggregate({ where: { ...wsFilter, archived: false, unreadCount: { gt: 0 } }, _sum: { unreadCount: true }, _count: { _all: true } }).catch(() => null)
  ]);
  const online = live.filter((d) => d.online).length;
  const scanned = live.filter((d) => d.scanned);
  const exit = scanned.filter((d) => d.exitIp).length;
  const active = live.filter((d) => d.account === 'ACTIVE').length;
  const problems = live.filter((d) => problemOf(d)).length;
  const { ok, total, rate } = sends;
  const watchAge = watch ? Date.now() - watch.at.getTime() : null;
  const bad = online < live.length || (scanned.length && exit < scanned.length) || (watchAge !== null && watchAge > 25 * 60000);
  const head = bad ? '🔴' : problems ? '🟡' : '🟢';
  return [
    `<b>📊 Durum</b> ${head}`,
    '',
    `📱 Cihaz <b>${online}</b>/${live.length} açık · 🌐 <b>${exit}</b>/${scanned.length} internette`,
    `💬 WhatsApp <b>${active}</b> aktif${problems ? ` · ⚠️ ${problems} sorunlu cihaz` : ''}`,
    `✉️ 24 saat: <b>${ok}</b>/${total} mesaj gitti (%${rate}) · ${msgIn} gelen`,
    `🔵 Okunmamış: <b>${unread?._sum.unreadCount ?? 0}</b> mesaj · ${unread?._count._all ?? 0} sohbet`,
    watch ? `🛡 Bekçi: ${fmtAge(watchAge ?? 0)} · ${watch.healthy} sağlıklı` : '🛡 Bekçi: okunamadı',
    '',
    '<i>Ayrıntı: /saglik · /cihazlar · /hesaplar · /banlar</i>'
  ].join('\n');
}

// /cihazlar — özet + sorunlular + kompakt tam liste.
export async function renderDevicesV2(workspaceId: string): Promise<string> {
  const live = await collectLive(workspaceId);
  if (!live.length) return 'Bu çalışma alanında cihaz yok.';
  const online = live.filter((d) => d.online).length;
  const bad = live.filter((d) => problemOf(d));
  const L: string[] = [`<b>📱 Cihazlar</b> — ${online}/${live.length} açık`, ''];
  if (bad.length) {
    L.push(`<b>⚠️ Sorunlu (${bad.length})</b>`);
    for (const d of bad.slice(0, 25)) {
      L.push(`${deviceDot(d)} <b>${esc(d.inst)}</b> ${esc(d.phone ?? d.name)} — ${problemOf(d)}`);
    }
    if (bad.length > 25) L.push(`… ve ${bad.length - 25} cihaz daha`);
    L.push('');
  } else {
    L.push('✅ Sorunlu cihaz yok', '');
  }
  L.push('<b>Tümü</b>');
  const cells = live.map((d) => `${deviceDot(d)}${d.inst}`);
  for (let i = 0; i < cells.length; i += 5) L.push(`<code>${cells.slice(i, i + 5).map((c) => c.padEnd(7)).join(' ')}</code>`);
  L.push('', `<i>${LEGEND}</i>`, '<i>Tek cihaz: /uyandir · /reboot · /sil &lt;cihaz&gt;</i>');
  return L.join('\n');
}

// /hesaplar — yaşayan filonun WA hesapları: dağılım + sorunlular.
export async function renderAccountsV2(workspaceId: string): Promise<string> {
  const live = await collectLive(workspaceId);
  const count = (s: string | null) => live.filter((d) => d.account === s).length;
  const act = count('ACTIVE'), res = count('RESTRICTED'), lo = count('LOGGED_OUT'), ban = count('BANNED'), none = count(null);
  const usable = live.length ? Math.round((act * 100) / live.length) : 0;
  const L: string[] = [
    `<b>💬 WhatsApp Hesapları</b> <i>(${live.length} yaşayan cihaz)</i>`,
    '',
    `✅ Aktif <b>${act}</b> · 🟡 Kısıtlı ${res} · 🟠 Çıkış ${lo} · ⛔️ Banlı ${ban} · 🔘 Hesapsız ${none}`,
    `📈 Kullanılabilir oran: <b>%${usable}</b>`
  ];
  const bad = live.filter((d) => d.account !== 'ACTIVE');
  if (bad.length) {
    L.push('', `<b>⚠️ Dikkat isteyenler (${bad.length})</b>`);
    for (const d of bad.slice(0, 30)) {
      L.push(`${deviceDot(d)} <b>${esc(d.inst)}</b> <code>${esc(d.phone ?? d.name)}</code> — ${problemOf(d) ?? d.account}`);
    }
  } else {
    L.push('', '✅ Tüm cihazlarda aktif hesap var');
  }
  L.push('', '<i>Silinmiş cihazların eski kayıtları sayılmaz. Tam liste: panel → Hesaplar</i>');
  return L.join('\n');
}

// /banlar — son 7 gün, YALNIZ yaşayan cihazlar; silinenler ayrı not.
export async function renderBanWaveV2(workspaceId: string): Promise<string> {
  const wsFilter = workspaceId ? { workspaceId } : {};
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const live = await collectLive(workspaceId);
  const byId = new Map(live.map((d) => [d.id, d]));
  const rows = await prisma.generatedAccount.findMany({
    where: { platform: 'whatsapp', ...wsFilter, status: { in: ['BANNED', 'RESTRICTED', 'LOGGED_OUT'] }, updatedAt: { gte: since } },
    select: { phoneNumber: true, status: true, deviceId: true, updatedAt: true, error: true },
    orderBy: { updatedAt: 'desc' }
  });
  // Yalnız cihazı hâlâ yaşayan VE o cihazdaki en iyi durumu gerçekten kötü olanlar
  // (aynı cihazda sonradan aktif hesap açıldıysa eski kayıt olay sayılmaz).
  const real = rows.filter((r) => r.deviceId && byId.has(r.deviceId) && byId.get(r.deviceId)!.account !== 'ACTIVE');
  const gone = rows.length - rows.filter((r) => r.deviceId && byId.has(r.deviceId)).length;
  const dayKey = (d: Date) => d.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit' });
  const L: string[] = [`<b>⚠️ Ban / Kısıt</b> — son 7 gün, yaşayan cihazlar`, ''];
  if (!real.length) {
    L.push('✅ Yaşayan cihazlarda son 7 günde ban/kısıt yok.');
  } else {
    // Günlük seri (dalga tespiti için).
    const perDay = new Map<string, number>();
    for (const r of real) perDay.set(dayKey(r.updatedAt), (perDay.get(dayKey(r.updatedAt)) ?? 0) + 1);
    L.push(`📅 ${[...perDay.entries()].map(([d, n]) => `${d}: <b>${n}</b>`).join(' · ')}`, '');
    const label = (s: string) => (s === 'BANNED' ? '⛔️ Ban' : s === 'LOGGED_OUT' ? '🟠 Çıkış' : '🟡 Kısıt');
    for (const r of real.slice(0, 20)) {
      const d = byId.get(r.deviceId!)!;
      const when = r.updatedAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const why = String(r.error ?? '').replace(/^Otonom tarama:\s*/, '').replace(/\s+/g, ' ').slice(0, 55);
      L.push(`${label(r.status)} <b>${esc(d.inst)}</b> <code>${esc(r.phoneNumber ?? '-')}</code> · ${esc(when)}${why ? `\n   <i>${esc(why)}</i>` : ''}`);
    }
  }
  if (gone > 0) L.push('', `<i>ℹ️ Ayrıca ${gone} kayıt silinmiş cihazlara ait — sayıma katılmadı.</i>`);
  return L.join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// ★2026-09-30 /proxy · /tani · /ozet · /bakiye v2
// Eskileri: /proxy yalnız metadata'daki ülkeyi sayıyordu (gerçek çıkışı hiç
// görmüyordu), /tani ve /ozet TÜM ZAMANLARIN hesaplarını sayıyordu (silinmiş
// cihazlar dahil). Hepsi artık yaşayan filo + bekçinin derin taraması + gerçek
// gönderim sonucu üzerinden.
// ════════════════════════════════════════════════════════════════════════════

// Filo karnesi: 4 ana eksenin ortalaması → harf notu (tek bakışta "bugün nasıl").
function fleetGrade(parts: Array<number | null>): { score: number; grade: string } {
  const xs = parts.filter((x): x is number => x !== null && Number.isFinite(x));
  const score = xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
  const grade = score >= 95 ? '🏆 A+' : score >= 90 ? '🌟 A' : score >= 80 ? '👍 B' : score >= 65 ? '😐 C' : '🚨 D';
  return { score, grade };
}

// /proxy — cihazlar hangi pakette/ülkede, GERÇEKTEN internete çıkıyor mu, IP paylaşan var mı.
export async function renderProxyV2(workspaceId: string): Promise<string> {
  const [live, confs, quota, watch] = await Promise.all([collectLive(workspaceId), proxyConfigs(), thordataQuota(), lastWatchRun().catch(() => null)]);
  if (!live.length) return 'Cihaz yok.';
  const host = publicIPv4s();
  const L: string[] = ['<b>🌐 Proxy</b> <i>(bekçinin gerçek çıkış taraması)</i>', ''];

  // Paket × ülke tablosu, her hücrede "çıkan/toplam".
  const grid = new Map<string, { total: number; exit: number }>();
  for (const d of live) {
    const c = confs?.get(d.inst);
    const key = `${c?.kind ?? 'config yok'}|${c?.cc ?? '—'}`;
    const cell = grid.get(key) ?? { total: 0, exit: 0 };
    cell.total++;
    if (d.exitIp) cell.exit++;
    grid.set(key, cell);
  }
  L.push('<b>📦 Paket · ülke</b>');
  for (const [key, c] of [...grid.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const [kind = '', cc = ''] = key.split('|');
    const p = pct(c.exit, c.total);
    L.push(`${goodDot(p, 97, 80)} ${kind === 'mobil' ? '📡' : kind === 'residential' ? '🏠' : '❔'} ${esc(kind)} <b>${esc(cc)}</b>  ${bar(p, 8)} ${c.exit}/${c.total}`);
  }

  // Çıkış sağlığı
  const scanned = live.filter((d) => d.scanned);
  const noExit = scanned.filter((d) => !d.exitIp);
  const leaks = scanned.filter((d) => d.exitIp && host.has(d.exitIp));
  const ipCount = new Map<string, number>();
  for (const d of scanned) if (d.exitIp) ipCount.set(d.exitIp, (ipCount.get(d.exitIp) ?? 0) + 1);
  const shared = [...ipCount.entries()].filter(([, n]) => n > 1);
  L.push('', '<b>🔎 Çıkış</b>');
  L.push(`${noExit.length ? '🔴' : '🟢'} İnternette <b>${scanned.length - noExit.length}</b>/${scanned.length}${live.length > scanned.length ? ` · ${live.length - scanned.length} taranmadı` : ''}`);
  L.push(`${leaks.length ? '🔴' : '🛡'} Sunucu IP'siyle çıkan (sızıntı): <b>${leaks.length}</b>`);
  L.push(`${shared.length ? '🟡' : '🟢'} Farklı çıkış IP: <b>${ipCount.size}</b>${shared.length ? ` · ⚠️ ${shared.length} IP birden çok cihazda` : ' · hepsi tekil'}`);
  if (noExit.length) L.push(`   Çıkışsız: ${noExit.slice(0, 10).map((d) => `<code>${esc(d.inst)}</code>`).join(' ')}${noExit.length > 10 ? ' …' : ''}`);
  if (leaks.length) L.push(`   Sızıntı: ${leaks.slice(0, 10).map((d) => `<code>${esc(d.inst)}</code>`).join(' ')}`);
  if (watch) L.push(`🛡 Bekçi: son tur ${fmtAge(Date.now() - watch.at.getTime())}${watch.deadExit ? ` · ${watch.deadExit} çıkış-ölü onarımda` : ''}`);

  L.push('', '<b>💳 Kota</b>');
  L.push(quota ? `🏠 Residential: <b>${quota.balanceGb.toFixed(1)} GB</b> · bitiş ${esc(quota.expiration)}` : '⚪️ Residential kota okunamadı');
  L.push('📡 <i>Mobil paket kotası bu token\'da görünmüyor → Thordata paneli</i>');
  L.push('', '<i>Geçmiş kullanım: /bakiye · onarım: /kurtar</i>');
  return L.join('\n');
}

// /tani — "neyin bozuk olduğunu" tek mesajda + ne yapılmalı önerisi.
export async function renderDiagnosticsV2(workspaceId: string): Promise<string> {
  const wsFilter = workspaceId ? { workspaceId } : {};
  const since24 = new Date(Date.now() - 24 * 3600 * 1000);
  const [live, watch, vitals, sends, alerts, stuck, base] = await Promise.all([
    collectLive(workspaceId),
    lastWatchRun().catch(() => null),
    hostVitals(),
    sendStats(workspaceId, since24),
    prisma.alertEvent.findMany({
      where: { ...wsFilter, createdAt: { gte: new Date(Date.now() - 6 * 3600 * 1000) } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { title: true, createdAt: true }
    }),
    prisma.job.count({ where: { ...wsFilter, status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } } }),
    fleetHealthService.health(workspaceId).catch(() => null)
  ]);
  const hm = (d: Date) => d.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
  const online = live.filter((d) => d.online).length;
  const scanned = live.filter((d) => d.scanned);
  const exit = scanned.filter((d) => d.exitIp).length;
  const active = live.filter((d) => d.account === 'ACTIVE').length;
  const watchAge = watch ? Date.now() - watch.at.getTime() : null;
  const watchOk = watchAge !== null && watchAge <= 25 * 60000;

  // Her bulgu → önerilen adım. Operatör "şimdi ne yapayım" sorusunun cevabını görsün.
  const findings: Array<[string, string, string]> = []; // [nokta, bulgu, öneri]
  if (!watchOk) findings.push(['🔴', watchAge !== null ? `Bekçi ${fmtAge(watchAge)} tur atmadı` : 'Bekçi turu okunamadı', 'otomatik onarım durmuş olabilir → geliştiriciye bildir']);
  if (base?.hosts?.some((h) => h.monitorStale)) findings.push(['🔴', 'Sunucu izleme sinyali bayat', 'agent çalışıyor mu kontrol edilmeli']);
  if (online < live.length) findings.push([live.length - online >= 5 ? '🔴' : '🟡', `${live.length - online} cihaz kapalı`, '/kurtar ile uyandır']);
  if (scanned.length && exit < scanned.length) findings.push([scanned.length - exit >= 10 ? '🔴' : '🟡', `${scanned.length - exit} cihaz internetsiz`, 'bekçi ~7 dk içinde onarır; sürerse /proxy']);
  if (stuck) findings.push(['🟡', `${stuck} iş 10+ dk takılı`, '/kurtar takılı işleri temizler']);
  if (sends.total >= 20 && sends.ok / sends.total < 0.85 && sends.lastHourFail < 10) {
    const peak = sends.peakFail ? ` · en yoğun ${sends.peakFail.hour} (${sends.peakFail.n})` : '';
    findings.push(['🟡', `24 saatte gönderimlerin %${pct(sends.fail, sends.total)} kadarı gitmedi (şu an sakin)`, `en sık: ${sends.reasons[0] ? reasonLabel(sends.reasons[0][0]) : '?'}${peak}`]);
  }
  if (sends.lastHourFail >= 10) findings.push(['🔴', `son 1 saatte ${sends.lastHourFail} gönderim gitmedi`, `en sık: ${sends.reasons[0] ? reasonLabel(sends.reasons[0][0]) : '?'}`]);
  if (vitals.ramFreeGb !== null && vitals.ramFreeGb < 20) findings.push(['🔴', `boş RAM ${vitals.ramFreeGb.toFixed(0)} GB`, 'yeni cihaz açma']);
  if (vitals.diskUsedPct !== null && vitals.diskUsedPct >= 85) findings.push(['🟡', `disk %${vitals.diskUsedPct}`, 'log/yedek temizliği']);

  const L: string[] = ['<b>🔍 Derin Teşhis</b>', ''];
  if (!findings.length) L.push('✅ <b>Her şey yolunda</b> — müdahale gerekmiyor.');
  for (const [dot, what, todo] of findings) L.push(`${dot} <b>${esc(what)}</b>\n   👉 ${esc(todo)}`);

  L.push('', '<b>📋 Kontrol listesi</b>');
  const chk = (ok: boolean, s: string) => L.push(`${ok ? '✅' : '❌'} ${s}`);
  chk(watchOk, `Bekçi${watchAge !== null ? ` (${fmtAge(watchAge)})` : ''}`);
  chk(online === live.length, `Cihazlar açık ${online}/${live.length}`);
  chk(!scanned.length || exit === scanned.length, `İnternet çıkışı ${exit}/${scanned.length}`);
  chk(active >= live.length * 0.9, `WhatsApp aktif ${active}/${live.length}`);
  chk(stuck === 0, `Takılı iş ${stuck}`);
  chk(sends.total === 0 || sends.ok / sends.total >= 0.85, `Gönderim %${sends.rate} (${sends.ok}/${sends.total})`);
  const sat = vitals.load1 !== null && vitals.cores ? Math.round((vitals.load1 / vitals.cores) * 100) : null;
  chk(sat === null || sat < 90, `CPU %${sat ?? '?'} · RAM ${vitals.ramFreeGb?.toFixed(0) ?? '?'} GB boş · disk %${vitals.diskUsedPct ?? '?'}`);

  if (sends.reasons.length) {
    L.push('', '<b>✉️ Gitmeyen mesaj sebepleri</b> <i>(24 sa)</i>');
    for (const [c, n] of sends.reasons.slice(0, 4)) L.push(`• ${esc(reasonLabel(c))}: <b>${n}</b>`);
  }
  L.push('', alerts.length ? '<b>🔔 Son 6 saat</b>' : '🔕 Son 6 saatte alarm yok.');
  for (const a of alerts) L.push(`• <code>${hm(a.createdAt)}</code> ${esc(a.title).slice(0, 70)}`);
  return L.join('\n');
}

// /ozet — sabah raporu: karne + 24 saatin hikâyesi.
export async function renderDailyDigestV2(workspaceId: string): Promise<string> {
  const wsFilter = workspaceId ? { workspaceId } : {};
  const since24 = new Date(Date.now() - 24 * 3600 * 1000);
  const live = await collectLive(workspaceId);
  const liveIds = live.map((d) => d.id);
  const [sends, msgIn, alerts, newBans, newRegs, watch, quota] = await Promise.all([
    sendStats(workspaceId, since24),
    prisma.whatsappMessage.count({ where: { ...wsFilter, direction: 'IN', createdAt: { gte: since24 } } }),
    prisma.alertEvent.count({ where: { ...wsFilter, createdAt: { gte: since24 } } }),
    prisma.generatedAccount.count({ where: { platform: 'whatsapp', status: 'BANNED', deviceId: { in: liveIds }, updatedAt: { gte: since24 } } }),
    prisma.generatedAccount.count({ where: { ...wsFilter, platform: 'whatsapp', status: 'ACTIVE', createdAt: { gte: since24 } } }),
    lastWatchRun().catch(() => null),
    thordataQuota()
  ]);
  const online = live.filter((d) => d.online).length;
  const scanned = live.filter((d) => d.scanned);
  const exit = scanned.filter((d) => d.exitIp).length;
  const active = live.filter((d) => d.account === 'ACTIVE').length;
  const { score, grade } = fleetGrade([
    pct(online, live.length),
    scanned.length ? pct(exit, scanned.length) : null,
    pct(active, live.length),
    sends.total ? pct(sends.ok, sends.total) : null
  ]);
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }));
  const hello = hour < 6 ? '🌙 İyi geceler' : hour < 12 ? '☀️ Günaydın' : hour < 18 ? '🌤 İyi günler' : '🌆 İyi akşamlar';
  const tenth = Math.round(score / 10);

  const L: string[] = [`<b>${hello}!</b> Filo karnesi: <b>${grade}</b> <i>(${score}/100)</i>`, `<code>${'█'.repeat(tenth)}${'░'.repeat(10 - tenth)}</code>`, ''];
  L.push(`📱 Cihaz    ${bar(pct(online, live.length), 8)} <b>${online}</b>/${live.length}`);
  if (scanned.length) L.push(`🌐 İnternet ${bar(pct(exit, scanned.length), 8)} <b>${exit}</b>/${scanned.length}`);
  L.push(`💬 WA aktif ${bar(pct(active, live.length), 8)} <b>${active}</b>/${live.length}`);
  if (sends.total) L.push(`✉️ Teslim   ${bar(pct(sends.ok, sends.total), 8)} <b>${sends.ok}</b>/${sends.total} (%${sends.rate})`);

  L.push('', '<b>📖 Son 24 saat</b>');
  L.push(`📨 ${msgIn} gelen mesaj · 🆕 ${newRegs} yeni hesap · ${newBans ? `⛔️ ${newBans} yeni ban` : '🛡 yeni ban yok'}`);
  if (sends.reasons.length) L.push(`↳ gitmeyenler: ${sends.reasons.slice(0, 3).map(([c, n]) => `${esc(reasonLabel(c))} ${n}`).join(' · ')}`);
  L.push(`🔔 ${alerts} alarm${watch ? ` · 🛡 bekçi ${fmtAge(Date.now() - watch.at.getTime())}` : ' · 🔴 bekçi okunamadı'}`);
  if (quota) L.push(`💳 Residential ${quota.balanceGb.toFixed(1)} GB${quota.yesterdayGb !== null ? ` · dün ${quota.yesterdayGb.toFixed(1)} GB` : ''}`);

  const tips: string[] = [];
  if (online < live.length) tips.push(`${live.length - online} kapalı cihaz → /kurtar`);
  if (newBans) tips.push('yeni banlar → /banlar');
  if (sends.total && sends.ok / sends.total < 0.85) tips.push('gönderim oranı düşük → /tani');
  L.push('', tips.length ? `👉 ${tips.join(' · ')}` : '✨ Müdahale gereken bir şey yok. İyi çalışmalar!');
  return L.join('\n');
}

// /bakiye — kota + son 7 günün kullanım grafiği.
export async function renderBalanceV2(): Promise<string> {
  const [quota, split] = await Promise.all([thordataQuota(), proxySplit()]);
  if (!quota) return '⚠️ Thordata kota bilgisi okunamadı (token yok ya da API cevap vermedi — 15 dk sonra tekrar deneyin).';
  const daysLeftExp = Math.ceil((new Date(`${quota.expiration}T23:59:59Z`).getTime() - Date.now()) / 86400000);
  const dot = quota.balanceGb < 10 || daysLeftExp <= 3 ? '🔴' : quota.balanceGb < 30 || daysLeftExp <= 7 ? '🟡' : '🟢';
  const L: string[] = ['<b>💳 Proxy Bakiyesi</b> <i>(Thordata)</i>', ''];
  L.push(`${dot} 🏠 Residential: <b>${quota.balanceGb.toFixed(2)} GB</b>`);
  L.push(`📅 Bitiş: ${esc(quota.expiration)} <i>(${daysLeftExp} gün)</i>`);
  const days = quota.days.slice(-7);
  if (days.length) {
    const max = Math.max(...days.map((d) => d.gb), 0.01);
    L.push('', '<b>📊 Günlük kullanım</b>');
    for (const d of days) {
      const n = Math.round((d.gb / max) * 12);
      L.push(`<code>${d.date.slice(5)} ${'▇'.repeat(n)}${' '.repeat(12 - n)} ${d.gb.toFixed(2).padStart(6)} GB</code>`);
    }
    const rate = quota.yesterdayGb;
    if (split && split.residential === 0) L.push('💤 Filo şu an residential kullanmıyor → bu kota yalnız bitiş tarihine kadar bekliyor');
    else if (rate && rate > 0.05) L.push(`⏳ Dün ${rate.toFixed(2)} GB → bu hızla ~${Math.floor(quota.balanceGb / rate)} gün yeter`);
  }
  if (split) L.push('', `📡 Filo: mobil <b>${split.mobile}</b> · residential <b>${split.residential}</b> cihaz`);
  L.push('<i>Mobil paket kotası bu token\'da görünmüyor → Thordata paneli.</i>');
  return L.join('\n');
}
