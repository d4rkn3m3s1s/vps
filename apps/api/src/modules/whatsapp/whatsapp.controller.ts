import type { Request, Response } from 'express';
import { z } from 'zod';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { whatsappService } from './whatsapp.service';
import { writeAuditLog } from '../audit/audit.service';

// ── conversation list ───────────────────────────────────────────────────────

const listConvSchema = z.object({
  deviceId: z.string().min(1),
  filter: z.enum(['all', 'unread', 'favorite', 'archived']).optional(),
  labelId: z.string().min(1).optional(),
  search: z.string().max(120).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).optional()
});
export async function listConversationsHandler(req: Request, res: Response): Promise<void> {
  const input = listConvSchema.parse(req.query);
  const result = await whatsappService.listConversations(getWorkspaceId(req), input);
  res.json({
    data: {
      conversations: result.conversations.map((c) => ({
        ...c,
        lastMessageAt: c.lastMessageAt.toISOString()
      })),
      nextCursor: result.nextCursor
    }
  });
}

const unreadSchema = z.object({ deviceId: z.string().min(1) });
export async function unreadTotalHandler(req: Request, res: Response): Promise<void> {
  const { deviceId } = unreadSchema.parse(req.query);
  const total = await whatsappService.unreadTotal(getWorkspaceId(req), deviceId);
  res.json({ data: { unread: total } });
}

// ── a single thread ─────────────────────────────────────────────────────────

const threadSchema = z.object({
  deviceId: z.string().min(1),
  peer: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).optional(),
  before: z.string().min(1).optional()
});
export async function threadMessagesHandler(req: Request, res: Response): Promise<void> {
  const input = threadSchema.parse(req.query);
  const result = await whatsappService.getThreadMessages(getWorkspaceId(req), input);
  res.json({
    data: {
      messages: result.messages.map((m) => ({
        ...m,
        waTimestamp: m.waTimestamp.toISOString(),
        createdAt: m.createdAt.toISOString()
      })),
      nextBefore: result.nextBefore
    }
  });
}

const markReadSchema = z.object({ deviceId: z.string().min(1), peer: z.string().min(1) });
export async function markReadHandler(req: Request, res: Response): Promise<void> {
  const input = markReadSchema.parse(req.body);
  await whatsappService.markRead(getWorkspaceId(req), input);
  res.json({ data: { ok: true } });
}

// ── operator state: favourite / archive / labels ────────────────────────────

const stateSchema = z.object({
  deviceId: z.string().min(1),
  peer: z.string().min(1),
  favorite: z.boolean().optional(),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional()
});
export async function setStateHandler(req: Request, res: Response): Promise<void> {
  const input = stateSchema.parse(req.body);
  await whatsappService.setConversationState(getWorkspaceId(req), input);
  res.json({ data: { ok: true } });
}

// ── contact info (name + notes) ──────────────────────────────────────────────

const contactGetSchema = z.object({ deviceId: z.string().min(1), peer: z.string().min(1) });
export async function getContactHandler(req: Request, res: Response): Promise<void> {
  const input = contactGetSchema.parse(req.query);
  const info = await whatsappService.getContactInfo(getWorkspaceId(req), input);
  res.json({ data: info });
}

// Lazy-load one thread's avatar data-URI (kept out of the list payload).
const avatarGetSchema = z.object({ deviceId: z.string().min(1), peer: z.string().min(1) });
export async function getAvatarHandler(req: Request, res: Response): Promise<void> {
  const input = avatarGetSchema.parse(req.query);
  const av = await whatsappService.getAvatar(getWorkspaceId(req), input);
  res.json({ data: av });
}

const contactSetSchema = z.object({
  deviceId: z.string().min(1),
  peer: z.string().min(1),
  displayName: z.string().max(120).optional(),
  notes: z.string().max(4000).optional()
});
export async function setContactHandler(req: Request, res: Response): Promise<void> {
  const input = contactSetSchema.parse(req.body);
  await whatsappService.setContactInfo(getWorkspaceId(req), input);
  res.json({ data: { ok: true } });
}

// ── bulk actions ─────────────────────────────────────────────────────────────

const bulkSchema = z.object({
  deviceId: z.string().min(1),
  peers: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(['read', 'archive', 'unarchive', 'favorite', 'unfavorite', 'pin', 'unpin', 'addLabel', 'removeLabel']),
  labelId: z.string().min(1).optional()
});
export async function bulkActionHandler(req: Request, res: Response): Promise<void> {
  const input = bulkSchema.parse(req.body);
  const result = await whatsappService.bulkAction(getWorkspaceId(req), input);
  res.json({ data: result });
}

// ── canned replies (templates) ───────────────────────────────────────────────

export async function listCannedHandler(req: Request, res: Response): Promise<void> {
  const replies = await whatsappService.listCannedReplies(getWorkspaceId(req));
  res.json({ data: { replies } });
}

const createCannedSchema = z.object({
  title: z.string().min(1).max(80),
  body: z.string().min(1).max(4096),
  shortcut: z.string().max(30).optional(),
  sortOrder: z.number().int().optional()
});
export async function createCannedHandler(req: Request, res: Response): Promise<void> {
  const input = createCannedSchema.parse(req.body);
  const reply = await whatsappService.createCannedReply(getWorkspaceId(req), input);
  res.status(201).json({ data: reply });
}

const updateCannedSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  body: z.string().min(1).max(4096).optional(),
  shortcut: z.string().max(30).optional(),
  sortOrder: z.number().int().optional()
});
export async function updateCannedHandler(req: Request, res: Response): Promise<void> {
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  const input = updateCannedSchema.parse(req.body);
  await whatsappService.updateCannedReply(getWorkspaceId(req), id, input);
  res.json({ data: { ok: true } });
}

export async function deleteCannedHandler(req: Request, res: Response): Promise<void> {
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  await whatsappService.deleteCannedReply(getWorkspaceId(req), id);
  res.json({ data: { ok: true } });
}

// ── stats ─────────────────────────────────────────────────────────────────────

const statsSchema = z.object({
  deviceId: z.string().min(1).optional(),
  sinceHours: z.coerce.number().int().positive().max(720).optional()
});
export async function statsHandler(req: Request, res: Response): Promise<void> {
  const input = statsSchema.parse(req.query);
  const stats = await whatsappService.getStats(getWorkspaceId(req), input);
  res.json({ data: stats });
}

// ── broadcast ──────────────────────────────────────────────────────────────

const broadcastSchema = z.object({
  deviceId: z.string().min(1),
  // Optional extra sending devices — recipients are sharded across the pool so the
  // devices send in parallel (deviceId is always included as the primary).
  deviceIds: z.array(z.string().min(1)).max(64).optional(),
  message: z.string().min(1).max(4096),
  peers: z.array(z.string().min(1)).max(1000).optional(),
  labelId: z.string().min(1).optional(),
  minGapSec: z.number().int().min(2).max(600).optional(),
  maxGapSec: z.number().int().min(2).max(600).optional()
}).refine((v) => (v.peers && v.peers.length) || v.labelId, { message: 'peers veya labelId gerekli' });
export async function createBroadcastHandler(req: Request, res: Response): Promise<void> {
  const input = broadcastSchema.parse(req.body);
  const result = await whatsappService.createBroadcast(getWorkspaceId(req), input);
  res.status(201).json({ data: result });
}

export async function listBroadcastsHandler(req: Request, res: Response): Promise<void> {
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
  const broadcasts = await whatsappService.listBroadcasts(getWorkspaceId(req), deviceId);
  res.json({ data: { broadcasts } });
}

const setLabelsSchema = z.object({
  deviceId: z.string().min(1),
  peer: z.string().min(1),
  labelIds: z.array(z.string().min(1)).max(20)
});
export async function setLabelsHandler(req: Request, res: Response): Promise<void> {
  const input = setLabelsSchema.parse(req.body);
  await whatsappService.setConversationLabels(getWorkspaceId(req), input);
  res.json({ data: { ok: true } });
}

// ── labels (categories) CRUD ────────────────────────────────────────────────

export async function listLabelsHandler(req: Request, res: Response): Promise<void> {
  const labels = await whatsappService.listLabels(getWorkspaceId(req));
  res.json({ data: { labels } });
}

const createLabelSchema = z.object({ name: z.string().min(1).max(40), color: z.string().max(20).optional() });
export async function createLabelHandler(req: Request, res: Response): Promise<void> {
  const input = createLabelSchema.parse(req.body);
  const label = await whatsappService.createLabel(getWorkspaceId(req), input);
  res.status(201).json({ data: label });
}

export async function deleteLabelHandler(req: Request, res: Response): Promise<void> {
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  await whatsappService.deleteLabel(getWorkspaceId(req), id);
  res.json({ data: { ok: true } });
}

// ── Hesap sagligi: ELLE ayarla + YENIDEN TARA ───────────────────────────────
//
// ★2026-08-18 (operator istegi): "kisitli/yasakli hesaplarin bazilari aslinda
// acilmis; ben bunlari elle acayim, sonra sistem kendi tarasin, hala kisitliysa
// tekrar isaretlesin."
//
// Otomatik yol bunu yapamiyordu cunku setAccountHealth MONOTONIK (ban/kisit geri
// alinamaz) ve otomatik iyilesme BANNED'i kapsam disi birakiyor — dogru bir
// varsayilan, ama insan mudahalesine kapali. Bu iki uc o boslugu kapatir:
//   POST /whatsapp/health/set     → operator beyani (audit'e yazilir)
//   POST /whatsapp/health/rescan  → cihazi yeniden yoklat (gercegi sistem soyler)

const setHealthSchema = z.object({
  deviceId: z.string().min(1),
  health: z.enum(['ACTIVE', 'RESTRICTED', 'BANNED', 'LOGGED_OUT']),
  note: z.string().max(300).optional()
});

export async function setAccountHealthManualHandler(req: Request, res: Response): Promise<void> {
  const input = setHealthSchema.parse(req.body);
  const workspaceId = getWorkspaceId(req);
  const result = await whatsappService.manualSetAccountHealth({
    deviceId: input.deviceId,
    workspaceId: workspaceId ?? null,
    health: input.health,
    ...(input.note ? { note: input.note } : {})
  });
  // Insan karari + monotonik kurali deliyor → iz birakmasi SART.
  await writeAuditLog({
    ...(req.auth?.userId ? { userId: req.auth.userId } : {}),
    action: 'whatsapp.health.manual',
    resourceType: 'device',
    resourceId: input.deviceId,
    ...(req.requestId ? { requestId: req.requestId } : {}),
    ...(req.ip ? { ip: req.ip } : {}),
    metadata: { to: input.health, from: result.from ?? null, changed: result.changed, note: input.note ?? null },
    ...(workspaceId ? { workspaceId } : {})
  });
  res.json({ data: result });
}

const rescanSchema = z.object({
  deviceIds: z.array(z.string().min(1)).max(500).optional(),
  statuses: z.array(z.enum(['RESTRICTED', 'BANNED', 'LOGGED_OUT', 'ACTIVE'])).optional()
});

export async function rescanAccountHealthHandler(req: Request, res: Response): Promise<void> {
  const input = rescanSchema.parse(req.body ?? {});
  const workspaceId = getWorkspaceId(req);
  const result = await whatsappService.rescanAccountHealth({
    workspaceId: workspaceId ?? '',
    ...(input.deviceIds ? { deviceIds: input.deviceIds } : {}),
    ...(input.statuses ? { statuses: input.statuses } : {})
  });
  await writeAuditLog({
    ...(req.auth?.userId ? { userId: req.auth.userId } : {}),
    action: 'whatsapp.health.rescan',
    resourceType: 'workspace',
    ...(req.requestId ? { requestId: req.requestId } : {}),
    ...(req.ip ? { ip: req.ip } : {}),
    metadata: { queued: result.queued, skipped: result.skipped, statuses: input.statuses ?? ['RESTRICTED', 'LOGGED_OUT'] },
    ...(workspaceId ? { workspaceId } : {})
  });
  res.json({ data: result });
}
