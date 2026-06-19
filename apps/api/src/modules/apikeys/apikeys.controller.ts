import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { API_SCOPES, apiKeysService } from './apikeys.service';

const createSchema = z.object({
  name: z.string().min(1).max(60),
  scopes: z.array(z.enum(API_SCOPES)).default(['read'])
});

export async function listApiKeysHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await apiKeysService.list(getWorkspaceId(req)) });
}

export async function createApiKeyHandler(req: Request, res: Response): Promise<void> {
  const { name, scopes } = createSchema.parse(req.body);
  const workspaceId = getWorkspaceId(req);
  const userId = req.auth?.userId;
  const result = await apiKeysService.create({
    name,
    scopes,
    ...(workspaceId ? { workspaceId } : {}),
    ...(userId ? { userId } : {})
  });
  await writeAuditLog({
    userId,
    action: 'apikey.create',
    resourceType: 'api_key',
    resourceId: result.key.id,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { name, scopes },
    ...(workspaceId ? { workspaceId } : {})
  });
  // plaintext is returned exactly once.
  res.status(201).json({ data: result });
}

export async function revokeApiKeyHandler(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('API key id required', 400, 'INVALID_ID');
  const workspaceId = getWorkspaceId(req);
  const key = await apiKeysService.revoke(id, workspaceId);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'apikey.revoke',
    resourceType: 'api_key',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    ...(workspaceId ? { workspaceId } : {})
  });
  res.json({ data: key });
}
