import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { requireWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import * as vast from './vast.service';

const apiKeySchema = z.object({ apiKey: z.string().min(10) });
const offersSchema = z.object({
  maxPrice: z.coerce.number().positive().optional(),
  minGpus: z.coerce.number().int().min(0).optional(),
  query: z.string().optional()
});
const provisionSchema = z.object({
  offerId: z.coerce.number().int().positive(),
  label: z.string().max(60).optional(),
  diskGb: z.coerce.number().int().min(8).max(1024).optional(),
  image: z.string().max(200).optional()
});

// Status: is Vast configured for this workspace? Never returns the key itself.
export async function statusHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  res.json({ data: { configured: await vast.hasApiKey(workspaceId) } });
}

export async function setKeyHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const { apiKey } = apiKeySchema.parse(req.body);
  await vast.setApiKey(workspaceId, apiKey);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'vast.configure',
    resourceType: 'workspace',
    resourceId: workspaceId,
    requestId: req.requestId,
    ip: req.ip,
    workspaceId
  });
  res.json({ data: { configured: true } });
}

export async function clearKeyHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  await vast.clearApiKey(workspaceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'vast.disconnect',
    resourceType: 'workspace',
    resourceId: workspaceId,
    requestId: req.requestId,
    ip: req.ip,
    workspaceId
  });
  res.json({ data: { configured: false } });
}

export async function offersHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const opts = offersSchema.parse(req.query);
  res.json({ data: await vast.searchOffers(workspaceId, opts) });
}

export async function provisionHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const params = provisionSchema.parse(req.body);
  const result = await vast.provision(workspaceId, params);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'vast.provision',
    resourceType: 'host',
    resourceId: result.host.id,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { offerId: params.offerId, instanceId: result.instanceId },
    workspaceId
  });
  res.status(201).json({ data: result });
}

export async function instancesHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  res.json({ data: await vast.listInstances(workspaceId) });
}

export async function syncHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const result = await vast.syncInstances(workspaceId);
  res.json({ data: result });
}

export async function destroyHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new AppError('Invalid instance id', 400, 'INVALID_INSTANCE_ID');
  await vast.destroyInstance(workspaceId, id);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'vast.destroy',
    resourceType: 'host',
    requestId: req.requestId,
    ip: req.ip,
    metadata: { instanceId: id },
    workspaceId
  });
  res.json({ data: { id, destroyed: true } });
}
