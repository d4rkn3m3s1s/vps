import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';
import { batchService } from './batch.service';
import { waRegisterService } from './wa-register.service';
import { igRegisterService } from './ig-register.service';

function id(req: Request): string {
  const v = req.params.id;
  if (typeof v !== 'string' || !v) throw new AppError('id gereklidir', 400, 'INVALID_ID');
  return v;
}

const createSchema = z.object({
  platform: z.enum(['whatsapp', 'instagram', 'facebook']),
  count: z.coerce.number().int().min(1).max(50),
  countryCode: z.string().length(2).optional()
});

export async function createBatchHandler(req: Request, res: Response): Promise<void> {
  const input = createSchema.parse(req.body);
  res.status(201).json({ data: await batchService.createBatch(getWorkspaceId(req), input) });
}

export async function listAccountsHandler(req: Request, res: Response): Promise<void> {
  const batchId = typeof req.query.batchId === 'string' ? req.query.batchId : undefined;
  res.json({ data: await batchService.list(getWorkspaceId(req), batchId) });
}

export async function getAccountHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.get(getWorkspaceId(req), id(req)) });
}

export async function provisionAccountHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.provision(getWorkspaceId(req), id(req)) });
}

export async function pollOtpHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.pollOtp(getWorkspaceId(req), id(req)) });
}

// Step-by-step screenshots from the account's last WhatsApp registration job.
export async function registrationShotsHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.getRegistrationShots(getWorkspaceId(req), id(req)) });
}

const provisionBatchSchema = z.object({ batchId: z.string().min(1) });
export async function provisionBatchHandler(req: Request, res: Response): Promise<void> {
  const { batchId } = provisionBatchSchema.parse(req.body);
  res.json({ data: await batchService.provisionBatch(getWorkspaceId(req), batchId) });
}

const registerSchema = z.object({ deviceId: z.string().min(1) });
export async function registerAccountHandler(req: Request, res: Response): Promise<void> {
  const { deviceId } = registerSchema.parse(req.body);
  res.json({ data: await batchService.registerAccount(getWorkspaceId(req), id(req), deviceId) });
}

const sendWhatsAppSchema = z.object({
  to: z.string().min(5),
  message: z.string().min(1).max(4096),
  deviceId: z.string().min(1).optional()
});
export async function sendWhatsAppHandler(req: Request, res: Response): Promise<void> {
  const input = sendWhatsAppSchema.parse(req.body);
  res.json({ data: await batchService.sendWhatsApp(getWorkspaceId(req), id(req), input) });
}

const readWhatsAppSchema = z
  .object({
    from: z.string().min(1).optional(),
    to: z.string().min(5).optional(),
    deviceId: z.string().min(1).optional()
  })
  .refine((v) => v.from || v.to, { message: 'from veya to gerekli' });
export async function readWhatsAppHandler(req: Request, res: Response): Promise<void> {
  const input = readWhatsAppSchema.parse(req.body);
  res.json({ data: await batchService.readWhatsApp(getWorkspaceId(req), id(req), input) });
}

// Send a WhatsApp message directly from a device (WhatsApp page — device-scoped,
// no account id needed).
const sendFromDeviceSchema = z.object({
  deviceId: z.string().min(1),
  to: z.string().min(5),
  message: z.string().min(1).max(4096)
});
export async function sendWhatsAppFromDeviceHandler(req: Request, res: Response): Promise<void> {
  const input = sendFromDeviceSchema.parse(req.body);
  res.json({ data: await batchService.sendFromDevice(getWorkspaceId(req), input) });
}

// Send a Telegram message directly from a device (Telegram page — device-scoped,
// no account id). Same shape as WhatsApp send; the agent runtime-detects the pkg.
const sendTelegramFromDeviceSchema = z.object({
  deviceId: z.string().min(1),
  to: z.string().min(5),
  message: z.string().min(1).max(4096)
});
export async function sendTelegramFromDeviceHandler(req: Request, res: Response): Promise<void> {
  const input = sendTelegramFromDeviceSchema.parse(req.body);
  res.json({ data: await batchService.sendTelegramFromDevice(getWorkspaceId(req), input) });
}

// Fetch a contact's WhatsApp profile (avatar + name/about) — device-scoped.
const fetchProfileSchema = z
  .object({
    deviceId: z.string().min(1),
    to: z.string().min(5).optional(),
    from: z.string().min(1).optional()
  })
  .refine((v) => v.to || v.from, { message: 'to veya from gerekli' });
export async function fetchWhatsAppProfileHandler(req: Request, res: Response): Promise<void> {
  const input = fetchProfileSchema.parse(req.body);
  res.json({ data: await batchService.fetchProfile(getWorkspaceId(req), input) });
}

// Block / unblock a WhatsApp contact — device-scoped. block defaults to true.
const blockContactSchema = z
  .object({
    deviceId: z.string().min(1),
    to: z.string().min(5).optional(),
    from: z.string().min(1).optional(),
    block: z.boolean().optional()
  })
  .refine((v) => v.to || v.from, { message: 'to veya from gerekli' });
export async function blockWhatsAppContactHandler(req: Request, res: Response): Promise<void> {
  const input = blockContactSchema.parse(req.body);
  res.json({ data: await batchService.blockContact(getWorkspaceId(req), input) });
}

// Read the blocked-contacts list off a device — device-scoped.
const blocklistSchema = z.object({ deviceId: z.string().min(1) });
export async function listWhatsAppBlockedHandler(req: Request, res: Response): Promise<void> {
  const input = blocklistSchema.parse(req.body);
  res.json({ data: await batchService.listBlocked(getWorkspaceId(req), input) });
}

// Read the account's OWN WhatsApp number off a device — device-scoped.
const myNumberSchema = z.object({ deviceId: z.string().min(1) });
export async function whatsAppMyNumberHandler(req: Request, res: Response): Promise<void> {
  const input = myNumberSchema.parse(req.body);
  res.json({ data: await batchService.myNumber(getWorkspaceId(req), input) });
}

// ── Root-DB read endpoints (no UI on device — read WhatsApp's own SQLite) ─────
const waReceiptsSchema = z.object({ deviceId: z.string().min(1), to: z.string().min(1), limit: z.coerce.number().int().positive().max(100).optional() });
export async function whatsAppReceiptsHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.waReceipts(getWorkspaceId(req), waReceiptsSchema.parse(req.body)) });
}
const waMediaSchema = z.object({ deviceId: z.string().min(1), to: z.string().min(1).optional(), limit: z.coerce.number().int().positive().max(200).optional() });
export async function whatsAppMediaHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.waMedia(getWorkspaceId(req), waMediaSchema.parse(req.body)) });
}
const waCallsSchema = z.object({ deviceId: z.string().min(1), limit: z.coerce.number().int().positive().max(200).optional() });
export async function whatsAppCallsHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.waCalls(getWorkspaceId(req), waCallsSchema.parse(req.body)) });
}
const waSearchSchema = z.object({ deviceId: z.string().min(1), query: z.string().min(1).max(100), limit: z.coerce.number().int().positive().max(200).optional() });
export async function whatsAppSearchHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.waSearch(getWorkspaceId(req), waSearchSchema.parse(req.body)) });
}
const waUnreadSchema = z.object({ deviceId: z.string().min(1) });
export async function whatsAppUnreadHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.waUnread(getWorkspaceId(req), waUnreadSchema.parse(req.body)) });
}
const waConversationsSchema = z.object({ deviceId: z.string().min(1), limit: z.coerce.number().int().positive().max(200).optional() });
export async function whatsAppConversationsHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.waConversations(getWorkspaceId(req), waConversationsSchema.parse(req.body)) });
}

// Send a media message (image/document) from a device — device-scoped.
const sendMediaSchema = z.object({
  deviceId: z.string().min(1),
  to: z.string().min(5),
  mediaUrl: z.string().url().max(2048),
  caption: z.string().max(1024).optional(),
  kind: z.enum(['image', 'document']).optional()
});
export async function sendWhatsAppMediaHandler(req: Request, res: Response): Promise<void> {
  const input = sendMediaSchema.parse(req.body);
  res.json({ data: await batchService.sendMedia(getWorkspaceId(req), input) });
}

// Delete a message (for me / for everyone) — device-scoped.
const deleteMsgSchema = z.object({
  deviceId: z.string().min(1),
  to: z.string().min(5),
  scope: z.enum(['me', 'everyone']).optional(),
  matchText: z.string().max(500).optional()
});
export async function deleteWhatsAppMessageHandler(req: Request, res: Response): Promise<void> {
  const input = deleteMsgSchema.parse(req.body);
  res.json({ data: await batchService.deleteMessage(getWorkspaceId(req), input) });
}

// Clear all messages in a chat — device-scoped.
const clearChatSchema = z.object({ deviceId: z.string().min(1), to: z.string().min(5) });
export async function clearWhatsAppChatHandler(req: Request, res: Response): Promise<void> {
  const input = clearChatSchema.parse(req.body);
  res.json({ data: await batchService.clearChat(getWorkspaceId(req), input) });
}

// List stored WhatsApp messages (inbound + outbound) for a device. deviceId is a
// query param so this works without an account id (any device the key owns).
const listMessagesSchema = z.object({
  deviceId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(500).optional(),
  direction: z.enum(['IN', 'OUT']).optional()
});
export async function listWhatsAppMessagesHandler(req: Request, res: Response): Promise<void> {
  const input = listMessagesSchema.parse(req.query);
  res.json({ data: await batchService.listMessages(getWorkspaceId(req), input) });
}

export async function cancelAccountHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.cancel(getWorkspaceId(req), id(req)) });
}

export async function deleteAccountHandler(req: Request, res: Response): Promise<void> {
  res.json({ data: await batchService.remove(getWorkspaceId(req), id(req)) });
}

// Fully automatic WhatsApp registration: rent number → register → poll OTP →
// enter OTP → finish, all server-side. Long-running (awaits on-device jobs +
// polls the SMS up to ~3 min) — the HTTP call blocks until the pipeline ends.
const autoRegisterSchema = z.object({
  deviceId: z.string().min(1),
  fullName: z.string().min(1).max(80).optional(),
  countryId: z.coerce.number().int().positive().optional(),
  batchId: z.string().min(1).optional(),
  provider: z.enum(['sms-bus', '5sim']).optional()
});
export async function autoRegisterWhatsAppHandler(req: Request, res: Response): Promise<void> {
  const input = autoRegisterSchema.parse(req.body);
  const result = await batchService.autoRegisterWhatsApp(getWorkspaceId(req), input.deviceId, {
    ...(input.fullName ? { fullName: input.fullName } : {}),
    ...(input.countryId ? { countryId: input.countryId } : {}),
    ...(input.batchId ? { batchId: input.batchId } : {}),
    ...(input.provider ? { provider: input.provider } : {})
  });
  res.json({ data: result });
}

// Operator-OTP registration (one-click). The operator supplies their OWN number;
// the agent drives to OTP then stops. Async: returns the account row immediately
// (status REGISTERING → AWAITING_OTP as the agent reports back).
const startRegisterSchema = z.object({
  deviceId: z.string().min(1),
  phoneNumber: z.string().min(6),
  // Optional operator-chosen profile name. Absent → backend auto-generates one.
  fullName: z.string().trim().min(1).max(60).optional(),
  // Explicit confirmation to proceed when the device already has a live WhatsApp account
  // (the fresh register pm-clears it). Only the operator ticking the modal warning sets this.
  force: z.boolean().optional()
});
export async function startRegisterHandler(req: Request, res: Response): Promise<void> {
  const input = startRegisterSchema.parse(req.body);
  const account = await batchService.startOperatorRegister(
    getWorkspaceId(req),
    input.deviceId,
    input.phoneNumber,
    input.fullName,
    input.force
  );
  res.status(201).json({ data: account });
}

// Operator hands us the SMS code; re-dispatch so the agent enters it + finishes
// the profile (random name). Account flips to ACTIVE (or FAILED) via the hook.
const provideOtpSchema = z.object({ otpCode: z.string().min(4).max(8) });
export async function provideOtpHandler(req: Request, res: Response): Promise<void> {
  const { otpCode } = provideOtpSchema.parse(req.body);
  const account = await batchService.provideOperatorOtp(getWorkspaceId(req), id(req), otpCode);
  res.json({ data: account });
}

// Operator picked a verification method on the "Choose how to verify" sheet; re-
// dispatch REGISTER_WHATSAPP with verifyMethod so the agent selects that row instead
// of guessing. Account flips AWAITING_OTP → REGISTERING (guarded against double-tap).
// ★FIX: add 'other_device' — WhatsApp's "Choose how to verify" sheet often offers "Other
// device" (the number is registered elsewhere; the code goes to that phone). The agent's
// applyVerifyMethod already handles it, but the schema rejected it → the panel button
// 400'd. Now the operator can pick any row WhatsApp shows.
const provideVerifyMethodSchema = z.object({ method: z.enum(['sms', 'voice', 'missed_call', 'other_device']) });
export async function provideVerifyMethodHandler(req: Request, res: Response): Promise<void> {
  const { method } = provideVerifyMethodSchema.parse(req.body);
  const account = await batchService.provideVerifyMethod(getWorkspaceId(req), id(req), method);
  res.json({ data: account });
}

// Live WhatsApp-registration progress (log + last step) for the modal to restore.
export async function waRegisterStatusHandler(req: Request, res: Response): Promise<void> {
  const data = await waRegisterService.getStatus(id(req), getWorkspaceId(req));
  res.json({ data });
}

// One-click Instagram registration. Email-based and fully autonomous (the agent
// reads the confirmation code from email). All identity fields are optional —
// anything omitted is generated. Returns the account row immediately; the modal
// polls status while the agent works.
const startIgRegisterSchema = z.object({
  deviceId: z.string().min(1),
  email: z.string().email().optional(),
  password: z.string().min(6).max(64).optional(),
  fullName: z.string().min(1).max(80).optional(),
  birthYear: z.coerce.number().int().min(1950).max(2007).optional()
});
export async function startInstagramRegisterHandler(req: Request, res: Response): Promise<void> {
  const input = startIgRegisterSchema.parse(req.body);
  const { deviceId, ...overrides } = input;
  const account = await batchService.startInstagramRegister(getWorkspaceId(req), deviceId, overrides);
  res.status(201).json({ data: account });
}

// Live Instagram-registration progress (log + last step) for the modal to restore.
export async function igRegisterStatusHandler(req: Request, res: Response): Promise<void> {
  const data = await igRegisterService.getStatus(id(req), getWorkspaceId(req));
  res.json({ data });
}
