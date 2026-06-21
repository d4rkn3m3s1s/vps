import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { ProxyService } from './proxy.service';

const proxyService = new ProxyService();

const createSchema = z.object({
  label: z.string().min(1),
  type: z.enum(['HTTP', 'HTTPS', 'SOCKS5']).optional(),
  host: z.string().min(1),
  port: z.coerce.number().int().positive(),
  username: z.string().optional(),
  password: z.string().optional(),
  group: z.string().optional(),
  isp: z.string().optional(),
  remarks: z.string().optional(),
  countryCode: z.string().length(2).optional()
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['UNKNOWN', 'OK', 'FAILED']).optional(),
  exportIp: z.string().nullable().optional()
});

function requireId(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Proxy id is required', 400, 'INVALID_PROXY_ID');
  return id;
}

export async function listProxiesHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await proxyService.list(getWorkspaceId(req)) });
}

export async function createProxyHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  const proxy = await proxyService.create(input, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'proxy.create',
    resourceType: 'proxy',
    resourceId: proxy.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { label: input.label, host: input.host, port: input.port }
  });
  res.status(201).json({ data: proxy });
}

export async function updateProxyHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  const input = updateSchema.parse(req.body);
  const proxy = await proxyService.update(id, input, getWorkspaceId(req));
  res.json({ data: proxy });
}

export async function deleteProxyHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  await proxyService.remove(id, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'proxy.delete',
    resourceType: 'proxy',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: { id } });
}

export async function checkProxyHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  const proxy = await proxyService.check(id, getWorkspaceId(req));
  res.json({ data: proxy });
}

const importSchema = z.object({
  text: z.string().min(1).max(500_000),
  type: z.enum(['HTTP', 'HTTPS', 'SOCKS5']).optional(),
  group: z.string().optional()
});

// Bulk-import a provider's proxy list into the pool.
export async function importProxiesHandler(req: Request, res: Response): Promise<void> {
  const { text, type, group } = importSchema.parse(req.body);
  const result = await proxyService.bulkImport(text, { type, group }, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'proxy.import',
    resourceType: 'proxy',
    requestId: req.requestId,
    ip: req.ip,
    metadata: { ...result }
  });
  res.status(201).json({ data: result });
}

const assignSchema = z.object({ deviceId: z.string().min(1) });

// Auto-assign a geo-matched healthy proxy to a device.
export async function autoAssignProxyHandler(req: Request, res: Response): Promise<void> {
  const { deviceId } = assignSchema.parse(req.body);
  const result = await proxyService.autoAssignGeoMatched(deviceId, getWorkspaceId(req));
  res.json({ data: result });
}

// IP-change endpoint: rotates the proxy's exit IP. For rotating/residential
// proxies this hits the provider's change-IP URL; here it re-probes the exit IP.
export async function rotateProxyHandler(req: Request, res: Response): Promise<void> {
  const id = requireId(req);
  const proxy = await proxyService.check(id, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'proxy.rotate',
    resourceType: 'proxy',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined
  });
  res.json({ data: proxy });
}
