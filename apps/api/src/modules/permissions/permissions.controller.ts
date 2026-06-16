import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { writeAuditLog } from '../audit/audit.service';
import { permissionsService } from './permissions.service';

const grantSchema = z
  .object({
    userId: z.string().min(1),
    groupId: z.string().optional(),
    deviceId: z.string().optional(),
    canView: z.boolean().optional(),
    canControl: z.boolean().optional(),
    canDelete: z.boolean().optional()
  })
  .refine((v) => v.groupId || v.deviceId, { message: 'Either groupId or deviceId is required' });

function requireId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Permission id is required', 400, 'INVALID_PERMISSION_ID');
  return id;
}

export async function listPermissionsHandler(req: Request, res: Response): Promise<void> {
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const data = userId ? await permissionsService.listForUser(userId) : await permissionsService.list();
  res.json({ data });
}

export async function grantPermissionHandler(req: Request, res: Response): Promise<void> {
  const input = grantSchema.parse(req.body);
  const perm = await permissionsService.grant(input);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'permission.grant',
    resourceType: 'permission',
    resourceId: perm.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { targetUser: input.userId, groupId: input.groupId, deviceId: input.deviceId }
  });
  res.status(201).json({ data: perm });
}

export async function revokePermissionHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  await permissionsService.revoke(id);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'permission.revoke',
    resourceType: 'permission',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: { id } });
}
