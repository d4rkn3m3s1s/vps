import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { requireWorkspaceId } from '../../lib/workspaceContext';
import { writeAuditLog } from '../audit/audit.service';
import { notificationsService } from './notifications.service';

const saveSchema = z.object({
  type: z.enum(['telegram', 'slack', 'discord']),
  config: z.record(z.string(), z.unknown())
});

export async function listChannelsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  res.json({ data: await notificationsService.getChannels(workspaceId) });
}

export async function saveChannelHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const input = saveSchema.parse(req.body);
  const channel = await notificationsService.saveChannel(workspaceId, input.type, input.config);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'notification.channel.save',
    resourceType: 'notification_channel',
    resourceId: channel.id,
    requestId: req.requestId,
    ip: req.ip,
    metadata: { type: input.type },
    workspaceId
  });
  res.status(201).json({ data: channel });
}

export async function deleteChannelHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Kanal id gerekli', 400, 'INVALID_ID');
  await notificationsService.deleteChannel(workspaceId, id);
  await writeAuditLog({
    userId: req.auth?.userId,
    action: 'notification.channel.delete',
    resourceType: 'notification_channel',
    resourceId: id,
    requestId: req.requestId,
    ip: req.ip,
    workspaceId
  });
  res.json({ data: { id } });
}

export async function testChannelHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const id = req.params.id;
  if (typeof id !== 'string') throw new AppError('Kanal id gerekli', 400, 'INVALID_ID');
  res.json({ data: await notificationsService.sendTest(workspaceId, id) });
}
