import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { permissionsService } from '../permissions/permissions.service';
import { adbBridgeService } from './adbBridge.service';

const execSchema = z.object({ command: z.string().min(1).max(2000) });
const exposeSchema = z.object({
  publicHost: z.string().min(1).optional(),
  publicPort: z.coerce.number().int().min(1).max(65535).optional(),
  // CIDR or plain IPs; empty list means "no IP restriction" (discouraged).
  allowlist: z.array(z.string().min(1)).max(50).optional()
});

function deviceId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Device id required', 400, 'INVALID_DEVICE_ID');
  return id;
}

export async function connectInfoHandler(req: Request, res: Response): Promise<void> {
  const id = deviceId(req);
  if (req.auth) await permissionsService.assertDeviceAccess(req.auth.userId, req.auth.role, id, 'view');
  res.json({ data: await adbBridgeService.connectInfo(id, getWorkspaceId(req)) });
}

export async function execHandler(req: Request, res: Response): Promise<void> {
  const id = deviceId(req);
  if (req.auth) await permissionsService.assertDeviceAccess(req.auth.userId, req.auth.role, id, 'control');
  const { command } = execSchema.parse(req.body);
  const result = await adbBridgeService.exec(id, command, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.adb.exec',
    resourceType: 'device',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { command },
    ...(getWorkspaceId(req) ? { workspaceId: getWorkspaceId(req) } : {})
  });
  res.json({ data: result });
}

export async function exposeHandler(req: Request, res: Response): Promise<void> {
  const id = deviceId(req);
  const params = exposeSchema.parse(req.body);
  const result = await adbBridgeService.expose(id, params, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.adb.expose',
    resourceType: 'device',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { publicPort: params.publicPort, allowlist: params.allowlist ?? [] },
    ...(getWorkspaceId(req) ? { workspaceId: getWorkspaceId(req) } : {})
  });
  res.json({ data: result });
}

export async function unexposeHandler(req: Request, res: Response): Promise<void> {
  const id = deviceId(req);
  const result = await adbBridgeService.unexpose(id, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'device.adb.unexpose',
    resourceType: 'device',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    ...(getWorkspaceId(req) ? { workspaceId: getWorkspaceId(req) } : {})
  });
  res.json({ data: result });
}
