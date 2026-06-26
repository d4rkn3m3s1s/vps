import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { requireWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { createAsset, deleteAsset, listAssets } from './library.service';

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['IMAGE', 'VIDEO', 'APK', 'COOKIE', 'OTHER']).optional(),
  sizeBytes: z.coerce.number().int().nonnegative().optional(),
  url: z.string().optional(),
  tags: z.array(z.string()).optional()
});

export async function listAssetsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  res.json({ data: await listAssets(workspaceId) });
}

export async function createAssetHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const input = createSchema.parse(req.body);
  const asset = await createAsset(workspaceId, input);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'library.create',
    resourceType: 'library_asset',
    resourceId: asset.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: { name: input.name, type: asset.type },
    workspaceId
  });
  res.status(201).json({ data: asset });
}

export async function deleteAssetHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Asset id is required', 400, 'INVALID_ASSET_ID');
  const result = await deleteAsset(workspaceId, id);
  res.json({ data: result });
}
