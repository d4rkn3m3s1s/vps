import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './db/prisma';
import { ensureBootstrapIdentity } from './modules/auth/auth.service';
import { ensureDefaultWorkspace } from './modules/workspace/workspace.bootstrap';
import { deviceHub } from './modules/devices/device.hub';
import { streamHub } from './modules/stream/stream.hub';
import { schedulerService } from './modules/scheduler/scheduler.service';
import { reapStaleJobs } from './modules/jobs/jobs.service';
import { whatsappService } from './modules/whatsapp/whatsapp.service';
import { sweepIdempotencyKeys } from './modules/public/idempotency.service';
import { startWebhookWorker } from './modules/webhooks/webhook.queue';
import { syncAllWorkspaces } from './modules/vast/vast.service';
import { farmService } from './modules/farm/farm.service';
import { ProxyService } from './modules/proxies/proxy.service';
import { calendarService } from './modules/calendar/calendar.service';
import { alertsService } from './modules/alerts/alerts.service';
import { webhooksService } from './modules/webhooks/webhooks.service';
import { startTelegramBot } from './modules/telegram/telegram.service';
import * as notificationsService from './modules/notifications/notifications.service';
import { renderDailyDigest } from './modules/telegram/ops.service';

// ★2026-07-29: "sağlık izleyici durdu" bildirimini host başına en fazla 30 dakikada
// bir gönder. Bu tick 60-90 sn'de bir çalıştığı için koşulsuz gönderim mesaj yağmuru
// olurdu; sorun sürdükçe hatırlatmak isteriz ama operatörü boğmadan.
const monitorDownNotified = new Map<string, number>();

// Günlük özetin bugün gönderilip gönderilmediği (YYYY-MM-DD). Süreç yeniden
// başlarsa aynı gün ikinci kez gitmesin diye DB'ye değil belleğe yazmak yeterli:
// en kötü ihtimalle restart sonrası bir kez daha gider, veri kaybı riski yok.
let digestSentOn = '';

async function main(): Promise<void> {
  await ensureBootstrapIdentity();
  await ensureDefaultWorkspace();
  await prisma.$connect();

  const app = createApp();
  const server = createServer(app);
  // ★2026-07-24: bound HTTP timeouts so a hung handler (slow DB, exhausted pool, a stuck
  // downstream) can't hold a socket — and its DB connection — open indefinitely. Without
  // these, an asylum of stuck requests slowly drains the Prisma pool → the whole API
  // locks up (agent can't claim jobs). requestTimeout is generous (120s) so long flows
  // (provision, AI) still finish; the point is to kill the truly-hung, not the merely-slow.
  server.requestTimeout = 120_000;   // whole-request cap
  server.headersTimeout = 30_000;    // must send headers within 30s
  server.keepAliveTimeout = 65_000;  // > typical LB idle (avoids premature socket reuse races)
  deviceHub.attach(server);
  streamHub.attach(server);

  // In-process webhook delivery worker (retry/backoff via BullMQ).
  const webhookWorker = startWebhookWorker();
  logger.info('Webhook delivery worker started');

  // Two-way Telegram bot: long-polls each workspace's configured bot for commands
  // and inline-button taps, driving the same workspace-scoped services (list
  // devices, send/read WhatsApp). Self-scheduling loop (not setInterval).
  startTelegramBot();

  // In-process scheduler tick: fire any due tasks once a minute. A reentrancy
  // guard prevents a slow tick (300-device fleet) from overlapping the next one,
  // which would double-dispatch the same due task/post.
  let schedulerTickRunning = false;
  setInterval(() => {
    if (schedulerTickRunning) return;
    schedulerTickRunning = true;
    void (async () => {
      try {
        const n = await schedulerService.runDue();
        if (n > 0) logger.info(`Scheduler fired ${n} due task(s)`);
      } catch (error) {
        logger.error('Scheduler tick failed', { error: error instanceof Error ? error.message : String(error) });
      }
      // Content calendar: dispatch any scheduled posts whose time has passed.
      try {
        const r = await calendarService.dispatchDue();
        if (r.dispatched > 0) logger.info(`Calendar dispatched ${r.dispatched} post(s)`);
      } catch (error) {
        logger.error('Calendar tick failed', { error: error instanceof Error ? error.message : String(error) });
      } finally {
        schedulerTickRunning = false;
      }
    })();
  }, 60_000).unref();

  // Periodic Vast.ai reconciliation: bring provisioned GPU hosts online and
  // auto-register their cloud phone once the instance is RUNNING.
  let vastSyncRunning = false;
  setInterval(() => {
    if (vastSyncRunning) return;
    vastSyncRunning = true;
    syncAllWorkspaces()
      .then((r) => {
        if (r.hostsUpdated > 0 || r.devicesCreated > 0) {
          logger.info('Vast sync', { ...r });
        }
      })
      .catch((error) => {
        logger.error('Vast sync tick failed', { error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => { vastSyncRunning = false; });
  }, 90_000).unref();

  // Farm engine tick: dispatch humanized RPA runs for active campaigns, honoring
  // per-device daily caps, warmup stages, and active hours.
  let farmTickRunning = false;
  setInterval(() => {
    if (farmTickRunning) return;
    farmTickRunning = true;
    farmService
      .tick()
      .then((r) => {
        if (r.dispatched > 0) logger.info(`Farm engine dispatched ${r.dispatched} action(s)`);
      })
      .catch((error) => {
        logger.error('Farm tick failed', { error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => { farmTickRunning = false; });
  }, 60_000).unref();

  // Proxy revalidation: periodically re-check proxies whose health check is due,
  // updating their rolling score so autoAssign always prefers healthy exits.
  const proxyService = new ProxyService();
  // Reentrancy guard: a slow round (25 proxies × 8s timeout = 200s) must not overlap the
  // next tick and double-check / double-write. Skip if the previous run is still going.
  let proxyRevalRunning = false;
  setInterval(() => {
    if (proxyRevalRunning) return;
    proxyRevalRunning = true;
    proxyService.revalidateDue().then((r) => {
      if (r.checked > 0) logger.info('Proxy revalidation', r);
      // ★2026-07-24: PROXY POOL ALARM. A silently-failing proxy pool is the #1 ban cause —
      // devices keep routing through a dead/degraded proxy. Before this the result was only
      // logged (logger.info), so 4/4 FAILED went unnoticed. Now: if a meaningful share of
      // the checked pool failed, fire PROXY_UNHEALTHY so the operator hears it (fail-open
      // dispatch reaches Telegram even without a custom rule). Threshold: >=half failed.
      if (r.checked >= 2 && r.failed >= Math.ceil(r.checked / 2)) {
        void proxyService.alertUnhealthyPool(r).catch(() => undefined);
      }
    }).catch((error) => {
      logger.error('Proxy revalidation failed', { error: error instanceof Error ? error.message : String(error) });
    }).finally(() => { proxyRevalRunning = false; });
  }, 600_000).unref();

  // ★2026-07-26: thordata KREDİ/GB kontrolü. Kalan trafik biterse cihazlar datacenter-IP'ye
  // düşer (ban riski). Env token(lar)ından kalan GB'yi 12 saatte bir sorgula; eşik altındaysa
  // PROXY_CREDIT_LOW alarmı (top-up hatırlatması). İlk kontrol 30s sonra (boot'u yormaz).
  const runCreditCheck = () => proxyService.checkThordataCredit().catch((e) =>
    logger.warn('thordata credit check failed', { error: e instanceof Error ? e.message : String(e) }));
  setTimeout(runCreditCheck, 30_000).unref();
  setInterval(runCreditCheck, 12 * 60 * 60 * 1000).unref();

  // Offline detection: flip devices/hosts ONLINE -> OFFLINE when their heartbeat
  // goes stale (>5 min) and fire DEVICE_OFFLINE / HOST_OFFLINE alerts. Without
  // this, those two alert triggers would never fire (nothing else marks offline).
  setInterval(() => {
    const staleTime = new Date(Date.now() - 5 * 60 * 1000);
    Promise.all([
      (async () => {
        const stale = await prisma.device.findMany({
          where: { status: 'ONLINE', lastSeen: { lt: staleTime } },
          select: { id: true, name: true, workspaceId: true }
        });
        for (const d of stale) {
          await prisma.device.update({ where: { id: d.id }, data: { status: 'OFFLINE' } });
          void alertsService.evaluate(d.workspaceId ?? undefined, 'DEVICE_OFFLINE', {
            title: `Cihaz çevrimdışı: ${d.name}`,
            detail: 'Cihaz heartbeat zaman aşımına uğradı (>5 dk).'
          });
          // Also fire the DEVICE_OFFLINE webhook event (was defined but never dispatched).
          void webhooksService.dispatch('DEVICE_OFFLINE', { deviceId: d.id, name: d.name }, d.workspaceId ?? undefined);
        }
        // ★2026-07-23 (M-4): FLEET-WIDE BURST alert. Per-device DEVICE_OFFLINE alerts turn a
        // systemic outage (host crash, proxy-provider drop, network) into 50 separate pings
        // that drown each other out — the exact opposite of an early warning. When a large
        // SHARE of a workspace's fleet goes offline in ONE tick, fire a single aggregate
        // FLEET_MASS_OFFLINE per workspace. Grouped so one bad host doesn't alert another
        // tenant. Threshold: ≥3 devices AND ≥30% of that workspace's fleet in one tick.
        if (stale.length >= 3) {
          const byWs = new Map<string, number>();
          for (const d of stale) if (d.workspaceId) byWs.set(d.workspaceId, (byWs.get(d.workspaceId) ?? 0) + 1);
          for (const [ws, count] of byWs) {
            if (count < 3) continue;
            const total = await prisma.device.count({ where: { workspaceId: ws } }).catch(() => 0);
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            if (pct < 30) continue;
            void alertsService.evaluate(ws, 'FLEET_MASS_OFFLINE', {
              title: `🚨 Filoda toplu düşüş — ${count} cihaz (%${pct}) aynı anda çevrimdışı`,
              detail: `Tek bir kontrol turunda ${count} cihaz (filonun %${pct}'i) çevrimdışı oldu — sistemik bir olay olabilir (sunucu/proxy/ağ). Hemen kontrol edin.`,
              value: pct
            });
          }
        }
        return stale.length;
      })(),
      (async () => {
        const stale = await prisma.host.findMany({
          where: { status: 'ONLINE', lastSeenAt: { lt: staleTime } },
          select: { id: true, name: true, workspaceId: true }
        });
        for (const h of stale) {
          await prisma.host.update({ where: { id: h.id }, data: { status: 'OFFLINE' } });
          void alertsService.evaluate(h.workspaceId ?? undefined, 'HOST_OFFLINE', {
            title: `Sunucu çevrimdışı: ${h.name}`,
            detail: 'Sunucu heartbeat zaman aşımına uğradı (>5 dk).'
          });
        }
        // ★2026-07-23 (M-2): HOST SATURATION alert. The agent already reports loadAvg1m /
        // cpuCores / diskFreeGb, but nothing alerted on them — the host had to fully DIE
        // (HOST_OFFLINE) before any warning. That's "after", not "before". Now: for each
        // LIVE host, warn when load ≥ cores×0.9 (CPU saturated — the load-100 storms devices
        // fall from) or free disk < 15GB (a full disk silently breaks provision/snapshot).
        const liveHosts = await prisma.host
          .findMany({
            where: { status: 'ONLINE' },
            select: { id: true, name: true, workspaceId: true, loadAvg1m: true, cpuCores: true, diskFreeGb: true }
          })
          .catch(() => []);
        for (const h of liveHosts) {
          const cores = h.cpuCores ?? 0;
          const load = h.loadAvg1m ?? 0;
          const disk = h.diskFreeGb ?? 999;
          const cpuSat = cores > 0 && load >= cores * 0.9;
          const diskLow = disk < 15;
          if (!cpuSat && !diskLow) continue;
          const parts: string[] = [];
          if (cpuSat) parts.push(`CPU yükü ${load.toFixed(0)}/${cores} (satürasyon)`);
          if (diskLow) parts.push(`boş disk ${disk}GB (kritik)`);
          void alertsService.evaluate(h.workspaceId ?? undefined, 'HOST_SATURATED', {
            title: `⚠️ Sunucu kaynağı kritik: ${h.name}`,
            detail: `${h.name}: ${parts.join(' · ')}. Cihazlar yavaşlayabilir/donabilir; boşta cihazları uyutmayı veya kapasiteyi artırmayı düşünün.`,
            ...(cores > 0 ? { value: Math.round((load / cores) * 100) } : {})
          });
        }
        // ★2026-07-23 (M-3): dead-man's switch. A LIVE host whose wd-health-watch monitor
        // hasn't reported in >20min = the proactive proxy-leak/zombie layer is silently down.
        // Only check hosts that have EVER reported (lastHealthWatchAt not null) so a brand-new
        // host without the heartbeat wired doesn't false-alarm.
        const monitorStale = new Date(Date.now() - 20 * 60 * 1000);
        const monitorDown = liveHosts.length
          ? await prisma.host
              .findMany({
                where: { status: 'ONLINE', lastHealthWatchAt: { not: null, lt: monitorStale } },
                select: { id: true, name: true, workspaceId: true }
              })
              .catch(() => [])
          : [];
        for (const h of monitorDown) {
          const title = `🛑 Sağlık izleyici durdu: ${h.name}`;
          const detail = `${h.name} üzerindeki proaktif sağlık izleyici (proxy-sızıntı/zombie tespiti) 20+ dakikadır rapor vermiyor — izleme katmanı çökmüş olabilir. Sunucuyu kontrol edin.`;
          void alertsService.evaluate(h.workspaceId ?? undefined, 'HOST_SATURATED', { title, detail });
          // ★2026-07-29: bu alarm KURAL TANIMLI OLMASA BİLE gitmeli. İzleme katmanının
          // ölmesi, "her şey yolunda" sanılmasına yol açan en tehlikeli sessizliktir —
          // operatörün önceden bir HOST_SATURATED kuralı oluşturmuş olmasına bel bağlayamayız.
          // ⚠️ Bu tick 60-90 sn'de bir çalışıyor → koşulsuz göndermek MESAJ YAĞMURU olurdu.
          // Host başına 30 dakikada bir kez gönderiyoruz (sorun sürdükçe hatırlatır ama boğmaz).
          const lastPing = monitorDownNotified.get(h.id) ?? 0;
          if (Date.now() - lastPing > 30 * 60 * 1000) {
            monitorDownNotified.set(h.id, Date.now());
            void notificationsService
              .dispatch(h.workspaceId ?? '', {
                title,
                detail,
                telegramButtons: [[{ text: '🔍 Teşhis', callback_data: 'ops:diag' }]]
              })
              .catch(() => undefined);
          }
        }
        return stale.length;
      })(),
      // ★2026-07-29 GÜNLÜK ÖZET: her sabah tek mesaj — "gece ne oldu, şu an durum ne".
      // Amaç sessizlik belirsizliğini bitirmek: sistem sağlıklıysa da rapor gelir, böylece
      // "bildirim gelmiyor çünkü her şey yolunda" ile "bildirim gelmiyor çünkü izleme
      // ölmüş" birbirinden ayrılır (ikincisini raporun kendisi söyler).
      (async () => {
        // ★Saat OPERATÖRÜN diliminde yorumlanır (varsayılan Europe/Istanbul) — aksi
        // halde "sabah 9" UTC'ye göre TR'de 12:00 olurdu.
        const tz = process.env.FLEET_TZ || 'Europe/Istanbul';
        const hour = Number(process.env.FLEET_DIGEST_HOUR ?? 9);
        const now = new Date();
        let localHour: number;
        let today: string;
        try {
          const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz, hour: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit'
          }).formatToParts(now);
          const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
          localHour = Number(get('hour'));
          today = `${get('year')}-${get('month')}-${get('day')}`;
        } catch {
          localHour = now.getUTCHours();
          today = now.toISOString().slice(0, 10);
        }
        if (localHour !== hour || digestSentOn === today) return 0;
        digestSentOn = today;
        const workspaces = await prisma.workspace.findMany({ select: { id: true } }).catch(() => []);
        for (const ws of workspaces) {
          const text = await renderDailyDigest(ws.id).catch(() => null);
          if (!text) continue;
          void notificationsService
            .dispatch(ws.id, {
              title: '',
              detail: text,
              telegramButtons: [[
                { text: '🔍 Teşhis', callback_data: 'ops:diag' },
                { text: '🔧 Kurtar', callback_data: 'ops:fix' }
              ]]
            })
            .catch(() => undefined);
        }
        return workspaces.length;
      })(),
      // Fail jobs that hang PENDING/RUNNING with no agent progress, so the
      // dashboard shows an error instead of an eternal "yükleniyor" spinner.
      reapStaleJobs(),
      // Drop expired public-API Idempotency-Key reservations (24h TTL) so the
      // table stays bounded. Best-effort; a failed sweep just retries next tick.
      sweepIdempotencyKeys().catch(() => 0),
      // ★2026-07-24: GeneratedAccount transient-state reaper. reapStaleJobs only fails the
      // Job row; the account can stay stuck in AWAITING_OTP/REGISTERING forever (VERIFIED: an
      // account 50h in AWAITING_OTP while its register job was COMPLETED — a live desync).
      // Move accounts stuck in a transient state past the grace window to FAILED so the panel
      // stops showing "kayıt sürüyor", the OTP pool + batch counters aren't polluted, and the
      // device frees. Grace (45min) > any real OTP wait, so a genuine in-flight signup is safe.
      prisma.generatedAccount.updateMany({
        where: {
          status: { in: ['AWAITING_OTP', 'REGISTERING', 'CONTACT_READY', 'IDENTITY_READY', 'PENDING'] },
          updatedAt: { lt: new Date(Date.now() - Number(process.env.FLEET_GA_STALE_MIN || 45) * 60 * 1000) }
        },
        data: { status: 'FAILED', error: 'Zaman aşımı — kayıt/OTP akışı tamamlanmadı (otomatik temizlik)' }
      }).then((r) => r.count).catch(() => 0)
    ])
      .then(([devices, hosts, reapedJobs, , staleAccounts]) => {
        if (devices > 0 || hosts > 0 || reapedJobs > 0 || staleAccounts > 0) logger.info('Offline detection', { devices, hosts, reapedJobs, staleAccounts });
      })
      .catch((error) => {
        logger.error('Offline detection tick failed', { error: error instanceof Error ? error.message : String(error) });
      });
  }, 60_000).unref();

  // ★2026-07-24: BAN-WAVE detection. Single bans already alert one-by-one, but a BURST of
  // bans in a short window means a SYSTEMIC problem (a proxy IP-pool got flagged, a country
  // pool burned) — a different, more urgent signal than one ban. Every ~3min, count WhatsApp
  // accounts that transitioned to BANNED/RESTRICTED in the last 15min per workspace; if a
  // workspace crosses the threshold, fire a distinct ban-wave alert so the operator can STOP
  // new registrations before more accounts burn. Reentrancy-guarded; best-effort.
  let banWaveRunning = false;
  setInterval(() => {
    if (banWaveRunning) return;
    banWaveRunning = true;
    (async () => {
      const since = new Date(Date.now() - 15 * 60 * 1000);
      const recent = await prisma.generatedAccount.groupBy({
        by: ['workspaceId'],
        where: { platform: 'whatsapp', status: { in: ['BANNED', 'RESTRICTED'] }, updatedAt: { gte: since } },
        _count: { _all: true }
      }).catch(() => [] as Array<{ workspaceId: string | null; _count: { _all: number } }>);
      const THRESHOLD = Number(process.env.FLEET_BAN_WAVE_THRESHOLD || 3);
      for (const row of recent) {
        if (!row.workspaceId || row._count._all < THRESHOLD) continue;
        void alertsService.evaluate(row.workspaceId, 'ACCOUNT_BANNED', {
          title: `🔴 BAN DALGASI — 15 dakikada ${row._count._all} hesap banlandı/kısıtlandı`,
          detail: `Kısa sürede çok sayıda hesap banlandı; bu SİSTEMİK bir sorun (proxy IP-havuzu kirlendi / bir ülke-havuzu flag'lendi) olabilir. YENİ KAYITLARI DURDURUN ve proxy sağlığını kontrol edin — devam ederse daha fazla değerli hesap yanar.`
        }).catch(() => undefined);
      }
    })().catch((e) => logger.error('ban-wave tick failed', { error: e instanceof Error ? e.message : String(e) }))
      .finally(() => { banWaveRunning = false; });
  }, 180_000).unref();

  // ★2026-07-24: DATA-RETENTION housekeeping. Several tables grow UNBOUNDED with no cleanup
  // (VERIFIED: DeviceMetricPoint 232K rows with a broken %20-epoch prune, Job 81MB TOAST bloat
  // never deleted, RefreshToken 2000+ expired-but-kept, AuditLog/AlertEvent forever). Left
  // alone they slow every query and bloat the DB over months. One timer (every 6h, unref'd,
  // reentrancy-guarded) trims each to a sane window. All deletes are on terminal/expired rows
  // — never live data (an ACTIVE account, a RUNNING job, a valid token). Bounded windows are
  // env-overridable. Mirrors the existing sweepIdempotencyKeys pattern.
  let housekeepingRunning = false;
  const HK_MS = Number(process.env.FLEET_HOUSEKEEPING_MS || 6 * 60 * 60 * 1000); // every 6h
  const runHousekeeping = async () => {
    if (housekeepingRunning) return;
    housekeepingRunning = true;
    const now = Date.now();
    const days = (n: number) => new Date(now - n * 24 * 60 * 60 * 1000);
    try {
      const results: Record<string, number> = {};
      // Device metrics: keep 7 days (chart window). The agent's own %20-epoch prune is
      // unreliable; this deterministic delete is the real retention.
      results.metrics = (await prisma.deviceMetricPoint.deleteMany({ where: { capturedAt: { lt: days(Number(process.env.FLEET_RETAIN_METRICS_DAYS || 7)) } } }).catch(() => ({ count: 0 }))).count;
      // Terminal jobs older than 30d — register history lives on GeneratedAccount.registerLog,
      // so deleting the Job row doesn't lose panel history. Frees the biggest TOAST bloat.
      results.jobs = (await prisma.job.deleteMany({ where: { status: { in: ['COMPLETED', 'FAILED'] }, createdAt: { lt: days(Number(process.env.FLEET_RETAIN_JOBS_DAYS || 30)) } } }).catch(() => ({ count: 0 }))).count;
      // Expired or long-revoked refresh tokens — invalid already, safe to drop.
      results.tokens = (await prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now) } }, { AND: [{ revokedAt: { not: null } }, { revokedAt: { lt: days(30) } }] }] } }).catch(() => ({ count: 0 }))).count;
      // Acknowledged alert events older than 30d (unacked ones stay for the operator).
      results.alerts = (await prisma.alertEvent.deleteMany({ where: { acknowledged: true, createdAt: { lt: days(30) } } }).catch(() => ({ count: 0 }))).count;
      // Audit log older than 90d (compliance-tunable via env).
      results.audit = (await prisma.auditLog.deleteMany({ where: { createdAt: { lt: days(Number(process.env.FLEET_RETAIN_AUDIT_DAYS || 90)) } } }).catch(() => ({ count: 0 }))).count;
      const total = Object.values(results).reduce((a, b) => a + b, 0);
      if (total > 0) logger.info('housekeeping: pruned old rows', results);
    } catch (error) {
      logger.error('housekeeping tick failed', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      housekeepingRunning = false;
    }
  };
  setInterval(() => { void runHousekeeping(); }, HK_MS).unref();
  // Run once ~2min after boot so a long-running instance doesn't wait 6h for the first prune.
  setTimeout(() => { void runHousekeeping(); }, 120_000).unref();

  // ★2026-07-24: bind to loopback by default so the API is NOT directly reachable from
  // the public internet on :4000 (bypassing Caddy's /public + /agent filtering). Caddy
  // reverse-proxies from localhost, so this doesn't change how real traffic arrives — it
  // just removes the open :4000 that exposed /docs.json + non-BFF routes to the world.
  // Override with FLEET_BIND_HOST=0.0.0.0 only if you intentionally need external binding.
  const bindHost = process.env.FLEET_BIND_HOST || '127.0.0.1';
  server.listen(env.port, bindHost, () => {
    logger.info(`API server listening on ${bindHost}:${env.port}`);
    // Resume any broadcast whose in-memory dispatcher was killed by a restart, so its
    // un-dispatched recipients aren't stranded forever (broadcast persist/resume).
    void whatsappService.resumeStrandedBroadcasts().catch(() => undefined);
    // ★2026-07-24: seed default AlertRules for every workspace so proactive alerts fire
    // out of the box. Idempotent (skips triggers a workspace already has a rule for), so
    // it's safe to run on every boot and never clobbers an operator's custom rules.
    void alertsService.seedDefaultRulesAllWorkspaces().catch(() => undefined);
  });

  // ★2026-07-24: real graceful shutdown. Stop accepting new connections, drain the Redis
  // webhook worker AND the Prisma pool (previously $disconnect was never called → the DB
  // pool + Redis could be left mid-operation on restart, widening the half-write window),
  // then exit. A 10s cap ensures we exit even if an in-flight request never finishes, so
  // systemd's Restart=always brings us back cleanly instead of waiting for a SIGKILL.
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(); // stop accepting new connections; existing ones drain
    const done = Promise.allSettled([webhookWorker.close(), prisma.$disconnect()]);
    const cap = new Promise((r) => setTimeout(r, 10_000).unref());
    void Promise.race([done, cap]).finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // A stray rejected promise (e.g. a fire-and-forget webhook/notification dispatch
  // whose caller forgot .catch()) is recoverable — LOG and keep serving.
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { error: reason instanceof Error ? reason.message : String(reason) });
  });
  // An uncaughtException leaves Node in an UNDEFINED state (Node docs) — resuming can
  // corrupt data. Log, then exit so systemd (Restart=always) restarts cleanly, which
  // is what happened before this handler existed. Do NOT log-and-continue here.
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException — exiting for a clean restart', { error: err instanceof Error ? err.stack ?? err.message : String(err) });
    process.exit(1);
  });
}

void main().catch((error) => {
  logger.error('API startup failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
