import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { JobTypes } from '../jobs/job.types';
import { bulkService } from './bulk.service';

const bulkJobSchema = z.object({
  deviceIds: z.array(z.string()).min(1),
  jobType: z.enum(JobTypes),
  payload: z.record(z.any()).optional()
});

const bulkProxySchema = z.object({
  deviceIds: z.array(z.string()).min(1),
  proxyId: z.string().min(1)
});

export async function bulkJobHandler(req: Request, res: Response): Promise<void> {
  const input = bulkJobSchema.parse(req.body);
  const result = await bulkService.runJob(input, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'bulk.job',
    resourceType: 'device',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { jobType: input.jobType, count: result.created }
  });
  res.status(201).json({ data: result });
}

export async function bulkProxyHandler(req: Request, res: Response): Promise<void> {
  const input = bulkProxySchema.parse(req.body);
  const result = await bulkService.setProxy(input, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'bulk.proxy',
    resourceType: 'device',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { proxyId: input.proxyId, count: result.updated }
  });
  res.status(201).json({ data: result });
}
