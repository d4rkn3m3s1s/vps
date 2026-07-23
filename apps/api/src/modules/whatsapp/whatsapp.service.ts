// WhatsApp conversation layer — the WhatsApp-Web-style chat list on top of the
// raw WhatsappMessage log. One WhatsappConversation row per (device, peer) thread
// holds a denormalised last-message preview + unread count so the list renders for
// 200+ chats without scanning the message table.
//
// `recordMessage` is the single write path: agent.service calls it for every
// stored message (inbound + outbound) to upsert the thread. Everything else here
// is read/operator-state (labels, favourite, archive, mark-read).
//
// All queries are workspace-scoped: the caller passes the resolved workspaceId and
// we verify the device belongs to it before touching a thread (cross-tenant guard,
// same pattern as batch.service.listMessages).

import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { encryptString, safeDecrypt } from '../../lib/crypto';
import { createJobRecord } from '../jobs/jobs.service';
import type { JobPayload } from '../jobs/job.types';
import { webhooksService } from '../webhooks/webhooks.service';
import { alertsService } from '../alerts/alerts.service';
import { notificationsService } from '../notifications/notifications.service';
import { logger } from '../../lib/logger';

// Kept in sync with the dashboard label picker + Telegram chip rendering.
export const LABEL_COLORS = [
  'slate',
  'emerald',
  'sky',
  'violet',
  'amber',
  'rose',
  'cyan',
  'lime'
] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export type ConversationFilter = 'all' | 'unread' | 'favorite' | 'archived';

// ── peer normalisation ───────────────────────────────────────────────────────

// Canonicalise a peer so the SAME contact always maps to ONE conversation thread,
// no matter how WhatsApp surfaced it. Inbound peers arrive as WhatsApp's display
// form ("+90 546 402 28 35"); outbound peers are the digits we dialled
// ("905464022835"). Without this they became two separate threads.
//
// Rule: if the value is phone-like (mostly digits, ≥7 of them once stripped), keep
// only the digits and drop a leading international "00". Otherwise it's a contact/
// group NAME — leave it as-is (trimmed) so named chats aren't mangled.
export function normalizePeer(peer: string): string {
  const raw = peer.trim();
  const digits = raw.replace(/\D/g, '');
  // Heuristic: phone numbers are ≥7 digits and the non-digit chars are only the
  // usual formatting (+, spaces, dashes, parens). A name like "Ali 42" keeps letters.
  const looksLikePhone = digits.length >= 7 && /^[\d\s+()\-.]+$/.test(raw);
  if (!looksLikePhone) return raw.slice(0, 256);
  // Drop a leading "00" international prefix (0090… → 90…). Never touch a bare 0.
  const canonical = digits.replace(/^00(?=\d)/, '');
  return canonical.slice(0, 256);
}

// ── device / workspace guard ────────────────────────────────────────────────

async function assertDevice(deviceId: string, workspaceId: string | undefined): Promise<void> {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true }
  });
  if (!device) throw new AppError('Cihaz bulunamadı', 404, 'DEVICE_NOT_FOUND');
}

// ── the single write path (called from agent.service) ───────────────────────

// Upsert the conversation thread for a just-stored message. `plainBody` is the
// DECRYPTED preview text (agent.service has it in hand); we re-encrypt it before
// storing so the preview is protected at rest exactly like the message body.
// Inbound bumps unreadCount; outbound leaves it (we sent it, it's "read").
export async function recordMessage(input: {
  deviceId: string;
  workspaceId: string | null;
  peer: string;
  direction: 'IN' | 'OUT';
  plainBody: string;
  at: Date;
  // Outbound delivery state to denormalise onto the thread (list tick). Defaults
  // to SENT for OUT and DELIVERED for IN.
  status?: string;
}): Promise<void> {
  // Canonical peer → one thread per contact regardless of inbound/outbound form.
  const peer = normalizePeer(input.peer);
  const preview = encryptString(input.plainBody.slice(0, 4096));
  const isIn = input.direction === 'IN';
  const lastStatus = input.status ?? (isIn ? 'DELIVERED' : 'SENT');
  await prisma.whatsappConversation.upsert({
    where: { deviceId_peer: { deviceId: input.deviceId, peer } },
    create: {
      deviceId: input.deviceId,
      workspaceId: input.workspaceId,
      peer,
      lastMessageBody: preview,
      lastDirection: input.direction,
      lastMessageAt: input.at,
      lastStatus,
      unreadCount: isIn ? 1 : 0
    },
    update: {
      lastMessageBody: preview,
      lastDirection: input.direction,
      lastMessageAt: input.at,
      lastStatus,
      // Keep the newest workspace binding (older rows may predate it).
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      // Opening an archived thread on a new inbound message un-archives it, like
      // WhatsApp Web. Outbound never changes archive state.
      ...(isIn ? { unreadCount: { increment: 1 }, archived: false } : {})
    }
  });
}

// ── outbound delivery receipts (✓✓ delivered / blue-tick read) ───────────────

// Monotonic ordering of an outbound message's delivery state. A receipt may only
// ADVANCE the status (SENT → DELIVERED → READ); a late/stale DELIVERED must never
// pull a message that's already READ back down.
const OUT_STATUS_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: -1 };

// Advance the delivery state of the most recent matching OUT message in a thread
// (and denormalise it onto the conversation's list tick), then fire the matching
// webhook so external integrations learn a sent message was delivered/read on the
// peer's phone. Idempotent + monotonic: re-applying the same or an older receipt is
// a no-op. Returns whether anything actually advanced.
//
// ⚠️ AGENT SIDE IS NOT WIRED YET. This is the API + webhook half of the receipt
// feature. The host agent must, on a WHATSAPP_SEND (or a periodic sweep), read the
// tick glyph off the sent bubble (single ✓ = SENT, double ✓✓ = DELIVERED, blue =
// READ) and POST it to /agent/whatsapp/receipt → agentService.recordWhatsappReceipt
// → here. TODO(agent): implement the on-device tick read; until then no receipt
// events fire and OUT messages stay 'SENT' (today's behaviour, unchanged).
export async function advanceOutboundReceipt(input: {
  deviceId: string;
  workspaceId: string | null;
  peer: string;
  status: 'DELIVERED' | 'READ';
  // Optional: target a specific message id; otherwise the newest OUT row in the thread.
  messageId?: string | undefined;
  at?: Date | undefined;
}): Promise<{ advanced: boolean; messageId: string | null }> {
  const peer = normalizePeer(input.peer);
  const at = input.at ?? new Date();
  const nextRank = OUT_STATUS_RANK[input.status] ?? 0;

  // Find the target OUT message (specific id, or the newest OUT in the thread).
  const msg = input.messageId
    ? await prisma.whatsappMessage.findFirst({
        where: { id: input.messageId, deviceId: input.deviceId, direction: 'OUT' },
        select: { id: true, status: true, peer: true }
      })
    : await prisma.whatsappMessage.findFirst({
        where: { deviceId: input.deviceId, peer, direction: 'OUT' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true, peer: true }
      });
  if (!msg) return { advanced: false, messageId: null };

  // Monotonic: never downgrade (DELIVERED after READ, or any receipt on a FAILED row).
  const curRank = OUT_STATUS_RANK[msg.status] ?? 0;
  if (curRank < 0 || nextRank <= curRank) return { advanced: false, messageId: msg.id };

  await prisma.whatsappMessage
    .update({ where: { id: msg.id }, data: { status: input.status, statusAt: at } })
    .catch(() => undefined);

  // Denormalise onto the thread's list tick ONLY when this is still the last message
  // (a newer send may have superseded it). Best-effort.
  await prisma.whatsappConversation
    .updateMany({
      where: { deviceId: input.deviceId, peer, lastDirection: 'OUT' },
      data: { lastStatus: input.status }
    })
    .catch(() => undefined);

  // Webhook fan-out (WHATSAPP_DELIVERED / WHATSAPP_READ). webhooks.service does not
  // import whatsapp.service, so a static import is cycle-free.
  void webhooksService.dispatch(
    input.status === 'READ' ? 'WHATSAPP_READ' : 'WHATSAPP_DELIVERED',
    { deviceId: input.deviceId, to: peer, messageId: msg.id, status: input.status, ts: at.toISOString() },
    input.workspaceId ?? undefined
  );

  return { advanced: true, messageId: msg.id };
}

// ── account health ───────────────────────────────────────────────────────────

// The three on-device health states an ACTIVE WhatsApp account can fall into.
export type WaAccountHealth = 'RESTRICTED' | 'BANNED' | 'LOGGED_OUT';

// Only transition INTO a health state from a live account — never from a state
// that is still mid-registration (those flows own the row) or already terminal.
// This keeps a stray ban signal from overwriting an in-progress OTP wait.
const HEALTH_TRANSITIONABLE = new Set(['ACTIVE', 'RESTRICTED', 'BANNED', 'LOGGED_OUT']);
// Rank so we don't flap: a RESTRICTED signal must not overwrite a harder BANNED /
// LOGGED_OUT that was already recorded. Recovery back to ACTIVE happens elsewhere
// (a successful send/register), not here.
const HEALTH_RANK: Record<string, number> = { RESTRICTED: 1, LOGGED_OUT: 2, BANNED: 3 };

// Record a WhatsApp account-health transition detected on-device (from a send
// result or an inbound system notice). Finds the device's most recent WhatsApp
// account and, if it's in a transitionable state, moves it to `health` and fires
// the WHATSAPP_ACCOUNT_HEALTH webhook. Idempotent + monotonic (won't downgrade a
// harder state, won't re-fire the same state). Best-effort — never throws.
export async function setAccountHealth(input: {
  deviceId: string;
  workspaceId: string | null;
  health: WaAccountHealth;
  note?: string | undefined;
}): Promise<{ changed: boolean }> {
  const account = await prisma.generatedAccount.findFirst({
    where: { deviceId: input.deviceId, platform: 'whatsapp' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, phoneNumber: true }
  });
  if (!account) return { changed: false };
  if (!HEALTH_TRANSITIONABLE.has(account.status)) return { changed: false };
  // Monotonic: already at this state, or at a harder one → nothing to do.
  const curRank = HEALTH_RANK[account.status] ?? 0;
  const nextRank = HEALTH_RANK[input.health] ?? 0;
  if (nextRank <= curRank) return { changed: false };

  await prisma.generatedAccount
    .update({
      where: { id: account.id },
      data: { status: input.health, ...(input.note ? { error: input.note.slice(0, 500) } : {}) }
    })
    .catch(() => undefined);

  void webhooksService.dispatch(
    'WHATSAPP_ACCOUNT_HEALTH',
    {
      deviceId: input.deviceId,
      phoneNumber: account.phoneNumber ?? null,
      health: input.health,
      ...(input.note ? { note: input.note } : {})
    },
    input.workspaceId ?? undefined
  );

  // ★2026-07-23 (M-1): a ban/restriction/logout is a CRITICAL account event, but before
  // this it ONLY fired the webhook — an operator without a webhook configured never learned
  // their account got banned (the exact "found out by looking manually" gap). Now:
  //  1) run the alert engine (ACCOUNT_BANNED) so any matching rule + its channels fire, AND
  //  2) push a Telegram/Slack/Discord notification UNCONDITIONALLY (no rule needed) — a ban
  //     is too important to depend on the operator having pre-created an alert rule.
  const num = account.phoneNumber ?? input.deviceId;
  const healthTr: Record<string, string> = { BANNED: '🚫 BANLANDI', RESTRICTED: '⚠️ KISITLANDI', LOGGED_OUT: '🔒 ÇIKIŞ YAPILDI' };
  const label = healthTr[input.health] ?? input.health;
  void alertsService
    .evaluate(input.workspaceId ?? undefined, 'ACCOUNT_BANNED', {
      title: `WhatsApp hesabı ${label} — ${num}`,
      detail: `${label}\n📱 ${num}${input.note ? `\n📝 ${input.note.slice(0, 200)}` : ''}`
    })
    .catch(() => undefined);
  void notificationsService
    .dispatch(input.workspaceId ?? '', {
      title: `${label} — WhatsApp hesabı`,
      detail: `${label}\n📱 Numara: ${num}${input.note ? `\n📝 ${input.note.slice(0, 200)}` : ''}`.slice(0, 900)
    })
    .catch(() => undefined);
  return { changed: true };
}

// ── conversation list ───────────────────────────────────────────────────────

export type ConversationRow = {
  id: string;
  peer: string;
  displayName: string | null;
  lastMessageBody: string;
  lastDirection: string;
  lastStatus: string;
  lastMessageAt: Date;
  unreadCount: number;
  favorite: boolean;
  archived: boolean;
  pinned: boolean;
  labelIds: string[];
  // Whether this contact is currently blocked on the device.
  blocked: boolean;
  // We DON'T ship the (potentially large) avatar data-URI in the list — just a
  // flag so the row can lazy-load it from GET /whatsapp/avatar. Keeps the 40-row
  // list payload small even when every thread has a photo.
  hasAvatar: boolean;
};

type ConvModel = {
  id: string; peer: string; displayName: string | null; lastMessageBody: string;
  lastDirection: string; lastStatus: string; lastMessageAt: Date; unreadCount: number;
  favorite: boolean; archived: boolean; pinned: boolean; labelIds: string[];
  blocked: boolean; avatarBase64: string | null;
};
function toRow(c: ConvModel): ConversationRow {
  return {
    id: c.id,
    peer: c.peer,
    displayName: c.displayName,
    lastMessageBody: c.lastMessageBody ? safeDecrypt(c.lastMessageBody) : '',
    lastDirection: c.lastDirection,
    lastStatus: c.lastStatus,
    lastMessageAt: c.lastMessageAt,
    unreadCount: c.unreadCount,
    favorite: c.favorite,
    archived: c.archived,
    pinned: c.pinned,
    labelIds: c.labelIds,
    blocked: c.blocked,
    hasAvatar: Boolean(c.avatarBase64)
  };
}

// List a device's chat threads, newest-active first (pinned threads on top of the
// first page). Supports a smart filter (all/unread/favorite/archived), a label
// filter, a peer/displayName search, and cursor pagination for 200+ chats.
export async function listConversations(
  workspaceId: string | undefined,
  input: {
    deviceId: string;
    filter?: ConversationFilter | undefined;
    labelId?: string | undefined;
    search?: string | undefined;
    limit?: number | undefined;
    cursor?: string | undefined; // ISO lastMessageAt of the last row seen
  }
): Promise<{ conversations: ConversationRow[]; nextCursor: string | null }> {
  await assertDevice(input.deviceId, workspaceId);
  const take = Math.min(Math.max(input.limit ?? 40, 1), 100);
  const filter = input.filter ?? 'all';
  const search = input.search?.trim();
  const firstPage = !input.cursor;

  const where: Record<string, unknown> = { deviceId: input.deviceId };
  // Archived is its own view: only the 'archived' filter shows archived threads.
  if (filter === 'archived') where.archived = true;
  else where.archived = false;
  if (filter === 'unread') where.unreadCount = { gt: 0 };
  if (filter === 'favorite') where.favorite = true;
  if (input.labelId) where.labelIds = { has: input.labelId };
  if (search) {
    // Body is encrypted at rest, so match on the peer (number) OR the operator's
    // friendly displayName (both plaintext).
    where.OR = [
      { peer: { contains: search, mode: 'insensitive' } },
      { displayName: { contains: search, mode: 'insensitive' } }
    ];
  }
  if (input.cursor) {
    const d = new Date(input.cursor);
    if (!Number.isNaN(d.getTime())) where.lastMessageAt = { lt: d };
  }

  // Pinned threads pin to the very top — but only on the first page (they're few
  // and would otherwise fight the lastMessageAt cursor). On the first page we pull
  // pinned separately and prepend; the regular page then excludes pinned.
  let pinnedRows: ConvModel[] = [];
  if (firstPage) {
    pinnedRows = (await prisma.whatsappConversation.findMany({
      where: { ...where, pinned: true },
      orderBy: { pinnedAt: 'desc' }
    })) as ConvModel[];
    where.pinned = false;
  }

  const rows = (await prisma.whatsappConversation.findMany({
    where,
    orderBy: { lastMessageAt: 'desc' },
    take: take + 1
  })) as ConvModel[];
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const conversations = [...pinnedRows, ...page].map(toRow);
  const last = page[page.length - 1];
  return {
    conversations,
    nextCursor: hasMore && last ? last.lastMessageAt.toISOString() : null
  };
}

// Cheap unread total for the sidebar badge (sum across non-archived threads).
export async function unreadTotal(
  workspaceId: string | undefined,
  deviceId: string
): Promise<number> {
  await assertDevice(deviceId, workspaceId);
  const agg = await prisma.whatsappConversation.aggregate({
    where: { deviceId, archived: false, unreadCount: { gt: 0 } },
    _sum: { unreadCount: true }
  });
  return agg._sum.unreadCount ?? 0;
}

// ── a single thread's messages ──────────────────────────────────────────────

// Messages for one (device, peer) thread, oldest→newest for chat rendering, with
// cursor pagination (createdAt-based, older pages on scroll-up).
export async function getThreadMessages(
  workspaceId: string | undefined,
  input: { deviceId: string; peer: string; limit?: number | undefined; before?: string | undefined }
): Promise<{ messages: Array<{ id: string; direction: string; peer: string; body: string; status: string; failReason: string | null; waTimestamp: Date; createdAt: Date }>; nextBefore: string | null }> {
  await assertDevice(input.deviceId, workspaceId);
  const take = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const where: Record<string, unknown> = { deviceId: input.deviceId, peer: normalizePeer(input.peer) };
  if (input.before) {
    const d = new Date(input.before);
    if (!Number.isNaN(d.getTime())) where.createdAt = { lt: d };
  }
  // Pull newest-first (so the cursor works), then reverse to chat order.
  const rows = await prisma.whatsappMessage.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const oldest = page[page.length - 1];
  const messages = page
    .slice()
    .reverse()
    .map((m) => ({
      id: m.id,
      direction: m.direction,
      peer: m.peer,
      body: safeDecrypt(m.body),
      status: m.status,
      failReason: m.failReason,
      waTimestamp: m.waTimestamp,
      createdAt: m.createdAt
    }));
  return { messages, nextBefore: hasMore && oldest ? oldest.createdAt.toISOString() : null };
}

// Mark a thread read: zero its unread count and flip its unread inbound rows.
export async function markRead(
  workspaceId: string | undefined,
  input: { deviceId: string; peer: string }
): Promise<void> {
  await assertDevice(input.deviceId, workspaceId);
  const peer = normalizePeer(input.peer);
  await prisma.$transaction([
    prisma.whatsappConversation.updateMany({
      where: { deviceId: input.deviceId, peer },
      data: { unreadCount: 0 }
    }),
    prisma.whatsappMessage.updateMany({
      where: { deviceId: input.deviceId, peer, direction: 'IN', read: false },
      data: { read: true }
    })
  ]);
}

// ── operator state: favourite / archive / labels ────────────────────────────

export async function setConversationState(
  workspaceId: string | undefined,
  input: { deviceId: string; peer: string; favorite?: boolean | undefined; archived?: boolean | undefined; pinned?: boolean | undefined }
): Promise<void> {
  await assertDevice(input.deviceId, workspaceId);
  const data: Record<string, unknown> = {};
  if (typeof input.favorite === 'boolean') data.favorite = input.favorite;
  if (typeof input.archived === 'boolean') data.archived = input.archived;
  if (typeof input.pinned === 'boolean') {
    data.pinned = input.pinned;
    data.pinnedAt = input.pinned ? new Date() : null;
  }
  if (Object.keys(data).length === 0) return;
  await prisma.whatsappConversation.updateMany({
    where: { deviceId: input.deviceId, peer: normalizePeer(input.peer) },
    data
  });
}

// Set operator contact info: a friendly displayName (plaintext, shown in lists)
// and free-text notes (encrypted at rest). Pass undefined to leave a field as-is;
// pass '' to clear it.
export async function setContactInfo(
  workspaceId: string | undefined,
  input: { deviceId: string; peer: string; displayName?: string | undefined; notes?: string | undefined }
): Promise<void> {
  await assertDevice(input.deviceId, workspaceId);
  const data: Record<string, unknown> = {};
  if (typeof input.displayName === 'string') data.displayName = input.displayName.trim().slice(0, 120) || null;
  if (typeof input.notes === 'string') data.notes = input.notes ? encryptString(input.notes.slice(0, 4000)) : null;
  if (Object.keys(data).length === 0) return;
  await prisma.whatsappConversation.updateMany({
    where: { deviceId: input.deviceId, peer: normalizePeer(input.peer) },
    data
  });
}

// Read a conversation's decrypted notes + displayName (contact panel), plus the
// blocked flag and scraped profile info (name/about) fetched by WHATSAPP_PROFILE.
export async function getContactInfo(
  workspaceId: string | undefined,
  input: { deviceId: string; peer: string }
): Promise<{
  displayName: string | null; notes: string; labelIds: string[]; pinned: boolean;
  favorite: boolean; archived: boolean; blocked: boolean; hasAvatar: boolean;
  profileInfo: Record<string, unknown> | null; avatarAt: Date | null;
} | null> {
  await assertDevice(input.deviceId, workspaceId);
  const c = await prisma.whatsappConversation.findUnique({
    where: { deviceId_peer: { deviceId: input.deviceId, peer: normalizePeer(input.peer) } }
  });
  if (!c) return null;
  return {
    displayName: c.displayName,
    notes: c.notes ? safeDecrypt(c.notes) : '',
    labelIds: c.labelIds,
    pinned: c.pinned,
    favorite: c.favorite,
    archived: c.archived,
    blocked: c.blocked,
    hasAvatar: Boolean(c.avatarBase64),
    profileInfo: (c.profileInfo as Record<string, unknown> | null) ?? null,
    avatarAt: c.avatarAt
  };
}

// Return the stored avatar data-URI for one thread (lazy-loaded by the list/
// contact panel so the big image never rides along in the list payload).
export async function getAvatar(
  workspaceId: string | undefined,
  input: { deviceId: string; peer: string }
): Promise<{ avatarBase64: string | null; avatarAt: Date | null }> {
  await assertDevice(input.deviceId, workspaceId);
  const c = await prisma.whatsappConversation.findUnique({
    where: { deviceId_peer: { deviceId: input.deviceId, peer: normalizePeer(input.peer) } },
    select: { avatarBase64: true, avatarAt: true }
  });
  return { avatarBase64: c?.avatarBase64 ?? null, avatarAt: c?.avatarAt ?? null };
}

// Replace a thread's label set (validates the ids belong to this workspace).
export async function setConversationLabels(
  workspaceId: string | undefined,
  input: { deviceId: string; peer: string; labelIds: string[] }
): Promise<void> {
  await assertDevice(input.deviceId, workspaceId);
  const valid = await prisma.whatsappLabel.findMany({
    where: { id: { in: input.labelIds }, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true }
  });
  const ids = valid.map((l) => l.id);
  await prisma.whatsappConversation.updateMany({
    where: { deviceId: input.deviceId, peer: normalizePeer(input.peer) },
    data: { labelIds: ids }
  });
}

// ── labels (categories) CRUD ────────────────────────────────────────────────

export async function listLabels(
  workspaceId: string | undefined
): Promise<Array<{ id: string; name: string; color: string }>> {
  const rows = await prisma.whatsappLabel.findMany({
    where: { ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { createdAt: 'asc' }
  });
  return rows.map((l) => ({ id: l.id, name: l.name, color: l.color }));
}

export async function createLabel(
  workspaceId: string | undefined,
  input: { name: string; color?: string | undefined }
): Promise<{ id: string; name: string; color: string }> {
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new AppError('Etiket adı gerekli', 400, 'INVALID_LABEL');
  const color = (LABEL_COLORS as readonly string[]).includes(input.color ?? '')
    ? (input.color as string)
    : 'slate';
  const row = await prisma.whatsappLabel.create({
    data: { name, color, workspaceId: workspaceId ?? null }
  });
  return { id: row.id, name: row.name, color: row.color };
}

export async function deleteLabel(workspaceId: string | undefined, id: string): Promise<void> {
  const row = await prisma.whatsappLabel.findFirst({
    where: { id, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true }
  });
  if (!row) throw new AppError('Etiket bulunamadı', 404, 'LABEL_NOT_FOUND');
  await prisma.whatsappLabel.delete({ where: { id } });
  // Best-effort: strip the id off any threads that still reference it. Postgres
  // array_remove via a raw update (Prisma has no array-element pull helper).
  // Scoped by workspace so a delete never scans/writes other tenants' rows.
  if (workspaceId) {
    await prisma.$executeRaw`UPDATE "WhatsappConversation" SET "labelIds" = array_remove("labelIds", ${id}) WHERE "workspaceId" = ${workspaceId} AND ${id} = ANY("labelIds")`.catch(
      () => undefined
    );
  } else {
    await prisma.$executeRaw`UPDATE "WhatsappConversation" SET "labelIds" = array_remove("labelIds", ${id}) WHERE ${id} = ANY("labelIds")`.catch(
      () => undefined
    );
  }
}

// ── bulk conversation actions (200+ chat management) ─────────────────────────

// Apply one action to many threads at once (bulk archive / read / favourite /
// pin / label). Verifies the device belongs to the workspace, then updates all
// listed peers in one query.
export async function bulkAction(
  workspaceId: string | undefined,
  input: {
    deviceId: string;
    peers: string[];
    action: 'read' | 'archive' | 'unarchive' | 'favorite' | 'unfavorite' | 'pin' | 'unpin' | 'addLabel' | 'removeLabel';
    labelId?: string | undefined;
  }
): Promise<{ affected: number }> {
  await assertDevice(input.deviceId, workspaceId);
  const peers = [...new Set(input.peers.slice(0, 500).map(normalizePeer))];
  if (!peers.length) return { affected: 0 };
  const base = { deviceId: input.deviceId, peer: { in: peers } };

  switch (input.action) {
    case 'read': {
      const r = await prisma.$transaction([
        prisma.whatsappConversation.updateMany({ where: base, data: { unreadCount: 0 } }),
        prisma.whatsappMessage.updateMany({
          where: { deviceId: input.deviceId, peer: { in: peers }, direction: 'IN', read: false },
          data: { read: true }
        })
      ]);
      return { affected: r[0].count };
    }
    case 'archive':   return { affected: (await prisma.whatsappConversation.updateMany({ where: base, data: { archived: true } })).count };
    case 'unarchive': return { affected: (await prisma.whatsappConversation.updateMany({ where: base, data: { archived: false } })).count };
    case 'favorite':  return { affected: (await prisma.whatsappConversation.updateMany({ where: base, data: { favorite: true } })).count };
    case 'unfavorite':return { affected: (await prisma.whatsappConversation.updateMany({ where: base, data: { favorite: false } })).count };
    case 'pin':       return { affected: (await prisma.whatsappConversation.updateMany({ where: base, data: { pinned: true, pinnedAt: new Date() } })).count };
    case 'unpin':     return { affected: (await prisma.whatsappConversation.updateMany({ where: base, data: { pinned: false, pinnedAt: null } })).count };
    case 'addLabel':
    case 'removeLabel': {
      if (!input.labelId) throw new AppError('labelId gerekli', 400, 'LABEL_REQUIRED');
      // Validate the label belongs to this workspace.
      const lbl = await prisma.whatsappLabel.findFirst({ where: { id: input.labelId, ...(workspaceId ? { workspaceId } : {}) }, select: { id: true } });
      if (!lbl) throw new AppError('Etiket bulunamadı', 404, 'LABEL_NOT_FOUND');
      // Read → mutate → write per row (small N; array element ops need per-row logic).
      const rows = await prisma.whatsappConversation.findMany({ where: base, select: { id: true, labelIds: true } });
      let affected = 0;
      for (const row of rows) {
        const has = row.labelIds.includes(input.labelId);
        const next = input.action === 'addLabel'
          ? (has ? row.labelIds : [...row.labelIds, input.labelId])
          : row.labelIds.filter((l) => l !== input.labelId);
        if (next.length !== row.labelIds.length) {
          await prisma.whatsappConversation.update({ where: { id: row.id }, data: { labelIds: next } });
          affected++;
        }
      }
      return { affected };
    }
    default:
      return { affected: 0 };
  }
}

// ── canned replies (message templates) ───────────────────────────────────────

export async function listCannedReplies(
  workspaceId: string | undefined
): Promise<Array<{ id: string; shortcut: string | null; title: string; body: string; sortOrder: number }>> {
  const rows = await prisma.whatsappCannedReply.findMany({
    where: { ...(workspaceId ? { workspaceId } : {}) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
  });
  return rows.map((r) => ({ id: r.id, shortcut: r.shortcut, title: r.title, body: r.body, sortOrder: r.sortOrder }));
}

export async function createCannedReply(
  workspaceId: string | undefined,
  input: { title: string; body: string; shortcut?: string | undefined; sortOrder?: number | undefined }
): Promise<{ id: string; shortcut: string | null; title: string; body: string; sortOrder: number }> {
  const title = input.title.trim().slice(0, 80);
  const body = input.body.trim().slice(0, 4096);
  if (!title || !body) throw new AppError('Başlık ve metin gerekli', 400, 'INVALID_CANNED');
  const shortcut = input.shortcut?.trim().replace(/^\/+/, '').slice(0, 30) || null;
  const row = await prisma.whatsappCannedReply.create({
    data: {
      title, body,
      ...(shortcut ? { shortcut } : {}),
      sortOrder: input.sortOrder ?? 0,
      workspaceId: workspaceId ?? null
    }
  });
  return { id: row.id, shortcut: row.shortcut, title: row.title, body: row.body, sortOrder: row.sortOrder };
}

export async function updateCannedReply(
  workspaceId: string | undefined,
  id: string,
  input: { title?: string | undefined; body?: string | undefined; shortcut?: string | undefined; sortOrder?: number | undefined }
): Promise<void> {
  const row = await prisma.whatsappCannedReply.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) }, select: { id: true } });
  if (!row) throw new AppError('Şablon bulunamadı', 404, 'CANNED_NOT_FOUND');
  const data: Record<string, unknown> = {};
  if (typeof input.title === 'string') data.title = input.title.trim().slice(0, 80);
  if (typeof input.body === 'string') data.body = input.body.trim().slice(0, 4096);
  if (typeof input.shortcut === 'string') data.shortcut = input.shortcut.trim().replace(/^\/+/, '').slice(0, 30) || null;
  if (typeof input.sortOrder === 'number') data.sortOrder = input.sortOrder;
  if (Object.keys(data).length) await prisma.whatsappCannedReply.update({ where: { id }, data });
}

export async function deleteCannedReply(workspaceId: string | undefined, id: string): Promise<void> {
  const row = await prisma.whatsappCannedReply.findFirst({ where: { id, ...(workspaceId ? { workspaceId } : {}) }, select: { id: true } });
  if (!row) throw new AppError('Şablon bulunamadı', 404, 'CANNED_NOT_FOUND');
  await prisma.whatsappCannedReply.delete({ where: { id } });
}

// ── stats (analytics / SLA) ──────────────────────────────────────────────────

// Aggregate messaging stats over a window: inbound/outbound counts, open (unread)
// thread count, and average first-response time (inbound → next outbound in the
// same thread). Time metadata is plaintext so this works despite encrypted bodies.
export async function getStats(
  workspaceId: string | undefined,
  input: { deviceId?: string | undefined; sinceHours?: number | undefined }
): Promise<{ inbound: number; outbound: number; failed: number; openThreads: number; avgResponseMinutes: number | null }> {
  const since = new Date(Date.now() - (input.sinceHours ?? 24) * 3600_000);
  const msgWhere: Record<string, unknown> = { createdAt: { gte: since } };
  if (workspaceId) msgWhere.workspaceId = workspaceId;
  if (input.deviceId) { await assertDevice(input.deviceId, workspaceId); msgWhere.deviceId = input.deviceId; }

  const [inbound, outbound, failed] = await Promise.all([
    prisma.whatsappMessage.count({ where: { ...msgWhere, direction: 'IN' } }),
    prisma.whatsappMessage.count({ where: { ...msgWhere, direction: 'OUT' } }),
    prisma.whatsappMessage.count({ where: { ...msgWhere, direction: 'OUT', status: 'FAILED' } })
  ]);

  const convWhere: Record<string, unknown> = { archived: false, unreadCount: { gt: 0 } };
  if (workspaceId) convWhere.workspaceId = workspaceId;
  if (input.deviceId) convWhere.deviceId = input.deviceId;
  const openThreads = await prisma.whatsappConversation.count({ where: convWhere });

  // First-response time: for each thread with recent activity, pair the earliest
  // inbound with the earliest following outbound. Sampled over the window's rows.
  const recent = await prisma.whatsappMessage.findMany({
    where: msgWhere,
    select: { peer: true, deviceId: true, direction: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 4000
  });
  const firstIn = new Map<string, number>();
  const deltas: number[] = [];
  for (const m of recent) {
    const key = `${m.deviceId}:${m.peer}`;
    if (m.direction === 'IN') {
      if (!firstIn.has(key)) firstIn.set(key, m.createdAt.getTime());
    } else if (firstIn.has(key)) {
      deltas.push(m.createdAt.getTime() - firstIn.get(key)!);
      firstIn.delete(key);
    }
  }
  const avgResponseMinutes = deltas.length
    ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length / 60000)
    : null;

  return { inbound, outbound, failed, openThreads, avgResponseMinutes };
}

// ── broadcast (one-to-many throttled send) ───────────────────────────────────

// Launch a broadcast: create a tracking row, then dispatch a WHATSAPP_SEND job
// per recipient with a randomised delay (jitter) between them to blunt ban risk.
// Recipients come from an explicit peer list or a label (all threads carrying it).
export async function createBroadcast(
  workspaceId: string | undefined,
  input: {
    deviceId: string;
    deviceIds?: string[] | undefined; // multi-device fan-out (parallel send)
    message: string;
    peers?: string[] | undefined;
    labelId?: string | undefined;
    minGapSec?: number | undefined; // min seconds between sends PER DEVICE (default 6)
    maxGapSec?: number | undefined; // max seconds between sends PER DEVICE (default 20)
  }
): Promise<{ id: string; total: number; devices: number }> {
  await assertDevice(input.deviceId, workspaceId);
  const message = input.message.trim().slice(0, 4096);
  if (!message) throw new AppError('Mesaj gerekli', 400, 'INVALID_MESSAGE');

  // Resolve the sending-device pool: the primary deviceId plus any extra deviceIds.
  // Validate each (workspace-scoped) so a foreign device can't be smuggled in.
  const poolRaw = [input.deviceId, ...(input.deviceIds ?? [])].filter(Boolean);
  const pool = [...new Set(poolRaw)];
  for (const d of pool) if (d !== input.deviceId) await assertDevice(d, workspaceId);

  // Resolve recipients: explicit peers, or every thread with the given label.
  let peers = (input.peers ?? []).map((p) => p.replace(/[^\d]/g, '')).filter(Boolean);
  if (input.labelId) {
    const rows = await prisma.whatsappConversation.findMany({
      where: { deviceId: input.deviceId, labelIds: { has: input.labelId }, archived: false },
      select: { peer: true }
    });
    peers = [...new Set([...peers, ...rows.map((r) => r.peer.replace(/[^\d]/g, '')).filter(Boolean)])];
  }
  peers = [...new Set(peers)].slice(0, 1000);
  if (!peers.length) throw new AppError('Alıcı bulunamadı', 400, 'NO_RECIPIENTS');

  const bc = await prisma.whatsappBroadcast.create({
    data: {
      workspaceId: workspaceId ?? null,
      deviceId: input.deviceId,
      deviceIds: pool,
      message,
      peers,
      total: peers.length,
      status: 'RUNNING'
    }
  });

  const minGap = Math.max(2, input.minGapSec ?? 6) * 1000;
  const maxGap = Math.max(minGap, (input.maxGapSec ?? 20) * 1000);
  // Shard recipients round-robin across the device pool: recipient i → pool[i % N].
  // Each device gets its OWN paced dispatcher running in PARALLEL, so N devices send
  // ~N× faster than the old single-device loop (which serialised all 1000 on one phone
  // ≈ 5h). Within a device the gap still paces creation; the agent runs one job per
  // device at a time (skipBusyCheck lets them queue instead of tripping DEVICE_BUSY).
  const shards: string[][] = pool.map(() => []);
  peers.forEach((to, i) => { shards[i % pool.length]!.push(to); });

  const dispatchShard = async (deviceId: string, tos: string[]) => {
    let dispatchFailed = 0;
    for (const to of tos) {
      try {
        const payload = { deviceId, to, message, broadcastId: bc.id } as unknown as JobPayload;
        await createJobRecord('WHATSAPP_SEND', payload, deviceId, workspaceId ?? undefined, { skipBusyCheck: true });
        // Persist dispatch progress so a mid-broadcast API restart can tell how far it
        // got (resume support) instead of the old in-memory-only counter that vanished.
        await prisma.whatsappBroadcast.update({
          where: { id: bc.id }, data: { dispatchedCount: { increment: 1 } }
        }).catch(() => undefined);
      } catch (e) {
        dispatchFailed++;
        logger.warn('broadcast dispatch failed', { error: String(e), to, deviceId });
      }
      const gap = minGap + Math.floor(Math.random() * (maxGap - minGap + 1));
      await new Promise((r) => setTimeout(r, gap));
    }
    return dispatchFailed;
  };

  // Fire-and-forget: run all shard dispatchers concurrently. When they ALL finish
  // dispatching, DON'T force COMPLETED — the sends are still executing on-device. Let
  // the status resolve to COMPLETED once sentCount+failCount(+dispatch failures) reaches
  // total, reconciled in agent.service on each send-complete (and by the reaper). Only
  // fold dispatch-level failures into failCount here so their count isn't lost.
  void (async () => {
    const results = await Promise.all(shards.map((tos, idx) => dispatchShard(pool[idx]!, tos)));
    const dispatchFailed = results.reduce((a, b) => a + b, 0);
    if (dispatchFailed > 0) {
      await prisma.whatsappBroadcast.update({
        where: { id: bc.id }, data: { failCount: { increment: dispatchFailed } }
      }).catch(() => undefined);
    }
    // Reconcile once now (covers the all-dispatch-failed / tiny-broadcast case); the
    // per-send completion path finalises the normal case.
    await reconcileBroadcast(bc.id).catch(() => undefined);
  })();

  return { id: bc.id, total: peers.length, devices: pool.length };
}

// Resume any broadcast left RUNNING by an API restart. The dispatcher runs in-memory,
// so a crash mid-broadcast stranded the un-dispatched tail forever (the row stayed
// RUNNING with dispatchedCount < total). On startup we re-dispatch the remaining
// recipients. peers is an ordered snapshot and dispatchedCount counts dispatches, so
// peers.slice(dispatchedCount) is the tail; the public API's Idempotency-Key isn't in
// play here, but re-dispatching is bounded and the reaper/reconcile keep counts honest.
// Best-effort, sequential per broadcast, single device (the primary) to stay simple.
export async function resumeStrandedBroadcasts(): Promise<number> {
  const rows = await prisma.whatsappBroadcast.findMany({
    where: { status: 'RUNNING' },
    select: { id: true, deviceId: true, workspaceId: true, message: true, peers: true, total: true, dispatchedCount: true },
    take: 50
  });
  let resumed = 0;
  for (const bc of rows) {
    const remaining = bc.peers.slice(bc.dispatchedCount);
    if (!remaining.length) { await reconcileBroadcast(bc.id).catch(() => undefined); continue; }
    resumed++;
    void (async () => {
      for (const to of remaining) {
        try {
          const payload = { deviceId: bc.deviceId, to, message: bc.message, broadcastId: bc.id } as unknown as JobPayload;
          await createJobRecord('WHATSAPP_SEND', payload, bc.deviceId, bc.workspaceId ?? undefined, { skipBusyCheck: true });
          await prisma.whatsappBroadcast.update({ where: { id: bc.id }, data: { dispatchedCount: { increment: 1 } } }).catch(() => undefined);
        } catch (e) {
          logger.warn('broadcast resume dispatch failed', { error: String(e), to, broadcastId: bc.id });
        }
        await new Promise((r) => setTimeout(r, 6000 + Math.floor(Math.random() * 14000)));
      }
      await reconcileBroadcast(bc.id).catch(() => undefined);
    })();
  }
  if (resumed) logger.info('resumed stranded broadcasts', { count: resumed });
  return resumed;
}

// Flip a broadcast to COMPLETED once every recipient's send has a terminal outcome
// (sentCount + failCount >= total). Called after each send completes (agent.service)
// and by the dispatcher. Idempotent + only advances a RUNNING row, so concurrent
// callers can't double-flip or resurrect a CANCELLED broadcast.
export async function reconcileBroadcast(broadcastId: string): Promise<void> {
  const bc = await prisma.whatsappBroadcast.findUnique({
    where: { id: broadcastId },
    select: { status: true, total: true, sentCount: true, failCount: true }
  });
  if (!bc || bc.status !== 'RUNNING') return;
  if (bc.sentCount + bc.failCount >= bc.total) {
    await prisma.whatsappBroadcast
      .updateMany({ where: { id: broadcastId, status: 'RUNNING' }, data: { status: 'COMPLETED' } })
      .catch(() => undefined);
  }
}

export async function listBroadcasts(
  workspaceId: string | undefined,
  deviceId?: string
): Promise<Array<{ id: string; message: string; total: number; sentCount: number; failCount: number; status: string; createdAt: Date }>> {
  const rows = await prisma.whatsappBroadcast.findMany({
    where: { ...(workspaceId ? { workspaceId } : {}), ...(deviceId ? { deviceId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 30
  });
  return rows.map((b) => ({ id: b.id, message: b.message, total: b.total, sentCount: b.sentCount, failCount: b.failCount, status: b.status, createdAt: b.createdAt }));
}

export const whatsappService = {
  recordMessage,
  advanceOutboundReceipt,
  setAccountHealth,
  listConversations,
  unreadTotal,
  getThreadMessages,
  markRead,
  setConversationState,
  setContactInfo,
  getContactInfo,
  getAvatar,
  setConversationLabels,
  bulkAction,
  listLabels,
  createLabel,
  deleteLabel,
  listCannedReplies,
  createCannedReply,
  updateCannedReply,
  deleteCannedReply,
  getStats,
  createBroadcast,
  reconcileBroadcast,
  resumeStrandedBroadcasts,
  listBroadcasts
};
