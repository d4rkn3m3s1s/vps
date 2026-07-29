import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireWorkspaceId } from '../../lib/workspaceContext';
import { listNotifications, markRead, clearNotifications } from './feed.service';

// Bildirim merkezi beslemesi. Kanal (Slack/webhook hedefi) yönetimiyle KARIŞTIRMAYIN:
// `notifications.controller.ts` bildirimlerin nereye GÖNDERİLECEĞİNİ yönetir, bu dosya
// panelin zil ikonundaki listeyi sunar.

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  unreadOnly: z.enum(['true', 'false']).optional()
});

export async function listFeedHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const q = listQuerySchema.parse(req.query);
  const { items, unreadCount } = await listNotifications(workspaceId, {
    ...(q.limit ? { limit: q.limit } : {}),
    ...(q.unreadOnly === 'true' ? { unreadOnly: true } : {})
  });
  res.json({ data: items, meta: { unreadCount } });
}

const readSchema = z.object({
  // Boş/eksik ids → hepsi okundu (panelde zil açılınca yapılan davranış).
  ids: z.array(z.string().min(1)).max(200).optional()
});

export async function markReadHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const { ids } = readSchema.parse(req.body ?? {});
  const count = await markRead(workspaceId, ids);
  res.json({ data: { updated: count } });
}

export async function clearFeedHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requireWorkspaceId(req);
  const count = await clearNotifications(workspaceId);
  res.json({ data: { deleted: count } });
}
