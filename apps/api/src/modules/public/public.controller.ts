import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { DeviceService } from '../devices/device.service';
import { batchService } from '../accounts/batch.service';
import { whatsappService } from '../whatsapp/whatsapp.service';
import { provisionService } from '../provision/provision.service';
import { waRegisterService } from '../accounts/wa-register.service';
import { getJob } from '../jobs/jobs.service';
import { requirePublicWorkspace, requireScope } from './public.guards';
import { withIdempotency, readIdempotencyKey } from './idempotency.service';

const deviceService = new DeviceService();

// GET /public/v1/devices — the workspace's devices, trimmed to the fields an
// external integration needs to pick a target. Workspace-scoped (never leaks
// other tenants; see requirePublicWorkspace).
export async function listDevicesHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const devices = await deviceService.listDevices(workspaceId);
  res.json({
    data: devices.map((d) => ({ id: d.id, name: d.name, status: d.status }))
  });
}

// POST /public/v1/whatsapp/send — dispatch a WhatsApp send from one device.
// Reuses the same workspace-scoped service the dashboard uses (it verifies the
// device belongs to this workspace before dispatching).
const sendSchema = z.object({
  deviceId: z.string().min(1),
  to: z.string().min(5),
  message: z.string().min(1).max(4096)
});
export async function sendHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = sendSchema.parse(req.body);
  // Idempotency-Key (optional): a retry with the same key returns the FIRST job
  // instead of dispatching a second send. See idempotency.service.
  const idemKey = readIdempotencyKey(req.header('idempotency-key'));
  const result = await withIdempotency(workspaceId, idemKey, 'whatsapp.send', async () => {
    const { job } = await batchService.sendFromDevice(workspaceId, input);
    return { jobId: job.id, status: job.status };
  });
  res.json({ data: { jobId: result.jobId, status: result.status, ...(result.idempotentReplay ? { idempotentReplay: true } : {}) } });
}

// POST /public/v1/whatsapp/send/bulk — many DISTINCT messages in one call (each a
// {deviceId,to,message}). Returns one {jobId,status} per item (or {error} for the ones
// that failed to dispatch), so an integrator sending 100 personalized messages makes a
// single HTTP round-trip instead of 100 (and counts as one heavy-op). Capped at 100.
const bulkSendSchema = z.object({
  messages: z.array(sendSchema).min(1).max(100)
});
export async function bulkSendHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const { messages } = bulkSendSchema.parse(req.body);
  // Idempotency-Key (optional): a replay of the SAME bulk call returns the SAME
  // per-item jobIds instead of dispatching everything twice. We derive a stable
  // per-item key from the batch key + item index so item N always maps to the same
  // reservation across retries (order-stable: the array is positional).
  const bulkKey = readIdempotencyKey(req.header('idempotency-key'));
  const results = await Promise.all(
    messages.map(async (m, i) => {
      try {
        const itemKey = bulkKey ? `${bulkKey}:${i}` : undefined;
        const r = await withIdempotency(workspaceId, itemKey, 'whatsapp.send', async () => {
          const { job } = await batchService.sendFromDevice(workspaceId, m);
          return { jobId: job.id, status: job.status };
        });
        return { to: m.to, jobId: r.jobId, status: r.status, ...(r.idempotentReplay ? { idempotentReplay: true } : {}) };
      } catch (e) {
        return { to: m.to, error: e instanceof AppError ? e.code : 'DISPATCH_FAILED', message: (e as Error).message };
      }
    })
  );
  res.json({ data: { count: results.length, results } });
}

// POST /public/v1/whatsapp/profile — fetch a contact's profile (avatar + name).
// Dispatches an on-device job; the avatar/profile lands on the conversation once
// the agent completes (read it back via GET /whatsapp/conversations or the
// dashboard). Returns the jobId to poll.
const profileSchema = z
  .object({ deviceId: z.string().min(1), to: z.string().min(5).optional(), from: z.string().min(1).optional() })
  .refine((v) => v.to || v.from, { message: 'to veya from gerekli' });
export async function profileHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = profileSchema.parse(req.body);
  const { job } = await batchService.fetchProfile(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/block — block or unblock a contact on a device.
// `block` defaults to true. On-device job; returns the jobId.
const blockSchema = z
  .object({ deviceId: z.string().min(1), to: z.string().min(5).optional(), from: z.string().min(1).optional(), block: z.boolean().optional() })
  .refine((v) => v.to || v.from, { message: 'to veya from gerekli' });
export async function blockHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = blockSchema.parse(req.body);
  const { job } = await batchService.blockContact(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/blocklist — read the device's blocked-contacts list.
// On-device job; the scraped list lands on the job result. Returns the jobId.
const blocklistSchema = z.object({ deviceId: z.string().min(1) });
export async function blocklistHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = blocklistSchema.parse(req.body);
  const { job } = await batchService.listBlocked(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/mynumber — read the account's own number off the
// device. On-device job; the number lands on the job result. Returns the jobId.
const myNumberSchema = z.object({ deviceId: z.string().min(1) });
export async function myNumberHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = myNumberSchema.parse(req.body);
  const { job } = await batchService.myNumber(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/send-media — send an image/document to a peer.
const sendMediaSchema = z.object({
  deviceId: z.string().min(1),
  to: z.string().min(5),
  mediaUrl: z.string().url().max(2048),
  caption: z.string().max(1024).optional(),
  kind: z.enum(['image', 'document']).optional()
});
export async function sendMediaHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = sendMediaSchema.parse(req.body);
  const { job } = await batchService.sendMedia(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/delete-message — delete a message (for me/everyone).
const deleteMsgSchema = z.object({
  deviceId: z.string().min(1),
  to: z.string().min(5),
  scope: z.enum(['me', 'everyone']).optional(),
  matchText: z.string().max(500).optional()
});
export async function deleteMessageHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = deleteMsgSchema.parse(req.body);
  const { job } = await batchService.deleteMessage(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/clear-chat — clear all local messages in a chat.
const clearChatSchema = z.object({ deviceId: z.string().min(1), to: z.string().min(5) });
export async function clearChatHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = clearChatSchema.parse(req.body);
  const { job } = await batchService.clearChat(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// ── Root-DB read endpoints (read WhatsApp's own SQLite via the agent — no UI on
// the device). Each dispatches an on-device job and returns a jobId to poll with
// GET /v1/jobs/:jobId. They're WRITE scope + apiRateLimiter because they drive a
// real device (root sqlite read), same as the other on-device jobs. ──────────

// POST /public/v1/whatsapp/receipts — per-message delivery/read receipts (✓/✓✓/
// blue) for a chat, straight from msgstore.db. Far richer than the OUT thread's
// coarse status: shows exactly which messages were delivered vs read + timestamps.
const receiptsSchema = z.object({
  deviceId: z.string().min(1),
  to: z.string().min(1),
  limit: z.coerce.number().int().positive().max(100).optional()
});
export async function receiptsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = receiptsSchema.parse(req.body);
  const { job } = await batchService.waReceipts(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/media — media gallery (images/video/docs/audio) the
// account has in a chat (or across all chats), from message_media. Returns file
// name/type/size + on-device path; no UI walk, pure DB read.
const mediaSchema = z.object({
  deviceId: z.string().min(1),
  to: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});
export async function mediaHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = mediaSchema.parse(req.body);
  const { job } = await batchService.waMedia(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/calls — the account's WhatsApp call log (voice/video,
// in/out/missed) from call_log. No UI on the device exposes this over an API.
const callsSchema = z.object({
  deviceId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).optional()
});
export async function callsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = callsSchema.parse(req.body);
  const { job } = await batchService.waCalls(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/search — full-text search across ALL of the account's
// messages (message_ftsv2), server-side. Matching bubbles + which chat + when.
const searchSchema = z.object({
  deviceId: z.string().min(1),
  query: z.string().min(1).max(100),
  limit: z.coerce.number().int().positive().max(200).optional()
});
export async function searchHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = searchSchema.parse(req.body);
  const { job } = await batchService.waSearch(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/unread — every chat with unread messages + its unread
// count, from chat.unseen_message_count. The device's own truth (vs our captured
// mirror), so it reflects reads/writes that happened outside our pipeline too.
const unreadSchema = z.object({ deviceId: z.string().min(1) });
export async function unreadHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = unreadSchema.parse(req.body);
  const { job } = await batchService.waUnread(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/contacts — the account's full WhatsApp address book
// (every contact it knows: number + display name), from wa.db. write scope.
const contactsSchema = z.object({
  deviceId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(500).optional()
});
export async function contactsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = contactsSchema.parse(req.body);
  const { job } = await batchService.waContacts(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/group-members — members of a group chat (by subject or
// jid id): each member's number + admin flag, from msgstore.db. write scope.
const groupMembersSchema = z.object({
  deviceId: z.string().min(1),
  group: z.string().min(1).max(120),
  limit: z.coerce.number().int().positive().max(1000).optional()
});
export async function groupMembersHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = groupMembersSchema.parse(req.body);
  const { job } = await batchService.waGroupMembers(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/chat-summary — one chat's aggregate stats (total /
// inbound / outbound / media counts + first & last message ts). write scope.
const chatSummarySchema = z.object({ deviceId: z.string().min(1), to: z.string().min(1) });
export async function chatSummaryHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = chatSummarySchema.parse(req.body);
  const { job } = await batchService.waChatSummary(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/account-health — the device account's own health:
// registered number, WhatsApp version, registered flag. Straight from the device
// (no UI), so it reflects the real logged-in account. write scope.
const accountHealthSchema = z.object({ deviceId: z.string().min(1) });
export async function accountHealthHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = accountHealthSchema.parse(req.body);
  const { job } = await batchService.waAccountHealth(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/fetch-media — pull a chat's DOWNLOADED media off the
// device as base64 (root). Not-yet-downloaded media comes back pending:true (only an
// encrypted CDN blob exists on the device until it's opened). write scope.
const fetchMediaSchema = z.object({
  deviceId: z.string().min(1),
  to: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(20).optional()
});
export async function fetchMediaHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = fetchMediaSchema.parse(req.body);
  const { job } = await batchService.waFetchMedia(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/reactions — emoji reactions (optionally one chat). write scope.
const reactionsSchema = z.object({
  deviceId: z.string().min(1),
  to: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});
export async function reactionsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = reactionsSchema.parse(req.body);
  const { job } = await batchService.waReactions(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/polls — polls (question + options + vote counts). write scope.
const pollsSchema = z.object({ deviceId: z.string().min(1), limit: z.coerce.number().int().positive().max(100).optional() });
export async function pollsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = pollsSchema.parse(req.body);
  const { job } = await batchService.waPolls(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/read-by — per-recipient read receipts for the account's own
// sent messages in a chat (in a group: WHICH members read a message). write scope.
const readBySchema = z.object({ deviceId: z.string().min(1), to: z.string().min(1), limit: z.coerce.number().int().positive().max(200).optional() });
export async function readByHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = readBySchema.parse(req.body);
  const { job } = await batchService.waReadBy(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/starred — the account's starred (bookmarked) messages. write scope.
const starredSchema = z.object({ deviceId: z.string().min(1), limit: z.coerce.number().int().positive().max(200).optional() });
export async function starredHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = starredSchema.parse(req.body);
  const { job } = await batchService.waStarred(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/labels-list — WhatsApp Business labels (name/color/chat-count
// + predefined flag). Read-only device labels; distinct from the /labels category API
// (which manages OUR workspace's chat categories). write scope.
const labelsListSchema = z.object({ deviceId: z.string().min(1) });
export async function labelsListHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = labelsListSchema.parse(req.body);
  const { job } = await batchService.waLabels(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// GET /public/v1/whatsapp/messages?deviceId=&limit=&direction=IN|OUT — stored
// conversation history (inbound captured by the agent + outbound we sent),
// bodies decrypted. Device-scoped to the caller's workspace.
const messagesSchema = z.object({
  deviceId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(500).optional(),
  direction: z.enum(['IN', 'OUT']).optional()
});
export async function messagesHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const input = messagesSchema.parse(req.query);
  const { messages } = await batchService.listMessages(workspaceId, input);
  res.json({
    data: {
      messages: messages.map((m) => ({
        id: m.id,
        deviceId: m.deviceId,
        direction: m.direction,
        peer: m.peer,
        body: m.body,
        waTimestamp: m.waTimestamp,
        createdAt: m.createdAt
      }))
    }
  });
}

// GET /public/v1/whatsapp/conversations?deviceId=&filter=&labelId=&search=&limit=&cursor=
// The WhatsApp-Web-style chat list for a device: one entry per peer with a
// last-message preview + unread count. Device-scoped to the caller's workspace.
const conversationsSchema = z.object({
  deviceId: z.string().min(1),
  filter: z.enum(['all', 'unread', 'favorite', 'archived']).optional(),
  labelId: z.string().min(1).optional(),
  search: z.string().max(120).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).optional()
});
export async function conversationsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const input = conversationsSchema.parse(req.query);
  const result = await whatsappService.listConversations(workspaceId, input);
  res.json({
    data: {
      conversations: result.conversations.map((c) => ({
        peer: c.peer,
        displayName: c.displayName,
        lastMessageBody: c.lastMessageBody,
        lastDirection: c.lastDirection,
        lastStatus: c.lastStatus,
        lastMessageAt: c.lastMessageAt,
        unreadCount: c.unreadCount,
        favorite: c.favorite,
        archived: c.archived,
        pinned: c.pinned,
        labelIds: c.labelIds
      })),
      nextCursor: result.nextCursor
    }
  });
}

// GET /public/v1/whatsapp/thread?deviceId=&peer=&limit=&before= — one chat's
// message history, oldest→newest, with scroll-up pagination (before cursor).
const threadSchema = z.object({
  deviceId: z.string().min(1),
  peer: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).optional(),
  before: z.string().min(1).optional()
});
export async function threadHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const input = threadSchema.parse(req.query);
  const result = await whatsappService.getThreadMessages(workspaceId, input);
  res.json({
    data: {
      messages: result.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        peer: m.peer,
        body: m.body,
        status: m.status,
        failReason: m.failReason,
        waTimestamp: m.waTimestamp,
        createdAt: m.createdAt
      })),
      nextBefore: result.nextBefore
    }
  });
}

// POST /public/v1/whatsapp/thread/read — mark a thread read: zeroes its unread
// count and flips its unread inbound rows to read (write scope). Mirrors the
// dashboard's "open chat" behaviour so an external inbox integration can clear the
// unread badge after it has processed a thread's messages.
const markReadSchema = z.object({
  deviceId: z.string().min(1),
  peer: z.string().min(1)
});
export async function markReadHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = markReadSchema.parse(req.body);
  await whatsappService.markRead(workspaceId, input);
  res.json({ data: { ok: true } });
}

// GET /public/v1/whatsapp/stats?deviceId=&sinceHours= — messaging counts + SLA.
const statsSchema = z.object({
  deviceId: z.string().min(1).optional(),
  sinceHours: z.coerce.number().int().positive().max(720).optional()
});
export async function statsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const input = statsSchema.parse(req.query);
  const stats = await whatsappService.getStats(workspaceId, input);
  res.json({ data: stats });
}

// POST /public/v1/whatsapp/broadcast — one-to-many throttled send (write scope).
const broadcastSchema = z.object({
  deviceId: z.string().min(1),
  message: z.string().min(1).max(4096),
  peers: z.array(z.string().min(1)).max(1000).optional(),
  labelId: z.string().min(1).optional()
}).refine((v) => (v.peers && v.peers.length) || v.labelId, { message: 'peers veya labelId gerekli' });
export async function broadcastHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = broadcastSchema.parse(req.body);
  const result = await whatsappService.createBroadcast(workspaceId, input);
  // Match the documented public contract: { broadcastId, queued }. The internal
  // service returns { id, total } — projecting here keeps external clients (which read
  // data.broadcastId / data.queued per the docs) from silently getting undefined.
  res.status(201).json({ data: { broadcastId: result.id, queued: result.total } });
}

// ── labels / categories over the public API ──────────────────────────────────

// GET /public/v1/whatsapp/labels — the workspace's conversation categories.
export async function labelsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const labels = await whatsappService.listLabels(workspaceId);
  res.json({ data: { labels } });
}

// POST /public/v1/whatsapp/labels — create a category (write scope).
const createLabelSchema = z.object({ name: z.string().min(1).max(40), color: z.string().max(20).optional() });
export async function createLabelHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = createLabelSchema.parse(req.body);
  const label = await whatsappService.createLabel(workspaceId, input);
  res.status(201).json({ data: label });
}

// POST /public/v1/whatsapp/conversations/labels — assign categories to a chat.
const setLabelsSchema = z.object({
  deviceId: z.string().min(1),
  peer: z.string().min(1),
  labelIds: z.array(z.string().min(1)).max(20)
});
export async function setLabelsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = setLabelsSchema.parse(req.body);
  await whatsappService.setConversationLabels(workspaceId, input);
  res.json({ data: { ok: true } });
}

// POST /public/v1/whatsapp/conversations/state — favourite / archive / pin a chat.
const stateSchema = z.object({
  deviceId: z.string().min(1),
  peer: z.string().min(1),
  favorite: z.boolean().optional(),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional()
});
export async function stateHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = stateSchema.parse(req.body);
  await whatsappService.setConversationState(workspaceId, input);
  res.json({ data: { ok: true } });
}

// ── One-click device provision (API) ───────────────────────────────────────
// POST /public/v1/devices/provision — build a brand-new isolated cloud phone
// from scratch (boot → root → identity → proxy → apps → WhatsApp-ready), exactly
// like the dashboard's "Tek Tıkla Cihaz Oluştur". Async: returns immediately with
// the deviceId + jobId; poll GET /v1/devices or the job to watch it come online.
const provisionSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  countryCode: z.string().length(2).optional(),
  deviceModel: z.string().max(60).optional(),
  androidVersion: z.string().max(10).optional(),
  // Country-matched residential proxy (ISO-2). WhatsApp needs number-country ==
  // exit-IP country, so set this to the country you'll register numbers from.
  proxyCountry: z.string().length(2).optional()
});
export async function provisionDeviceHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = provisionSchema.parse(req.body ?? {});
  const result = await provisionService.createInstance(
    {
      ...(input.name ? { name: input.name } : {}),
      ...(input.countryCode ? { countryCode: input.countryCode } : {}),
      ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
      ...(input.androidVersion ? { androidVersion: input.androidVersion } : {}),
      ...(input.proxyCountry ? { proxyCountry: input.proxyCountry } : {})
    },
    workspaceId
  );
  res.status(201).json({ data: { deviceId: result.deviceId, jobId: result.jobId, instance: result.instance, status: 'PROVISIONING' } });
}

// GET /public/v1/devices/provision/:jobId/status — live step-by-step provision
// progress (current step, percent, full step log), EXACTLY what the dashboard
// modal shows. Poll this to watch a one-click device build boot → root → identity
// → proxy → apps → WhatsApp-ready. status: PENDING/RUNNING/COMPLETED/FAILED.
export async function provisionStatusHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
  if (!jobId) throw new AppError('jobId gerekli', 400, 'MISSING_JOB_ID');
  const data = await provisionService.getStatus(jobId, workspaceId);
  res.json({ data });
}

// ── One-click WhatsApp registration (API) ──────────────────────────────────
// POST /public/v1/whatsapp/register — start an autonomous WhatsApp signup on a
// device using the caller's OWN number. Async, two-phase: the agent drives to the
// SMS-code screen and stops (status AWAITING_OTP); submit the code you receive to
// /register/:id/otp to finish. Poll /register/:id/status for live progress.
const registerSchema = z.object({
  deviceId: z.string().min(1),
  phoneNumber: z.string().min(6)
});
export async function registerWhatsappHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = registerSchema.parse(req.body);
  const account = await batchService.startOperatorRegister(workspaceId, input.deviceId, input.phoneNumber);
  // account carries accountId + deviceId + steps + proxyAssigned.
  const a = account as Record<string, unknown>;
  res.status(201).json({
    data: {
      accountId: a.accountId,
      deviceId: a.deviceId,
      phoneNumber: a.phoneNumber,
      status: a.status ?? 'REGISTERING',
      ...(a.proxyAssigned ? { proxyAssigned: a.proxyAssigned } : {})
    }
  });
}

// POST /public/v1/whatsapp/register/:id/otp — submit the SMS code so the agent
// enters it + finishes the profile. Account flips to ACTIVE (or FAILED).
const otpSchema = z.object({ otpCode: z.string().min(4).max(8) });
export async function registerWhatsappOtpHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const accountId = typeof req.params.id === 'string' ? req.params.id : '';
  if (!accountId) throw new AppError('accountId gerekli', 400, 'MISSING_ACCOUNT_ID');
  const { otpCode } = otpSchema.parse(req.body);
  const account = await batchService.provideOperatorOtp(workspaceId, accountId, otpCode);
  // SECURITY (H-1): toPublic() decrypts otpCode + carries the phone number. This is an
  // EXTERNAL boundary — never echo the decrypted OTP/secret back to the caller (it
  // would land in their logs / any middlebox that records response bodies). Project to
  // the same safe shape the register-start handler uses; the docs promise only these.
  const a = account as Record<string, unknown>;
  res.json({ data: { id: a.id, status: a.status, phoneNumber: a.phoneNumber } });
}

// POST /public/v1/whatsapp/register/:id/verify-method — when registration parked on
// WhatsApp's "Choose how to verify" sheet (status AWAITING_OTP with method_select),
// pick sms | voice | missed_call. The agent applies it and continues to the code step.
const verifyMethodSchema = z.object({ method: z.enum(['sms', 'voice', 'missed_call']) });
export async function registerWhatsappVerifyMethodHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const accountId = typeof req.params.id === 'string' ? req.params.id : '';
  if (!accountId) throw new AppError('accountId gerekli', 400, 'MISSING_ACCOUNT_ID');
  const { method } = verifyMethodSchema.parse(req.body);
  const account = await batchService.provideVerifyMethod(workspaceId, accountId, method);
  const a = account as Record<string, unknown>;
  res.json({ data: { id: a.id, status: a.status, phoneNumber: a.phoneNumber } });
}

// GET /public/v1/whatsapp/register/:id/status — live registration progress
// (current step, percent, full step log). Poll this to track a signup.
export async function registerWhatsappStatusHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const accountId = typeof req.params.id === 'string' ? req.params.id : '';
  if (!accountId) throw new AppError('accountId gerekli', 400, 'MISSING_ACCOUNT_ID');
  const data = await waRegisterService.getStatus(accountId, workspaceId);
  res.json({ data });
}

// GET /public/v1/me — who the calling flk_ key is: its workspace, scopes, label, and
// this workspace's device count. Lets an integrator self-discover its permissions and
// scale without trial-and-error 403s.
export async function meHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const key = req.apiKey as { id?: string; name?: string; label?: string; scopes?: string[] } | undefined;
  const deviceCount = await new DeviceService().listDevices(workspaceId).then((d) => d.length).catch(() => 0);
  res.json({
    data: {
      workspaceId,
      keyId: key?.id ?? null,
      label: key?.label ?? key?.name ?? null,
      scopes: key?.scopes ?? [],
      deviceCount
    }
  });
}

// GET /public/v1/jobs/:jobId — universal poll target for the jobId every on-device
// write endpoint hands back (send/blocklist/mynumber/profile/…). Previously external
// callers got a jobId with NO way to read its result. Workspace-scoped (getJob filters
// by workspaceId → a foreign jobId 404s). NOTE: we deliberately DO NOT return
// job.payload — it can hold decrypted identity/proxy secrets. Only the safe outcome
// fields are exposed.
export async function jobHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
  if (!jobId) throw new AppError('jobId gerekli', 400, 'MISSING_JOB_ID');
  const job = await getJob(jobId, workspaceId);
  if (!job) throw new AppError('İş bulunamadı', 404, 'JOB_NOT_FOUND');
  res.json({
    data: {
      id: job.id,
      type: job.type,
      status: job.status,
      result: job.result ?? null,
      error: job.error ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    }
  });
}

// GET /public/v1/jobs/:jobId/wait?timeout=30 — LONG-POLL: block server-side until
// the job reaches a terminal state (COMPLETED / FAILED / CANCELLED) or ?timeout=
// seconds elapse, then return the same shape as GET /v1/jobs/:jobId. This turns
// the integrator's poll loop into ONE request: dispatch a send/receipts/etc job,
// then GET .../wait to receive the result the moment it's ready — no polling, no
// wasted round-trips. If the timeout hits first, the current (still-PENDING/RUNNING)
// job is returned with `timedOut: true` so the caller can decide to wait again.
// Workspace-scoped (getJob filters by workspaceId → a foreign jobId 404s).
const TERMINAL_JOB = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const jobWaitQuerySchema = z.object({
  // Clamp to [1,60]s. We DON'T hold the socket forever — a very long client wait
  // should re-issue the call (the default 30s already covers most on-device jobs).
  timeout: z.coerce.number().int().min(1).max(60).optional()
});
export async function jobWaitHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const jobId = typeof req.params.jobId === 'string' ? req.params.jobId : '';
  if (!jobId) throw new AppError('jobId gerekli', 400, 'MISSING_JOB_ID');
  const { timeout } = jobWaitQuerySchema.parse(req.query);
  const deadline = Date.now() + (timeout ?? 30) * 1000;
  // Poll the DB on a short interval (300ms) rather than the client hammering us
  // every few seconds over the network. First hit checks immediately so an already-
  // finished job returns without any delay.
  const STEP_MS = 300;
  // Detect a client that gives up mid-wait so we stop looping and free the handler.
  let aborted = false;
  req.on('close', () => { aborted = true; });
  for (;;) {
    const job = await getJob(jobId, workspaceId);
    if (!job) throw new AppError('İş bulunamadı', 404, 'JOB_NOT_FOUND');
    const done = TERMINAL_JOB.has(job.status);
    const timedOut = Date.now() >= deadline;
    if (done || timedOut || aborted) {
      if (aborted) return; // client hung up — nothing to send
      res.json({
        data: {
          id: job.id,
          type: job.type,
          status: job.status,
          result: job.result ?? null,
          error: job.error ?? null,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          ...(done ? {} : { timedOut: true })
        }
      });
      return;
    }
    await new Promise((r) => setTimeout(r, STEP_MS));
  }
}
