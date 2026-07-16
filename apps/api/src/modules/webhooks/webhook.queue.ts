import { createHmac } from 'node:crypto';
import { Queue, Worker, type Job as BullJob } from 'bullmq';
import { env } from '../../config/env';
import { prisma } from '../../db/prisma';
import { logger } from '../../lib/logger';
import { assertSafePublicUrl } from '../../lib/urlGuard';

// Connection config mirrors the jobs queue so both share the same Redis. Redis is
// OPTIONAL infrastructure: the primary job path is the host agent, and webhooks
// degrade gracefully when Redis is down. So we never let a missing/unreachable
// Redis crash the API — connect lazily, cap reconnect backoff, and swallow
// connection errors with a warning instead of an unhandled throw.
const redisUrl = new URL(env.redisUrl);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: redisUrl.pathname && redisUrl.pathname !== '/' ? Number(redisUrl.pathname.replace('/', '')) : undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
  // Keep retrying with a capped backoff (max 10s) so it auto-recovers when Redis
  // comes back, without a tight reconnect loop.
  retryStrategy: (times: number) => Math.min(times * 500, 10_000)
};

const QUEUE_NAME = 'vps-webhooks';

// A single delivery job carries the delivery row id; all data is read from the
// DB at attempt time so payloads survive restarts and stay the source of truth.
export type WebhookJobData = { deliveryId: string };

export const webhookQueue = new Queue<WebhookJobData>(QUEUE_NAME, {
  connection,
  prefix: env.redisQueuePrefix
});

let warnedNoRedis = false;
// Without this handler, ioredis emits 'error' as an unhandled event → process crash.
// We log once and keep going; deliveries simply wait until Redis is reachable.
webhookQueue.on('error', (err) => {
  if (!warnedNoRedis) {
    logger.warn('Webhook queue Redis unavailable — webhook delivery paused until Redis is reachable', { error: err.message });
    warnedNoRedis = true;
  }
});

// Enqueue a delivery with exponential backoff. 5 attempts: ~0s, 10s, 40s, 90s, 160s.
// Never throws to the caller: webhook delivery is best-effort, so a Redis outage
// must not break the state-changing action that triggered the webhook.
export async function enqueueDelivery(deliveryId: string): Promise<void> {
  try {
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
  } catch (err) {
    logger.warn('Could not enqueue webhook delivery (Redis down?)', { deliveryId, error: err instanceof Error ? err.message : String(err) });
  }
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
    // SSRF guard AT DELIVERY TIME (not just create): the URL is re-resolved here, so
    // re-validate right before the request to defeat DNS-rebinding (a hostname that
    // was public at create time can be re-pointed to 169.254.169.254 / an internal IP).
    // redirect:'manual' stops a 3xx from bouncing us into an internal service — the
    // non-2xx branch below treats it as a failed attempt instead of following it.
    await assertSafePublicUrl(hook.url);
    const res = await fetch(hook.url, { method: 'POST', headers, body, redirect: 'manual', signal: controller.signal });
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

  // Swallow Redis connection errors so a missing Redis can't crash the API.
  let workerWarned = false;
  worker.on('error', (err) => {
    if (!workerWarned) {
      logger.warn('Webhook worker Redis unavailable — will resume when Redis is back', { error: err.message });
      workerWarned = true;
    }
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
