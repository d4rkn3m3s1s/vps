import { logger } from './lib/logger';
import { registerWorkerTelemetry, startJobWorker } from './modules/jobs/queue';

const worker = startJobWorker();
registerWorkerTelemetry(worker);

worker.on('ready', () => {
  logger.info('Job worker ready');
});

worker.on('error', (error) => {
  logger.error('Job worker error', { error: error.message });
});
