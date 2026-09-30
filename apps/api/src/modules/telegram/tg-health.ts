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
type Quota = { balanceGb: number; expiration: string; yesterdayGb: number | null; avg3Gb: number | null };
let quotaCache: { at: number; value: Quota | null } | null = null;

async function thordataQuota(): Promise<Quota | null> {
  if (quotaCache && Date.now() - quotaCache.at < 15 * 60 * 1000) return quotaCache.value;
  const token = process.env.FLEET_THORDATA_TOKEN || '';
  let value: Quota | null = null;
  if (token) {
    try {
      const today = new Date();
      const from = new Date(today.getTime() - 4 * 86400000).toISOString().slice(0, 10);
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
          avg3Gb: last3.length ? last3.reduce((a, r) => a + r.usage_traffic, 0) / last3.length / GB_KB : null
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
async function proxySplit(): Promise<{ mobile: number; residential: number; other: number } | null> {
  try {
    const mport = (await envValue('FLEET_PROXY_MOBILE_PORT')) ?? '5555';
    const rport = (await envValue('FLEET_PROXY_PORT')) ?? '9999';
    const files = (await readdir('/etc')).filter((f) => /^redsocks-inst-.+\.conf$/.test(f));
    let mobile = 0, residential = 0, other = 0;
    for (const f of files) {
      const t = (await readText(`/etc/${f}`)) ?? '';
      const port = t.match(/^\s*port = (\d+);/m)?.[1];
      if (port === mport) mobile++;
      else if (port === rport) residential++;
      else other++;
    }
    return { mobile, residential, other };
  } catch {
    return null;
  }
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

async function hostVitals(): Promise<{ load1: number | null; cores: number; ramFreeGb: number | null; swapUsedPct: number | null; diskFreeGb: number | null; diskUsedPct: number | null }> {
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
    prisma.job.findMany({
      where: { ...wsFilter, type: 'WHATSAPP_SEND', createdAt: { gte: since24 }, status: { in: ['COMPLETED', 'FAILED'] } },
      select: { status: true, startedAt: true, finishedAt: true, updatedAt: true }
    }),
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

  const sendOk = sends.filter((s) => s.status === 'COMPLETED');
  const sendFail = sends.length - sendOk.length;
  const durs = sendOk
    .map((s) => (s.startedAt ? ((s.finishedAt ?? s.updatedAt).getTime() - s.startedAt.getTime()) / 1000 : null))
    .filter((x): x is number => x !== null && x >= 0 && x < 900)
    .sort((a, b) => a - b);
  const median = durs.length ? durs[Math.floor(durs.length / 2)]! : null;

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
  if (sends.length >= 20 && pct(sendFail, sends.length) >= 5) warn.push(`gönderim başarısızlığı %${pct(sendFail, sends.length)}`);
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
  L.push(`${offline ? '🟡' : '🟢'} <b>${online}</b>/${live.length} açık${offline ? ` · ⚪️ ${offline} kapalı` : ''}`);
  if (scan) {
    L.push(`${scan.exit === scan.scanned ? '🟢' : '🔴'} İnternet: <b>${scan.exit}</b>/${scan.scanned} çıkıyor · sızıntı <b>${scan.leak}</b>`);
    L.push(`   Android açık ${scan.boot} · ADB ${scan.adb} · tarama ${fmtAge(scan.ageMs)}`);
  }

  // WhatsApp
  L.push('', '<b>💬 WhatsApp</b> <i>(yaşayan cihazlar)</i>');
  L.push(`✅ ${wa.ACTIVE} aktif${wa.RESTRICTED ? ` · 🟡 ${wa.RESTRICTED} kısıtlı` : ''}${wa.LOGGED_OUT ? ` · 🟠 ${wa.LOGGED_OUT} çıkış` : ''}${wa.BANNED ? ` · 🔴 ${wa.BANNED} banlı` : ''}${noAccount ? ` · ⚪️ ${noAccount} hesapsız` : ''}`);
  L.push(`${bans24 ? '🔴' : '🟢'} Son 24 saat yeni ban: <b>${bans24}</b>`);

  // Mesaj
  L.push('', '<b>✉️ Mesajlar</b> <i>(24 saat)</i>');
  if (sends.length) {
    const okRate = ((sendOk.length * 100) / sends.length).toFixed(1).replace('.', ',').replace(/,0$/, '');
    L.push(`${pct(sendFail, sends.length) >= 5 ? '🟡' : '🟢'} Gönderim: <b>${sendOk.length}</b> başarılı · ${sendFail} başarısız (%${okRate})`);
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
  L.push(`${sat !== null && sat > 90 ? '🔴' : '🟢'} Yük ${vitals.load1?.toFixed(1) ?? '?'} / ${vitals.cores} çekirdek${sat !== null ? ` (%${sat})` : ''}`);
  L.push(`${vitals.ramFreeGb !== null && vitals.ramFreeGb < 20 ? '🔴' : '🟢'} RAM ${vitals.ramFreeGb?.toFixed(0) ?? '?'} GB boş · swap %${vitals.swapUsedPct ?? '?'} · disk %${vitals.diskUsedPct ?? '?'} (${vitals.diskFreeGb?.toFixed(0) ?? '?'} GB boş)`);
  if (watch) {
    const age = Date.now() - watch.at.getTime();
    L.push(`${age > 25 * 60000 ? '🔴' : '🟢'} Bekçi: son tur ${fmtAge(age)} · ${watch.healthy} sağlıklı${watch.deadExit ? ` · ${watch.deadExit} çıkış-ölü` : ''}${watch.unreachable ? ` · ${watch.unreachable} erişilemez` : ''}`);
  }
  if (base?.hosts?.some((h) => h.monitorStale)) L.push('🔴 Sunucu izleme sinyali bayat');

  return L.join('\n');
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
    prisma.job.groupBy({ by: ['status'], where: { ...wsFilter, type: 'WHATSAPP_SEND', createdAt: { gte: since24 }, status: { in: ['COMPLETED', 'FAILED'] } }, _count: { _all: true } }),
    prisma.whatsappMessage.count({ where: { ...wsFilter, direction: 'IN', createdAt: { gte: since24 } } }),
    prisma.whatsappConversation.aggregate({ where: { ...wsFilter, archived: false, unreadCount: { gt: 0 } }, _sum: { unreadCount: true }, _count: { _all: true } }).catch(() => null)
  ]);
  const online = live.filter((d) => d.online).length;
  const scanned = live.filter((d) => d.scanned);
  const exit = scanned.filter((d) => d.exitIp).length;
  const active = live.filter((d) => d.account === 'ACTIVE').length;
  const problems = live.filter((d) => problemOf(d)).length;
  const ok = sends.find((s) => s.status === 'COMPLETED')?._count._all ?? 0;
  const fail = sends.find((s) => s.status === 'FAILED')?._count._all ?? 0;
  const rate = ok + fail ? ((ok * 100) / (ok + fail)).toFixed(1).replace('.', ',').replace(/,0$/, '') : '—';
  const watchAge = watch ? Date.now() - watch.at.getTime() : null;
  const bad = online < live.length || (scanned.length && exit < scanned.length) || (watchAge !== null && watchAge > 25 * 60000);
  const head = bad ? '🔴' : problems ? '🟡' : '🟢';
  return [
    `<b>📊 Durum</b> ${head}`,
    '',
    `📱 Cihaz <b>${online}</b>/${live.length} açık · 🌐 <b>${exit}</b>/${scanned.length} internette`,
    `💬 WhatsApp <b>${active}</b> aktif${problems ? ` · ⚠️ ${problems} sorunlu cihaz` : ''}`,
    `✉️ 24 saat: <b>${ok}</b> gönderim (%${rate}) · ${msgIn} gelen`,
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
