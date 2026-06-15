import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { createJob, getJob, listJobs } from './jobs.service';

const jobQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25)
});

function requireJobId(req: Request): string {
  const jobId = req.params.id;
  if (typeof jobId !== 'string') {
    throw new AppError('Job id is required', 400, 'INVALID_JOB_ID');
  }

  return jobId;
}

export async function getJobsHandler(req: Request, res: Response): Promise<void> {
  const { limit } = jobQuerySchema.parse(req.query);
  const jobs = await listJobs();
  res.json({ data: jobs.slice(0, limit) });
}

export async function getJobHandler(req: Request, res: Response): Promise<void> {
  const job = await getJob(requireJobId(req));
  if (!job) {
    res.status(404).json({ error: 'JOB_NOT_FOUND', message: 'Job not found' });
    return;
  }

  res.json({ data: job });
}

export async function enqueueDemoJobHandler(req: Request, res: Response): Promise<void> {
  const emulatorId = requireJobId(req);
  const job = await createJob('EMULATOR_SHELL', { emulatorId, command: 'echo demo' }, emulatorId);
  res.status(202).json({ data: job });
}
