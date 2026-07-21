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

async function main(): Promise<void> {
  await ensureBootstrapIdentity();
  await ensureDefaultWorkspace();
  await prisma.$connect();

  const app = createApp();
  const server = createServer(app);
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
  setInterval(() => {
    proxyService.revalidateDue().then((r) => {
      if (r.checked > 0) logger.info('Proxy revalidation', r);
    }).catch((error) => {
      logger.error('Proxy revalidation failed', { error: error instanceof Error ? error.message : String(error) });
    });
  }, 600_000).unref();

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
        return stale.length;
      })(),
      // Fail jobs that hang PENDING/RUNNING with no agent progress, so the
      // dashboard shows an error instead of an eternal "yükleniyor" spinner.
      reapStaleJobs(),
      // Drop expired public-API Idempotency-Key reservations (24h TTL) so the
      // table stays bounded. Best-effort; a failed sweep just retries next tick.
      sweepIdempotencyKeys().catch(() => 0)
    ])
      .then(([devices, hosts, reapedJobs]) => {
        if (devices > 0 || hosts > 0 || reapedJobs > 0) logger.info('Offline detection', { devices, hosts, reapedJobs });
      })
      .catch((error) => {
        logger.error('Offline detection tick failed', { error: error instanceof Error ? error.message : String(error) });
      });
  }, 60_000).unref();

  server.listen(env.port, () => {
    logger.info(`API server listening on port ${env.port}`);
    // Resume any broadcast whose in-memory dispatcher was killed by a restart, so its
    // un-dispatched recipients aren't stranded forever (broadcast persist/resume).
    void whatsappService.resumeStrandedBroadcasts().catch(() => undefined);
  });

  // Clean up the worker on shutdown so Redis connections drain gracefully.
  const shutdown = () => {
    void webhookWorker.close();
    server.close();
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
