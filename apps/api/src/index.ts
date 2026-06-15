import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './db/prisma';
import { ensureBootstrapIdentity } from './modules/auth/auth.service';
import { deviceHub } from './modules/devices/device.hub';

async function main(): Promise<void> {
  await ensureBootstrapIdentity();
  await prisma.$connect();

  const app = createApp();
  const server = createServer(app);
  deviceHub.attach(server);

  server.listen(env.port, () => {
    logger.info(`API server listening on port ${env.port}`);
  });
}

void main().catch((error) => {
  logger.error('API startup failed', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
