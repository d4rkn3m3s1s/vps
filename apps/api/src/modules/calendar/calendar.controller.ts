import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { calendarService } from './calendar.service';

const createSchema = z.object({
  caption: z.string().max(2200).default(''),
  platform: z.string().max(40).default('other'),
  mediaUrl: z.string().url().max(2000).optional(),
  groupId: z.string().optional(),
  deviceIds: z.array(z.string()).max(2000).optional(),
  rpaFlowId: z.string().optional(),
  scheduledFor: z.string()
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['SCHEDULED', 'CANCELED']).optional()
});

export async function listPostsHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await calendarService.list(getWorkspaceId(req)) });
}

export async function createPostHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  const data = await calendarService.create(input, { workspaceId: getWorkspaceId(req), userId: req.auth?.userId });
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'calendar.post.create',
    resourceType: 'scheduled_post',
    resourceId: data.id,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { platform: input.platform, scheduledFor: input.scheduledFor }
  });
  res.status(201).json({ data });
}

export async function updatePostHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  const input = updateSchema.parse(req.body);
  res.json({ data: await calendarService.update(id, input, getWorkspaceId(req)) });
}

export async function deletePostHandler(req: Request, res: Response): Promise<void> {
  const id = String(req.params.id);
  res.json({ data: await calendarService.remove(id, getWorkspaceId(req)) });
}
