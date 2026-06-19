import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { grantService } from './grant.service';

export async function listDeviceGrantsHandler(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId);
  res.json({ data: await grantService.listForDevice(deviceId) });
}

export async function listReceivedGrantsHandler(req: Request, res: Response): Promise<void> {
  if (!req.auth?.userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  res.json({ data: await grantService.listReceived(req.auth.userId) });
}

const grantSchema = z.object({
  email: z.string().email(),
  access: z.enum(['VIEW', 'CONTROL']).optional(),
  expiresInHours: z.coerce.number().positive().max(8760).optional()
});

export async function grantHandler(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId);
  if (!req.auth?.userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
  const input = grantSchema.parse(req.body);
  const data = await grantService.grant(deviceId, input, { granterId: req.auth.userId, workspaceId: getWorkspaceId(req) });
  await writeAuditLog({
    userId: req.auth.userId,
    action: 'device.grant',
    resourceType: 'device',
    resourceId: deviceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { email: input.email, access: input.access ?? 'VIEW' }
  });
  res.status(201).json({ data });
}

export async function revokeGrantHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const data = await grantService.revoke(id);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.grant.revoke',
    resourceType: 'device_grant',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip
  });
  res.json({ data });
}

const transferSchema = z.object({ workspace: z.string().min(1) });

export async function transferHandler(req: Request, res: Response): Promise<void> {
  const deviceId = String(req.params.deviceId);
  const { workspace } = transferSchema.parse(req.body);
  const data = await grantService.transfer(deviceId, workspace);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.transfer',
    resourceType: 'device',
    resourceId: deviceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { ...data }
  });
  res.json({ data });
}
