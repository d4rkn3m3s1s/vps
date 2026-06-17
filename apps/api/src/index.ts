import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './db/prisma';
import { ensureBootstrapIdentity } from './modules/auth/auth.service';
import { ensureDefaultWorkspace } from './modules/workspace/workspace.bootstrap';
import { deviceHub } from './modules/devices/device.hub';
import { schedulerService } from './modules/scheduler/scheduler.service';
import { startWebhookWorker } from './modules/webhooks/webhook.queue';
import { syncAllWorkspaces } from './modules/vast/vast.service';

async function main(): Promise<void> {
  await ensureBootstrapIdentity();
  await ensureDefaultWorkspace();
  await prisma.$connect();

  const app = createApp();
  const server = createServer(app);
  deviceHub.attach(server);

  // In-process webhook delivery worker (retry/backoff via BullMQ).
  const webhookWorker = startWebhookWorker();
  logger.info('Webhook delivery worker started');

  // In-process scheduler tick: fire any due tasks once a minute.
  setInterval(() => {
    schedulerService
      .runDue()
      .then((n) => {
        if (n > 0) logger.info(`Scheduler fired ${n} due task(s)`);
      })
      .catch((error) => {
        logger.error('Scheduler tick failed', { error: error instanceof Error ? error.message : String(error) });
      });
  }, 60_000).unref();

  // Periodic Vast.ai reconciliation: bring provisioned GPU hosts online and
  // auto-register their cloud phone once the instance is RUNNING.
  setInterval(() => {
    syncAllWorkspaces()
      .then((r) => {
        if (r.hostsUpdated > 0 || r.devicesCreated > 0) {
          logger.info('Vast sync', { ...r });
        }
      })
      .catch((error) => {
        logger.error('Vast sync tick failed', { error: error instanceof Error ? error.message : String(error) });
      });
  }, 90_000).unref();

  server.listen(env.port, () => {
    logger.info(`API server listening on port ${env.port}`);
  });

  // Clean up the worker on shutdown so Redis connections drain gracefully.
  const shutdown = () => {
    void webhookWorker.close();
    server.close();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

void main().catch((error) => {
  logger.error('API startup failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
