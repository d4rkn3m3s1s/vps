import { createHmac } from 'node:crypto';
import { Queue, Worker, type Job as BullJob } from 'bullmq';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { logger } from '../../lib/logger';

// Connection config mirrors the jobs queue so both share the same Redis.
const redisUrl = new URL(env.redisUrl);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: redisUrl.pathname && redisUrl.pathname !== '/' ? Number(redisUrl.pathname.replace('/', '')) : undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false
};

const QUEUE_NAME = 'vps-webhooks';

// A single delivery job carries the delivery row id; all data is read from the
// DB at attempt time so payloads survive restarts and stay the source of truth.
export type WebhookJobData = { deliveryId: string };

export const webhookQueue = new Queue<WebhookJobData>(QUEUE_NAME, {
  connection,
  prefix: env.redisQueuePrefix
});

// Enqueue a delivery with exponential backoff. 5 attempts: ~0s, 10s, 40s, 90s, 160s.
export async function enqueueDelivery(deliveryId: string): Promise<void> {
  await webhookQueue.add(
    'deliver',
    { deliveryId },
    {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000
    }
  );
}

// Performs one HTTP delivery attempt. Throws on failure so BullMQ retries; the
// final attempt's failure is recorded by the worker's 'failed' handler.
async function attemptDelivery(job: BullJob<WebhookJobData>): Promise<void> {
  const { deliveryId } = job.data;
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true }
  });
  if (!delivery) {
    logger.warn('Webhook delivery row missing; dropping', { deliveryId });
    return;
  }
  const hook = delivery.webhook;
  if (!hook.active) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'FAILED', error: 'Webhook is inactive', attempts: { increment: 1 } }
    });
    return;
  }

  const body = JSON.stringify(delivery.payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Fleet-Event': delivery.event,
    'X-Fleet-Delivery': delivery.id
  };
  if (hook.secret) {
    headers['X-Fleet-Signature'] = createHmac('sha256', hook.secret).update(body).digest('hex');
  }

  const attemptNo = (job.attemptsMade ?? 0) + 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(hook.url, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      await prisma.$transaction([
        prisma.webhookDelivery.update({
          where: { id: deliveryId },
          data: { status: 'SUCCESS', responseCode: res.status, attempts: attemptNo, deliveredAt: new Date(), error: null }
        }),
        prisma.webhook.update({
          where: { id: hook.id },
          data: { lastFiredAt: new Date(), failCount: 0 }
        })
      ]);
      return;
    }
    // Non-2xx: record the attempt and throw so BullMQ retries.
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { responseCode: res.status, attempts: attemptNo, error: `HTTP ${res.status}` }
    });
    throw new Error(`Webhook returned HTTP ${res.status}`);
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : String(error);
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { attempts: attemptNo, error: message }
    });
    throw error instanceof Error ? error : new Error(message);
  }
}

export function startWebhookWorker(): Worker<WebhookJobData> {
  const worker = new Worker<WebhookJobData>(QUEUE_NAME, async (job) => attemptDelivery(job), {
    connection,
    prefix: env.redisQueuePrefix
  });

  // When all retries are exhausted, mark the delivery terminally failed and bump
  // the webhook's failCount (auto-disable handled by the dispatch path).
  worker.on('failed', (job, error) => {
    const deliveryId = job?.data.deliveryId;
    logger.error('Webhook delivery attempt failed', { deliveryId, attempt: job?.attemptsMade, error: error?.message });
    if (job && (job.attemptsMade ?? 0) >= (job.opts.attempts ?? 1) && deliveryId) {
      void prisma.webhookDelivery
        .update({ where: { id: deliveryId }, data: { status: 'FAILED' } })
        .then(() => prisma.webhookDelivery.findUnique({ where: { id: deliveryId } }))
        .then((d) => {
          if (d) return prisma.webhook.update({ where: { id: d.webhookId }, data: { failCount: { increment: 1 } } });
          return undefined;
        })
        .catch((e) => logger.error('Failed to finalize webhook delivery', { deliveryId, error: String(e) }));
    }
  });

  worker.on('completed', (job) => {
    logger.info('Webhook delivered', { deliveryId: job.data.deliveryId });
  });

  return worker;
}
