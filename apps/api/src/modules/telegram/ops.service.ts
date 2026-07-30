import { prisma } from '../../db/prisma';
import { logger } from '../../lib/logger';
import { fleetHealthService } from '../fleet-health/fleet-health.service';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';

// ── OPERASYON KOMUTLARI (Telegram) ──────────────────────────────────────────
//
// ★2026-07-29 — NEDEN VAR: operatör panele/sunucuya erişemediğinde (dışarıdayken)
// filoyu Telegram'dan TEŞHİS edebilmeli ve KURTARABİLMELİ. Bugüne kadar bir arıza
// olduğunda tek yol "geliştiriciye yaz, o sunucuya bağlansın"dı — bu, gece yaşanan
// bir kesintide filonun saatlerce ölü kalması demek.
//
// Buradaki komutlar host'a SSH gerektirmez: hepsi API'nin kendi verisi + agent'a
// gönderilen job'lar üzerinden çalışır. Ağır/uzun işler job olarak kuyruğa girer,
// bot hemen özet döner (Telegram 60 sn'de timeout eder, uzun beklemek yasak).

const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Zaman damgasını OPERATÖRÜN saat diliminde göster.
//
// ★2026-07-29: alarm saatleri `toISOString()` ile basılıyordu, yani UTC — Türkiye'de
// 3 saat geride görünüyordu ve operatör olayın ne zaman olduğunu yanlış değerlendiriyordu
// ("gece 00:30'da olmuş" derken aslında 03:30). FLEET_TZ ile ayarlanabilir.
const DISPLAY_TZ = process.env.FLEET_TZ || 'Europe/Istanbul';
function localHm(d: Date): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: DISPLAY_TZ
    }).format(d);
  } catch {
    // Geçersiz TZ adı → sessizce UTC'ye düş (hiç saat göstermemekten iyi).
    return new Date(d).toISOString().slice(11, 16);
  }
}

// Bir cihazın "şu an gerçekten çalışıyor mu" özeti için gereken alanlar.
type DeviceRow = {
  id: string;
  name: string;
  status: string;
  ipAddress: string | null;
  lastSeen: Date | null;
  metadata: unknown;
};

function instanceOf(d: DeviceRow): string {
  const m = (d.metadata ?? {}) as Record<string, unknown>;
  return typeof m.instance === 'string' ? m.instance : '—';
}

function proxyCountryOf(d: DeviceRow): string {
  const m = (d.metadata ?? {}) as Record<string, unknown>;
  return typeof m.proxyCountry === 'string' ? m.proxyCountry.toUpperCase() : '—';
}

// ── /tani — DERİN TEŞHİS ────────────────────────────────────────────────────
//
// "Neyin bozuk olduğunu" tek mesajda gösterir: servis/izleme canlılığı, cihaz
// durumu, WhatsApp hesap sağlığı, proxy ülke dağılımı, son alarmlar.
export async function renderDiagnostics(workspaceId: string): Promise<string> {
  // ★2026-07-29 — YALANCI SAĞLIK RAPORU TEHLİKESİ:
  // Aşağıdaki sorguların hepsi `.catch(() => boş)` ile korunuyor. Bu, tek bir sorgu
  // patladığında raporun yine de üretilmesini sağlar AMA veritabanı TAMAMEN çökerse
  // rapor "0 cihaz, 0 alarm, her şey sessiz" diye görünür — yani ARIZA, SAĞLIK gibi
  // okunur. Bir acil-teşhis komutunda bundan daha tehlikeli bir davranış olamaz.
  // Bu yüzden hataları ayrıca sayıyoruz ve rapora AÇIKÇA yazıyoruz.
  let dbFail = 0;
  const fail = <T>(fallback: T) => (): T => {
    dbFail++;
    return fallback;
  };

  const [health, devices, recentAlerts, staleJobs] = await Promise.all([
    fleetHealthService.health(workspaceId).catch(fail(null)),
    prisma.device.findMany({
      where: { workspaceId },
      select: { id: true, name: true, status: true, ipAddress: true, lastSeen: true, metadata: true }
    }).catch(fail<DeviceRow[]>([])),
    // Son 6 saatte fırlayan alarmlar — "gece ne oldu" sorusunun cevabı.
    prisma.alertEvent.findMany({
      where: { workspaceId, createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { title: true, createdAt: true }
    }).catch(fail<Array<{ title: string; createdAt: Date }>>([])),
    // Takılı kalmış işler: RUNNING ama uzun süredir güncellenmemiş.
    prisma.job.count({
      where: { workspaceId, status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } }
    }).catch(fail(0))
  ]);

  const lines: string[] = ['<b>🔍 Derin Teşhis</b>', ''];

  // Veri okunamadıysa bunu EN ÜSTTE söyle — aşağıdaki "0 cihaz / alarm yok" satırları
  // gerçeği değil, veri yokluğunu yansıtıyor olabilir.
  if (dbFail > 0) {
    lines.push(
      `🔴 <b>UYARI: ${dbFail} sorgu başarısız</b> — veritabanına erişilemiyor olabilir.`,
      '<i>Aşağıdaki sayılar EKSİK/YANILTICI olabilir; "sorun yok" gibi görünmesine aldanmayın.</i>',
      ''
    );
  }

  // 1) İzleme canlı mı? (dead-man switch) — EN KRİTİK satır: izleme ölmüşse
  //    aşağıdaki "her şey yolunda" bilgisi de güvenilmez demektir.
  if (health?.hosts?.length) {
    for (const h of health.hosts) {
      const dot = h.monitorStale ? '🔴' : '🟢';
      const load = h.load1 !== null ? h.load1.toFixed(1) : '—';
      const pct = h.saturationPct !== null ? ` (%${h.saturationPct})` : '';
      const disk = h.diskFreeGb !== null ? ` · 💾 ${Math.round(h.diskFreeGb)}GB` : '';
      lines.push(`${dot} <b>${esc(h.name)}</b> — yük ${load}${pct}${disk}`);
      if (h.monitorStale) lines.push('   ⚠️ <b>İzleme durmuş</b> (20+ dk rapor yok) — otomatik kurtarma ÇALIŞMIYOR olabilir!');
    }
  } else {
    lines.push('⚠️ Sunucu bilgisi okunamadı.');
  }

  // 2) Cihazlar
  const total = devices.length;
  const online = devices.filter((d) => d.status === 'ONLINE').length;
  const offline = devices.filter((d) => d.status === 'OFFLINE').length;
  const err = devices.filter((d) => d.status === 'ERROR').length;
  lines.push('', `📱 <b>Cihaz</b>: ${total} · 🟢 ${online} · ⚪️ ${offline}${err ? ` · 🔴 ${err}` : ''}`);

  // Uzun süredir haber vermeyen cihazlar (heartbeat bayat) — sessiz ölüm göstergesi.
  const staleCut = Date.now() - 15 * 60 * 1000;
  const stale = devices.filter((d) => d.status === 'ONLINE' && d.lastSeen && d.lastSeen.getTime() < staleCut);
  if (stale.length) {
    lines.push(`⚠️ ${stale.length} cihaz ONLINE görünüyor ama 15+ dk sessiz:`);
    lines.push('   ' + stale.slice(0, 6).map((d) => esc(d.name)).join(', ') + (stale.length > 6 ? ' …' : ''));
  }

  // 3) WhatsApp hesap sağlığı
  if (health?.waAccounts) {
    const w = health.waAccounts;
    const parts: string[] = [];
    if (w.active) parts.push(`✅ ${w.active}`);
    if (w.restricted) parts.push(`🟡 ${w.restricted} kısıtlı`);
    if (w.loggedOut) parts.push(`🟠 ${w.loggedOut} çıkış`);
    if (w.banned) parts.push(`🔴 ${w.banned} yasaklı`);
    if (parts.length) lines.push(`💬 <b>WhatsApp</b>: ${parts.join(' · ')}`);
  }

  // 4) Proxy ülke dağılımı — bir ülke havuzu ölürse hangi cihazların etkileneceğini
  //    önceden gösterir (29 Tem: TR havuzu ölünce 26 cihaz birden düşmüştü).
  const byCc = new Map<string, number>();
  for (const d of devices) {
    const cc = proxyCountryOf(d);
    byCc.set(cc, (byCc.get(cc) ?? 0) + 1);
  }
  const ccStr = [...byCc.entries()]
    .filter(([cc]) => cc !== '—')
    .sort((a, b) => b[1] - a[1])
    .map(([cc, n]) => `${cc}:${n}`)
    .join(' · ');
  if (ccStr) lines.push(`🌍 <b>Proxy ülke</b>: ${ccStr}`);

  // 5) Takılı işler
  if (staleJobs > 0) lines.push(`⏳ <b>${staleJobs}</b> iş 10+ dk RUNNING'de takılı`);

  // 6) Son alarmlar
  if (recentAlerts.length) {
    lines.push('', '<b>🔔 Son 6 saat</b>');
    for (const a of recentAlerts) {
      lines.push(`• <code>${localHm(a.createdAt)}</code> ${esc(a.title).slice(0, 70)}`);
    }
  } else {
    lines.push('', '🔕 Son 6 saatte alarm yok.');
  }

  return lines.join('\n');
}

// ── /proxy — PROXY TEŞHİS ───────────────────────────────────────────────────
//
// Hangi cihaz hangi ülkede, kaçı sağlıklı. Asıl amaç: "bir ülke havuzu mu öldü,
// yoksa tek cihaz mı takıldı" ayrımını operatörün SSH'sız görebilmesi.
export async function renderProxyStatus(workspaceId: string): Promise<string> {
  const devices = await prisma.device
    .findMany({
      where: { workspaceId },
      select: { id: true, name: true, status: true, ipAddress: true, lastSeen: true, metadata: true }
    })
    .catch((): DeviceRow[] => []);

  if (!devices.length) return 'Cihaz yok.';

  const lines: string[] = ['<b>🌐 Proxy Durumu</b>', ''];
  const byCc = new Map<string, DeviceRow[]>();
  for (const d of devices) {
    const cc = proxyCountryOf(d);
    if (!byCc.has(cc)) byCc.set(cc, []);
    byCc.get(cc)!.push(d);
  }

  for (const [cc, list] of [...byCc.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const on = list.filter((d) => d.status === 'ONLINE').length;
    const dot = on === list.length ? '🟢' : on === 0 ? '🔴' : '🟡';
    lines.push(`${dot} <b>${cc === '—' ? 'ülkesiz' : cc}</b> — ${list.length} cihaz · ${on} online`);
  }

  lines.push(
    '',
    '<i>Not: çıkış-IP testi cihaz üzerinde çalışır ve uzun sürer; bu liste cihaz/ülke',
    'dağılımını gösterir. Gerçek çıkış kontrolü + otomatik onarım için</i> <b>/kurtar</b>.'
  );
  return lines.join('\n');
}

// ── /kurtar — TEK KOMUTLA OTOMATİK ONARIM ───────────────────────────────────
//
// Operatörün "bir şeyler bozuk, düzelt" dediği tek düğme. Yaptıkları:
//   1) OFFLINE/ERROR cihazlara uyandırma job'ı gönderir (ADB kopması → reconnect).
//   2) Takılı RUNNING işleri temizler (reaper zaten var; burada tetikliyoruz).
//   3) Host'un kendi sağlık-izleme turunu tetikler (proxy kurtarma orada çalışır).
// Uzun süren işleri BEKLEMEZ — job'ları kuyruğa atıp özet döner.
export async function runRecovery(workspaceId: string): Promise<string> {
  const lines: string[] = ['<b>🔧 Otomatik Kurtarma</b>', ''];

  // 1) Uyandırılacak cihazlar
  const down = await prisma.device
    .findMany({
      where: { workspaceId, status: { in: ['OFFLINE', 'ERROR'] } },
      select: { id: true, name: true, status: true }
    })
    .catch(() => [] as Array<{ id: string; name: string; status: string }>);

  let woke = 0;
  for (const d of down.slice(0, 20)) {
    try {
      await createJobRecord('DEVICE_WAKE', { deviceId: d.id } as unknown as JobPayload, d.id, workspaceId);
      woke++;
    } catch (e) {
      logger.warn('recovery wake failed', { device: d.name, error: (e as Error).message });
    }
  }
  lines.push(
    down.length
      ? `🔆 ${woke}/${down.length} kapalı cihaza uyandırma gönderildi`
      : '🟢 Kapalı cihaz yok'
  );

  // 2) Takılı işler — reaper'ın süresini beklemeden şimdi düşür.
  const stuckCut = new Date(Date.now() - 10 * 60 * 1000);
  const stuck = await prisma.job
    .updateMany({
      where: { workspaceId, status: 'RUNNING', updatedAt: { lt: stuckCut } },
      data: { status: 'FAILED', error: 'Telegram /kurtar ile temizlendi (10+ dk takılı)', finishedAt: new Date() }
    })
    .catch(() => ({ count: 0 }));
  lines.push(stuck.count ? `🧹 ${stuck.count} takılı iş temizlendi` : '🧹 Takılı iş yok');

  // 3) Ekran/proxy kurtarması host'ta çalışır (wd-health-watch + agent reaper'ları).
  //    Onları buradan tetikleyemeyiz (host script'i), ama periyodu kısa olduğu için
  //    operatöre ne zaman devreye gireceğini söylüyoruz — yanlış beklenti oluşmasın.
  lines.push(
    '',
    '<i>Proxy çıkışı ve takılı ekranlar sunucudaki otomatik onarım turunda',
    'düzeltilir (her ~7 dk). Sonucu <b>/tani</b> ile görebilirsin.</i>'
  );

  return lines.join('\n');
}

// ── /acil — SERVİS YENİDEN BAŞLATMA (onaylı) ────────────────────────────────
//
// ⚠️ Bot API sürecinin İÇİNDEN kendi servisini yeniden başlatamaz (kendini öldürür
// ve cevabı gönderemez). Bunun yerine operatöre NE yapılacağını ve neyin otomatik
// olduğunu söyler; gerçek restart'ı gerektiren tek senaryo (agent stream zombie)
// artık ping/pong watchdog ile kendi kendine çözülüyor.
export function renderEmergencyHelp(): string {
  return [
    '<b>🚨 Acil Müdahale</b>',
    '',
    'Çoğu arıza artık <b>otomatik</b> çözülüyor:',
    '• Canlı yayın kanalı koparsa → agent 30 sn içinde kendini yeniden bağlar',
    '• Proxy çıkışı ölürse → sessid döndürme, olmazsa hesap değiştirme (~7 dk tur)',
    '• Takılı ekran/izin diyaloğu → otomatik temizlenir',
    '• Cihaz ADB\'den düşerse → otomatik reconnect, olmazsa instance yeniden başlatılır',
    '',
    '<b>Elle müdahale:</b>',
    '• <b>/kurtar</b> — kapalı cihazları uyandır + takılı işleri temizle',
    '• <b>/reconnect</b> — ADB kopan cihazları toplu kurtar',
    '• <b>/reboot</b> &lt;cihaz&gt; — tek cihazı yeniden başlat',
    '• <b>/tani</b> — neyin bozuk olduğunu gör',
    '',
    '<i>Sunucu servisleri (API/agent) çökerse systemd onları otomatik yeniden',
    'başlatır. Buna rağmen /tani "izleme durmuş" diyorsa geliştiriciye bildir.</i>'
  ].join('\n');
}

// ── GÜNLÜK ÖZET ─────────────────────────────────────────────────────────────
//
// Sabah tek mesaj: gece ne oldu, şu an durum ne. "Sessizlik = arıza mı, huzur mu"
// belirsizliğini bitirir — sistem sağlıklıysa da mesaj gelir.
export async function renderDailyDigest(workspaceId: string): Promise<string> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [health, alerts, jobs, notifs] = await Promise.all([
    fleetHealthService.health(workspaceId).catch(() => null),
    prisma.alertEvent.count({ where: { workspaceId, createdAt: { gte: since } } }).catch(() => 0),
    prisma.job
      .groupBy({
        by: ['status'],
        where: { workspaceId, createdAt: { gte: since } },
        _count: { _all: true }
      })
      .catch(() => [] as Array<{ status: string; _count: { _all: number } }>),
    prisma.notification.count({ where: { workspaceId, createdAt: { gte: since }, kind: 'err' } }).catch(() => 0)
  ]);

  const d = health?.devices;
  const w = health?.waAccounts;
  const jobDone = jobs.find((j) => j.status === 'COMPLETED')?._count._all ?? 0;
  const jobFail = jobs.find((j) => j.status === 'FAILED')?._count._all ?? 0;

  // ★2026-07-30 GÖNDERİM BAŞARISI AYRI SAYILIR — "COMPLETED" YALAN SÖYLÜYORDU.
  //
  // CANLI ÖLÇÜM (30 Tem, son 24 sa): 28 WHATSAPP_SEND işinin 27'si `COMPLETED`
  // görünüyordu ama `result.status` okununca yalnızca **2** tanesi gerçekten SENT'ti:
  //   COMPLETED + CHAT_NOT_OPENED    17
  //   COMPLETED + ACCOUNT_RESTRICTED  7
  //   COMPLETED + ACCOUNT_LOGGED_OUT  1
  //   COMPLETED + SENT                2   ← gerçek başarı
  // Yani özet "✅ 2245" derken gerçek gönderim oranı ~%7'ydi. `COMPLETED` sadece
  // "iş çalıştı ve rapor döndü" demek; mesajın gidip gitmediği `result.status`ta.
  // Operatör bu rakama bakıp "her şey yolunda" sanıyordu — en tehlikeli hata türü.
  const sendJobs = await prisma.job
    .findMany({
      where: { workspaceId, createdAt: { gte: since }, type: 'WHATSAPP_SEND' },
      select: { status: true, result: true }
    })
    .catch(() => [] as Array<{ status: string; result: unknown }>);
  let sentOk = 0;
  const sendReasons = new Map<string, number>();
  for (const j of sendJobs) {
    const rs = String(((j.result ?? {}) as Record<string, unknown>).status ?? '');
    if (rs === 'SENT' || rs === 'OK' || rs === 'DELIVERED') sentOk++;
    else {
      const key = rs || (j.status === 'FAILED' ? 'FAILED' : 'BİLİNMEYEN');
      sendReasons.set(key, (sendReasons.get(key) ?? 0) + 1);
    }
  }
  const sendTotal = sendJobs.length;

  const lines: string[] = ['<b>☀️ Günlük Özet</b> <i>(son 24 saat)</i>', ''];

  if (d) {
    const allOk = d.offline === 0 && d.error === 0;
    lines.push(`${allOk ? '🟢' : '🟡'} <b>Cihaz</b>: ${d.total} · 🟢 ${d.online} · ⚪️ ${d.offline}${d.error ? ` · 🔴 ${d.error}` : ''}`);
  }
  if (w) {
    const parts: string[] = [];
    if (w.active) parts.push(`✅ ${w.active}`);
    if (w.restricted) parts.push(`🟡 ${w.restricted}`);
    if (w.banned) parts.push(`🔴 ${w.banned}`);
    if (parts.length) lines.push(`💬 <b>WhatsApp</b>: ${parts.join(' · ')}`);
  }
  lines.push(`⚙️ <b>İşler</b>: ✅ ${jobDone} · ❌ ${jobFail} <i>(iş çalıştı mı)</i>`);

  // Gönderim başarısı AYRI satır: "iş çalıştı" ile "mesaj gitti" farklı şeyler.
  if (sendTotal > 0) {
    const pct = Math.round((sentOk / sendTotal) * 100);
    const icon = pct >= 80 ? '🟢' : pct >= 40 ? '🟡' : '🔴';
    lines.push(`${icon} <b>Mesaj GİTTİ</b>: ${sentOk}/${sendTotal} <b>(%${pct})</b>`);
    if (sentOk < sendTotal) {
      // En sık 3 sebebi yaz — operatör "neden gitmiyor" sorusunu tek bakışta görsün.
      const top = [...sendReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const label: Record<string, string> = {
        CHAT_NOT_OPENED: 'sohbet açılamadı',
        ACCOUNT_RESTRICTED: 'hesap KISITLI',
        ACCOUNT_LOGGED_OUT: 'hesap ÇIKIŞ yapmış',
        ACCOUNT_BANNED: 'hesap YASAKLI',
        FAILED: 'iş başarısız'
      };
      lines.push(`   ↳ ${top.map(([k, n]) => `${label[k] ?? k}: ${n}`).join(' · ')}`);
    }
  }

  lines.push(`🔔 <b>Alarm</b>: ${alerts} · <b>Hata bildirimi</b>: ${notifs}`);

  // İzleme canlılığı — bu satır "raporun kendisine güvenilir mi" sorusunu yanıtlar.
  const staleMon = health?.hosts?.some((h) => h.monitorStale);
  if (staleMon) {
    lines.push('', '🔴 <b>DİKKAT: sağlık izleme durmuş</b> — otomatik kurtarma çalışmıyor olabilir.');
  } else if (alerts === 0 && jobFail === 0) {
    lines.push('', '✨ Gece sorunsuz geçti.');
  }

  lines.push('', '<i>Ayrıntı için</i> <b>/tani</b> · <i>onarım için</i> <b>/kurtar</b>');
  return lines.join('\n');
}
