import { Queue, Worker } from 'bullmq';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import type { JobPayload, JobType } from './job.types';
import { processJob } from './processor';

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

export const jobQueue = new Queue('vps-jobs', {
  connection,
  prefix: env.redisQueuePrefix
});

export function startJobWorker(): Worker<JobPayload, unknown, JobType> {
  return new Worker<JobPayload, unknown, JobType>(
    'vps-jobs',
    async (job) => processJob(job),
    { connection, prefix: env.redisQueuePrefix }
  );
}

export function registerWorkerTelemetry(worker: Worker<JobPayload, unknown, JobType>): void {
  worker.on('completed', (job) => {
    logger.info('Job completed', { jobId: job.id, name: job.name });
  });

  worker.on('failed', (job, error) => {
    logger.error('Job failed', { jobId: job?.id, name: job?.name, error: error?.message });
  });
}
