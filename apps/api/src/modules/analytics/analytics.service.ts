import { prisma } from '../../db/prisma';

// Analytics is now backed by REAL fleet operational data — devices, jobs, farm
// accounts and usage — not fabricated social metrics. (The old ContentMetric
// demo seed has been removed; there is no live social-network integration, so we
// surface the operational data we actually have instead of inventing numbers.)
export type AnalyticsSummary = {
  totals: {
    devices: number;
    onlineDevices: number;
    jobs: number;
    jobsCompleted: number;
    jobsFailed: number;
    successRate: number; // % — İŞ ÇALIŞMA oranı (COMPLETED/total), gönderim başarısı DEĞİL
    // ★2026-07-30 GÖNDERİM BAŞARISI AYRI ÖLÇÜLÜR. `successRate` yalnızca "iş koştu ve
    // rapor döndü" demek; WhatsApp mesajının gidip gitmediği Job.result.status'ta.
    // CANLI ÖLÇÜM: 28 gönderim işinin 27'si COMPLETED'ken sadece 2'si gerçekten SENT'ti
    // (17 CHAT_NOT_OPENED, 7 ACCOUNT_RESTRICTED, 1 ACCOUNT_LOGGED_OUT) → %96 "başarı"
    // görünürken gerçek oran %7. Operatör panele bakıp "her şey yolunda" sanıyordu.
    sendTotal: number;      // son dönemdeki WHATSAPP_SEND işi sayısı
    sendDelivered: number;  // bunlardan GERÇEKTEN gönderilen
    sendRate: number;       // % — gerçek gönderim oranı
    farmAccounts: number;
    avgHealthScore: number; // 0-100
    onlineMinutes: number;
  };
  byJobType: Array<{ type: string; total: number; completed: number; failed: number; successRate: number }>;
  timeline: Array<{ date: string; jobs: number; completed: number; failed: number }>;
  farmByProvider: Array<{ provider: string; accounts: number; avgHealth: number; avgWarmupStage: number }>;
  topDevices: Array<{ deviceId: string; name: string; onlineMinutes: number; jobs: number }>;
};

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

export class AnalyticsService {
  async summary(workspaceId: string | undefined, days = 14): Promise<AnalyticsSummary> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const wsJob = workspaceId ? { workspaceId } : {};
    const wsFarm = workspaceId ? { workspaceId } : {};

    const [devices, onlineDevices, jobs, farmAccounts] = await Promise.all([
      prisma.device.count(workspaceId ? { where: { workspaceId } } : undefined),
      prisma.device.count({ where: { status: 'ONLINE', ...(workspaceId ? { workspaceId } : {}) } }),
      // Only the createdAt slice is materialized (needed for the per-day
      // timeline). Type/status counts come from a DB-side groupBy below instead
      // of counting every row in JS — so a workspace with tens of thousands of
      // jobs in the window doesn't pull them all into memory just to tally.
      prisma.job.findMany({
        where: { createdAt: { gte: since }, ...wsJob },
        // ★2026-08-12 `type` + `result` KALDIRILDI — API'yi ÇÖKERTİYORDU.
        // Eski yorum "`result` bir JSON kolonu, ek sorgu maliyeti yok" diyordu;
        // bu, Job tablosu küçükken doğruydu. CANLI ÖLÇÜM (12 Ağu): 14 günlük
        // pencerede 36.245 iş var ve yalnızca `result` kolonunun toplamı 298 MB
        // (tek satır 2,3 MB'a kadar çıkıyor — ekran metinleri/dump'lar orada).
        // Bunu belleğe çekip JS nesnesine dönüştürmek heap'i patlatıyordu:
        // süreç `SIGABRT` (exit 134) ile ölüyor, systemd yeniden başlatıyordu.
        // Yani /analytics sayfasını AÇAN HERKES API'yi düşürüyordu (iki kez
        // birebir tekrarlandı). Gönderim oranı artık DB'de sayılıyor (aşağıda).
        select: { status: true, createdAt: true }
      }),
      prisma.farmAccount.findMany({
        where: wsFarm,
        select: { platform: true, healthScore: true, warmupStage: true, deviceId: true }
      })
    ]);

    const jobsCompleted = jobs.filter((j) => j.status === 'COMPLETED').length;
    const jobsFailed = jobs.filter((j) => j.status === 'FAILED').length;

    // ★2026-07-30 GERÇEK GÖNDERİM ORANI. `Job.status === 'COMPLETED'` "iş koştu"
    // demek; mesajın gidip gitmediği `result.status`ta ('SENT' / 'CHAT_NOT_OPENED' /
    // 'ACCOUNT_RESTRICTED' / 'ACCOUNT_LOGGED_OUT'…). İkisini ayırmadan bakınca
    // %96 başarı görünürken gerçek oran %7 olabiliyor (canlı ölçüm, 30 Tem).
    // ★2026-08-12: bu iki sayım artık DB'de yapılıyor. Önceden tüm `result`
    // JSON'ları belleğe çekilip JS'te filtreleniyordu (yukarıdaki nota bakın).
    // Sayım DB tarafında olunca 298 MB'lık veri hiç ağa/belleğe çıkmıyor.
    const [sendTotalCount, sendDeliveredCount] = await Promise.all([
      prisma.job.count({ where: { type: 'WHATSAPP_SEND', createdAt: { gte: since }, ...wsJob } }),
      prisma.job.count({
        where: {
          type: 'WHATSAPP_SEND',
          createdAt: { gte: since },
          ...wsJob,
          // `result.status` değerleri: SENT (gerçekten gitti) · OK · DELIVERED.
          // COMPLETED "iş koştu" demek, mesajın gittiği anlamına GELMEZ — bu ayrım
          // 30 Tem'de ölçülmüştü: %96 görünen başarı gerçekte %7 çıkabiliyor.
          OR: [
            { result: { path: ['status'], equals: 'SENT' } },
            { result: { path: ['status'], equals: 'OK' } },
            { result: { path: ['status'], equals: 'DELIVERED' } }
          ]
        }
      })
    ]);
    const sendDelivered = sendDeliveredCount;
    // Online-minute metering was removed with the usage module; there is no live
    // per-device online-minute rollup to aggregate, so this is 0 for now.
    const onlineMinutes = 0;
    const avgHealthScore =
      farmAccounts.length > 0
        ? Math.round(farmAccounts.reduce((s, a) => s + a.healthScore, 0) / farmAccounts.length)
        : 0;

    const totals = {
      devices,
      onlineDevices,
      jobs: jobs.length,
      jobsCompleted,
      jobsFailed,
      successRate: pct(jobsCompleted, jobsCompleted + jobsFailed),
      sendTotal: sendTotalCount,
      sendDelivered,
      sendRate: pct(sendDelivered, sendTotalCount),
      farmAccounts: farmAccounts.length,
      avgHealthScore,
      onlineMinutes
    };

    // Per job type — counted in the DB (groupBy type+status) instead of scanning
    // every row in JS.
    const typeGroups = await prisma.job.groupBy({
      by: ['type', 'status'],
      where: { createdAt: { gte: since }, ...wsJob },
      _count: { _all: true }
    });
    const typeMap = new Map<string, { total: number; completed: number; failed: number }>();
    for (const g of typeGroups) {
      const cur = typeMap.get(g.type) ?? { total: 0, completed: 0, failed: 0 };
      const n = g._count._all;
      cur.total += n;
      if (g.status === 'COMPLETED') cur.completed += n;
      if (g.status === 'FAILED') cur.failed += n;
      typeMap.set(g.type, cur);
    }
    const byJobType = Array.from(typeMap.entries())
      .map(([type, v]) => ({ type, ...v, successRate: pct(v.completed, v.completed + v.failed) }))
      .sort((a, b) => b.total - a.total);

    // Daily timeline.
    const dayMap = new Map<string, { jobs: number; completed: number; failed: number }>();
    for (const j of jobs) {
      const key = j.createdAt.toISOString().slice(0, 10);
      const cur = dayMap.get(key) ?? { jobs: 0, completed: 0, failed: 0 };
      cur.jobs += 1;
      if (j.status === 'COMPLETED') cur.completed += 1;
      if (j.status === 'FAILED') cur.failed += 1;
      dayMap.set(key, cur);
    }
    const timeline = Array.from(dayMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Farm accounts grouped by platform (x / instagram / tiktok / ...).
    const provMap = new Map<string, { accounts: number; health: number; warmup: number }>();
    for (const a of farmAccounts) {
      const platform = a.platform ?? 'other';
      const cur = provMap.get(platform) ?? { accounts: 0, health: 0, warmup: 0 };
      cur.accounts += 1;
      cur.health += a.healthScore;
      cur.warmup += a.warmupStage;
      provMap.set(platform, cur);
    }
    const farmByProvider = Array.from(provMap.entries()).map(([provider, v]) => ({
      provider,
      accounts: v.accounts,
      avgHealth: v.accounts > 0 ? Math.round(v.health / v.accounts) : 0,
      avgWarmupStage: v.accounts > 0 ? Number((v.warmup / v.accounts).toFixed(1)) : 0
    }));

    // Top-devices-by-online-minutes went away with the usage module (no live
    // online-minute rollup to rank on), so this list is empty for now.
    const topDevices: AnalyticsSummary['topDevices'] = [];

    return { totals, byJobType, timeline, farmByProvider, topDevices };
  }
}

export const analyticsService = new AnalyticsService();
