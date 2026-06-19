import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { JobTypes } from '../jobs/job.types';
import { schedulerService } from './scheduler.service';

const createSchema = z.object({
  name: z.string().min(1),
  jobType: z.enum(JobTypes),
  deviceId: z.string().optional(),
  payload: z.record(z.any()).optional(),
  repeat: z.enum(['ONCE', 'HOURLY', 'DAILY', 'WEEKLY']).optional(),
  nextRunAt: z.string().datetime()
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).optional(),
  repeat: z.enum(['ONCE', 'HOURLY', 'DAILY', 'WEEKLY']).optional(),
  nextRunAt: z.string().datetime().optional()
});

function requireId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Schedule id is required', 400, 'INVALID_SCHEDULE_ID');
  return id;
}

export async function listSchedulesHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await schedulerService.list(getWorkspaceId(req)) });
}

export async function createScheduleHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  const task = await schedulerService.create(input, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'schedule.create',
    resourceType: 'schedule',
    resourceId: task.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { name: input.name, jobType: input.jobType, repeat: input.repeat ?? 'ONCE' }
  });
  res.status(201).json({ data: task });
}

export async function updateScheduleHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  const input = updateSchema.parse(req.body);
  res.json({ data: await schedulerService.update(id, input) });
}

export async function deleteScheduleHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  await schedulerService.remove(id);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'schedule.delete',
    resourceType: 'schedule',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: { id } });
}

export async function runDueHandler(_req: Request, res: Response): Promise<void> {
  const count = await schedulerService.runDue();
  res.json({ data: { triggered: count } });
}
