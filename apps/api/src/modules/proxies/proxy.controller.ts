import type { Request, Response } from 'express';
import { z } from 'zod';
import { countryCodeSchema } from '../../lib/countryCode';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { ProxyService } from './proxy.service';

const proxyService = new ProxyService();

// Curated country catalogue for provider (thordata-style) proxies. ISO-2 + a
// Turkish label. thordata resolves -cc-<CC> for all of these (verified live for
// US/GB/DE/TR/AL). Ordered by how often we farm them.
const PROXY_COUNTRIES: Array<{ code: string; name: string }> = [
  { code: 'US', name: 'Amerika' }, { code: 'GB', name: 'Birleşik Krallık' }, { code: 'DE', name: 'Almanya' },
  { code: 'FR', name: 'Fransa' }, { code: 'NL', name: 'Hollanda' }, { code: 'IT', name: 'İtalya' },
  { code: 'ES', name: 'İspanya' }, { code: 'TR', name: 'Türkiye' }, { code: 'AL', name: 'Arnavutluk' },
  { code: 'BG', name: 'Bulgaristan' }, { code: 'RO', name: 'Romanya' }, { code: 'GR', name: 'Yunanistan' },
  { code: 'PL', name: 'Polonya' }, { code: 'UA', name: 'Ukrayna' }, { code: 'RU', name: 'Rusya' },
  { code: 'PT', name: 'Portekiz' }, { code: 'SE', name: 'İsveç' }, { code: 'NO', name: 'Norveç' },
  { code: 'DK', name: 'Danimarka' }, { code: 'FI', name: 'Finlandiya' }, { code: 'AT', name: 'Avusturya' },
  { code: 'CH', name: 'İsviçre' }, { code: 'BE', name: 'Belçika' }, { code: 'IE', name: 'İrlanda' },
  { code: 'CA', name: 'Kanada' }, { code: 'BR', name: 'Brezilya' }, { code: 'MX', name: 'Meksika' },
  { code: 'AR', name: 'Arjantin' }, { code: 'IN', name: 'Hindistan' }, { code: 'ID', name: 'Endonezya' },
  { code: 'PH', name: 'Filipinler' }, { code: 'VN', name: 'Vietnam' }, { code: 'TH', name: 'Tayland' },
  { code: 'MY', name: 'Malezya' }, { code: 'SG', name: 'Singapur' }, { code: 'BD', name: 'Bangladeş' },
  { code: 'PK', name: 'Pakistan' }, { code: 'AE', name: 'BAE' }, { code: 'SA', name: 'Suudi Arabistan' },
  { code: 'EG', name: 'Mısır' }, { code: 'ZA', name: 'Güney Afrika' }, { code: 'NG', name: 'Nijerya' },
  { code: 'AU', name: 'Avustralya' }, { code: 'NZ', name: 'Yeni Zelanda' }, { code: 'JP', name: 'Japonya' }
];

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
  countryCode: countryCodeSchema.optional()
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

// List provider proxies (country-selectable residential accounts).
export async function listProvidersHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await proxyService.listProviders(getWorkspaceId(req)) });
}

// Countries a provider proxy can exit from. thordata-style accounts support the
// full residential catalogue; we expose a curated ISO-2 list with names.
export async function proxyCountriesHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: PROXY_COUNTRIES });
}

// Route a device through a provider proxy for a chosen country.
const countryAssignSchema = z.object({
  deviceId: z.string().min(1),
  providerId: z.string().min(1),
  countryCode: countryCodeSchema
});
export async function assignCountryProxyHandler(req: Request, res: Response): Promise<void> {
  const input = countryAssignSchema.parse(req.body);
  const result = await proxyService.assignCountryProxy(input.deviceId, input.providerId, input.countryCode, getWorkspaceId(req));
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'proxy.assignCountry',
    resourceType: 'device',
    resourceId: input.deviceId,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { providerId: input.providerId, country: result.country }
  });
  res.status(201).json({ data: result });
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
