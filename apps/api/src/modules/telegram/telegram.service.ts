// Telegram bot — two-way integration via long-polling (getUpdates).
//
// The existing notifications module only PUSHES to Telegram (outbound). This adds
// INBOUND: the bot polls Telegram for commands/button taps and drives the same
// workspace-scoped services the dashboard/public API use (list devices, send a
// WhatsApp message, read messages). Long-polling needs no public HTTPS webhook,
// so it works on the current HTTP deployment.
//
// One bot token per workspace lives (encrypted) in NotificationChannel(type=
// 'telegram'). We poll each configured bot, map the incoming chatId back to its
// workspace (only the chatId the operator registered may command the bot), and
// reply with inline-keyboard menus for a clean, tap-driven UX.

import { prisma } from '../../db/prisma';
import { decryptString } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { batchService } from '../accounts/batch.service';
import { whatsappService, type ConversationFilter } from '../whatsapp/whatsapp.service';
import { DeviceService } from '../devices/device.service';

const deviceService = new DeviceService();

// How many conversations per page in the /sohbetler list (inline buttons).
const CONV_PAGE_SIZE = 8;

// ── Telegram Bot API helpers ────────────────────────────────────────────────

const TG_API = 'https://api.telegram.org';

type TgUser = { id: number; first_name?: string; username?: string };
type TgChat = { id: number; type: string };
type TgMessage = { message_id: number; from?: TgUser; chat: TgChat; text?: string };
type TgCallbackQuery = { id: string; from: TgUser; message?: TgMessage; data?: string };
type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
};

type InlineButton = { text: string; callback_data: string };

async function tgCall(token: string, method: string, params: Record<string, unknown>, timeoutMs = 12000): Promise<any> {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown };
  if (!json.ok) throw new Error(json.description || `telegram ${method} failed`);
  return json.result;
}

async function sendMessage(
  token: string,
  chatId: string | number,
  text: string,
  buttons?: InlineButton[][]
): Promise<void> {
  const params: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  };
  if (buttons?.length) params.reply_markup = { inline_keyboard: buttons };
  await tgCall(token, 'sendMessage', params).catch((e) => logger.warn('tg sendMessage failed', { error: String(e) }));
}

async function answerCallback(token: string, callbackId: string, text?: string): Promise<void> {
  await tgCall(token, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    ...(text ? { text } : {})
  }).catch(() => undefined);
}

// Send a photo from a data-URI (e.g. a captured WhatsApp avatar) with a caption.
// Telegram's sendPhoto needs multipart for raw bytes, so we decode the data-URI
// and post it as a file part. Best-effort — falls back to a text note on failure.
async function sendPhotoDataUri(
  token: string,
  chatId: string | number,
  dataUri: string,
  caption: string
): Promise<boolean> {
  try {
    const m = /^data:(image\/\w+);base64,(.+)$/s.exec(dataUri);
    if (!m) return false;
    const bytes = Buffer.from(m[2]!, 'base64');
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    form.append('photo', new Blob([bytes], { type: m[1] }), 'avatar.png');
    const res = await fetch(`${TG_API}/bot${token}/sendPhoto`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(15000)
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
    return Boolean(json.ok);
  } catch (e) {
    logger.warn('tg sendPhoto failed', { error: String(e) });
    return false;
  }
}

// ── Command palette (Telegram's "/" menu via setMyCommands) ──────────────────

// The commands shown in Telegram's slash-menu / command palette. Registered once
// per bot token (setMyCommands is idempotent but we skip re-sending to save calls).
const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'menu', description: '🏠 Ana menü' },
  { command: 'sohbetler', description: '💬 Sohbet listesi (kategori + sayfalama)' },
  { command: 'ara', description: '🔎 Sohbet ara (numara/isim)' },
  { command: 'gonder', description: '✉️ Yeni mesaj gönder' },
  { command: 'okunmamis', description: '🔵 Okunmamış sohbetler' },
  { command: 'favoriler', description: '⭐ Favori sohbetler' },
  { command: 'etiketler', description: '🏷 Etiketleri (kategorileri) yönet' },
  { command: 'istatistik', description: '📈 Mesaj istatistikleri (24 saat)' },
  { command: 'cihazlar', description: '📱 Cihazları listele' },
  { command: 'durum', description: '📊 Özet durum (cihaz + okunmamış)' },
  { command: 'engellenenler', description: '🚫 Engellenen kişiler' },
  { command: 'numaram', description: '📞 Kendi WhatsApp numaram' },
  { command: 'yardim', description: 'ℹ️ Yardım' }
];

// Tokens whose command palette we've already pushed this process life.
const commandsRegistered = new Set<string>();

async function ensureCommands(token: string): Promise<void> {
  if (commandsRegistered.has(token)) return;
  commandsRegistered.add(token); // optimistic — avoid a retry storm on failure
  try {
    await tgCall(token, 'setMyCommands', {
      commands: BOT_COMMANDS,
      scope: { type: 'default' }
    });
    // Also set the persistent "Menu" button (bottom-left) to open the command list.
    await tgCall(token, 'setChatMenuButton', { menu_button: { type: 'commands' } }).catch(() => undefined);
  } catch (e) {
    commandsRegistered.delete(token); // let a later poll retry
    logger.warn('tg setMyCommands failed', { error: String(e) });
  }
}

// ── Per-bot polling state (in-memory; single instance) ──────────────────────

// Per bot-token: the last update_id offset we've consumed, and a per-chat
// "compose" state so a "Mesaj gönder" button flow can collect deviceId → number
// → text across messages.
type ChatState = {
  mode: 'idle' | 'awaiting_number' | 'awaiting_text' | 'awaiting_reply' | 'awaiting_search' | 'awaiting_media';
  deviceId?: string | undefined;
  to?: string | undefined;
  // Conversation-browser state (the /sohbetler flow).
  browseDeviceId?: string | undefined;
  browseFilter?: ConversationFilter | undefined;
  browseLabelId?: string | undefined;
  browseSearch?: string | undefined; // active /ara search term (or undefined)
  // callback_data can't hold a long peer, so we index the current page's peers
  // and reference them by position. Also remembers the cursor stack for paging.
  pagePeers?: string[] | undefined;
  cursorStack?: string[] | undefined; // cursors of pages already seen (for "back")
  nextCursor?: string | null | undefined;
};
type BotState = {
  offset: number;
  chats: Map<string, ChatState>;
};
const botStates = new Map<string, BotState>();

function getChatState(bot: BotState, chatId: string): ChatState {
  let s = bot.chats.get(chatId);
  if (!s) { s = { mode: 'idle' }; bot.chats.set(chatId, s); }
  return s;
}

// ── HTML escaping for Telegram parse_mode=HTML ──────────────────────────────

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Command / callback handling ─────────────────────────────────────────────

const MAIN_MENU: InlineButton[][] = [
  [{ text: '💬 Sohbetler', callback_data: 'chats' }, { text: '🔎 Ara', callback_data: 'search' }],
  [{ text: '🔵 Okunmamış', callback_data: 'q:unread' }, { text: '⭐ Favoriler', callback_data: 'q:favorite' }],
  [{ text: '✉️ Mesaj Gönder', callback_data: 'send' }, { text: '📈 İstatistik', callback_data: 'stats' }],
  [{ text: '🏷 Etiketler', callback_data: 'labels' }, { text: '📊 Durum', callback_data: 'status' }],
  [{ text: '📱 Cihazlar', callback_data: 'devices' }, { text: 'ℹ️ Yardım', callback_data: 'help' }]
];

function menuText(): string {
  return [
    '<b>🤖 Fleet WhatsApp Bot</b>',
    '',
    'Menüden seçin, komut yazın ya da <b>/</b> tuşuyla komut paletini açın:',
    '• /sohbetler — sohbet listesi (kategori + sayfalama)',
    '• /ara — sohbet ara (numara/isim)',
    '• /okunmamis — okunmamış sohbetler',
    '• /favoriler — favori sohbetler',
    '• /etiketler — etiketleri (kategorileri) yönet',
    '• /gonder — yeni mesaj gönder',
    '• /istatistik — mesaj istatistikleri',
    '• /durum — özet durum',
    '• /cihazlar — cihazları listele'
  ].join('\n');
}

// Smart-filter chips shown above the conversation list (mirrors the dashboard).
const CONV_FILTERS: Array<{ key: ConversationFilter; label: string }> = [
  { key: 'all', label: 'Tümü' },
  { key: 'unread', label: 'Okunmamış' },
  { key: 'favorite', label: 'Favori' },
  { key: 'archived', label: 'Arşiv' }
];

// Render the conversation list for the browser state as text + inline buttons.
// Peers are referenced by page index (c:<i>) because callback_data is ≤64 bytes.
async function renderChatList(
  workspaceId: string,
  state: ChatState
): Promise<{ text: string; buttons: InlineButton[][] }> {
  const deviceId = state.browseDeviceId!;
  const filter = state.browseFilter ?? 'all';
  const cursor = state.nextCursor ?? undefined;
  const { conversations, nextCursor } = await whatsappService.listConversations(workspaceId, {
    deviceId,
    filter,
    ...(state.browseLabelId ? { labelId: state.browseLabelId } : {}),
    ...(state.browseSearch ? { search: state.browseSearch } : {}),
    limit: CONV_PAGE_SIZE,
    ...(cursor ? { cursor } : {})
  });

  // Remember this page's peers (for c:<i> callbacks) + the next cursor.
  state.pagePeers = conversations.map((c) => c.peer);
  state.nextCursor = nextCursor;

  const labels = await whatsappService.listLabels(workspaceId);
  const activeLabel = labels.find((l) => l.id === state.browseLabelId);

  const header = [
    state.browseSearch ? `<b>🔎 Arama: ${esc(state.browseSearch)}</b>` : '<b>💬 Sohbetler</b>',
    `Filtre: <b>${CONV_FILTERS.find((f) => f.key === filter)?.label ?? 'Tümü'}</b>` +
      (activeLabel ? ` · Etiket: <b>${esc(activeLabel.name)}</b>` : '')
  ];
  const lines = conversations.length
    ? conversations.map((c, i) => {
        const badge = c.unreadCount > 0 ? ` <b>(${c.unreadCount})</b>` : '';
        const star = c.favorite ? '⭐ ' : '';
        const arrow = c.lastDirection === 'OUT' ? '➡️ ' : '';
        const preview = c.lastMessageBody ? esc(c.lastMessageBody.slice(0, 40)) : '—';
        return `${i + 1}. ${star}<b>${esc(c.peer)}</b>${badge}\n   ${arrow}${preview}`;
      })
    : ['Bu filtreye uyan sohbet yok.'];

  // Buttons: one row per conversation (numbered), then filter chips, then paging.
  const buttons: InlineButton[][] = [];
  conversations.forEach((c, i) => {
    const label = `${c.unreadCount > 0 ? '🔵 ' : ''}${c.favorite ? '⭐ ' : ''}${c.peer}`.slice(0, 60);
    buttons.push([{ text: label, callback_data: `c:${i}` }]);
  });
  // Filter chips (2 rows of 2).
  buttons.push(
    CONV_FILTERS.slice(0, 2).map((f) => ({
      text: `${filter === f.key ? '● ' : ''}${f.label}`,
      callback_data: `cf:${f.key}`
    })),
    CONV_FILTERS.slice(2).map((f) => ({
      text: `${filter === f.key ? '● ' : ''}${f.label}`,
      callback_data: `cf:${f.key}`
    }))
  );
  // Label filter chips (max 4, by index into the labels list).
  if (labels.length) {
    const row: InlineButton[] = labels.slice(0, 4).map((l, i) => ({
      text: `${state.browseLabelId === l.id ? '● ' : '🏷 '}${l.name}`.slice(0, 24),
      callback_data: `cl:${i}`
    }));
    if (state.browseLabelId) row.push({ text: '✖️ Etiket', callback_data: 'cl:x' });
    buttons.push(row);
  }
  // Paging.
  const nav: InlineButton[] = [];
  if (state.cursorStack && state.cursorStack.length) nav.push({ text: '⬅️ Önceki', callback_data: 'cprev' });
  if (nextCursor) nav.push({ text: 'Sonraki ➡️', callback_data: 'cnext' });
  if (nav.length) buttons.push(nav);
  buttons.push([{ text: '🔄 Yenile', callback_data: 'chats' }, { text: '🏠 Menü', callback_data: 'menu' }]);

  return { text: [...header, '', ...lines].join('\n'), buttons };
}

// Delivery-status glyph for an outbound message (✓ sent, ✓✓ delivered/read, ⚠ fail).
function statusGlyph(status: string): string {
  switch (status) {
    case 'FAILED': return ' ⚠️';
    case 'DELIVERED': return ' ✓✓';
    case 'READ': return ' ✓✓';
    case 'SENT': return ' ✓';
    default: return '';
  }
}

// Render one thread's recent messages + reply/actions buttons. Marks read as a
// side effect. Shows the contact's friendly name (if set) and per-message status.
async function renderThread(
  workspaceId: string,
  deviceId: string,
  peer: string
): Promise<{ text: string; buttons: InlineButton[][] }> {
  const { messages } = await whatsappService.getThreadMessages(workspaceId, { deviceId, peer, limit: 12 });
  const info = await whatsappService.getContactInfo(workspaceId, { deviceId, peer }).catch(() => null);
  await whatsappService.markRead(workspaceId, { deviceId, peer }).catch(() => undefined);
  const lines = messages.length
    ? messages.map((m) => {
        const arrow = m.direction === 'OUT' ? '➡️' : '⬅️';
        const glyph = m.direction === 'OUT' ? statusGlyph(m.status) : '';
        const failNote = m.direction === 'OUT' && m.status === 'FAILED' && m.failReason ? ` <i>(${esc(String(m.failReason))})</i>` : '';
        return `${arrow} ${esc(String(m.body).slice(0, 180))}${glyph}${failNote}`;
      })
    : ['(Bu sohbette henüz mesaj yok.)'];

  const nameStr = info?.displayName ? `${esc(info.displayName)} · <code>${esc(peer)}</code>` : esc(peer);
  const blockedTag = info?.blocked ? ' 🚫' : '';
  const title = `${nameStr}${blockedTag}`;
  const favLabel = info?.favorite ? '⭐ Favoriden çıkar' : '⭐ Favori';
  const archLabel = info?.archived ? '📤 Arşivden çıkar' : '📥 Arşivle';
  const pinLabel = info?.pinned ? '📌 Sabiti kaldır' : '📌 Sabitle';
  const blockLabel = info?.blocked ? '✅ Engeli kaldır' : '🚫 Engelle';
  const buttons: InlineButton[][] = [
    [{ text: '💬 Cevapla', callback_data: 'reply' }, { text: '⚡ Hazır Cevap', callback_data: 'canned' }],
    [{ text: favLabel, callback_data: 'favtoggle' }, { text: pinLabel, callback_data: 'pintoggle' }],
    [{ text: '🏷 Etiketle', callback_data: 'labelmenu' }, { text: archLabel, callback_data: 'archtoggle' }],
    // WhatsApp on-device actions (dispatch a job; result reconciles the thread).
    [{ text: '📷 Profil', callback_data: 'profilefetch' }, { text: blockLabel, callback_data: 'blocktoggle' }],
    [{ text: '🖼 Medya gönder', callback_data: 'sendmedia' }, { text: '🗑 Son mesajı sil', callback_data: 'delmsg' }],
    [{ text: '🧹 Sohbeti temizle', callback_data: 'clearchat' }, { text: '🚫 Engellenenler', callback_data: 'blocklist' }],
    [{ text: '⬅️ Sohbetler', callback_data: 'chats' }, { text: '🏠 Menü', callback_data: 'menu' }]
  ];
  return { text: [`<b>👤 ${title}</b>`, '', ...lines].join('\n'), buttons };
}

async function listDevicesText(workspaceId: string): Promise<{ text: string; buttons: InlineButton[][] }> {
  const devices = await deviceService.listDevices(workspaceId);
  if (!devices.length) return { text: 'Bu çalışma alanında cihaz yok.', buttons: MAIN_MENU };
  const lines = devices.map((d) => {
    const dot = d.status === 'ONLINE' ? '🟢' : '⚪️';
    return `${dot} <b>${esc(d.name)}</b> — ${esc(d.status)}`;
  });
  return { text: ['<b>📱 Cihazlar</b>', '', ...lines].join('\n'), buttons: MAIN_MENU };
}

// Build device-picker buttons (for the send / chat-browse flows).
// `whatsappOnly`: keep only devices that have an ACTIVE WhatsApp account. Sending a
// message from a device with no WhatsApp is guaranteed to fail (there's no account
// to send from), so the send picker filters these out — the operator asked for
// this ("her cihazda wp yok"). The phone number is shown next to the name so the
// operator knows WHICH WhatsApp identity they're sending from.
async function devicePickerButtons(
  workspaceId: string,
  action: 'sendpick' | 'readpick' | 'chatpick',
  filter?: ConversationFilter,
  whatsappOnly = false
): Promise<InlineButton[][]> {
  const devices = await deviceService.listDevices(workspaceId);
  // `hasActiveWhatsapp` / `activeWhatsappPhone` are attached by listDevices (device
  // has an ACTIVE/AWAITING_MANUAL WhatsApp account). Read them defensively.
  const waDevices = whatsappOnly
    ? devices.filter((d) => (d as Record<string, unknown>).hasActiveWhatsapp === true)
    : devices;
  const online = waDevices.filter((d) => d.status === 'ONLINE');
  const pick = (online.length ? online : waDevices).slice(0, 8);
  // A non-'all' filter is carried on the callback so the list opens pre-filtered
  // (e.g. /okunmamis → chatpick:<id>:unread). callback_data stays under 64 bytes.
  const suffix = filter && filter !== 'all' ? `:${filter}` : '';
  const rows: InlineButton[][] = pick.map((d) => {
    const phone = (d as Record<string, unknown>).activeWhatsappPhone as string | null | undefined;
    const label = `${d.status === 'ONLINE' ? '🟢' : '⚪️'} ${d.name}${phone ? ` · ${phone}` : ''}`.slice(0, 60);
    return [{ text: label, callback_data: `${action}:${d.id}${suffix}` }];
  });
  rows.push([{ text: '⬅️ Menü', callback_data: 'menu' }]);
  return rows;
}

// True when the workspace has at least one device with an active WhatsApp account —
// used to show a helpful "no WhatsApp device" message instead of an empty picker.
async function hasAnyWhatsappDevice(workspaceId: string): Promise<boolean> {
  const devices = await deviceService.listDevices(workspaceId);
  return devices.some((d) => (d as Record<string, unknown>).hasActiveWhatsapp === true);
}

async function readMessagesText(workspaceId: string, deviceId: string): Promise<string> {
  const { messages } = await batchService.listMessages(workspaceId, { deviceId, limit: 10 });
  if (!messages.length) return 'Bu cihazda kayıtlı mesaj yok.';
  const lines = messages
    .slice()
    .reverse()
    .map((m) => {
      const arrow = m.direction === 'OUT' ? '➡️' : '⬅️';
      return `${arrow} <b>${esc(m.peer)}</b>: ${esc(String(m.body).slice(0, 120))}`;
    });
  return ['<b>📨 Son mesajlar</b>', '', ...lines].join('\n');
}

// List the workspace's conversation labels (categories) as a read-only overview.
// Creating/deleting labels stays in the dashboard; the bot uses them to filter.
async function renderLabels(workspaceId: string): Promise<{ text: string; buttons: InlineButton[][] }> {
  const labels = await whatsappService.listLabels(workspaceId);
  const lines = labels.length
    ? labels.map((l) => `🏷 <b>${esc(l.name)}</b>`)
    : ['Henüz etiket yok. Panelden (WhatsApp → Etiketler) oluşturabilirsiniz.'];
  return {
    text: ['<b>🏷 Etiketler (Kategoriler)</b>', '', ...lines, '', 'Bir cihazın sohbetlerini etikete göre filtrelemek için /sohbetler → etiket çipini kullanın.'].join('\n'),
    buttons: [[{ text: '💬 Sohbetler', callback_data: 'chats' }, { text: '🏠 Menü', callback_data: 'menu' }]]
  };
}

// One-glance status: device online counts + total unread across all devices.
async function renderStatus(workspaceId: string): Promise<string> {
  const devices = await deviceService.listDevices(workspaceId);
  const online = devices.filter((d) => d.status === 'ONLINE').length;
  // Sum unread across ALL of this workspace's devices in ONE grouped query instead
  // of a per-device aggregate (N+1 → 1). Scoped to the workspace's device ids.
  const grouped = await prisma.whatsappConversation.groupBy({
    by: ['deviceId'],
    where: { deviceId: { in: devices.map((d) => d.id) }, archived: false, unreadCount: { gt: 0 } },
    _sum: { unreadCount: true }
  }).catch(() => [] as Array<{ _sum: { unreadCount: number | null } }>);
  const unread = grouped.reduce((sum, g) => sum + (g._sum.unreadCount ?? 0), 0);
  return [
    '<b>📊 Durum</b>',
    '',
    `📱 Cihaz: <b>${devices.length}</b> (🟢 ${online} çevrimiçi)`,
    `🔵 Okunmamış sohbet mesajı: <b>${unread}</b>`
  ].join('\n');
}

// Messaging stats over the last 24h: inbound/outbound/failed counts, open
// (unread) threads, and average first-response time.
async function renderStats(workspaceId: string): Promise<string> {
  const s = await whatsappService.getStats(workspaceId, { sinceHours: 24 });
  const resp = s.avgResponseMinutes === null ? '—' : `${s.avgResponseMinutes} dk`;
  return [
    '<b>📈 İstatistik (son 24 saat)</b>',
    '',
    `⬅️ Gelen: <b>${s.inbound}</b>`,
    `➡️ Giden: <b>${s.outbound}</b>`,
    `⚠️ Başarısız: <b>${s.failed}</b>`,
    `🔵 Açık (okunmamış) sohbet: <b>${s.openThreads}</b>`,
    `⏱ Ortalama ilk yanıt süresi: <b>${resp}</b>`
  ].join('\n');
}

// Handle one text command from a registered chat.
async function handleCommand(
  token: string,
  workspaceId: string,
  chatId: string,
  bot: BotState,
  text: string
): Promise<void> {
  const state = getChatState(bot, chatId);
  const cmd = text.trim();
  const lower = cmd.toLowerCase();

  // If we're mid-compose (send flow), interpret the text as number then message.
  if (state.mode === 'awaiting_number') {
    const to = cmd.replace(/[^\d]/g, '');
    if (to.length < 5) { await sendMessage(token, chatId, '❌ Geçerli bir numara girin (ülke kodu ile, örn. 905551112233).'); return; }
    state.to = to; state.mode = 'awaiting_text';
    await sendMessage(token, chatId, `📞 Alıcı: <b>${esc(to)}</b>\nŞimdi göndermek istediğiniz <b>mesajı</b> yazın:`);
    return;
  }
  if (state.mode === 'awaiting_text') {
    const message = cmd;
    const deviceId = state.deviceId!;
    const to = state.to!;
    state.mode = 'idle'; state.deviceId = undefined; state.to = undefined;
    try {
      const { job } = await batchService.sendFromDevice(workspaceId, { deviceId, to, message });
      await sendMessage(token, chatId, `✅ Mesaj sıraya alındı, cihaz gönderiyor.\n📞 ${esc(to)}\n🆔 <code>${esc(job.id)}</code>`, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Gönderilemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
    return;
  }
  // Search flow: the awaited text is a search term applied to the chat list.
  if (state.mode === 'awaiting_search') {
    state.mode = 'idle';
    const term = cmd.trim();
    if (!term) { await sendMessage(token, chatId, '❌ Boş arama.', MAIN_MENU); return; }
    if (!state.browseDeviceId) {
      // No device chosen yet — pick one, then apply the search on selection.
      state.browseSearch = term;
      const buttons = await devicePickerButtons(workspaceId, 'chatpick');
      await sendMessage(token, chatId, `🔎 <b>"${esc(term)}"</b> aranıyor.\nHangi cihazda?`, buttons);
      return;
    }
    state.browseSearch = term;
    state.browseFilter = 'all';
    state.cursorStack = []; state.nextCursor = undefined;
    try {
      const { text: t, buttons } = await renderChatList(workspaceId, state);
      await sendMessage(token, chatId, t, buttons);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Arama başarısız: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
    return;
  }
  // Reply flow from inside a thread: the awaited text goes straight to the peer.
  if (state.mode === 'awaiting_reply') {
    const message = cmd;
    const deviceId = state.browseDeviceId!;
    const to = state.to!;
    state.mode = 'idle';
    try {
      // sendFromDevice only QUEUES a WHATSAPP_SEND job (PENDING); the message hasn't
      // left the phone yet. Report "sending…" like the media flow does — the real
      // SENT/FAILED outcome arrives via the WHATSAPP_SENT/FAILED completion notify.
      // Saying "✅ Yanıt gönderildi" here was a false success (offline/busy device).
      await batchService.sendFromDevice(workspaceId, { deviceId, to, message });
      const { text: t, buttons } = await renderThread(workspaceId, deviceId, to);
      await sendMessage(token, chatId, `📤 <b>${esc(to)}</b> kişisine yanıt gönderiliyor…\n<i>(Sonuç işlem bitince bildirilecek.)</i>\n\n${t}`, buttons);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Gönderilemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
    return;
  }

  // Media flow: the awaited text is "<mediaUrl> [caption]". Dispatch a media job;
  // the completion notification will report success/failure.
  if (state.mode === 'awaiting_media') {
    const deviceId = state.deviceId || state.browseDeviceId!;
    const to = state.to!;
    state.mode = 'idle';
    const firstSpace = cmd.indexOf(' ');
    const mediaUrl = (firstSpace === -1 ? cmd : cmd.slice(0, firstSpace)).trim();
    const caption = firstSpace === -1 ? '' : cmd.slice(firstSpace + 1).trim();
    if (!/^https?:\/\//i.test(mediaUrl)) {
      await sendMessage(token, chatId, '⚠️ Geçerli bir http(s) URL gönderin.', [[{ text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]]);
      return;
    }
    try {
      await batchService.sendMedia(workspaceId, { deviceId, to, mediaUrl, ...(caption ? { caption } : {}) });
      await sendMessage(token, chatId, `🖼 <b>${esc(to)}</b> kişisine medya gönderiliyor…\n<i>(Sonuç işlem bitince bildirilecek.)</i>`, [[{ text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]]);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Medya gönderilemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
    return;
  }

  // Plain commands.
  if (lower === '/start' || lower === '/menu' || lower === 'menu') {
    await sendMessage(token, chatId, menuText(), MAIN_MENU);
  } else if (lower === '/cihazlar' || lower === 'cihazlar') {
    const { text: t, buttons } = await listDevicesText(workspaceId);
    await sendMessage(token, chatId, t, buttons);
  } else if (lower === '/gonder' || lower === 'gonder' || lower === '/send') {
    if (!(await hasAnyWhatsappDevice(workspaceId))) {
      await sendMessage(token, chatId, '⚠️ Bu çalışma alanında <b>WhatsApp hesabı olan</b> cihaz yok.\nÖnce panelden bir cihaza WhatsApp kaydı yapın; mesaj yalnızca WhatsApp\'lı cihazdan gönderilebilir.', MAIN_MENU);
    } else {
      const buttons = await devicePickerButtons(workspaceId, 'sendpick', undefined, true);
      await sendMessage(token, chatId, '✉️ <b>Mesaj Gönder</b>\nHangi <b>WhatsApp\'lı</b> cihazdan göndermek istiyorsunuz?', buttons);
    }
  } else if (lower === '/sohbetler' || lower === 'sohbetler' || lower === '/mesajlar' || lower === 'mesajlar' || lower === '/chats') {
    const buttons = await devicePickerButtons(workspaceId, 'chatpick');
    await sendMessage(token, chatId, '💬 <b>Sohbetler</b>\nHangi cihazın sohbetlerini görmek istiyorsunuz?', buttons);
  } else if (lower === '/okunmamis' || lower === 'okunmamis' || lower === '/okunmamış') {
    const buttons = await devicePickerButtons(workspaceId, 'chatpick', 'unread');
    await sendMessage(token, chatId, '🔵 <b>Okunmamış Sohbetler</b>\nHangi cihaz?', buttons);
  } else if (lower === '/favoriler' || lower === 'favoriler') {
    const buttons = await devicePickerButtons(workspaceId, 'chatpick', 'favorite');
    await sendMessage(token, chatId, '⭐ <b>Favori Sohbetler</b>\nHangi cihaz?', buttons);
  } else if (lower === '/etiketler' || lower === 'etiketler') {
    const { text: t, buttons } = await renderLabels(workspaceId);
    await sendMessage(token, chatId, t, buttons);
  } else if (lower === '/istatistik' || lower === 'istatistik' || lower === '/stats') {
    await sendMessage(token, chatId, await renderStats(workspaceId), MAIN_MENU);
  } else if (lower === '/durum' || lower === 'durum' || lower === '/status') {
    await sendMessage(token, chatId, await renderStatus(workspaceId), MAIN_MENU);
  } else if (lower === '/engellenenler' || lower === 'engellenenler' || lower === '/blocked') {
    // Show blocked contacts. If a device is already in context, trigger a fresh
    // on-device scrape + show what we know; otherwise ask to open a chat first.
    if (!state.browseDeviceId) {
      await sendMessage(token, chatId, '🚫 Engellenenleri görmek için önce bir sohbet açın (/sohbetler), sonra sohbetteki "🚫 Engelle" satırından yönetin. Cihaz listesini çekmek için bir sohbet açın.', MAIN_MENU);
    } else {
      const deviceId = state.browseDeviceId;
      await batchService.listBlocked(workspaceId, { deviceId }).catch(() => undefined);
      const { conversations } = await whatsappService.listConversations(workspaceId, { deviceId, limit: 100 });
      const blocked = conversations.filter((c) => c.blocked);
      const lines = blocked.length
        ? blocked.map((c) => `🚫 <code>${esc(c.peer)}</code>${c.displayName ? ' · ' + esc(c.displayName) : ''}`)
        : ['(Panelde engelli işaretli sohbet yok.)'];
      await sendMessage(token, chatId, ['<b>🚫 Engellenenler</b>', '<i>(cihazdan güncelleniyor…)</i>', '', ...lines].join('\n'), MAIN_MENU);
    }
  } else if (lower === '/numaram' || lower === 'numaram' || lower === '/mynumber') {
    // Read the account's own WhatsApp number off the current device.
    if (!state.browseDeviceId) {
      await sendMessage(token, chatId, '📞 Kendi numaranı görmek için önce bir sohbet açın (/sohbetler) — hangi cihazın numarası olduğunu bilmemiz gerekir.', MAIN_MENU);
    } else {
      try {
        await batchService.myNumber(workspaceId, { deviceId: state.browseDeviceId });
        await sendMessage(token, chatId, '📞 Numara cihazdan okunuyor… (bu işlem cihaz Ayarlar ekranını açar, sonuç işe düşer).', MAIN_MENU);
      } catch (e) {
        await sendMessage(token, chatId, `❌ Okunamadı: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
      }
    }
  } else if (lower === '/ara' || lower === 'ara' || lower.startsWith('/ara ') || lower.startsWith('ara ')) {
    // "/ara <terim>" searches immediately; bare "/ara" prompts for the term.
    const term = cmd.replace(/^\/?ara\s*/i, '').trim();
    if (term) {
      state.browseSearch = term;
      state.browseFilter = 'all';
      state.cursorStack = []; state.nextCursor = undefined;
      if (!state.browseDeviceId) {
        const buttons = await devicePickerButtons(workspaceId, 'chatpick');
        await sendMessage(token, chatId, `🔎 <b>"${esc(term)}"</b> aranıyor.\nHangi cihazda?`, buttons);
      } else {
        const { text: t, buttons } = await renderChatList(workspaceId, state);
        await sendMessage(token, chatId, t, buttons);
      }
    } else {
      state.mode = 'awaiting_search';
      await sendMessage(token, chatId, '🔎 Aramak istediğiniz <b>numarayı veya ismi</b> yazın:');
    }
  } else if (lower === '/help' || lower === 'yardim' || lower === '/yardim') {
    await sendMessage(token, chatId, menuText(), MAIN_MENU);
  } else {
    // Quick-send shorthand: "/gonder 905551112233 Merhaba"
    const m = /^\/?gonder\s+(\+?\d[\d\s]{4,})\s+([\s\S]+)$/i.exec(cmd);
    if (m) {
      const to = m[1]!.replace(/[^\d]/g, '');
      const message = m[2]!.trim();
      // Use the first ONLINE device.
      const devices = await deviceService.listDevices(workspaceId);
      const dev = devices.find((d) => d.status === 'ONLINE') ?? devices[0];
      if (!dev) { await sendMessage(token, chatId, '❌ Uygun cihaz yok.'); return; }
      try {
        const { job } = await batchService.sendFromDevice(workspaceId, { deviceId: dev.id, to, message });
        await sendMessage(token, chatId, `✅ Mesaj sıraya alındı (${esc(dev.name)}).\n📞 ${esc(to)}\n🆔 <code>${esc(job.id)}</code>`, MAIN_MENU);
      } catch (e) {
        await sendMessage(token, chatId, `❌ Gönderilemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
      }
    } else {
      await sendMessage(token, chatId, 'Anlamadım. Menü için /menu yazın.', MAIN_MENU);
    }
  }
}

// Handle an inline-button tap.
async function handleCallback(
  token: string,
  workspaceId: string,
  chatId: string,
  bot: BotState,
  cb: TgCallbackQuery
): Promise<void> {
  const data = cb.data ?? '';
  await answerCallback(token, cb.id);
  const state = getChatState(bot, chatId);

  if (data === 'menu' || data === 'help') {
    if (data === 'help') { await sendMessage(token, chatId, menuText(), MAIN_MENU); return; }
    await sendMessage(token, chatId, menuText(), MAIN_MENU);
  } else if (data === 'devices') {
    const { text: t, buttons } = await listDevicesText(workspaceId);
    await sendMessage(token, chatId, t, buttons);
  } else if (data === 'send') {
    if (!(await hasAnyWhatsappDevice(workspaceId))) {
      await sendMessage(token, chatId, '⚠️ Bu çalışma alanında <b>WhatsApp hesabı olan</b> cihaz yok.\nÖnce panelden bir cihaza WhatsApp kaydı yapın; mesaj yalnızca WhatsApp\'lı cihazdan gönderilebilir.', MAIN_MENU);
    } else {
      const buttons = await devicePickerButtons(workspaceId, 'sendpick', undefined, true);
      await sendMessage(token, chatId, '✉️ <b>Mesaj Gönder</b>\nHangi <b>WhatsApp\'lı</b> cihazdan göndermek istiyorsunuz?', buttons);
    }
  } else if (data === 'q:unread' || data === 'q:favorite') {
    // Quick-filter from the main menu → device picker carrying the filter.
    const f: ConversationFilter = data === 'q:unread' ? 'unread' : 'favorite';
    const buttons = await devicePickerButtons(workspaceId, 'chatpick', f);
    const title = f === 'unread' ? '🔵 <b>Okunmamış Sohbetler</b>' : '⭐ <b>Favori Sohbetler</b>';
    await sendMessage(token, chatId, `${title}\nHangi cihaz?`, buttons);
  } else if (data === 'labels') {
    const { text: t, buttons } = await renderLabels(workspaceId);
    await sendMessage(token, chatId, t, buttons);
  } else if (data === 'status') {
    await sendMessage(token, chatId, await renderStatus(workspaceId), MAIN_MENU);
  } else if (data === 'stats') {
    await sendMessage(token, chatId, await renderStats(workspaceId), MAIN_MENU);
  } else if (data === 'search') {
    state.mode = 'awaiting_search';
    await sendMessage(token, chatId, '🔎 Aramak istediğiniz <b>numarayı veya ismi</b> yazın:');
  } else if (data === 'read') {
    const buttons = await devicePickerButtons(workspaceId, 'readpick');
    await sendMessage(token, chatId, '📨 <b>Mesajları Oku</b>\nHangi cihazın mesajlarını görmek istiyorsunuz?', buttons);
  } else if (data.startsWith('sendpick:')) {
    const deviceId = data.slice('sendpick:'.length);
    state.mode = 'awaiting_number'; state.deviceId = deviceId; state.to = undefined;
    await sendMessage(token, chatId, '📞 Alıcı <b>numarasını</b> yazın (ülke kodu ile, örn. 905551112233):');
  } else if (data.startsWith('readpick:')) {
    const deviceId = data.slice('readpick:'.length);
    try {
      const t = await readMessagesText(workspaceId, deviceId);
      await sendMessage(token, chatId, t, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Okunamadı: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (data === 'chats') {
    // Re-render the current chat list (or prompt for a device if none picked yet).
    if (!state.browseDeviceId) {
      const buttons = await devicePickerButtons(workspaceId, 'chatpick');
      await sendMessage(token, chatId, '💬 <b>Sohbetler</b>\nHangi cihazın sohbetlerini görmek istiyorsunuz?', buttons);
    } else {
      try {
        const { text: t, buttons } = await renderChatList(workspaceId, state);
        await sendMessage(token, chatId, t, buttons);
      } catch (e) {
        await sendMessage(token, chatId, `❌ Liste alınamadı: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
      }
    }
  } else if (data.startsWith('chatpick:')) {
    // Device chosen — start browsing its conversations from page 1. The picker may
    // carry a filter suffix (chatpick:<id>:<filter>) from /okunmamis, /favoriler, etc.
    const rest = data.slice('chatpick:'.length);
    const [deviceId, filterPart] = rest.split(':');
    const valid: ConversationFilter[] = ['all', 'unread', 'favorite', 'archived'];
    state.browseDeviceId = deviceId;
    state.browseFilter = valid.includes(filterPart as ConversationFilter) ? (filterPart as ConversationFilter) : 'all';
    state.browseLabelId = undefined;
    state.cursorStack = [];
    state.nextCursor = undefined;
    const { text: t, buttons } = await renderChatList(workspaceId, state);
    await sendMessage(token, chatId, t, buttons);
  } else if (data.startsWith('cf:')) {
    // Switch smart filter — reset paging.
    state.browseFilter = data.slice('cf:'.length) as ConversationFilter;
    state.cursorStack = []; state.nextCursor = undefined;
    const { text: t, buttons } = await renderChatList(workspaceId, state);
    await sendMessage(token, chatId, t, buttons);
  } else if (data.startsWith('cl:')) {
    // Label filter by index into the workspace label list, or clear ('cl:x').
    const rest = data.slice('cl:'.length);
    if (rest === 'x') {
      state.browseLabelId = undefined;
    } else {
      const labels = await whatsappService.listLabels(workspaceId);
      const idx = Number(rest);
      state.browseLabelId = Number.isInteger(idx) ? labels[idx]?.id : undefined;
    }
    state.cursorStack = []; state.nextCursor = undefined;
    const { text: t, buttons } = await renderChatList(workspaceId, state);
    await sendMessage(token, chatId, t, buttons);
  } else if (data === 'cnext') {
    // Advance a page: push the current start cursor so 'back' can return here.
    if (state.nextCursor) {
      (state.cursorStack = state.cursorStack ?? []).push(state.nextCursor);
    }
    const { text: t, buttons } = await renderChatList(workspaceId, state);
    await sendMessage(token, chatId, t, buttons);
  } else if (data === 'cprev') {
    // Go back a page: pop the last two cursors (current + previous start).
    const stack = state.cursorStack ?? [];
    stack.pop();
    state.nextCursor = stack.length ? stack[stack.length - 1] : undefined;
    state.cursorStack = stack;
    const { text: t, buttons } = await renderChatList(workspaceId, state);
    await sendMessage(token, chatId, t, buttons);
  } else if (data.startsWith('c:')) {
    // Open a conversation by its index on the current page.
    const idx = Number(data.slice('c:'.length));
    const peer = state.pagePeers?.[idx];
    if (!peer || !state.browseDeviceId) {
      await sendMessage(token, chatId, '⚠️ Sohbet süresi doldu, listeyi yenileyin.', MAIN_MENU);
      return;
    }
    state.to = peer; // remember which peer the actions/reply target
    try {
      const { text: t, buttons } = await renderThread(workspaceId, state.browseDeviceId, peer);
      await sendMessage(token, chatId, t, buttons);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Açılamadı: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (data === 'reply') {
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    state.mode = 'awaiting_reply';
    await sendMessage(token, chatId, `💬 <b>${esc(state.to)}</b> kişisine yanıtınızı yazın:`);
  } else if (data === 'favtoggle' || data === 'archtoggle' || data === 'pintoggle') {
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    try {
      // Read current state to flip it (getContactInfo avoids a list scan).
      const cur = await whatsappService.getContactInfo(workspaceId, { deviceId: state.browseDeviceId, peer: state.to });
      if (data === 'favtoggle') {
        await whatsappService.setConversationState(workspaceId, { deviceId: state.browseDeviceId, peer: state.to, favorite: !cur?.favorite });
        await answerCallback(token, cb.id, cur?.favorite ? 'Favoriden çıkarıldı' : 'Favoriye eklendi');
      } else if (data === 'archtoggle') {
        await whatsappService.setConversationState(workspaceId, { deviceId: state.browseDeviceId, peer: state.to, archived: !cur?.archived });
        await answerCallback(token, cb.id, cur?.archived ? 'Arşivden çıkarıldı' : 'Arşivlendi');
      } else {
        await whatsappService.setConversationState(workspaceId, { deviceId: state.browseDeviceId, peer: state.to, pinned: !cur?.pinned });
        await answerCallback(token, cb.id, cur?.pinned ? 'Sabit kaldırıldı' : 'Sabitlendi');
      }
      const { text: t, buttons } = await renderThread(workspaceId, state.browseDeviceId, state.to);
      await sendMessage(token, chatId, t, buttons);
    } catch (e) {
      await sendMessage(token, chatId, `❌ İşlem başarısız: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (data === 'profilefetch') {
    // Fetch the contact's WhatsApp profile (avatar + name) on the device. This is
    // an on-device job (~15s), so we dispatch it, send any avatar we ALREADY have
    // now, and tell the operator it's refreshing.
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    try {
      await answerCallback(token, cb.id, 'Profil çekiliyor…');
      const deviceId = state.browseDeviceId, peer = state.to;
      await batchService.fetchProfile(workspaceId, { deviceId, to: peer });
      // Send the currently-stored avatar (if any) immediately.
      const av = await whatsappService.getAvatar(workspaceId, { deviceId, peer }).catch(() => null);
      if (av?.avatarBase64) {
        await sendPhotoDataUri(token, chatId, av.avatarBase64, `📷 <b>${esc(peer)}</b> profil fotoğrafı`);
      }
      await sendMessage(token, chatId, `📷 <b>${esc(peer)}</b> profili cihazdan çekiliyor (~15sn). Güncel foto birazdan panele düşer; tekrar denemek için butona basın.`, [[{ text: '🔄 Yenile', callback_data: 'profilefetch' }, { text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]]);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Profil çekilemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (data === 'blocktoggle') {
    // Block / unblock the open contact on the device (on-device job). Flip based
    // on the stored blocked flag; the agent reconciles it when the job completes.
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    try {
      const deviceId = state.browseDeviceId, peer = state.to;
      const cur = await whatsappService.getContactInfo(workspaceId, { deviceId, peer }).catch(() => null);
      const nextBlock = !cur?.blocked;
      await batchService.blockContact(workspaceId, { deviceId, to: peer, block: nextBlock });
      await answerCallback(token, cb.id, nextBlock ? 'Engelleniyor…' : 'Engel kaldırılıyor…');
      await sendMessage(token, chatId, nextBlock
        ? `🚫 <b>${esc(peer)}</b> cihazda engelleniyor…`
        : `✅ <b>${esc(peer)}</b> engeli cihazda kaldırılıyor…`,
        [[{ text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]]);
    } catch (e) {
      await sendMessage(token, chatId, `❌ İşlem başarısız: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (data === 'sendmedia') {
    // Ask for a media URL, then dispatch a WHATSAPP_SEND_MEDIA job. Optional caption
    // can follow the URL on the same line ("<url> açıklama").
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    state.mode = 'awaiting_media';
    state.deviceId = state.browseDeviceId;
    state.to = state.to;
    await answerCallback(token, cb.id, 'Medya URL bekleniyor');
    await sendMessage(token, chatId, `🖼 <b>${esc(state.to)}</b> kişisine gönderilecek medyanın URL'sini yollayın.\n\n<i>İsteğe bağlı açıklama için: <code>https://.../foto.jpg Açıklama metni</code></i>`, [[{ text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]]);
  } else if (data === 'delmsg') {
    // Delete the last outgoing message for everyone (on-device job).
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    try {
      await batchService.deleteMessage(workspaceId, { deviceId: state.browseDeviceId, to: state.to, scope: 'everyone' });
      await answerCallback(token, cb.id, 'Siliniyor…');
      await sendMessage(token, chatId, `🗑 <b>${esc(state.to)}</b> sohbetindeki son giden mesaj herkesten siliniyor…\n<i>(Sonuç işlem bitince bildirilecek.)</i>`, [[{ text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]]);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Silinemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (data === 'clearchat') {
    // Clear all local messages in the chat (on-device job).
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    try {
      await batchService.clearChat(workspaceId, { deviceId: state.browseDeviceId, to: state.to });
      await answerCallback(token, cb.id, 'Temizleniyor…');
      await sendMessage(token, chatId, `🧹 <b>${esc(state.to)}</b> sohbeti cihazda temizleniyor…`, [[{ text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]]);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Temizlenemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (data === 'blocklist') {
    // Read the device's blocked-contacts list (on-device job). We also show the
    // threads we already know are blocked, from the DB.
    if (!state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir cihaz/sohbet seçin.', MAIN_MENU); return; }
    try {
      const deviceId = state.browseDeviceId;
      await batchService.listBlocked(workspaceId, { deviceId });
      await answerCallback(token, cb.id, 'Liste çekiliyor…');
      // Show currently-known blocked threads from the DB immediately.
      const { conversations } = await whatsappService.listConversations(workspaceId, { deviceId, limit: 100 });
      const blocked = conversations.filter((c) => c.blocked);
      const lines = blocked.length
        ? blocked.map((c) => `🚫 <code>${esc(c.peer)}</code>${c.displayName ? ' · ' + esc(c.displayName) : ''}`)
        : ['(Panelde engelli işaretli sohbet yok.)'];
      await sendMessage(token, chatId, ['<b>🚫 Engellenenler</b>', '<i>(cihazdan güncelleniyor…)</i>', '', ...lines].join('\n'), MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Liste çekilemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (data === 'canned') {
    // Show the workspace's saved replies as tappable buttons (cr:<i>).
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    const replies = await whatsappService.listCannedReplies(workspaceId);
    if (!replies.length) {
      await sendMessage(token, chatId, '⚡ Henüz hazır cevap yok. Panelden (WhatsApp → Hazır Cevaplar) ekleyin.', [[{ text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]]);
      return;
    }
    const rows: InlineButton[][] = replies.slice(0, 10).map((r, i) => [
      { text: `⚡ ${r.title}`.slice(0, 60), callback_data: `cr:${i}` }
    ]);
    rows.push([{ text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]);
    await sendMessage(token, chatId, '⚡ <b>Hazır Cevap seçin:</b>', rows);
  } else if (data.startsWith('cr:')) {
    // Send the picked canned reply to the current peer.
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    const idx = Number(data.slice('cr:'.length));
    const replies = await whatsappService.listCannedReplies(workspaceId);
    const reply = Number.isInteger(idx) ? replies[idx] : undefined;
    if (!reply) { await sendMessage(token, chatId, '⚠️ Hazır cevap bulunamadı.', MAIN_MENU); return; }
    try {
      await batchService.sendFromDevice(workspaceId, { deviceId: state.browseDeviceId, to: state.to, message: reply.body });
      await answerCallback(token, cb.id, 'Gönderildi');
      const { text: t, buttons } = await renderThread(workspaceId, state.browseDeviceId, state.to);
      await sendMessage(token, chatId, `✅ Hazır cevap gönderildi.\n\n${t}`, buttons);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Gönderilemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (data === 'reopenthread') {
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    const { text: t, buttons } = await renderThread(workspaceId, state.browseDeviceId, state.to);
    await sendMessage(token, chatId, t, buttons);
  } else if (data === 'labelmenu') {
    // Show workspace labels as toggles for the current thread (setlbl:<i>).
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    const labels = await whatsappService.listLabels(workspaceId);
    if (!labels.length) {
      await sendMessage(token, chatId, '🏷 Henüz etiket yok. Panelden (WhatsApp → Etiketler) oluşturun.', [[{ text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]]);
      return;
    }
    const info = await whatsappService.getContactInfo(workspaceId, { deviceId: state.browseDeviceId, peer: state.to });
    const assigned = new Set(info?.labelIds ?? []);
    const rows: InlineButton[][] = labels.slice(0, 10).map((l, i) => [
      { text: `${assigned.has(l.id) ? '✅' : '⬜️'} ${l.name}`.slice(0, 60), callback_data: `setlbl:${i}` }
    ]);
    rows.push([{ text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]);
    await sendMessage(token, chatId, '🏷 <b>Etiket ata/kaldır:</b>', rows);
  } else if (data.startsWith('setlbl:')) {
    // Toggle a label on the current thread by its index in the label list.
    if (!state.to || !state.browseDeviceId) { await sendMessage(token, chatId, '⚠️ Önce bir sohbet açın.', MAIN_MENU); return; }
    const idx = Number(data.slice('setlbl:'.length));
    const labels = await whatsappService.listLabels(workspaceId);
    const label = Number.isInteger(idx) ? labels[idx] : undefined;
    if (!label) { await sendMessage(token, chatId, '⚠️ Etiket bulunamadı.', MAIN_MENU); return; }
    const info = await whatsappService.getContactInfo(workspaceId, { deviceId: state.browseDeviceId, peer: state.to });
    const cur = info?.labelIds ?? [];
    const has = cur.includes(label.id);
    const next = has ? cur.filter((x) => x !== label.id) : [...cur, label.id];
    await whatsappService.setConversationLabels(workspaceId, { deviceId: state.browseDeviceId, peer: state.to, labelIds: next });
    await answerCallback(token, cb.id, has ? `"${label.name}" kaldırıldı` : `"${label.name}" eklendi`);
    // Re-render the label menu with the updated ticks.
    const labels2 = await whatsappService.listLabels(workspaceId);
    const assigned = new Set(next);
    const rows: InlineButton[][] = labels2.slice(0, 10).map((l, i) => [
      { text: `${assigned.has(l.id) ? '✅' : '⬜️'} ${l.name}`.slice(0, 60), callback_data: `setlbl:${i}` }
    ]);
    rows.push([{ text: '⬅️ Sohbete dön', callback_data: 'reopenthread' }]);
    await sendMessage(token, chatId, '🏷 <b>Etiket ata/kaldır:</b>', rows);
  } else if (data.startsWith('wr:') || data.startsWith('wo:') || data.startsWith('wk:')) {
    // Actions on an inbound-notification message: reply / open / mark-read. The
    // message id resolves back to (deviceId, peer) so it survives state loss.
    const kind = data.slice(0, 2);
    const msgId = data.slice(3);
    const m = await prisma.whatsappMessage.findUnique({
      where: { id: msgId },
      select: { deviceId: true, peer: true, workspaceId: true }
    });
    if (!m || (m.workspaceId && m.workspaceId !== workspaceId)) {
      await sendMessage(token, chatId, '⚠️ Mesaj bulunamadı.', MAIN_MENU);
      return;
    }
    state.browseDeviceId = m.deviceId;
    state.to = m.peer;
    if (kind === 'wk') {
      await whatsappService.markRead(workspaceId, { deviceId: m.deviceId, peer: m.peer }).catch(() => undefined);
      await answerCallback(token, cb.id, 'Okundu işaretlendi');
    } else if (kind === 'wr') {
      state.mode = 'awaiting_reply';
      await sendMessage(token, chatId, `💬 <b>${esc(m.peer)}</b> kişisine yanıtınızı yazın:`);
    } else {
      // wo: open the thread.
      try {
        const { text: t, buttons } = await renderThread(workspaceId, m.deviceId, m.peer);
        await sendMessage(token, chatId, t, buttons);
      } catch (e) {
        await sendMessage(token, chatId, `❌ Açılamadı: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
      }
    }
  }
}

// ── Polling loop ────────────────────────────────────────────────────────────

// Load every workspace's telegram bot (token + registered chatId list), decrypted.
// chatId may hold several comma/space-separated ids (multi-operator); ALL of them
// are authorised to command the bot and receive notifications.
async function loadBots(): Promise<Array<{ workspaceId: string; token: string; chatIds: string[] }>> {
  const rows = await prisma.notificationChannel.findMany({
    where: { type: 'telegram', active: true }
  });
  const bots: Array<{ workspaceId: string; token: string; chatIds: string[] }> = [];
  for (const row of rows) {
    try {
      const cfg = JSON.parse(decryptString(row.configEnc)) as { botToken?: string; chatId?: string };
      const chatIds = String(cfg.chatId ?? '')
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (cfg.botToken && chatIds.length && row.workspaceId) {
        bots.push({ workspaceId: row.workspaceId, token: cfg.botToken, chatIds });
      }
    } catch { /* skip malformed */ }
  }
  return bots;
}

// Poll ONE bot once (getUpdates with a short long-poll). Processes only updates
// from the workspace's REGISTERED chatIds — any other chat is ignored (security:
// a stranger who finds the bot can't command it).
async function pollBot(bot: { workspaceId: string; token: string; chatIds: string[] }): Promise<void> {
  const state = botStates.get(bot.token) ?? { offset: 0, chats: new Map() };
  botStates.set(bot.token, state);

  // Publish the command palette to Telegram (once per token per process).
  await ensureCommands(bot.token);

  let updates: TgUpdate[];
  try {
    updates = await tgCall(bot.token, 'getUpdates', { offset: state.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 30000);
  } catch (e) {
    logger.warn('tg getUpdates failed', { error: String(e) });
    return;
  }
  if (!Array.isArray(updates) || !updates.length) return;

  const allowed = new Set(bot.chatIds);
  for (const u of updates) {
    state.offset = Math.max(state.offset, u.update_id + 1);
    try {
      if (u.message?.text && u.message.chat) {
        const chatId = String(u.message.chat.id);
        if (!allowed.has(chatId)) {
          // Unregistered chat — reject once so the sender knows.
          await sendMessage(bot.token, chatId, '⛔️ Bu bot yalnızca yetkili sohbete yanıt verir.');
          continue;
        }
        await handleCommand(bot.token, bot.workspaceId, chatId, state, u.message.text);
      } else if (u.callback_query) {
        const chatId = String(u.callback_query.message?.chat.id ?? u.callback_query.from.id);
        if (!allowed.has(chatId)) { await answerCallback(bot.token, u.callback_query.id, '⛔️ Yetkisiz'); continue; }
        await handleCallback(bot.token, bot.workspaceId, chatId, state, u.callback_query);
      }
    } catch (e) {
      logger.warn('tg update handling failed', { error: String(e) });
    }
  }
}

let running = false;
let stopped = false;

// Start the bot loop. Reloads the bot list each cycle so newly-configured bots
// are picked up without a restart. Self-scheduling (NOT setInterval) because each
// getUpdates call long-polls up to 25s.
export function startTelegramBot(): void {
  if (running) return;
  running = true;
  stopped = false;
  logger.info('telegram bot loop starting');

  const loop = async () => {
    while (!stopped) {
      try {
        const bots = await loadBots();
        if (!bots.length) {
          // No bots configured — idle a bit before checking again.
          await new Promise((r) => setTimeout(r, 15000));
          continue;
        }
        // Poll all bots in parallel; each long-polls ~25s.
        await Promise.all(bots.map((b) => pollBot(b).catch(() => undefined)));
      } catch (e) {
        logger.warn('telegram bot loop error', { error: String(e) });
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    running = false;
    logger.info('telegram bot loop stopped');
  };
  void loop();
}

export function stopTelegramBot(): void {
  stopped = true;
}
