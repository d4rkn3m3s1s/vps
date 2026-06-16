import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { writeAuditLog } from '../audit/audit.service';
import { createJob, createJobRecord, getJob, listJobs } from './jobs.service';
import { JobTypes } from './job.types';

const jobQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25)
});

const createJobSchema = z.object({
  type: z.enum(JobTypes),
  emulatorId: z.string().optional(),
  payload: z.record(z.any()).optional()
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

export async function createJobHandler(req: Request, res: Response): Promise<void> {
  const input = createJobSchema.parse(req.body);
  // Dashboard sends a Device id (or none). Job.emulatorId is a FK to the
  // Emulator table, so we carry the target id in the payload instead of as the
  // FK to avoid a foreign-key violation.
  const payload = { ...(input.payload ?? {}), ...(input.emulatorId ? { deviceId: input.emulatorId } : {}) };
  const job = await createJobRecord(input.type, payload);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'job.create',
    resourceType: 'job',
    resourceId: job.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { type: input.type }
  });
  res.status(201).json({ data: job });
}
