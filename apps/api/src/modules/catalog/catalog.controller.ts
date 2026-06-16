import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { writeAuditLog } from '../audit/audit.service';
import { catalogService } from './catalog.service';

const installAppSchema = z.object({
  packageName: z.string().min(1),
  deviceIds: z.array(z.string()).min(1)
});

const useTemplateSchema = z.object({
  deviceIds: z.array(z.string()).min(1)
});

export async function listAppsHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: await catalogService.listApps() });
}

export async function installAppHandler(req: Request, res: Response): Promise<void> {
  const input = installAppSchema.parse(req.body);
  const result = await catalogService.installApp(input.packageName, input.deviceIds);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'app.install',
    resourceType: 'app',
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { packageName: input.packageName, count: result.installed }
  });
  res.status(201).json({ data: result });
}

export async function listTemplatesHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: await catalogService.listTemplates() });
}

export async function useTemplateHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Template id is required', 400, 'INVALID_TEMPLATE_ID');
  const { deviceIds } = useTemplateSchema.parse(req.body);
  const result = await catalogService.useTemplate(id, deviceIds);
  res.status(201).json({ data: result });
}

export async function listListingsHandler(_req: Request, res: Response): Promise<void> {
  res.json({ data: await catalogService.listListings() });
}

export async function installListingHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Listing id is required', 400, 'INVALID_LISTING_ID');
  const listing = await catalogService.installListing(id);
  if (!listing) throw new AppError('Listing not found', 404, 'LISTING_NOT_FOUND');
  res.json({ data: listing });
}
