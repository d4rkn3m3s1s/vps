import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { cloudProvidersService } from './cloud-providers.service';

const kindSchema = z.enum(['SELF', 'GEELARK', 'VMOS', 'DUOPLUS', 'UGPHONE']);

const createSchema = z.object({
  name: z.string().min(1),
  kind: kindSchema,
  baseUrl: z.string().url().optional(),
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().min(1).optional()
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().min(1).optional(),
  enabled: z.boolean().optional()
});

const proxySchema = z.object({
  type: z.enum(['HTTP', 'HTTPS', 'SOCKS5']),
  host: z.string().min(1),
  port: z.coerce.number().int().positive(),
  username: z.string().optional(),
  password: z.string().optional()
});

function requireId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('id gerekli', 400, 'INVALID_ID');
  return id;
}
function requireDeviceId(req: Request): string {
  const id = req.params.deviceId;
  if (typeof id !== 'string') throw new AppError('deviceId gerekli', 400, 'INVALID_DEVICE_ID');
  return id;
}

export async function listProvidersHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await cloudProvidersService.list(getWorkspaceId(req)) });
}

export async function createProviderHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  const row = await cloudProvidersService.create(input, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId, action: 'cloudProvider.create', resourceType: 'cloudProvider',
    resourceId: row.id, requestId: req.requestId, ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined, metadata: { kind: input.kind, name: input.name }
  });
  res.status(201).json({ data: row });
}

export async function updateProviderHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  const input = updateSchema.parse(req.body);
  res.json({ data: await cloudProvidersService.update(id, input, getWorkspaceId(req)) });
}

export async function deleteProviderHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  await cloudProvidersService.remove(id, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId, action: 'cloudProvider.delete', resourceType: 'cloudProvider',
    resourceId: id, requestId: req.requestId, ip: req.ip, userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: { id } });
}

export async function checkProviderHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  res.json({ data: await cloudProvidersService.check(id, getWorkspaceId(req)) });
}

export async function syncProviderHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  res.json({ data: await cloudProvidersService.syncPhones(id, getWorkspaceId(req)) });
}

export async function createPhoneHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  const name = z.object({ name: z.string().min(1) }).parse(req.body).name;
  res.status(201).json({ data: await cloudProvidersService.createPhone(id, name, getWorkspaceId(req)) });
}

export async function deviceActionHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const action = z.object({ action: z.enum(['start', 'stop', 'reboot', 'delete']) }).parse(req.body).action;
  res.json({ data: await cloudProvidersService.deviceAction(deviceId, action, getWorkspaceId(req)) });
}

export async function deviceShellHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const command = z.object({ command: z.string().min(1) }).parse(req.body).command;
  res.json({ data: await cloudProvidersService.deviceShell(deviceId, command, getWorkspaceId(req)) });
}

export async function deviceProxyHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  const body = z.object({ proxy: proxySchema.nullable() }).parse(req.body);
  res.json({ data: await cloudProvidersService.deviceSetProxy(deviceId, body.proxy, getWorkspaceId(req)) });
}

export async function deviceScreenshotHandler(req: Request, res: Response): Promise<void> {
  const deviceId = requireDeviceId(req);
  res.json({ data: await cloudProvidersService.deviceScreenshot(deviceId, getWorkspaceId(req)) });
}
