import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { requireWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { resourcesService } from './resources.service';

const createSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  sortOrder: z.coerce.number().int().optional()
});

const updateSchema = z.object({
  question: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  sortOrder: z.coerce.number().int().optional()
});

export async function listGuidesHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  res.json({ data: await resourcesService.listGuides(workspaceId) });
}

export async function createGuideHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const input = createSchema.parse(req.body);
  const guide = await resourcesService.createGuide(workspaceId, input);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'resource.guide.create',
    resourceType: 'resource_guide',
    resourceId: guide.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    workspaceId
  });
  res.status(201).json({ data: guide });
}

export async function updateGuideHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Guide id is required', 400, 'INVALID_GUIDE_ID');
  const input = updateSchema.parse(req.body);
  res.json({ data: await resourcesService.updateGuide(workspaceId, id, input) });
}

export async function deleteGuideHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Guide id is required', 400, 'INVALID_GUIDE_ID');
  res.json({ data: await resourcesService.deleteGuide(workspaceId, id) });
}
