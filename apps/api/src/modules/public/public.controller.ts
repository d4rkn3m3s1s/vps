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
import { getWhatsappState, capabilitiesOf } from '../devices/whatsappCategory';
import { normalizePhoneInput, normalizeOtpInput } from '../../lib/phone';

const deviceService = new DeviceService();

// Map an on-device job's raw result.status code to a human-readable warning for the
// external caller. A public integrator polling a jobId used to get only the bare code
// (e.g. "CHAT_NOT_OPENED") with no idea what to do about it; this surfaces the reason +
// whether it's worth retrying, so a failed send never looks like an opaque success.
// `ok:false` marks a delivered job that nonetheless did NOT succeed (COMPLETED with a
// failure status) — the #1 thing an integrator needs to branch on.
const JOB_WARNING: Record<string, { ok: boolean; retryable: boolean; message: string }> = {
  SENT: { ok: true, retryable: false, message: 'Mesaj gönderildi.' },
  OK: { ok: true, retryable: false, message: 'İşlem başarılı.' },
  ACCOUNT_BANNED: { ok: false, retryable: false, message: 'Bu WhatsApp hesabı YASAKLI (ban) — hesap ölü, mesaj gönderilemez. Yeniden denemeyin.' },
  ACCOUNT_LOGGED_OUT: { ok: false, retryable: false, message: 'Bu WhatsApp hesabı ÇIKIŞ YAPMIŞ / kayıt silinmiş — yeniden kayıt gerekir.' },
  ACCOUNT_RESTRICTED: { ok: false, retryable: false, message: 'Hesap KISITLI — yeni sohbet başlatamıyor (ban öncesi durum). Bu numaraya ilk kez yazıyorsanız gitmez.' },
  ACCOUNT_REVIEW: { ok: false, retryable: true, message: 'Hesap incelemede — genelde ~24 saatte açılır, sonra tekrar deneyin.' },
  RATE_LIMITED: { ok: false, retryable: true, message: 'Bu cihaz geçici olarak hız-sınırlı ("wait N min") — belirtilen süre sonra tekrar deneyin.' },
  INVALID_RECIPIENT: { ok: false, retryable: false, message: 'Hedef numara WhatsApp\'ta değil veya geçersiz.' },
  CHAT_NOT_OPENED: { ok: false, retryable: true, message: 'Sohbet ekranı açılamadı — cihaz meşgul/kararsız olabilir ya da hesap çıkış yapmış olabilir. Tekrar deneyin; sürekli tekrarlıyorsa cihaz sağlığını kontrol edin.' },
  COMPOSE_FAILED: { ok: false, retryable: true, message: 'Mesaj kutusuna yazılamadı — tekrar deneyin.' }
};
function jobWarning(job: { status: string; result: unknown; error: string | null }): { ok: boolean; retryable: boolean; message: string } | null {
  if (job.status === 'FAILED') {
    return { ok: false, retryable: true, message: job.error ? String(job.error) : 'İş başarısız oldu — tekrar deneyin.' };
  }
  const rstatus = (job.result as { status?: string } | null)?.status;
  if (!rstatus) return null;
  return JOB_WARNING[rstatus] ?? null;
}

// GET /public/v1/devices — the workspace's devices, trimmed to the fields an
// external integration needs to pick a target. Workspace-scoped (never leaks
// other tenants; see requirePublicWorkspace).
//
// ★2026-07-29: filtreler + kategori sayaçları. Eskiden filo TEK düz liste olarak
// dönüyordu — 38 cihazın hangisi WhatsApp'lı, hangisi boş, hangisi banlı belli
// olmuyordu; entegratör hepsini çekip kendi süzüyordu. Artık ?category= ile süzülür
// ve `meta.counts` "ne var ne yok"u tek bakışta verir.
const listDevicesQuerySchema = z.object({
  category: z.enum(['empty', 'manual', 'registering', 'whatsapp', 'blocked']).optional(),
  // Kısayol: sadece mesaj atılabilir cihazlar (category=whatsapp ile aynı küme).
  whatsappReady: z.enum(['true', 'false']).optional(),
  status: z.enum(['ONLINE', 'OFFLINE', 'STARTING', 'STOPPING', 'ERROR', 'UPDATING', 'REBOOTING']).optional(),
  tag: z.string().min(1).max(40).optional(),
  search: z.string().min(1).max(120).optional()
});

// Bir cihaz satırını public API şekline indirger (tek yerde, /devices ve /devices/:id
// aynı alanları döndürsün diye).
function toPublicDevice(d: unknown): Record<string, unknown> {
  const x = d as Record<string, unknown>;
  return {
    id: x.id,
    name: x.name,
    status: x.status,
    // empty | registering | whatsapp | blocked — hangi uçların çalışacağını belirler.
    whatsappCategory: (x.whatsappCategory as string | undefined) ?? 'empty',
    // The registered WhatsApp number on this device (null if none / not registered).
    whatsappNumber: (x.activeWhatsappPhone as string | null) ?? null,
    // null = healthy/no account; otherwise RESTRICTED | BANNED | LOGGED_OUT.
    whatsappHealth: (x.waAccountHealth as string | null) ?? null,
    // true only when the device holds a usable WhatsApp account (ACTIVE-ish).
    whatsappReady: Boolean(x.hasActiveWhatsapp),
    tags: Array.isArray(x.tags) ? (x.tags as string[]) : []
  };
}

export async function listDevicesHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const q = listDevicesQuerySchema.parse(req.query);
  // tag/search zaten servis seviyesinde (SQL) filtreleniyor — orada bırakıyoruz.
  const devices = await deviceService.listDevices(
    workspaceId,
    ...([q.tag, q.search] as [string | undefined, string | undefined])
  );
  const mapped = devices.map(toPublicDevice);

  // Sayaçlar FİLTREDEN ÖNCE hesaplanır: "?category=empty" çağıran da filonun
  // tamamındaki dağılımı görsün (aksi halde counts hep tek kutuyu gösterirdi).
  const counts = { empty: 0, manual: 0, registering: 0, whatsapp: 0, blocked: 0 } as Record<string, number>;
  for (const d of mapped) {
    const c = String(d.whatsappCategory);
    if (c in counts) counts[c] = (counts[c] ?? 0) + 1;
  }

  let data = mapped;
  if (q.category) data = data.filter((d) => d.whatsappCategory === q.category);
  if (q.whatsappReady) data = data.filter((d) => Boolean(d.whatsappReady) === (q.whatsappReady === 'true'));
  if (q.status) data = data.filter((d) => d.status === q.status);

  res.json({ data, meta: { total: mapped.length, returned: data.length, counts } });
}

// GET /public/v1/devices/:id — tek cihaz + YETENEK listesi: bu cihazda hangi
// endpoint grupları çalışır, çalışmayanlar neden çalışmaz. Entegratör "boş cihaza
// send atıp 409 yemek" yerine önce buraya bakabilir. available/unavailable listesi
// guard'ın kullandığı AYNI karar tablosundan türer (whatsappCategory.ts) — ayrı bir
// liste tutulsaydı zamanla guard'dan ayrışırdı.
export async function getDeviceHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (!id) throw new AppError('deviceId gerekli', 400, 'MISSING_DEVICE_ID');
  const device = await deviceService.getDevice(id, workspaceId);
  if (!device) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
  const state = await getWhatsappState(device.id);
  res.json({
    data: {
      ...toPublicDevice(device),
      capabilities: capabilitiesOf(state)
    }
  });
}

// POST /public/v1/devices/:id/tags — add / remove / replace a device's tags (e.g. "#test"
// to group and filter the fleet). Three modes: add (default) appends, remove deletes,
// set replaces the whole list. A leading "#" is stripped and tags are lower-cased (so
// "#Test", "test", "TEST" are one tag) — the same normalization the dashboard uses.
// write scope, workspace-scoped (updateDevice 404s a foreign device id).
const deviceTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(40)).min(1).max(20),
  mode: z.enum(['add', 'remove', 'set']).optional()
});
// "#Test" → "test"; drops blanks; caps length. Mirrors updateDevice's own normalize.
function normalizeTag(t: string): string {
  return t.trim().replace(/^#+/, '').trim().toLowerCase().slice(0, 32);
}
export async function deviceTagsHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const deviceId = typeof req.params.id === 'string' ? req.params.id : '';
  if (!deviceId) throw new AppError('deviceId gerekli', 400, 'MISSING_DEVICE_ID');
  const { tags, mode = 'add' } = deviceTagsSchema.parse(req.body);
  const incoming = [...new Set(tags.map(normalizeTag).filter(Boolean))];
  // Load current tags (workspace-scoped read; a foreign id yields none → 404 on update).
  const current = await deviceService.getDevice(deviceId, workspaceId);
  if (!current) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
  const existing = Array.isArray((current as Record<string, unknown>).tags) ? ((current as Record<string, unknown>).tags as string[]) : [];
  let next: string[];
  if (mode === 'set') next = incoming;
  else if (mode === 'remove') next = existing.filter((t) => !incoming.includes(t));
  else next = [...new Set([...existing, ...incoming])]; // add
  // updateDevice re-normalizes + caps (20 tags), so this stays consistent with the panel.
  const updated = await deviceService.updateDevice(deviceId, { tags: next }, workspaceId);
  res.json({ data: { id: updated.id, name: updated.name, tags: updated.tags } });
}

// POST /public/v1/devices/:id/rename — rename a device (cosmetic label only; the
// instance / WhatsApp account / proxy are untouched, exactly like the dashboard's inline
// rename). write scope, workspace-scoped (updateDevice 404s a foreign device id).
const deviceRenameSchema = z.object({ name: z.string().min(1).max(60) });
export async function deviceRenameHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const deviceId = typeof req.params.id === 'string' ? req.params.id : '';
  if (!deviceId) throw new AppError('deviceId gerekli', 400, 'MISSING_DEVICE_ID');
  const { name } = deviceRenameSchema.parse(req.body);
  const updated = await deviceService.updateDevice(deviceId, { name: name.trim() }, workspaceId);
  res.json({ data: { id: updated.id, name: updated.name, status: updated.status } });
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

// POST /public/v1/whatsapp/profile/name — change the device's OWN profile display name.
const setNameSchema = z.object({ deviceId: z.string().min(1), name: z.string().min(1).max(25) });
export async function setNameHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = setNameSchema.parse(req.body);
  const { job } = await batchService.setProfileName(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/profile/avatar — change the device's OWN profile picture.
// `imageB64` is a base64 PNG/JPEG (data-URI prefix tolerated).
const setAvatarSchema = z.object({ deviceId: z.string().min(1), imageB64: z.string().min(1) });
export async function setAvatarHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = setAvatarSchema.parse(req.body);
  const { job } = await batchService.setAvatar(workspaceId, input);
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

// POST /public/v1/whatsapp/view-once — pull view-once (tek görünümlük) media as
// base64 (root sees the file even after the UI marks it opened). write scope.
const viewOnceSchema = z.object({ deviceId: z.string().min(1), limit: z.coerce.number().int().positive().max(30).optional() });
export async function viewOnceHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = viewOnceSchema.parse(req.body);
  const { job } = await batchService.waViewOnce(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/voice-notes — the account's voice notes (PTT), optionally
// with base64 audio. Set withAudio:false for metadata only (faster). write scope.
const voiceNotesSchema = z.object({ deviceId: z.string().min(1), to: z.string().min(1).optional(), limit: z.coerce.number().int().positive().max(30).optional(), withAudio: z.boolean().optional() });
export async function voiceNotesHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = voiceNotesSchema.parse(req.body);
  const { job } = await batchService.waVoiceNotes(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/deleted — messages the peer deleted "for everyone" that
// survive in the DB (anti-delete): what was deleted, by whom, when + original text.
// write scope.
const deletedSchema = z.object({ deviceId: z.string().min(1), limit: z.coerce.number().int().positive().max(200).optional() });
export async function deletedHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = deletedSchema.parse(req.body);
  const { job } = await batchService.waDeleted(workspaceId, input);
  res.json({ data: { jobId: job.id, status: job.status } });
}

// POST /public/v1/whatsapp/links — every URL shared in the account's chats
// (optionally one chat). write scope.
const linksSchema = z.object({ deviceId: z.string().min(1), to: z.string().min(1).optional(), limit: z.coerce.number().int().positive().max(200).optional() });
export async function linksHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = linksSchema.parse(req.body);
  const { job } = await batchService.waLinks(workspaceId, input);
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

// POST /public/v1/devices/provision/batch — build MANY brand-new devices in one call
// (1–20). Same one-click pipeline as the single provision, but with a count + optional
// name prefix. Each device gets a fresh unique name (prefix-xxxx). Fault-tolerant: if the
// host fills up mid-batch, the ones that started still come back in `started[]` and the
// failures in `failed[]` — you never lose the whole run to one error. Each started device
// carries its own {deviceId, jobId}; poll each jobId's status to watch it come online.
const provisionBatchSchema = z.object({
  count: z.coerce.number().int().min(1).max(20),
  // Optional name prefix — "watest" → watest-a3f, watest-9k2, … (unique per device).
  namePrefix: z.string().min(1).max(40).optional(),
  // Country-matched residential proxy (ISO-2). WhatsApp needs number-country == exit-IP
  // country, so set this to the country you'll register numbers from (e.g. "tr", "al").
  proxyCountry: z.string().length(2).optional(),
  deviceModel: z.string().max(60).optional(),
  androidVersion: z.string().max(10).optional()
});
export async function provisionBatchHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  requireScope(req, 'write');
  const input = provisionBatchSchema.parse(req.body ?? {});
  const result = await provisionService.createBatch(
    {
      count: input.count,
      ...(input.namePrefix ? { namePrefix: input.namePrefix } : {}),
      ...(input.proxyCountry ? { proxyCountry: input.proxyCountry } : {}),
      ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
      ...(input.androidVersion ? { androidVersion: input.androidVersion } : {})
    },
    workspaceId
  );
  res.status(201).json({
    data: {
      total: result.total,
      started: result.started, // [{ jobId, deviceId, instance, name }]
      failed: result.failed,    // [{ index, error }]
      status: 'PROVISIONING'
    }
  });
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
  // ★2026-07-29: dış entegratörler numarayı biçimli gönderebiliyor
  // ("+90 555 111 22 33"). Ayırıcılar temizlenir; rakamlara dokunulmaz.
  phoneNumber: z
    .string()
    .min(6)
    .transform((v, ctx) => {
      const n = normalizePhoneInput(v);
      if (!n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Geçerli bir telefon numarası girin (ülke kodu dahil, örn. +90 555 111 22 33)'
        });
        return z.NEVER;
      }
      return n;
    })
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
// ★2026-07-29: SMS'ten kopyalanan kod boşluklu gelebilir ("123 456") — ayırıcılar
// temizlenir, cihaza yalnız rakam iletilir.
const otpSchema = z.object({
  otpCode: z
    .string()
    .min(4)
    .max(16)
    .transform((v, ctx) => {
      const n = normalizeOtpInput(v);
      if (!n) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Doğrulama kodu 4-8 haneli olmalı (örn. 123456)' });
        return z.NEVER;
      }
      return n;
    })
});
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
//
// ★2026-07-30: yanıt artık operatör/entegratör yönlendirme alanlarını da taşıyor —
//   waitUntil (ISO)     WhatsApp bekletme cezasının bitiş anı
//   retryAfterSeconds   aynı bilginin makine-okunur hâli (poll döngüsü buna uyusun)
//   action              tek cümlelik "ne yapmalı"
//   wallKind            BAN | APK | COK_DENEME | RED (BAN → numara yandı)
//   resumable           aynı numarayla /retry çağrılabilir mi
// Eskiden entegratör "1 saat bekle" cezasını yalnızca serbest metinden çıkarabiliyordu;
// makine-okunur alan olmadığı için poll döngüleri cezayı görmezden gelip erken deneyip
// cezayı UZATIYORDU.
export async function registerWhatsappStatusHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const accountId = typeof req.params.id === 'string' ? req.params.id : '';
  if (!accountId) throw new AppError('accountId gerekli', 400, 'MISSING_ACCOUNT_ID');
  const data = await waRegisterService.getStatus(accountId, workspaceId);
  const until = data.waitUntil ? Date.parse(data.waitUntil) : NaN;
  const retryAfterSeconds = Number.isNaN(until) ? 0 : Math.max(0, Math.ceil((until - Date.now()) / 1000));
  res.json({ data: { ...data, retryAfterSeconds } });
}

// POST /public/v1/whatsapp/register/:id/retry — AYNI hesap satırıyla tekrar dene.
// Çıkış IP'si (proxy oturumu) yenilenir ve kayıt işi yeniden gönderilir; ajan kayıt
// başında WhatsApp verisini zaten temizliyor. Yeni hesap satırı AÇMAZ — bu kasıtlı:
// aynı numarayı "yeni kayıt" olarak tekrar göndermek WhatsApp'ın çok-deneme sayacını
// artırıyor (canlı veride asıl ban sürücüsü buydu).
// KESİN ban'da 409 NUMBER_BANNED döner; bekleme süresi dolmadan çağrılırsa 409 ile
// kalan süre bildirilir.
export async function registerWhatsappRetryHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const accountId = typeof req.params.id === 'string' ? req.params.id : '';
  if (!accountId) throw new AppError('accountId gerekli', 400, 'MISSING_ACCOUNT_ID');
  // Bekleme cezası sürüyorsa reddet: erken deneme cezayı uzatıyor. Panel bunu butonu
  // kilitleyerek yapıyor; API'de kural sunucuda olmalı (entegratör kilitlenemez).
  const st = await waRegisterService.getStatus(accountId, workspaceId);
  if (st.waitUntil) {
    const left = Math.ceil((Date.parse(st.waitUntil) - Date.now()) / 1000);
    if (left > 0) {
      throw new AppError(
        `WhatsApp bekletme cezası sürüyor — ${Math.ceil(left / 60)} dakika sonra tekrar deneyin (erken deneme cezayı uzatır).`,
        409,
        'WAIT_IN_PROGRESS'
      );
    }
  }
  const data = await batchService.retryWhatsappRegister(workspaceId, accountId);
  res.json({ data });
}

// GET /public/v1/me — who the calling flk_ key is: its workspace, scopes, label, and
// this workspace's device count. Lets an integrator self-discover its permissions and
// scale without trial-and-error 403s.
export async function meHandler(req: Request, res: Response): Promise<void> {
  const workspaceId = requirePublicWorkspace(req);
  const key = req.apiKey as { id?: string; name?: string; label?: string; scopes?: string[] } | undefined;
  const devices = await deviceService.listDevices(workspaceId).catch(() => []);
  // Filo dağılımı burada da verilir: entegratör tek çağrıda kaç boş / kaç WhatsApp'lı
  // cihazı olduğunu görür, listeyi çekip saymak zorunda kalmaz.
  const counts = { empty: 0, manual: 0, registering: 0, whatsapp: 0, blocked: 0 } as Record<string, number>;
  for (const d of devices) {
    const c = String((d as Record<string, unknown>).whatsappCategory ?? 'empty');
    if (c in counts) counts[c] = (counts[c] ?? 0) + 1;
  }
  res.json({
    data: {
      workspaceId,
      keyId: key?.id ?? null,
      label: key?.label ?? key?.name ?? null,
      scopes: key?.scopes ?? [],
      deviceCount: devices.length,
      devices: counts
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
  const warn = jobWarning(job);
  res.json({
    data: {
      id: job.id,
      type: job.type,
      status: job.status,
      result: job.result ?? null,
      error: job.error ?? null,
      // Human-readable outcome for the integrator: ok (did it truly succeed?),
      // retryable (worth trying again?), and a Turkish reason. Absent when the job
      // hasn't produced a classifiable result yet (still PENDING/RUNNING).
      ...(warn ? { ok: warn.ok, retryable: warn.retryable, warning: warn.message } : {}),
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
      const warn = jobWarning(job);
      res.json({
        data: {
          id: job.id,
          type: job.type,
          status: job.status,
          result: job.result ?? null,
          error: job.error ?? null,
          ...(warn ? { ok: warn.ok, retryable: warn.retryable, warning: warn.message } : {}),
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
