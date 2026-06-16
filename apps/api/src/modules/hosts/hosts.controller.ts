import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { writeAuditLog } from '../audit/audit.service';
import { hostsService } from './hosts.service';

const createSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  region: z.string().optional(),
  capacity: z.coerce.number().int().nonnegative().optional(),
  cpuCores: z.coerce.number().int().positive().optional(),
  memoryGb: z.coerce.number().int().positive().optional(),
  kvm: z.boolean().optional()
});

const heartbeatSchema = z.object({
  status: z.enum(['ONLINE', 'OFFLINE', 'DEGRADED']).optional(),
  runningPhones: z.coerce.number().int().nonnegative().optional(),
  capacity: z.coerce.number().int().nonnegative().optional()
});

function requireId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Host id is required', 400, 'INVALID_HOST_ID');
  return id;
}

export async function listHostsHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: await hostsService.list() });
}

export async function createHostHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  const host = await hostsService.create(input);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'host.register',
    resourceType: 'host',
    resourceId: host.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { name: input.name, address: input.address }
  });
  res.status(201).json({ data: host });
}

export async function heartbeatHostHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  const input = heartbeatSchema.parse(req.body);
  res.json({ data: await hostsService.heartbeat(id, input) });
}

export async function deleteHostHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  await hostsService.remove(id);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'host.delete',
    resourceType: 'host',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: { id } });
}
