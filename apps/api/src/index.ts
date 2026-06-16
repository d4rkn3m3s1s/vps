import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './db/prisma';
import { ensureBootstrapIdentity } from './modules/auth/auth.service';
import { deviceHub } from './modules/devices/device.hub';
import { schedulerService } from './modules/scheduler/scheduler.service';

async function main(): Promise<void> {
  await ensureBootstrapIdentity();
  await prisma.$connect();

  const app = createApp();
  const server = createServer(app);
  deviceHub.attach(server);

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

  server.listen(env.port, () => {
    logger.info(`API server listening on port ${env.port}`);
  });
}

void main().catch((error) => {
  logger.error('API startup failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
