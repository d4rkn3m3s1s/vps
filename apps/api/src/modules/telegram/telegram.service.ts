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
import { decryptString, safeDecrypt } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { batchService } from '../accounts/batch.service';
import { whatsappService, type ConversationFilter } from '../whatsapp/whatsapp.service';
import { DeviceService } from '../devices/device.service';
import { fleetHealthService } from '../fleet-health/fleet-health.service';
import { provisionService } from '../provision/provision.service';
import { ProxyService } from '../proxies/proxy.service';
import {
  renderDiagnostics,
  renderProxyStatus,
  runRecovery,
  renderEmergencyHelp,
  renderDailyDigest
} from './ops.service';
import { splitLeadingPhone } from '../../lib/phone';

const deviceService = new DeviceService();

// How many conversations per page in the /sohbetler list (inline buttons).
const CONV_PAGE_SIZE = 8;

// ── Telegram Bot API helpers ────────────────────────────────────────────────

const TG_API = 'https://api.telegram.org';

type TgUser = { id: number; first_name?: string; username?: string };
type TgChat = { id: number; type: string };
type TgPhotoSize = { file_id: string; file_size?: number; width?: number; height?: number };
type TgMessage = {
  message_id: number; from?: TgUser; chat: TgChat; text?: string;
  photo?: TgPhotoSize[];
  document?: { file_id: string; mime_type?: string; file_size?: number };
};
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
  // ★2026-07-29 4096 SINIRI: Telegram tek mesajda en fazla 4096 karakter kabul eder.
  // Uzun listeler (/hesaplar 40 satır, /kisiler 40, /okunmamistum 30, /sonmesajlar 25)
  // bu sınırı aşınca API isteği REDDEDİYOR ve aşağıdaki .catch() hatayı yutuyordu →
  // operatör komuta basıyor, HİÇBİR ŞEY gelmiyordu. Artık uzun metni parçalara bölüp
  // sırayla gönderiyoruz; butonlar yalnızca SON parçaya eklenir (aksi halde her
  // parçada menü tekrarlanır).
  const LIMIT = 3900; // HTML etiketleri + emoji payı için 4096'nın altında güvenli sınır
  const chunks: string[] = [];
  if (text.length <= LIMIT) {
    chunks.push(text);
  } else {
    // Satır sınırında böl ki HTML etiketi ortadan ikiye ayrılmasın.
    let buf = '';
    for (const line of text.split('\n')) {
      // Tek satır bile sınırı aşıyorsa (nadiren) sert kes.
      if (line.length > LIMIT) {
        if (buf) { chunks.push(buf); buf = ''; }
        for (let i = 0; i < line.length; i += LIMIT) chunks.push(line.slice(i, i + LIMIT));
        continue;
      }
      if (buf.length + line.length + 1 > LIMIT) { chunks.push(buf); buf = line; }
      else buf = buf ? `${buf}\n${line}` : line;
    }
    if (buf) chunks.push(buf);
  }

  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const params: Record<string, unknown> = {
      chat_id: chatId,
      text: chunks[i],
      parse_mode: 'HTML',
      disable_web_page_preview: true
    };
    if (isLast && buttons?.length) params.reply_markup = { inline_keyboard: buttons };
    // eslint-disable-next-line no-await-in-loop
    await tgCall(token, 'sendMessage', params).catch((e) =>
      logger.warn('tg sendMessage failed', { error: String(e), chunk: `${i + 1}/${chunks.length}` })
    );
  }
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

// Download a photo the operator sent to the bot and return it as base64 (no data-URI
// prefix). Telegram: getFile(file_id) → file_path → https download from the file host.
// Used by the /profilresim flow to feed WHATSAPP_SET_AVATAR.
async function downloadTelegramFileB64(token: string, fileId: string): Promise<string | null> {
  try {
    const meta = await tgCall(token, 'getFile', { file_id: fileId }) as { file_path?: string };
    if (!meta?.file_path) return null;
    const res = await fetch(`${TG_API}/file/bot${token}/${meta.file_path}`, {
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8_000_000) return null; // 8MB cap (avatar için fazlasıyla yeter)
    return buf.toString('base64');
  } catch (e) {
    logger.warn('tg getFile failed', { error: String(e) });
    return null;
  }
}

// ── Command palette (Telegram's "/" menu via setMyCommands) ──────────────────

// The commands shown in Telegram's slash-menu / command palette. Registered once
// per bot token (setMyCommands is idempotent but we skip re-sending to save calls).
const BOT_COMMANDS: Array<{ command: string; description: string }> = [
  { command: 'menu', description: '🏠 Ana menü ve tüm butonlar' },
  // Mesajlaşma
  { command: 'gonder', description: '✉️ Tek cihazdan mesaj gönder (cihaz seç)' },
  { command: 'testmesaj', description: '📢 Bir numaraya TÜM cihazlardan test — /testmesaj 90555… mesaj' },
  // ★2026-07-30 Açıklamalar artık "adım adım sorar" diyor: operatör parametreyi
  // ezberlemek/yazmak zorunda değil, çıplak komut yeter (cihazı butonla seçer).
  { command: 'profilisim', description: '📝 WA profil ismini değiştir (adım adım sorar)' },
  { command: 'profilresim', description: '🖼 WA profil resmini değiştir — /profilresim <cihaz> + foto' },
  { command: 'sohbetler', description: '💬 Sohbetleri gör (kategori + sayfalama)' },
  { command: 'ara', description: '🔎 Sohbet ara — /ara Ahmet veya /ara 90555…' },
  { command: 'okunmamis', description: '🔵 Bir cihazın okunmamış sohbetleri' },
  { command: 'favoriler', description: '⭐ Favori (yıldızlı) sohbetler' },
  { command: 'etiketler', description: '🏷 Sohbet etiketlerini (kategori) yönet' },
  { command: 'engellenenler', description: '🚫 Engellenen kişileri gör' },
  { command: 'numaram', description: '📞 Cihazın kendi WhatsApp numarasını oku' },
  // Durum / istatistik
  { command: 'durum', description: '📊 Özet: cihaz + okunmamış sayısı' },
  { command: 'istatistik', description: '📈 Son 24 saat mesaj istatistikleri' },
  { command: 'cihazlar', description: '📱 Tüm cihazları listele (online/offline)' },
  // 🚨 Acil müdahale + operasyon (★2026-07-29: operatör dışarıdayken SSH'sız teşhis/onarım)
  { command: 'tani', description: '🔍 Derin teşhis — neyin bozuk olduğunu göster' },
  { command: 'kurtar', description: '🔧 Otomatik onarım — kapalı cihaz + takılı iş' },
  { command: 'proxy', description: '🌐 Proxy/ülke dağılımı ve sağlığı' },
  { command: 'ozet', description: '☀️ Günlük özet (son 24 saat)' },
  { command: 'acil', description: '🚨 Acil müdahale rehberi (ne otomatik, ne elle)' },
  { command: 'saglik', description: '🩺 Filo sağlığı: cihaz + WA hesap + sunucu yükü' },
  { command: 'uyandir', description: '🔆 Offline cihazı uyandır — /uyandir <cihaz>' },
  { command: 'reboot', description: '♻️ Cihazı yeniden başlat — /reboot <cihaz>' },
  { command: 'reconnect', description: '🔧 ADB kopan offline cihazları toplu kurtar' },
  // 🛠 Cihaz yönetimi
  { command: 'kur', description: '🚀 Toplu cihaz kur (ülke + adet sorar)' },
  { command: 'etiket', description: '🏷 Cihaz etiketle (adım adım sorar)' },
  { command: 'adver', description: '✏️ Cihaz adını değiştir (adım adım sorar)' },
  { command: 'sil', description: '🗑 Cihaz sil (korumalıysa reddedilir) — /sil <cihaz>' },
  // 💬 WA hesap-sağlık
  // ★2026-07-29: /kayit dispatcher'da vardı ama palette/menüde YOKTU → operatör
  // komutun varlığını keşfedemiyordu. (Kendisi panele yönlendirir; bu bilinçli.)
  { command: 'kayit', description: '📝 Yarım kalan kayıtlar + kalan bekletme süreleri' },
  { command: 'hesaplar', description: '💬 WhatsApp hesapları + sağlık rozeti' },
  { command: 'banlar', description: '⚠️ Son 7 günün ban/kısıt dalgası' },
  // 📂 Kayıt okuma
  { command: 'okunmamistum', description: '🔵 TÜM cihazlarda okunmamış (tek liste)' },
  { command: 'kisiler', description: '👥 İsim verilmiş kayıtlı kişiler' },
  { command: 'sonmesajlar', description: '📨 Filodaki son gelen mesajlar' },
  // 2026-07-28: proxy KOTASI bitince cihazlar datacenter-IP'ye duser -> BAN. Bakiyeyi
  // operator bota sorabilsin (otomatik PROXY_CREDIT_LOW alarmi zaten var, bu ANLIK bakis).
  { command: 'bakiye', description: '💳 Proxy (thordata) kalan trafik + son kullanma' },
  { command: 'yardim', description: 'ℹ️ Komut listesi ve örnekler' }
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
  // ★2026-07-30 ADIM ADIM AKIŞLAR (operatör isteği: "bütün komutlarda adım adım
  // komutu çalıştırsın, no girsin vs — /xxx komut xxx noya xx mesaj gibi değil").
  // Yeni modlar: profil-ismi, etiket, cihaz-adı ve toplu kurulum artık parametreyi
  // TEK SATIRDA yazdırmak yerine sırayla soruyor.
  mode:
    | 'idle' | 'awaiting_number' | 'awaiting_text' | 'awaiting_reply' | 'awaiting_search'
    | 'awaiting_media' | 'awaiting_broadcast_number' | 'awaiting_broadcast_text'
    | 'awaiting_profile_photo'
    | 'awaiting_profile_name'   // /profilisim → cihaz seçildi, YENİ AD bekleniyor
    | 'awaiting_tag'            // /etiket    → cihaz seçildi, ETİKET bekleniyor
    | 'awaiting_rename'         // /adver     → cihaz seçildi, YENİ CİHAZ ADI bekleniyor
    | 'awaiting_provision_count'; // /kur     → ülke seçildi, ADET bekleniyor
  deviceId?: string | undefined;
  to?: string | undefined;
  // Adım adım akışların taşıdığı hedef cihaz (ad göstermek için ismi de tutuyoruz;
  // aksi halde her adımda tekrar DB'ye gitmek gerekir).
  targetDeviceId?: string | undefined;
  targetDeviceName?: string | undefined;
  // /kur akışında seçilen ülke (adet sorulurken hatırlanır).
  provisionCountry?: string | undefined;
  // Toplu test-mesajı akışı: numara → mesaj → tüm cihazlardan gönder.
  broadcastTo?: string | undefined;
  // Profil-resmi akışı: /profilresim <cihaz> → sonraki fotoğrafı bu cihaza uygula.
  profileDeviceId?: string | undefined;
  profileDeviceName?: string | undefined;
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

// Bir metnin ÇÖZÜLEMEMİŞ şifre gövdesi olup olmadığını tahmin eder.
//
// ★2026-07-29 — NEDEN: mesaj gövdeleri AES-256-GCM ile şifreli saklanıyor. Telegram
// listelerinde bu alanlar ÇÖZÜLMEDEN basılıyordu; operatör önizleme yerine
// "VIki/047Wc+XEa2cElErBN83XtA0IZ3LudeSfiNs" gibi anlamsız diziler görüyordu.
// safeDecrypt çözemediğinde (bozuk/eski kayıt, anahtar değişimi) girdiyi AYNEN geri
// verir — yani tek başına yeterli değil. Bu kontrol o durumu yakalayıp önizlemeyi
// tamamen gizler: yanlış bilgi göstermektense hiç göstermemek daha iyi.
// Sezgi: base64-benzeri, uzun, boşluksuz ve sözcük içermeyen diziler.
function looksEncrypted(s: string): boolean {
  const t = String(s || '').trim();
  if (t.length < 24) return false;
  if (/\s/.test(t)) return false; // gerçek mesajlar neredeyse her zaman boşluk içerir
  return /^[A-Za-z0-9+/=_-]+$/.test(t);
}

// Bir komutun ARGÜMANLI ve ARGÜMANSIZ hâlini birlikte eşler.
//
// ★2026-07-29 — NEDEN: Telegram'ın "/" komut menüsünden bir komuta dokunulduğunda
// bota argümansız hâli gönderilir ("/profilisim"). Dispatcher'daki koşullar ise
// yalnızca boşluklu biçimi (`lower.startsWith('/profilisim ')`) kabul ediyordu;
// sonuç olarak menüden komuta basmak "Anlamadım." cevabı veriyordu ve kullanım
// örneği hiç gösterilemiyordu. Operatörün bildirdiği "komuta basıyorum bir şey
// olmuyor" sorunu buydu.
//
// ⚠️ TÜRKÇE BÜYÜK-İ TUZAĞI: 'İ'.toLowerCase() JavaScript'te 'i' + U+0307 (birleşen
// nokta) üretir, bu yüzden `lower.startsWith('/profilİsim ')` gibi koşullar ASLA
// eşleşmez. Bu yüzden karşılaştırmadan önce birleşen noktayı ve Türkçe'ye özgü
// harfleri normalize ediyoruz — operatör Türkçe klavyeyle yazdığında da çalışsın.
function normCmd(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/̇/g, '') // 'İ'.toLowerCase() kalıntısı: birleşen nokta
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

function isCmd(lower: string, ...names: string[]): boolean {
  const t = normCmd(lower).trim();
  for (const n of names) {
    const k = normCmd(n);
    // "/ad", "ad", "/ad <arg>", "ad <arg>" — dördü de kabul.
    if (t === `/${k}` || t === k) return true;
    if (t.startsWith(`/${k} `) || t.startsWith(`${k} `)) return true;
  }
  return false;
}

// ── Command / callback handling ─────────────────────────────────────────────

const MAIN_MENU: InlineButton[][] = [
  [{ text: '💬 Sohbetler', callback_data: 'chats' }, { text: '🔎 Ara', callback_data: 'search' }],
  [{ text: '🔵 Okunmamış', callback_data: 'q:unread' }, { text: '⭐ Favoriler', callback_data: 'q:favorite' }],
  [{ text: '✉️ Mesaj Gönder', callback_data: 'send' }, { text: '📢 Toplu Test', callback_data: 'broadcast' }],
  [{ text: '🩺 Sağlık', callback_data: 'health' }, { text: '📈 İstatistik', callback_data: 'stats' }],
  [{ text: '🏷 Etiketler', callback_data: 'labels' }, { text: '📊 Durum', callback_data: 'status' }],
  // ★2026-07-29: 'read' (Mesajları Oku) handler'ı vardı ama HİÇBİR buton onu
  // göndermiyordu — readpick akışı UI'dan erişilemez ölü koddu. Menüye bağlandı.
  [{ text: '📱 Cihazlar', callback_data: 'devices' }, { text: '📨 Mesajları Oku', callback_data: 'read' }],
  // ★2026-07-29: operatör dışarıdayken teşhis + onarım tek dokunuşla erişilebilir olmalı.
  [{ text: '🔍 Teşhis', callback_data: 'ops:diag' }, { text: '🔧 Kurtar', callback_data: 'ops:fix' }],
  [{ text: 'ℹ️ Yardım', callback_data: 'help' }]
];

// Operasyon (teşhis/onarım) ekranlarının altındaki menü — buradan hızlıca diğer
// operasyon komutlarına geçilebilsin, her seferinde /menu'ye dönmek gerekmesin.
const OPS_MENU: InlineButton[][] = [
  [{ text: '🔍 Teşhis', callback_data: 'ops:diag' }, { text: '🌐 Proxy', callback_data: 'ops:proxy' }],
  [{ text: '🔧 Kurtar', callback_data: 'ops:fix' }, { text: '☀️ Özet', callback_data: 'ops:digest' }],
  [{ text: '🩺 Sağlık', callback_data: 'health' }, { text: '🚨 Acil', callback_data: 'ops:emergency' }],
  [{ text: '🏠 Ana menü', callback_data: 'menu' }]
];

function menuText(): string {
  return [
    '<b>🤖 Fleet WhatsApp Bot</b>',
    '<i>Aşağıdaki menüden seç, komut yaz ya da klavyedeki <b>/</b> ile paleti aç.</i>',
    '',
    '<b>✉️ Mesajlaşma</b>',
    '• <b>/gonder</b> — tek cihazdan mesaj gönder (cihaz seçtirir)',
    '• <b>/testmesaj</b> — bir numaraya <b>TÜM WhatsApp\'lı cihazlardan</b> test',
    '   örn: <code>/testmesaj 905551112233 Merhaba</code>',
    '   (mesaj yazmazsan "Test mesajı ✅" gönderilir)',
    '• <b>/sohbetler</b> — sohbetleri gör (kategori + sayfalama)',
    '• <b>/ara</b> — sohbet ara — <code>/ara Ahmet</code> ya da <code>/ara 90555…</code>',
    '',
    '<b>👤 Profil</b>',
    '• <b>/profilisim</b> — WA profil ismini değiştir <i>(cihazı seçtirir, sonra ismi sorar)</i>',
    '   hızlı yol: <code>/profilisim watest48 Zara</code>',
    '• <b>/profilresim</b> &lt;cihaz&gt; — sonra bir foto gönderin (profil resmi olur)',
    '• <b>/okunmamis</b> · <b>/favoriler</b> · <b>/etiketler</b>',
    '• <b>/engellenenler</b> · <b>/numaram</b>',
    '',
    '<b>📊 Durum & istatistik</b>',
    '• <b>/durum</b> — özet (cihaz + okunmamış) · <b>/istatistik</b> — 24s mesaj',
    '• <b>/cihazlar</b> — tüm cihazlar (online/offline)',
    '',
    '<b>🚨 Acil müdahale & operasyon</b>',
    '• <b>/tani</b> — <b>derin teşhis</b>: neyin bozuk olduğunu tek bakışta gör',
    '• <b>/kurtar</b> — otomatik onarım (kapalı cihaz + takılı iş)',
    '• <b>/proxy</b> — proxy/ülke dağılımı · <b>/ozet</b> — günlük özet',
    '• <b>/acil</b> — neyin otomatik çözüldüğü, neyin elle yapılacağı',
    '• <b>/saglik</b> — filo sağlığı (cihaz + WA hesap + sunucu yükü)',
    '• <b>/uyandir</b> &lt;cihaz&gt; — offline cihazı uyandır',
    '• <b>/reboot</b> &lt;cihaz&gt; — cihazı yeniden başlat',
    '• <b>/reconnect</b> — ADB kopan offline cihazları toplu kurtar',
    '   <i>(cihaz = isim, numara veya kimlik — örn. /uyandir 90555…)</i>',
    '',
    '<b>🛠 Cihaz yönetimi</b>',
    '<i>Bu komutlar ADIM ADIM sorar — parametre yazmak zorunda değilsiniz.</i>',
    '• <b>/kur</b> — toplu cihaz kur <i>(ülke seçtirir, sonra adet sorar)</i>',
    '• <b>/etiket</b> — cihaz etiketle <i>(cihazı seçtirir, sonra etiketi sorar)</i>',
    '• <b>/adver</b> — cihaz adını değiştir <i>(cihazı seçtirir, sonra adı sorar)</i>',
    '• <b>/sil</b> &lt;cihaz&gt; — cihaz sil (korumalıysa reddedilir)',
    '   <i>hızlı yol: <code>/kur 3 TR</code> · <code>/etiket watest52 #test</code></i>',
    '',
    '<b>💬 WA hesap-sağlık</b>',
    '• <b>/hesaplar</b> — WhatsApp hesapları + sağlık rozeti',
    '• <b>/banlar</b> — son 7 günün ban/kısıt dalgası',
    '',
    '<b>📂 Kayıt okuma</b>',
    '• <b>/okunmamistum</b> — tüm cihazlarda okunmamış (tek liste)',
    '• <b>/kisiler</b> — isim verilmiş kayıtlı kişiler',
    '• <b>/sonmesajlar</b> — filodaki son gelen mesajlar'
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
  // ★2026-07-29 OTURUM KAYBI: state BELLEKTE tutuluyor (botStates). API yeniden
  // başlayınca sıfırlanır — ama operatörün sohbet geçmişindeki ESKİ butonlar hâlâ
  // orada durur. Eskiden bu durumda `state.browseDeviceId!` undefined'a düşüyor,
  // listConversations patlıyor ve hata en dıştaki catch'te YUTULUYORDU: operatör
  // butona basıyor, hiçbir şey olmuyordu. Artık net bir yönlendirme veriyoruz.
  if (!state.browseDeviceId) {
    return {
      text: '⏳ <b>Oturum sıfırlandı</b> (bot yeniden başlatılmış olabilir).\nBu eski buton artık geçersiz — lütfen cihazı yeniden seçin.',
      buttons: await devicePickerButtons(workspaceId, 'chatpick', state.browseFilter ?? 'all')
    };
  }
  const deviceId = state.browseDeviceId;
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
        // Servis katmanı zaten safeDecrypt uyguluyor; ama çözme BAŞARISIZ olursa
        // (anahtar rotasyonu / bozuk satır) girdiyi aynen döndürür ve ham şifre metni
        // ekrana basılır. Bu iki ekran en çok kullanılanlar olduğu için burada da
        // koruyoruz — yanlış bilgi göstermektense önizlemeyi hiç göstermemek yeğdir.
        const preview =
          c.lastMessageBody && !looksEncrypted(c.lastMessageBody)
            ? esc(c.lastMessageBody.slice(0, 40))
            : '—';
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
        // Çözülememiş gövdeyi ham şifre olarak basma (bkz. renderChatList'teki not).
        const body = looksEncrypted(String(m.body)) ? '<i>(okunamadı)</i>' : esc(String(m.body).slice(0, 180));
        return `${arrow} ${body}${glyph}${failNote}`;
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
  // ★2026-07-30 adım-adım akışlar için yeni eylemler: profil-ismi, etiket, yeniden-adlandır.
  action: 'sendpick' | 'readpick' | 'chatpick' | 'namepick' | 'tagpick' | 'renamepick',
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

// ── Grup 1-4: cihaz-yönetim + acil-müdahale + hesap-sağlık komutları ─────────
// (2026-07-24) Telegram'dan filoyu tam yönet: acil durumda cihaz uyandır/reboot,
// ADB kopunca kurtar, cihaz kur/sil/etiketle/adver, WA hesap-sağlığı gör, DB oku.

// Resolve a device by a loose operator reference: exact id, exact name (case-
// insensitive), a unique name/substring match, or the account phone number. Used
// by all "/komut <cihaz>" commands so the operator can type "watest52" or a number
// instead of a 36-char UUID. Returns null if nothing (or ambiguously many) match.
async function findDeviceByRef(
  workspaceId: string,
  ref: string
): Promise<{ id: string; name: string; status: string } | null> {
  const q = ref.trim();
  if (!q) return null;
  const devices = await deviceService.listDevices(workspaceId);
  const norm = (s: string) => s.trim().toLowerCase();
  const ql = norm(q);
  // 1) exact id.
  const byId = devices.find((d) => d.id === q);
  if (byId) return { id: byId.id, name: byId.name, status: byId.status };
  // 2) exact name (case-insensitive).
  const exact = devices.filter((d) => norm(d.name) === ql);
  if (exact.length === 1) return { id: exact[0]!.id, name: exact[0]!.name, status: exact[0]!.status };
  // 3) unique substring on name.
  const partial = devices.filter((d) => norm(d.name).includes(ql));
  if (partial.length === 1) return { id: partial[0]!.id, name: partial[0]!.name, status: partial[0]!.status };
  // 4) by active WhatsApp phone number (digits only).
  const digits = q.replace(/[^\d]/g, '');
  if (digits.length >= 6) {
    const byPhone = devices.filter((d) => {
      const p = (d as Record<string, unknown>).activeWhatsappPhone as string | null | undefined;
      return p ? p.replace(/[^\d]/g, '').endsWith(digits) : false;
    });
    if (byPhone.length === 1) return { id: byPhone[0]!.id, name: byPhone[0]!.name, status: byPhone[0]!.status };
  }
  return null;
}

// Grup 1 — /saglik: fleet-health özeti (cihaz online/offline/error + WA hesap
// sağlık dağılımı + host yük). Panelin canlı sağlık panelinin metin karşılığı.
async function renderFleetHealth(workspaceId: string): Promise<string> {
  const h = await fleetHealthService.health(workspaceId);
  const d = h.devices;
  const w = h.waAccounts;
  const lines: string[] = [
    '<b>🩺 Filo Sağlığı</b>',
    '',
    `📱 Cihazlar: <b>${d.total}</b> · 🟢 ${d.online} · ⚪️ ${d.offline}${d.error ? ` · 🔴 ${d.error} hata` : ''}`
  ];
  // WhatsApp account health breakdown.
  const waParts: string[] = [];
  if (w.active) waParts.push(`✅ ${w.active} aktif`);
  if (w.restricted) waParts.push(`🟡 ${w.restricted} kısıtlı`);
  if (w.loggedOut) waParts.push(`🟠 ${w.loggedOut} çıkış`);
  if (w.banned) waParts.push(`🔴 ${w.banned} yasaklı`);
  if (waParts.length) lines.push(`💬 WhatsApp: ${waParts.join(' · ')}`);
  // Host machines (1-min load saturation + free disk).
  if (h.hosts.length) {
    lines.push('', '<b>🖥 Sunucular</b>');
    for (const host of h.hosts.slice(0, 6)) {
      const load = host.load1 !== null ? host.load1.toFixed(1) : '—';
      const pct = host.saturationPct;
      const disk = host.diskFreeGb !== null ? ` · ${Math.round(host.diskFreeGb)}GB boş` : '';
      const dot = pct === null ? '⚪️' : pct > 90 ? '🔴' : pct > 70 ? '🟡' : '🟢';
      const stale = host.monitorStale ? ' ⚠️izleme-durdu' : '';
      lines.push(`${dot} <b>${esc(host.name)}</b> — yük ${load}${pct !== null ? ` (%${pct})` : ''}${disk}${stale}`);
    }
  }
  return lines.join('\n');
}

// Map deviceId → device name for a set of accounts (GeneratedAccount has no device
// relation, only a scalar deviceId; one bounded lookup avoids an N+1).
async function deviceNameMap(workspaceId: string, deviceIds: Array<string | null>): Promise<Map<string, string>> {
  const ids = [...new Set(deviceIds.filter((x): x is string => !!x))];
  if (!ids.length) return new Map();
  const devs = await prisma.device.findMany({
    where: { id: { in: ids }, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true, name: true }
  });
  return new Map(devs.map((d) => [d.id, d.name]));
}

// Grup 3 — /hesaplar: tüm WhatsApp hesapları + sağlık rozeti (cihaz + numara).
// Health lives on GeneratedAccount.status (RESTRICTED/BANNED/LOGGED_OUT/ACTIVE…).
async function renderWaAccounts(workspaceId: string): Promise<string> {
  const accounts = await prisma.generatedAccount.findMany({
    where: { platform: 'whatsapp', ...(workspaceId ? { workspaceId } : {}) },
    select: { phoneNumber: true, status: true, deviceId: true },
    orderBy: { createdAt: 'desc' },
    take: 40
  });
  if (!accounts.length) return '💬 Bu çalışma alanında WhatsApp hesabı yok.';
  const names = await deviceNameMap(workspaceId, accounts.map((a) => a.deviceId));
  const badge = (status: string): string => {
    switch (status) {
      case 'BANNED': return '🔴';
      case 'LOGGED_OUT': return '🟠';
      case 'RESTRICTED': return '🟡';
      case 'ACTIVE': return '✅';
      case 'AWAITING_OTP': case 'AWAITING_MANUAL': case 'REGISTERING': return '⏳';
      case 'FAILED': return '❌';
      default: return '⚪️';
    }
  };
  const lines = accounts.map((a) => {
    const phone = a.phoneNumber ? esc(a.phoneNumber) : '(numara yok)';
    const dn = a.deviceId ? names.get(a.deviceId) : undefined;
    const dev = dn ? ` · ${esc(dn)}` : '';
    return `${badge(a.status)} <code>${phone}</code>${dev}`;
  });
  const healthy = accounts.filter((a) => a.status === 'ACTIVE').length;
  return [`<b>💬 WhatsApp Hesapları</b> (${healthy}/${accounts.length} sağlıklı)`, '', ...lines].join('\n');
}

// ★2026-07-30 Grup 3 — /kayit: YARIM KALAN kayıtlar + kalan bekleme süreleri.
//
// Eskiden /kayit yalnızca "panelden yapılır" diyen sabit bir metindi. Oysa operatörün
// dışarıdayken en çok ihtiyaç duyduğu bilgi bu: hangi kayıt takılı, hangi numara ne
// kadar bekletiliyor, ne yapmalı. WhatsApp bekletme cezaları 1 saate kadar sürüyor ve
// operatör süreyi bilmezse ya boşuna bekliyor ya da erken deneyip cezayı uzatıyor.
async function renderPendingRegistrations(workspaceId: string): Promise<string> {
  const pending = await prisma.generatedAccount.findMany({
    where: {
      platform: 'whatsapp',
      ...(workspaceId ? { workspaceId } : {}),
      status: { in: ['AWAITING_OTP', 'AWAITING_MANUAL', 'REGISTERING'] }
    },
    select: { id: true, phoneNumber: true, status: true, deviceId: true, error: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 20
  });
  const head = '<b>📝 Yarım Kalan WhatsApp Kayıtları</b>';
  if (!pending.length) {
    return [
      head,
      '',
      '✅ Şu an yarım kalan kayıt YOK.',
      '',
      'Yeni kayıt: Panel → <b>Profiller</b> → cihaz → <b>WhatsApp Kaydet</b>',
      'Durum izleme: /hesaplar · /saglik'
    ].join('\n');
  }
  const names = await deviceNameMap(workspaceId, pending.map((p) => p.deviceId));
  // Bekleme süresini hesabın son kayıt job'ından oku (ajanın `waitSeconds`'ı orada).
  const jobByDevice = new Map<string, { result: unknown; base: Date | null }>();
  for (const p of pending) {
    if (!p.deviceId || jobByDevice.has(p.deviceId)) continue;
    const job = await prisma.job
      .findFirst({
        where: { type: 'REGISTER_WHATSAPP', deviceId: p.deviceId, ...(workspaceId ? { workspaceId } : {}) },
        orderBy: { createdAt: 'desc' },
        select: { result: true, finishedAt: true, updatedAt: true }
      })
      .catch(() => null);
    jobByDevice.set(p.deviceId, { result: job?.result ?? null, base: job?.finishedAt ?? job?.updatedAt ?? null });
  }
  const lines: string[] = [];
  let bekleyen = 0;
  for (const p of pending) {
    const phone = p.phoneNumber ? esc(p.phoneNumber) : '(numara yok)';
    const dn = p.deviceId ? names.get(p.deviceId) : undefined;
    const dev = dn ? ` · ${esc(dn)}` : '';
    const j = p.deviceId ? jobByDevice.get(p.deviceId) : undefined;
    const r = (j?.result ?? {}) as Record<string, unknown>;
    const secs = typeof r.waitSeconds === 'number' ? r.waitSeconds : 0;
    let kalan = 0;
    if (secs > 0 && j?.base) {
      kalan = Math.max(0, Math.round((j.base.getTime() + secs * 1000 - Date.now()) / 1000));
    }
    const durum =
      kalan > 0
        ? `⏳ <b>${kalan >= 3600 ? `${Math.floor(kalan / 3600)}s ${Math.floor((kalan % 3600) / 60)}dk` : `${Math.ceil(kalan / 60)} dk`}</b> bekletme kaldı`
        : p.status === 'AWAITING_OTP'
          ? '📲 SMS kodu bekleniyor'
          : p.status === 'AWAITING_MANUAL'
            ? '✋ Manuel adım gerekiyor'
            : '⚙️ Kayıt sürüyor';
    if (kalan > 0) bekleyen++;
    lines.push(`<code>${phone}</code>${dev}\n   ${durum}`);
    // Aksiyon cümlesi varsa göster (ajan/API üretiyor) — tek satır, kısaltılmış.
    const act = typeof r.action === 'string' ? r.action : '';
    if (act) lines.push(`   ➡️ ${esc(act.slice(0, 140))}`);
  }
  return [
    `${head} (${pending.length})`,
    ...(bekleyen ? [`⏳ ${bekleyen} tanesi WhatsApp bekletmesinde — süre dolmadan denemeyin.`] : []),
    '',
    ...lines,
    '',
    'Kod girme / tekrar deneme: Panel → Profiller → ilgili cihaz'
  ].join('\n');
}

// Grup 3 — /banlar: son ban/kısıt dalgası (son 7 gün, BANNED/RESTRICTED/LOGGED_OUT).
async function renderBanWave(workspaceId: string): Promise<string> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const bad = await prisma.generatedAccount.findMany({
    where: {
      platform: 'whatsapp',
      ...(workspaceId ? { workspaceId } : {}),
      status: { in: ['BANNED', 'RESTRICTED', 'LOGGED_OUT'] },
      updatedAt: { gte: since }
    },
    select: { phoneNumber: true, status: true, deviceId: true },
    orderBy: { updatedAt: 'desc' },
    take: 30
  });
  if (!bad.length) return '✅ Son 7 günde ban/kısıt olayı yok — filo temiz.';
  const names = await deviceNameMap(workspaceId, bad.map((a) => a.deviceId));
  const label = (s: string) => (s === 'BANNED' ? '🔴 Yasaklı' : s === 'LOGGED_OUT' ? '🟠 Çıkış' : '🟡 Kısıtlı');
  const lines = bad.map((a) => {
    const phone = a.phoneNumber ? esc(a.phoneNumber) : '(numara yok)';
    const dn = a.deviceId ? names.get(a.deviceId) : undefined;
    const dev = dn ? ` · ${esc(dn)}` : '';
    return `${label(a.status)} — <code>${phone}</code>${dev}`;
  });
  return [`<b>⚠️ Son Ban/Kısıt Dalgası</b> (son 7 gün, ${bad.length})`, '', ...lines].join('\n');
}

// ── Grup 4: Root-DB okuma (panel açmadan Telegram'dan hızlı görüntüle) ────────

// /okunmamis-tum: TÜM cihazlarda okunmamış konuşmalar (unreadCount>0), en yeni önce.
async function renderAllUnread(workspaceId: string): Promise<string> {
  const rows = await prisma.whatsappConversation.findMany({
    where: { unreadCount: { gt: 0 }, ...(workspaceId ? { workspaceId } : {}) },
    select: { peer: true, displayName: true, unreadCount: true, lastMessageBody: true, deviceId: true },
    orderBy: { lastMessageAt: 'desc' },
    take: 30
  });
  if (!rows.length) return '✅ Okunmamış sohbet yok — tüm mesajlar okunmuş.';
  const names = await deviceNameMap(workspaceId, rows.map((r) => r.deviceId));
  const total = rows.reduce((a, r) => a + r.unreadCount, 0);
  const lines = rows.map((r) => {
    const who = r.displayName ? esc(r.displayName) : `<code>${esc(r.peer)}</code>`;
    const dn = names.get(r.deviceId);
    // ★2026-07-29 BUG: mesaj gövdeleri AES-256-GCM ŞİFRELİ saklanıyor; burada ham
    // haliyle basılıyordu ve operatör önizleme yerine anlamsız şifre metni görüyordu
    // ("VIki/047Wc+XEa2cElErBN83Xt…"). safeDecrypt çözer, çözemezse (bozuk/eski kayıt)
    // olduğu gibi döner — bu yüzden ayrıca "şifreli görünüyorsa hiç gösterme" kontrolü.
    const plain = r.lastMessageBody ? safeDecrypt(r.lastMessageBody) : '';
    const prev = plain && !looksEncrypted(plain) ? ` — <i>${esc(plain.slice(0, 40))}</i>` : '';
    return `🔵 <b>${r.unreadCount}</b> · ${who}${dn ? ` (${esc(dn)})` : ''}${prev}`;
  });
  return [`<b>🔵 Tüm Okunmamış</b> (${total} mesaj, ${rows.length} sohbet)`, '', ...lines].join('\n');
}

// /kisiler: kayıtlı kişiler (isim verilmiş konuşmalar) — hafif CRM görünümü.
async function renderContacts(workspaceId: string): Promise<string> {
  const rows = await prisma.whatsappConversation.findMany({
    where: { displayName: { not: null }, ...(workspaceId ? { workspaceId } : {}) },
    select: { peer: true, displayName: true, deviceId: true, favorite: true, blocked: true },
    orderBy: { lastMessageAt: 'desc' },
    take: 40
  });
  if (!rows.length) return '👥 Kayıtlı isimli kişi yok (sohbetlere isim ekleyince burada görünür).';
  const names = await deviceNameMap(workspaceId, rows.map((r) => r.deviceId));
  const lines = rows.map((r) => {
    const dn = names.get(r.deviceId);
    const flags = `${r.favorite ? ' ⭐' : ''}${r.blocked ? ' 🚫' : ''}`;
    return `👤 <b>${esc(r.displayName ?? '')}</b> · <code>${esc(r.peer)}</code>${dn ? ` (${esc(dn)})` : ''}${flags}`;
  });
  return [`<b>👥 Kişiler</b> (${rows.length})`, '', ...lines].join('\n');
}

// /sonmesajlar: TÜM filoda son gelen mesajlar (inbound), en yeni önce.
async function renderRecentInbound(workspaceId: string): Promise<string> {
  const rows = await prisma.whatsappMessage.findMany({
    where: { direction: 'IN', ...(workspaceId ? { workspaceId } : {}) },
    select: { peer: true, body: true, createdAt: true, read: true, deviceId: true },
    orderBy: { createdAt: 'desc' },
    take: 25
  });
  if (!rows.length) return '📭 Kayıtlı gelen mesaj yok.';
  const names = await deviceNameMap(workspaceId, rows.map((r) => r.deviceId));
  const lines = rows.map((r) => {
    const dn = names.get(r.deviceId);
    const dot = r.read ? '⚪️' : '🔵';
    // Gövde şifreli saklanır (bkz. renderAllUnread'deki not) — çöz, çözülemiyorsa gizle.
    const plain = r.body ? safeDecrypt(r.body) : '';
    const body = plain && !looksEncrypted(plain) ? esc(plain.slice(0, 50)) : '(okunamadı)';
    return `${dot} <code>${esc(r.peer)}</code>${dn ? ` (${esc(dn)})` : ''}: <i>${body}</i>`;
  });
  return [`<b>📨 Son Gelen Mesajlar</b> (${rows.length})`, '', ...lines].join('\n');
}

// ── Toplu test-mesajı: bir numaraya TÜM WhatsApp'lı cihazlardan gönder ────────
// Operatörün "bir numaraya bütün cihazlardan mesaj testi" isteği. Her ACTIVE
// WhatsApp hesabı olan cihaz için ayrı WHATSAPP_SEND job'ı yazar (sendFromDevice
// zaten BANNED/LOGGED_OUT'u önden reddeder → o cihazlar "atlandı" olarak raporlanır).
// Cihazlar agent tarafında sırayla/paralel işlenir; burada sadece kuyruğa alırız.
async function broadcastTestMessage(
  workspaceId: string,
  to: string,
  message: string
): Promise<string> {
  const digits = to.replace(/[^\d]/g, '');
  if (digits.length < 5) return '❌ Geçerli bir numara girin (ülke kodu ile, örn. 905551112233).';
  const devices = await deviceService.listDevices(workspaceId);
  const waDevices = devices.filter((d) => (d as Record<string, unknown>).hasActiveWhatsapp === true);
  if (!waDevices.length) return '⚠️ WhatsApp hesabı olan cihaz yok — toplu test gönderilemez.';

  const queued: string[] = [];
  const skipped: string[] = [];
  // Sıra: önce ONLINE cihazlar (daha hızlı işlenir). Kuyruğa almayı seri yaparız ki
  // tek bir hatalı cihaz diğerlerini engellemesin (her biri bağımsız try/catch).
  const ordered = [...waDevices].sort((a, b) => (a.status === 'ONLINE' ? -1 : 1) - (b.status === 'ONLINE' ? -1 : 1));
  for (const d of ordered) {
    try {
      await batchService.sendFromDevice(workspaceId, { deviceId: d.id, to: digits, message });
      queued.push(d.name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'hata';
      // BANNED/LOGGED_OUT/OFFLINE → atlandı olarak kısa raporla (job yakmadan).
      const reason = /YASAKLI|ban/i.test(msg) ? 'yasaklı'
        : /ÇIKIŞ|logged/i.test(msg) ? 'çıkış-yapmış'
        : /offline|OFFLINE|erişil/i.test(msg) ? 'offline'
        : msg.slice(0, 24);
      skipped.push(`${d.name} (${reason})`);
    }
  }

  const lines: string[] = [
    `<b>📢 Toplu Test Mesajı</b>`,
    `📞 Hedef: <code>${esc(digits)}</code>`,
    `💬 "${esc(message.slice(0, 60))}"`,
    ''
  ];
  lines.push(`✅ <b>${queued.length}</b> cihazdan gönderildi (sıraya alındı).`);
  if (queued.length) lines.push(queued.map((n) => `• ${esc(n)}`).join('\n'));
  if (skipped.length) {
    lines.push('', `⏭ <b>${skipped.length}</b> cihaz atlandı:`);
    lines.push(skipped.map((s) => `• ${esc(s)}`).join('\n'));
  }
  lines.push('', '<i>Sonuçları /istatistik veya /sonmesajlar ile izleyin.</i>');
  return lines.join('\n');
}

// Handle a photo/document message. Only meaningful while in the /profilresim flow
// (awaiting_profile_photo) — download the image and dispatch WHATSAPP_SET_AVATAR.
async function handlePhotoMessage(
  token: string,
  workspaceId: string,
  chatId: string,
  bot: BotState,
  msg: TgMessage
): Promise<void> {
  const state = getChatState(bot, chatId);
  if (state.mode !== 'awaiting_profile_photo' || !state.profileDeviceId) {
    // Beklenmeyen foto — kullanıcıya nasıl kullanacağını hatırlat.
    await sendMessage(token, chatId, 'ℹ️ Profil resmi ayarlamak için önce <code>/profilresim &lt;cihaz&gt;</code> yazın, sonra fotoğrafı gönderin.', MAIN_MENU);
    return;
  }
  const deviceId = state.profileDeviceId;
  const deviceName = state.profileDeviceName ?? 'cihaz';
  state.mode = 'idle'; state.profileDeviceId = undefined; state.profileDeviceName = undefined;
  // En yüksek çözünürlüklü foto boyutunu (photo dizisinin sonu) ya da document'i seç.
  const fileId = msg.photo?.length ? msg.photo[msg.photo.length - 1]!.file_id : msg.document?.file_id;
  if (!fileId) { await sendMessage(token, chatId, '❌ Fotoğraf okunamadı.', MAIN_MENU); return; }
  await sendMessage(token, chatId, `📥 Fotoğraf indiriliyor ve <b>${esc(deviceName)}</b> profiline uygulanıyor…`);
  const b64 = await downloadTelegramFileB64(token, fileId);
  if (!b64) { await sendMessage(token, chatId, '❌ Fotoğraf indirilemedi (çok büyük veya hata).', MAIN_MENU); return; }
  try {
    await batchService.setAvatar(workspaceId, { deviceId, imageB64: b64 });
    await sendMessage(token, chatId, `🖼 <b>${esc(deviceName)}</b> profil resmi değiştiriliyor…\n<i>(Cihaz WhatsApp'ı açar, ~40 sn.)</i>`, MAIN_MENU);
  } catch (e) {
    await sendMessage(token, chatId, `❌ Uygulanamadı: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
  }
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
  // Toplu test-mesajı: önce numara, sonra mesaj → tüm WA cihazlardan gönder.
  if (state.mode === 'awaiting_broadcast_number') {
    const to = cmd.replace(/[^\d]/g, '');
    if (to.length < 5) { await sendMessage(token, chatId, '❌ Geçerli bir numara girin (ülke kodu ile, örn. 905551112233).'); return; }
    state.broadcastTo = to; state.mode = 'awaiting_broadcast_text';
    await sendMessage(token, chatId, `📞 Hedef: <b>${esc(to)}</b>\nBu numaraya <b>TÜM WhatsApp'lı cihazlardan</b> gönderilecek mesajı yazın:`);
    return;
  }
  if (state.mode === 'awaiting_broadcast_text') {
    const message = cmd;
    const to = state.broadcastTo!;
    state.mode = 'idle'; state.broadcastTo = undefined;
    await sendMessage(token, chatId, '📢 Toplu test başlatılıyor, cihazlar sıraya alınıyor…');
    try {
      const report = await broadcastTestMessage(workspaceId, to, message);
      await sendMessage(token, chatId, report, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Toplu gönderim hatası: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
    return;
  }
  // ★2026-07-30 ADIM ADIM AKIŞ İŞLEYİCİLERİ. Operatör isteği: komutlar parametreyi
  // tek satırda yazdırmak yerine sırayla sorsun. Her biri modu HEMEN 'idle'a çeker
  // (yarım kalan bir akış sonraki mesajı yanlış yorumlamasın) ve bittiğinde menüyü
  // gösterir. Tek satırlık hızlı biçim de çalışmaya devam eder.
  if (state.mode === 'awaiting_profile_name') {
    state.mode = 'idle';
    const newName = cmd.trim().slice(0, 25);
    const devId = state.targetDeviceId;
    const devName = state.targetDeviceName ?? 'cihaz';
    state.targetDeviceId = undefined; state.targetDeviceName = undefined;
    if (!newName) { await sendMessage(token, chatId, '❌ Boş isim — işlem iptal edildi.', MAIN_MENU); return; }
    if (!devId) { await sendMessage(token, chatId, '❌ Cihaz kaybolmuş, komutu yeniden başlatın.', MAIN_MENU); return; }
    try {
      await batchService.setProfileName(workspaceId, { deviceId: devId, name: newName });
      await sendMessage(token, chatId, `📝 <b>${esc(devName)}</b> profil ismi <b>${esc(newName)}</b> olarak değiştiriliyor…\n<i>(Cihaz WhatsApp ayarlarını açar, ~30 sn.)</i>`, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Değiştirilemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
    return;
  }
  if (state.mode === 'awaiting_tag') {
    state.mode = 'idle';
    const raw = cmd.trim();
    const devId = state.targetDeviceId;
    const devName = state.targetDeviceName ?? 'cihaz';
    state.targetDeviceId = undefined; state.targetDeviceName = undefined;
    if (!raw) { await sendMessage(token, chatId, '❌ Boş etiket — işlem iptal edildi.', MAIN_MENU); return; }
    if (!devId) { await sendMessage(token, chatId, '❌ Cihaz kaybolmuş, komutu yeniden başlatın.', MAIN_MENU); return; }
    // Virgül/boşlukla birden çok etiket kabul et; baştaki # işaretini at.
    const tags = [...new Set(raw.split(/[,\s]+/).map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    try {
      const dev = await deviceService.getDevice(devId, workspaceId);
      const existing = Array.isArray((dev as Record<string, unknown>).tags) ? ((dev as Record<string, unknown>).tags as string[]) : [];
      const merged = [...new Set([...existing, ...tags])].slice(0, 20);
      await deviceService.updateDevice(devId, { tags: merged }, workspaceId);
      await sendMessage(token, chatId, `🏷 <b>${esc(devName)}</b> etiketleri: ${merged.map((t) => `<code>${esc(t)}</code>`).join(' ')}`, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Etiket eklenemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
    return;
  }
  if (state.mode === 'awaiting_rename') {
    state.mode = 'idle';
    const newName = cmd.trim().slice(0, 40);
    const devId = state.targetDeviceId;
    const oldName = state.targetDeviceName ?? 'cihaz';
    state.targetDeviceId = undefined; state.targetDeviceName = undefined;
    if (!newName) { await sendMessage(token, chatId, '❌ Boş ad — işlem iptal edildi.', MAIN_MENU); return; }
    if (!devId) { await sendMessage(token, chatId, '❌ Cihaz kaybolmuş, komutu yeniden başlatın.', MAIN_MENU); return; }
    try {
      await deviceService.updateDevice(devId, { name: newName }, workspaceId);
      await sendMessage(token, chatId, `✏️ Cihaz adı değişti: <b>${esc(oldName)}</b> → <b>${esc(newName)}</b>`, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Ad değiştirilemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
    return;
  }
  if (state.mode === 'awaiting_provision_count') {
    state.mode = 'idle';
    const cc = state.provisionCountry ?? 'TR';
    state.provisionCountry = undefined;
    const n = parseInt(cmd.replace(/[^\d]/g, ''), 10);
    if (!n || n < 1 || n > 20) {
      await sendMessage(token, chatId, '❌ 1 ile 20 arasında bir adet yazın (örn. <code>3</code>).', MAIN_MENU);
      return;
    }
    try {
      // ⚠️ Metot adı `createBatch(input, workspaceId)` — /kur komutunun kendisi de
      // aynı çağrıyı kullanıyor; iki yol AYRIŞMASIN diye birebir aynı imza.
      const res = await provisionService.createBatch({ count: n, proxyCountry: cc }, workspaceId);
      const ok = res.started.length;
      const fail = res.failed.length;
      await sendMessage(
        token,
        chatId,
        `🛠 <b>${ok} cihaz</b> kuruluyor (${esc(cc)} proxy)${fail ? ` · ❌ ${fail} başlatılamadı` : ''}…\n<i>Her biri ~90-120 sn. Durum için /cihazlar</i>`,
        MAIN_MENU
      );
    } catch (e) {
      await sendMessage(token, chatId, `❌ Kurulum başlatılamadı: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
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
  } else if (lower === '/testmesaj' || lower.startsWith('/testmesaj ') || lower.startsWith('testmesaj ') || lower === '/toplutest') {
    // Toplu test: bir numaraya TÜM WhatsApp'lı cihazlardan mesaj gönder.
    // Shorthand: "/testmesaj 905551112233 [mesaj]" — mesaj yoksa varsayılan test metni.
    if (!(await hasAnyWhatsappDevice(workspaceId))) {
      await sendMessage(token, chatId, '⚠️ Bu çalışma alanında <b>WhatsApp hesabı olan</b> cihaz yok.', MAIN_MENU);
    } else {
      const rest = cmd.replace(/^\/?(testmesaj|toplutest)\s*/i, '').trim();
      // ★2026-07-29 KRİTİK BUG: eski desen `^(\+?\d[\d\s]{4,})(?:\s+([\s\S]+))?$`
      // AÇGÖZLÜ idi — `[\d\s]{4,}` boşlukları da yuttuğu için
      // "/testmesaj 90 555 111 22 33 Merhaba" girdisinde numara grubu mesajın
      // başındaki rakam+boşlukları da içine alıyor, operatörün yazdığı "Merhaba"
      // kayboluyor ve GERÇEK bir kişiye varsayılan "Test mesajı ✅" gidiyordu.
      // splitLeadingPhone rakamları soldan toplar, E.164 üst sınırında (15) durur
      // ve kalanı mesaj sayar → boşluklu numara artık doğru ayrışıyor.
      const parsed = splitLeadingPhone(rest);
      if (parsed.phone) {
        const to = parsed.phone;
        const message = parsed.rest || 'Test mesajı ✅';
        await sendMessage(token, chatId, `📢 <b>${esc(to)}</b> numarasına tüm WhatsApp'lı cihazlardan test gönderiliyor…\n<i>Mesaj:</i> ${esc(message.slice(0, 80))}`);
        const report = await broadcastTestMessage(workspaceId, to, message);
        await sendMessage(token, chatId, report, MAIN_MENU);
      } else {
        // Numara verilmedi → interaktif akış: önce numara sor.
        state.mode = 'awaiting_broadcast_number';
        await sendMessage(token, chatId, '📢 <b>Toplu Test Mesajı</b>\nMesaj <b>TÜM WhatsApp\'lı cihazlardan</b> gönderilecek.\nÖnce hedef <b>numarayı</b> yazın (ülke kodu ile, örn. 905551112233):');
      }
    }
    // ★2026-07-29: ÇIPLAK komut da kabul edilmeli. Telegram'ın "/" menüsünden bir
    // komuta dokunulduğunda bota ARGÜMANSIZ hâli gider ("/profilisim"). Eskiden koşul
    // yalnızca boşluklu biçimi (`'/profilisim '`) kabul ettiği için çıplak hâl hiçbir
    // dala düşmüyor ve operatöre "Anlamadım." deniyordu — yani komuta basmak BOZUKTU
    // ve altındaki kullanım örneği hiç görünmüyordu. Artık argümansız çağrı da bu dala
    // girer ve aşağıdaki `parts.length < 2` kontrolü kullanım metnini gösterir.
    // (Aynı hata /sil, /etiket, /adver'de de vardı; hepsi düzeltildi.)
  } else if (isCmd(lower, 'profilisim')) {
    // "/profilisim <cihaz> <yeni-ad>" — WhatsApp profil ismini değiştir.
    const rest = cmd.replace(/^\/?profil[iİ]sim\s*/i, '').trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    // ★2026-07-30 ADIM ADIM: argüman YOKSA cihaz listesi gösterilir, sonra ad sorulur.
    // Eskiden yalnızca kullanım metni ("/profilisim <cihaz> <ad>") basılıyordu ve
    // operatörün cihaz adını/kimliğini elle yazması gerekiyordu. Tek satırlık biçim
    // ÇALIŞMAYA DEVAM EDER (hızlı yol) — yalnızca eksik argümanda akış devralır.
    if (parts.length === 0) {
      const buttons = await devicePickerButtons(workspaceId, 'namepick', undefined, true);
      await sendMessage(token, chatId, '📝 <b>WA Profil İsmi</b>\nHangi cihazın WhatsApp profil ismini değiştirmek istiyorsunuz?', buttons);
      return;
    }
    if (parts.length === 1) {
      // Cihaz verilmiş ama ad yok → cihazı doğrula, sonra adı SOR.
      const only = await findDeviceByRef(workspaceId, parts[0]!);
      if (!only) { await sendMessage(token, chatId, `❌ Cihaz bulunamadı: <b>${esc(parts[0]!)}</b>`, MAIN_MENU); return; }
      state.mode = 'awaiting_profile_name';
      state.targetDeviceId = only.id;
      state.targetDeviceName = only.name;
      await sendMessage(token, chatId, `📝 <b>${esc(only.name)}</b> için yeni <b>WhatsApp profil ismini</b> yazın (en fazla 25 karakter):`);
      return;
    }
    const ref = parts[0]!;
    const newName = parts.slice(1).join(' ').slice(0, 25);
    const dev = await findDeviceByRef(workspaceId, ref);
    if (!dev) { await sendMessage(token, chatId, `❌ Cihaz bulunamadı: <b>${esc(ref)}</b>`, MAIN_MENU); return; }
    try {
      await batchService.setProfileName(workspaceId, { deviceId: dev.id, name: newName });
      await sendMessage(token, chatId, `📝 <b>${esc(dev.name)}</b> profil ismi <b>${esc(newName)}</b> olarak değiştiriliyor…\n<i>(Cihaz WhatsApp ayarlarını açar, ~30 sn.)</i>`, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Değiştirilemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (lower.startsWith('/profilresim ') || lower.startsWith('profilresim ') || lower === '/profilresim') {
    // "/profilresim <cihaz>" → sonraki fotoğrafı bu cihazın profiline uygula.
    const ref = cmd.replace(/^\/?profilresim\s*/i, '').trim();
    if (!ref) { await sendMessage(token, chatId, 'ℹ️ Kullanım: <code>/profilresim &lt;cihaz&gt;</code>\nSonra bir fotoğraf gönderin.', MAIN_MENU); return; }
    const dev = await findDeviceByRef(workspaceId, ref);
    if (!dev) { await sendMessage(token, chatId, `❌ Cihaz bulunamadı: <b>${esc(ref)}</b>`, MAIN_MENU); return; }
    state.mode = 'awaiting_profile_photo';
    state.profileDeviceId = dev.id;
    state.profileDeviceName = dev.name;
    await sendMessage(token, chatId, `🖼 <b>${esc(dev.name)}</b> için <b>şimdi bir fotoğraf gönderin</b>.\n<i>(Gönderdiğiniz resim WhatsApp profil resmi olarak ayarlanacak.)</i>`);
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
  } else if (lower === '/tani' || lower === 'tani' || lower === '/teshis' || lower === '/diag') {
    // ★2026-07-29: operatör dışarıdayken "neyin bozuk olduğunu" SSH'sız görebilsin.
    await sendMessage(token, chatId, await renderDiagnostics(workspaceId), OPS_MENU);
  } else if (lower === '/proxy' || lower === 'proxy') {
    await sendMessage(token, chatId, await renderProxyStatus(workspaceId), OPS_MENU);
  } else if (lower === '/kurtar' || lower === 'kurtar' || lower === '/onar') {
    // Uzun sürebilir → önce "başladı" de, sonra sonucu gönder (Telegram 60sn timeout).
    await sendMessage(token, chatId, '🔧 Kurtarma başlatıldı, kontrol ediliyor…');
    await sendMessage(token, chatId, await runRecovery(workspaceId), OPS_MENU);
  } else if (lower === '/acil' || lower === 'acil' || lower === '/emergency') {
    await sendMessage(token, chatId, renderEmergencyHelp(), OPS_MENU);
  } else if (lower === '/ozet' || lower === 'ozet' || lower === '/rapor') {
    await sendMessage(token, chatId, await renderDailyDigest(workspaceId), OPS_MENU);
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
  // ── Grup 1: Acil müdahale ──────────────────────────────────────────────────
  } else if (lower === '/bakiye' || lower === 'bakiye' || lower === '/kota') {
    // Proxy kotasi bitince cihaz datacenter-IP'ye duser (ban riski) — anlik bakiye.
    const svc = new ProxyService();
    const accounts: Array<{ label: string; token: string }> = [
      { label: 'residential', token: process.env.FLEET_THORDATA_TOKEN || '' },
      { label: 'mobile', token: process.env.FLEET_THORDATA_TOKEN_MOBILE || '' }
    ].filter((a) => a.token);
    if (!accounts.length) {
      await sendMessage(token, chatId, '⚠️ Proxy bakiyesi sorgulanamıyor: <code>FLEET_THORDATA_TOKEN</code> tanımlı değil.', MAIN_MENU);
      return;
    }
    const lines: string[] = ['💳 <b>Proxy bakiyesi (thordata)</b>', ''];
    for (const acc of accounts) {
      const bal = await svc.fetchThordataBalance(acc.token).catch(() => null);
      if (!bal) { lines.push(`• ${esc(acc.label)}: <i>sorgulanamadı</i>`); continue; }
      const gb = bal.balanceMb / 1024;
      const mark = gb < 2 ? '🔴' : gb < 5 ? '🟡' : '🟢';
      lines.push(`${mark} <b>${esc(acc.label)}</b>: ${gb.toFixed(2)} GB — son kullanma ${esc(bal.expiration)}`);
    }
    lines.push('', '<i>2 GB altına düşünce otomatik uyarı gelir.</i>');
    await sendMessage(token, chatId, lines.join(String.fromCharCode(10)), MAIN_MENU);
  } else if (lower === '/saglik' || lower === 'saglik' || lower === '/sağlık' || lower === '/health') {
    await sendMessage(token, chatId, await renderFleetHealth(workspaceId), MAIN_MENU);
  } else if (lower === '/uyandir' || lower.startsWith('/uyandir ') || lower.startsWith('uyandir ')) {
    const ref = cmd.replace(/^\/?uyandir\s*/i, '').trim();
    if (!ref) { await sendMessage(token, chatId, 'ℹ️ Kullanım: <code>/uyandir &lt;cihaz&gt;</code> (isim / numara).', MAIN_MENU); return; }
    const dev = await findDeviceByRef(workspaceId, ref);
    if (!dev) { await sendMessage(token, chatId, `❌ Cihaz bulunamadı: <b>${esc(ref)}</b>`, MAIN_MENU); return; }
    try {
      await deviceService.wake(dev.id, workspaceId);
      await sendMessage(token, chatId, `🔆 <b>${esc(dev.name)}</b> uyandırılıyor… (ADB yeniden bağlanacak, ~1 dk).`, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Uyandırılamadı: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (lower === '/reboot' || lower.startsWith('/reboot ') || lower.startsWith('reboot ')) {
    const ref = cmd.replace(/^\/?reboot\s*/i, '').trim();
    if (!ref) { await sendMessage(token, chatId, 'ℹ️ Kullanım: <code>/reboot &lt;cihaz&gt;</code>.', MAIN_MENU); return; }
    const dev = await findDeviceByRef(workspaceId, ref);
    if (!dev) { await sendMessage(token, chatId, `❌ Cihaz bulunamadı: <b>${esc(ref)}</b>`, MAIN_MENU); return; }
    try {
      await deviceService.reboot(dev.id, workspaceId);
      await sendMessage(token, chatId, `♻️ <b>${esc(dev.name)}</b> yeniden başlatılıyor (kapat→aç, ~2 dk).`, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Reboot başarısız: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (lower === '/reconnect' || lower === 'reconnect' || lower === '/kurtar') {
    // ADB kopması agent'ta OTONOM kurtarılıyor (adbRecoveryTick: instance-up ama
    // ADB-erişilemez → adb server bounce + reconnect). Buradan MANUEL tetiklemek için
    // OFFLINE cihazlara wake atıyoruz (wake ADB-connect'i de yapar). Zaten-ONLINE
    // cihazlara dokunmayız (gereksiz reboot riski).
    const devices = await deviceService.listDevices(workspaceId);
    const offline = devices.filter((d) => d.status === 'OFFLINE' || d.status === 'ERROR');
    if (!offline.length) {
      await sendMessage(token, chatId, '✅ Tüm cihazlar ONLINE — kurtarılacak offline cihaz yok. (ADB otomatik kurtarma zaten host\'ta çalışıyor.)', MAIN_MENU);
      return;
    }
    let woken = 0; const failed: string[] = [];
    for (const d of offline.slice(0, 20)) {
      try { await deviceService.wake(d.id, workspaceId); woken++; }
      catch { failed.push(d.name); }
    }
    const tail = failed.length ? `\n⚠️ Uyandırılamayan: ${failed.map(esc).join(', ')}` : '';
    await sendMessage(token, chatId, `🔧 <b>ADB kurtarma</b>\n${woken} offline cihaza uyandırma gönderildi (ADB yeniden bağlanacak).${tail}`, MAIN_MENU);
  // ── Grup 2: Cihaz yönetimi ─────────────────────────────────────────────────
  } else if (isCmd(lower, 'etiket')) {
    // "/etiket <cihaz> #test" veya "/etiket <cihaz> test" — mevcut tag'lere ekler.
    // (Çıplak "/etiket" de buraya düşer → aşağıdaki kontrol kullanımı gösterir.)
    const rest = cmd.replace(/^\/?etiket\s*/i, '').trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    // ★2026-07-30 ADIM ADIM: argüman yoksa cihaz seçtir, sonra etiketi sor.
    if (parts.length === 0) {
      const buttons = await devicePickerButtons(workspaceId, 'tagpick');
      await sendMessage(token, chatId, '🏷 <b>Etiket Ekle</b>\nHangi cihaza etiket eklemek istiyorsunuz?', buttons);
      return;
    }
    if (parts.length === 1) {
      const only = await findDeviceByRef(workspaceId, parts[0]!);
      if (!only) { await sendMessage(token, chatId, `❌ Cihaz bulunamadı: <b>${esc(parts[0]!)}</b>`, MAIN_MENU); return; }
      state.mode = 'awaiting_tag';
      state.targetDeviceId = only.id;
      state.targetDeviceName = only.name;
      await sendMessage(token, chatId, `🏷 <b>${esc(only.name)}</b> için etiket(ler) yazın.\n<i>Birden fazlaysa virgülle ayırın — örn. <code>satis, tr, yedek</code></i>`);
      return;
    }
    const ref = parts[0]!;
    const tags = parts.slice(1).map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean);
    const dev = await findDeviceByRef(workspaceId, ref);
    if (!dev) { await sendMessage(token, chatId, `❌ Cihaz bulunamadı: <b>${esc(ref)}</b>`, MAIN_MENU); return; }
    try {
      const cur = await prisma.device.findFirst({ where: { id: dev.id }, select: { tags: true } });
      const merged = [...new Set([...(cur?.tags ?? []), ...tags])];
      await deviceService.updateDevice(dev.id, { tags: merged }, workspaceId);
      await sendMessage(token, chatId, `🏷 <b>${esc(dev.name)}</b> etiketleri: ${merged.map((t) => `<code>#${esc(t)}</code>`).join(' ')}`, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Etiket eklenemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (isCmd(lower, 'adver', 'yenidad')) {
    // "/adver <cihaz> <yeni-ad>" — cihazı yeniden adlandır.
    const rest = cmd.replace(/^\/?(adver|yenidad)\s*/i, '').trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    if (parts.length < 2) { await sendMessage(token, chatId, 'ℹ️ Kullanım: <code>/adver &lt;cihaz&gt; &lt;yeni-ad&gt;</code>.', MAIN_MENU); return; }
    const ref = parts[0]!;
    const newName = parts.slice(1).join(' ').slice(0, 60);
    const dev = await findDeviceByRef(workspaceId, ref);
    if (!dev) { await sendMessage(token, chatId, `❌ Cihaz bulunamadı: <b>${esc(ref)}</b>`, MAIN_MENU); return; }
    try {
      await deviceService.updateDevice(dev.id, { name: newName }, workspaceId);
      await sendMessage(token, chatId, `✏️ <b>${esc(dev.name)}</b> → <b>${esc(newName)}</b> olarak yeniden adlandırıldı.`, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Yeniden adlandırılamadı: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (isCmd(lower, 'kur')) {
    // "/kur <adet> [TR]" — toplu tek-tık cihaz kur (opsiyonel proxy ülkesi).
    const rest = cmd.replace(/^\/?kur\s*/i, '').trim();
    // ★2026-07-29: girdi SESSİZCE yorumlanmamalı. Eski hâlde:
    //   • argümansız "/kur" → sessizce 1 cihaz kurardı (operatör kurulum istememişti,
    //     sadece komuta basmıştı!) — gerçek para/gerçek filo sonucu.
    //   • "/kur 100" → regex yalnızca "10"u yakalar, 20'ye kırpar ve HİÇBİR uyarı
    //     vermeden 20 cihaz kurardı.
    // Artık: argümansızsa kullanım metni, geçersiz/aşan sayıda açık uyarı.
    // ★2026-07-30 ADIM ADIM: argümansız /kur artık ÜLKE SEÇTİRİYOR, sonra adet soruyor.
    // Eskiden yalnızca kullanım metni basıyordu (operatör "3 TR" yazmak zorundaydı).
    // ⚠️ Argümansız çağrı HÂLÂ kurulum BAŞLATMIYOR — iki adım da onay niteliğinde;
    // 29 Tem'deki "komuta basmak sessizce cihaz kurdu" hatası tekrarlamaz.
    if (!rest) {
      await sendMessage(
        token,
        chatId,
        '🛠 <b>Cihaz Kur</b>\nHangi <b>ülke</b> proxy\'si ile kurulsun?\n<i>Her cihaz o ülkeden benzersiz bir çıkış IP alır.</i>',
        [
          [
            { text: '🇹🇷 TR', callback_data: 'kurcc:TR' },
            { text: '🇦🇱 AL', callback_data: 'kurcc:AL' },
            { text: '🇺🇸 US', callback_data: 'kurcc:US' }
          ],
          [
            { text: '🇩🇪 DE', callback_data: 'kurcc:DE' },
            { text: '🇬🇧 GB', callback_data: 'kurcc:GB' },
            { text: '🇳🇱 NL', callback_data: 'kurcc:NL' }
          ]
        ]
      );
      return;
    }
    const m = /^(\d{1,3})(?:\s+([a-zA-Z]{2}))?\s*$/.exec(rest);
    if (!m) {
      await sendMessage(token, chatId, `❌ Anlaşılmadı: <code>${esc(rest)}</code>\nℹ️ Kullanım: <code>/kur &lt;adet&gt; [ülke]</code> — örn: <code>/kur 3 TR</code>`, MAIN_MENU);
      return;
    }
    const asked = parseInt(m[1]!, 10);
    const count = Math.max(1, Math.min(20, asked));
    if (asked !== count) {
      await sendMessage(token, chatId, `⚠️ Tek seferde en fazla <b>20</b> cihaz kurulabilir — <b>${asked}</b> yerine <b>${count}</b> kuruluyor.`);
    }
    const country = m[2] ? m[2].toUpperCase() : undefined;
    try {
      const res = await provisionService.createBatch(
        { count, ...(country ? { proxyCountry: country } : {}) },
        workspaceId
      );
      const ok = res.started.length;
      const fail = res.failed.length;
      const names = res.started.map((s) => `• <b>${esc(s.name)}</b>`).join('\n');
      const tail = fail ? `\n⚠️ ${fail} başarısız: ${esc(res.failed[0]?.error ?? '')}` : '';
      await sendMessage(token, chatId, `🚀 <b>Toplu Kurulum başladı</b> (${ok}/${res.total})${country ? ` · proxy ${esc(country)}` : ''}\n${names}${tail}\n\n<i>Durum için /cihazlar veya /saglik.</i>`, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Kurulum başlatılamadı: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (isCmd(lower, 'adver')) {
    // ★2026-07-30 /adver KOMUTU HİÇ YOKTU — menüde ve yardımda listeleniyordu ama
    // dispatcher'da bir dalı olmadığı için "Anlamadım." diyordu (sessiz kırık komut).
    // Şimdi hem tek satırlık biçim ("/adver <cihaz> <yeni-ad>") hem ADIM ADIM çalışır.
    const rest = cmd.replace(/^\/?adver\s*/i, '').trim();
    const parts = rest.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      const buttons = await devicePickerButtons(workspaceId, 'renamepick');
      await sendMessage(token, chatId, '✏️ <b>Cihaz Adını Değiştir</b>\nHangi cihazın adını değiştirmek istiyorsunuz?', buttons);
      return;
    }
    const dev0 = await findDeviceByRef(workspaceId, parts[0]!);
    if (!dev0) { await sendMessage(token, chatId, `❌ Cihaz bulunamadı: <b>${esc(parts[0]!)}</b>`, MAIN_MENU); return; }
    if (parts.length === 1) {
      state.mode = 'awaiting_rename';
      state.targetDeviceId = dev0.id;
      state.targetDeviceName = dev0.name;
      await sendMessage(token, chatId, `✏️ <b>${esc(dev0.name)}</b> için yeni <b>cihaz adını</b> yazın:`);
      return;
    }
    const newDevName = parts.slice(1).join(' ').slice(0, 40);
    try {
      await deviceService.updateDevice(dev0.id, { name: newDevName }, workspaceId);
      await sendMessage(token, chatId, `✏️ Cihaz adı değişti: <b>${esc(dev0.name)}</b> → <b>${esc(newDevName)}</b>`, MAIN_MENU);
    } catch (e) {
      await sendMessage(token, chatId, `❌ Ad değiştirilemedi: ${esc(e instanceof Error ? e.message : 'hata')}`, MAIN_MENU);
    }
  } else if (isCmd(lower, 'sil')) {
    // "/sil <cihaz>" — cihazı sil (host instance'ı da durdurulur). Korumalıysa reddedilir.
    const ref = cmd.replace(/^\/?sil\s*/i, '').trim();
    if (!ref) { await sendMessage(token, chatId, 'ℹ️ Kullanım: <code>/sil &lt;cihaz&gt;</code>.', MAIN_MENU); return; }
    const dev = await findDeviceByRef(workspaceId, ref);
    if (!dev) { await sendMessage(token, chatId, `❌ Cihaz bulunamadı: <b>${esc(ref)}</b>`, MAIN_MENU); return; }
    try {
      await deviceService.deleteDevice(dev.id, workspaceId);
      await sendMessage(token, chatId, `🗑 <b>${esc(dev.name)}</b> silindi (host instance durduruluyor).`, MAIN_MENU);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'hata';
      await sendMessage(token, chatId, `❌ Silinemedi: ${esc(msg)}${/protected|korumal/i.test(msg) ? '\n🔒 Cihaz korumalı — önce panelden korumayı kaldırın.' : ''}`, MAIN_MENU);
    }
  // ── Grup 3: WA hesap-sağlık ────────────────────────────────────────────────
  } else if (lower === '/hesaplar' || lower === 'hesaplar' || lower === '/accounts') {
    await sendMessage(token, chatId, await renderWaAccounts(workspaceId), MAIN_MENU);
  } else if (lower === '/banlar' || lower === 'banlar' || lower === '/bans') {
    await sendMessage(token, chatId, await renderBanWave(workspaceId), MAIN_MENU);
  } else if (lower === '/kayit' || lower.startsWith('/kayit ') || lower === '/kayıt') {
    // ★2026-07-30: sabit yönlendirme metni yerine GERÇEK durum — yarım kalan kayıtlar
    // ve kalan bekletme süreleri. Kaydın kendisi hâlâ panelden başlatılır (ban-riski
    // hassas, çok adımlı), ama "ne durumda, ne kadar bekleyeceğim" sorusu buradan
    // yanıtlanıyor; operatör dışarıdayken en çok bunu soruyor.
    await sendMessage(token, chatId, await renderPendingRegistrations(workspaceId), MAIN_MENU);
  // ── Grup 4: Root-DB okuma ──────────────────────────────────────────────────
  } else if (lower === '/okunmamis-tum' || lower === '/okunmamistum' || lower === '/tumokunmamis') {
    await sendMessage(token, chatId, await renderAllUnread(workspaceId), MAIN_MENU);
  } else if (lower === '/kisiler' || lower === 'kisiler' || lower === '/contacts' || lower === '/kişiler') {
    await sendMessage(token, chatId, await renderContacts(workspaceId), MAIN_MENU);
  } else if (lower === '/sonmesajlar' || lower === 'sonmesajlar' || lower === '/gelen' || lower === '/medya') {
    await sendMessage(token, chatId, await renderRecentInbound(workspaceId), MAIN_MENU);
  } else if (lower === '/help' || lower === 'yardim' || lower === '/yardim') {
    await sendMessage(token, chatId, menuText(), MAIN_MENU);
  } else {
    // Quick-send shorthand: "/gonder 905551112233 Merhaba"
    // ★2026-07-29: /testmesaj ile AYNI açgözlü-regex bug'ı buradaydı — boşluklu
    // numarada mesaj metni numaraya karışıyordu. splitLeadingPhone ile ayrıştırılıyor.
    const gonderRest = /^\/?gonder\s+([\s\S]+)$/i.exec(cmd)?.[1]?.trim() ?? '';
    const gp = gonderRest ? splitLeadingPhone(gonderRest) : { phone: null, rest: '' };
    if (gp.phone && gp.rest) {
      const to = gp.phone;
      const message = gp.rest;
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
  } else if (data === 'broadcast') {
    // Toplu test-mesajı: numara sor → TÜM WA cihazlardan gönder.
    if (!(await hasAnyWhatsappDevice(workspaceId))) {
      await sendMessage(token, chatId, '⚠️ Bu çalışma alanında <b>WhatsApp hesabı olan</b> cihaz yok.', MAIN_MENU);
    } else {
      state.mode = 'awaiting_broadcast_number';
      await sendMessage(token, chatId, '📢 <b>Toplu Test Mesajı</b>\nMesaj <b>TÜM WhatsApp\'lı cihazlardan</b> gönderilecek.\nÖnce hedef <b>numarayı</b> yazın (ülke kodu ile, örn. 905551112233):');
    }
  } else if (data === 'health') {
    await sendMessage(token, chatId, await renderFleetHealth(workspaceId), OPS_MENU);
  } else if (data === 'ops:diag') {
    await sendMessage(token, chatId, await renderDiagnostics(workspaceId), OPS_MENU);
  } else if (data === 'ops:proxy') {
    await sendMessage(token, chatId, await renderProxyStatus(workspaceId), OPS_MENU);
  } else if (data === 'ops:fix') {
    // Kritik alarm mesajlarındaki "🔧 Kurtarmayı başlat" butonu da buraya düşer.
    await sendMessage(token, chatId, '🔧 Kurtarma başlatıldı, kontrol ediliyor…');
    await sendMessage(token, chatId, await runRecovery(workspaceId), OPS_MENU);
  } else if (data === 'ops:digest') {
    await sendMessage(token, chatId, await renderDailyDigest(workspaceId), OPS_MENU);
  } else if (data === 'ops:emergency') {
    await sendMessage(token, chatId, renderEmergencyHelp(), OPS_MENU);
  } else if (data === 'menu') {
    await sendMessage(token, chatId, menuText(), MAIN_MENU);
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
  // ★2026-07-30 ADIM ADIM cihaz seçicileri. Cihaz butona basılarak seçilir, sonra
  // ilgili değer SORULUR — operatör cihaz adını/kimliğini elle yazmak zorunda kalmaz.
  } else if (data.startsWith('namepick:')) {
    const deviceId = data.slice('namepick:'.length);
    const dev = await deviceService.getDevice(deviceId, workspaceId).catch(() => null);
    state.mode = 'awaiting_profile_name';
    state.targetDeviceId = deviceId;
    state.targetDeviceName = dev?.name ?? deviceId;
    await sendMessage(token, chatId, `📝 <b>${esc(state.targetDeviceName)}</b> için yeni <b>WhatsApp profil ismini</b> yazın (en fazla 25 karakter):`);
  } else if (data.startsWith('tagpick:')) {
    const deviceId = data.slice('tagpick:'.length);
    const dev = await deviceService.getDevice(deviceId, workspaceId).catch(() => null);
    state.mode = 'awaiting_tag';
    state.targetDeviceId = deviceId;
    state.targetDeviceName = dev?.name ?? deviceId;
    await sendMessage(token, chatId, `🏷 <b>${esc(state.targetDeviceName)}</b> için etiket(ler) yazın.\n<i>Birden fazlaysa virgülle ayırın — örn. <code>satis, tr, yedek</code></i>`);
  } else if (data.startsWith('renamepick:')) {
    const deviceId = data.slice('renamepick:'.length);
    const dev = await deviceService.getDevice(deviceId, workspaceId).catch(() => null);
    state.mode = 'awaiting_rename';
    state.targetDeviceId = deviceId;
    state.targetDeviceName = dev?.name ?? deviceId;
    await sendMessage(token, chatId, `✏️ <b>${esc(state.targetDeviceName)}</b> için yeni <b>cihaz adını</b> yazın:`);
  } else if (data.startsWith('kurcc:')) {
    // /kur akışı: ülke seçildi → adet sorulur.
    const cc = data.slice('kurcc:'.length).toUpperCase().slice(0, 2);
    state.mode = 'awaiting_provision_count';
    state.provisionCountry = cc;
    await sendMessage(token, chatId, `🛠 <b>${esc(cc)}</b> için <b>kaç cihaz</b> kurulsun? (1-20)\n<i>Her cihaz kendi benzersiz kimliği ve ${esc(cc)} çıkış IP'siyle kurulur.</i>`);
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
      // ★2026-07-29: eskiden hata yutulup KOŞULSUZ "Okundu işaretlendi" deniyordu —
      // yazma başarısızken operatöre başarı bildiren YALAN bir onaydı. Artık sonuca
      // göre cevap veriliyor.
      const ok = await whatsappService
        .markRead(workspaceId, { deviceId: m.deviceId, peer: m.peer })
        .then(() => true)
        .catch(() => false);
      await answerCallback(token, cb.id, ok ? 'Okundu işaretlendi' : '⚠️ İşaretlenemedi, tekrar deneyin');
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
    // ★2026-07-29 SESSİZ BOT KAYBI: burada iki ayrı sessiz eleme vardı —
    //   (a) `catch { /* skip malformed */ }`: configEnc çözülemezse (şifreleme
    //       anahtarı değişmiş, kayıt bozulmuş) bot listeden düşüyordu,
    //   (b) `if (botToken && chatIds.length && workspaceId)`: eksik alan varsa
    //       kayıt sessizce atlanıyordu.
    // Her iki durumda da bot KALICI olarak cevap vermeyi bırakıyor, LOG BİLE
    // yazılmıyordu. Operatör "bot ölmüş" diyor, sunucuda hiçbir iz yok — teşhisi
    // neredeyse imkânsız. Artık her eleme sebebiyle birlikte loglanıyor.
    try {
      const cfg = JSON.parse(decryptString(row.configEnc)) as { botToken?: string; chatId?: string };
      const chatIds = String(cfg.chatId ?? '')
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!row.workspaceId) {
        logger.warn('tg bot atlandi: kanalin workspace bagi yok', { channelId: row.id });
        continue;
      }
      if (!cfg.botToken) {
        logger.warn('tg bot atlandi: botToken bos', { channelId: row.id, workspaceId: row.workspaceId });
        continue;
      }
      if (!chatIds.length) {
        logger.warn('tg bot atlandi: kayitli chatId yok (bota kimse komut veremez)', {
          channelId: row.id,
          workspaceId: row.workspaceId
        });
        continue;
      }
      bots.push({ workspaceId: row.workspaceId, token: cfg.botToken, chatIds });
    } catch (e) {
      // En kritik hâli: şifre çözme/JSON hatası → bot kalıcı olarak susar.
      logger.error('tg bot yapilandirmasi OKUNAMADI — bot devre disi', {
        channelId: row.id,
        workspaceId: row.workspaceId,
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }
  // Kanal tanımlı ama HİÇBİRİ kullanılabilir değilse bunu da söyle: "bot cevap
  // vermiyor" şikâyetinin kaynağı çoğu zaman burasıdır.
  if (rows.length && !bots.length) {
    logger.error('tg: telegram kanali tanimli ama calisan bot YOK (yukaridaki sebeplere bakin)', {
      channels: rows.length
    });
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
      // Fotoğraf/dosya mesajı — /profilresim akışında profil resmi olarak uygula.
      if ((u.message?.photo?.length || u.message?.document) && u.message.chat) {
        const chatId = String(u.message.chat.id);
        if (!allowed.has(chatId)) { continue; }
        await handlePhotoMessage(bot.token, bot.workspaceId, chatId, state, u.message);
      } else if (u.message?.text && u.message.chat) {
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
      // ★2026-07-29 SESSİZ ÇÖKÜŞ SONA ERDİ. Eskiden burada sadece log yazılıyordu:
      // bir komut/buton işlenirken hata olursa operatöre HİÇBİR ŞEY dönmüyordu —
      // dokunuyor, hiçbir şey olmuyordu. ("komuta basıyorum bir şey olmuyor")
      // Artık hata operatöre de bildiriliyor; en azından "bir şey ters gitti,
      // tekrar dene" görsün ve komutun çalışmadığını anlasın.
      logger.warn('tg update handling failed', { error: String(e) });
      const errChatId = u.message?.chat?.id ?? u.callback_query?.message?.chat?.id ?? u.callback_query?.from?.id;
      if (errChatId != null) {
        const msg = e instanceof Error ? e.message : String(e);
        await sendMessage(
          bot.token,
          String(errChatId),
          `⚠️ İşlem tamamlanamadı.\n<code>${esc(msg.slice(0, 200))}</code>\n\n<i>Tekrar deneyin; sürerse</i> <b>/tani</b> <i>ile sistemi kontrol edin.</i>`,
          MAIN_MENU
        ).catch(() => undefined);
      }
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
