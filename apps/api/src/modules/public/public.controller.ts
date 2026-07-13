import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { DeviceService } from '../devices/device.service';
import { batchService } from '../accounts/batch.service';
import { whatsappService } from '../whatsapp/whatsapp.service';
import { provisionService } from '../provision/provision.service';
import { waRegisterService } from '../accounts/wa-register.service';
import { requirePublicWorkspace, requireScope } from './public.guards';

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
  const { job } = await batchService.sendFromDevice(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
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
  res.status(201).json({ data: result });
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
  res.json({ data: account });
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
