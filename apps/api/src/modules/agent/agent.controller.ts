import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { agentService } from './agent.service';

const completeSchema = z.object({
  status: z.enum(['COMPLETED', 'FAILED']),
  result: z.unknown().optional(),
  error: z.string().optional()
});

const heartbeatSchema = z.object({
  runningPhones: z.coerce.number().int().nonnegative().optional(),
  capacity: z.coerce.number().int().nonnegative().optional()
});

const deviceMetricsSchema = z.object({
  devices: z
    .array(
      z.object({
        serial: z.string().min(1),
        cpuUsage: z.coerce.number().min(0).max(100).optional(),
        memoryUsage: z.coerce.number().min(0).max(100).optional(),
        diskUsage: z.coerce.number().min(0).max(100).optional()
      })
    )
    .default([])
});

function requireHost(req: Request) {
  if (!req.hostAgent) throw new AppError('Host agent not authenticated', 401, 'UNAUTHORIZED');
  return req.hostAgent;
}

// Agent long-polls this for the next job to run. Returns { data: null } when idle.
export async function claimNextJobHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const job = await agentService.claimNext(host);
  res.json({ data: job });
}

export async function completeJobHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const jobId = req.params.id;
  if (typeof jobId !== 'string') throw new AppError('Job id is required', 400, 'INVALID_JOB_ID');
  const input = completeSchema.parse(req.body);
  res.json({ data: await agentService.complete(host, jobId, input) });
}

export async function agentHeartbeatHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const input = heartbeatSchema.parse(req.body);
  const updated = await agentService.heartbeat(host, input);
  res.json({ data: { id: updated.id, status: updated.status, lastSeenAt: updated.lastSeenAt } });
}

// Agent reports per-device CPU/mem/disk; we map serial -> deviceId and persist.
export async function updateDeviceMetricsHandler(req: Request, res: Response): Promise<void> {
  const host = requireHost(req);
  const input = deviceMetricsSchema.parse(req.body);
  res.json({ data: await agentService.updateDeviceMetrics(host, input) });
}
