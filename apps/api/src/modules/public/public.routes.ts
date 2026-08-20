import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { requireApiKey } from '../../middleware/requireApiKey';
import { apiRateLimiter, heavyOperationRateLimiter } from '../../middleware/rateLimit';
import { requireWhatsappAccount } from './public.middleware';
import { serveMediaPublicHandler } from './public.controller';
import { listDevicesHandler, getDeviceHandler, deviceTagsHandler, deviceRenameHandler, sendHandler, bulkSendHandler, messagesHandler, conversationsHandler, threadHandler, markReadHandler, statsHandler, broadcastHandler, labelsHandler, createLabelHandler, setLabelsHandler, stateHandler, profileHandler, setNameHandler, setAvatarHandler, blockHandler, blocklistHandler, myNumberHandler, sendMediaHandler, deleteMessageHandler, clearChatHandler, receiptsHandler, mediaHandler, callsHandler, searchHandler, unreadHandler, contactsHandler, groupMembersHandler, chatSummaryHandler, accountHealthHandler, fetchMediaHandler, reactionsHandler, pollsHandler, readByHandler, starredHandler, labelsListHandler, viewOnceHandler, voiceNotesHandler, deletedHandler, linksHandler, provisionDeviceHandler, provisionBatchHandler, provisionStatusHandler, registerWhatsappHandler, registerWhatsappOtpHandler, registerWhatsappVerifyMethodHandler, registerWhatsappStatusHandler, registerWhatsappRetryHandler, jobHandler, jobWaitHandler, meHandler } from './public.controller';

// External/public WhatsApp API. Authenticated by `x-api-key` ONLY (a workspace-
// bound flk_ key minted in /admin/api-keys) — NO JWT. The workspace is resolved
// from the key; requirePublicWorkspace (in the handlers) refuses any key that has
// no workspace so this can never leak across tenants.
//
// ★2026-07-29 — KATEGORİLİ YOLLAR. Yüzey 52 ucun düz listesiydi; hangi ucun hangi
// cihazda anlamlı olduğu görünmüyordu. Artık uçlar kategorilere ayrıldı
// (send / chats / contacts / account / data) ve her uç, gerektirdiği cihaz durumunu
// bir guard ile ilan ediyor (devices/whatsappCategory.ts'teki tek karar tablosu).
//
// ⚠️ ESKİ YOLLAR KIRILMADI: her uç `mount()` ile hem yeni hem eski yola bağlanır,
// ikisi de AYNI handler'a ve AYNI guard'a gider. Dışarıdaki entegrasyonların
// değişmesi gerekmez; eski yollar dokümanlarda "legacy" olarak işaretlidir.
export const publicRouter = Router();

publicRouter.use(requireApiKey);

type Method = 'get' | 'post';
type MountOpts = {
  // Eski (legacy) yol — verilirse aynı handler'a ikinci kez bağlanır.
  alias?: string;
  // Sıralı ön-middleware (rate limit + WhatsApp guard).
  use?: RequestHandler[];
};

// Tek tanım → iki yol. Handler ve guard zinciri tek yerde kalır, alias otomatik
// bağlanır; böylece bir uç güncellendiğinde eski yolun geride kalması imkânsız.
function mount(method: Method, path: string, handler: RequestHandler, opts: MountOpts = {}): void {
  const chain = [...(opts.use ?? []), handler];
  publicRouter[method](path, ...chain);
  if (opts.alias) publicRouter[method](opts.alias, ...chain);
}

// Guard kısayolları. `send` = gönderim (ölü/boş hesapta 409), `read` = okuma
// (banlı hesapta ÇALIŞIR + accountWarning), `register` = kayıt.
const send = requireWhatsappAccount('send');
const read = requireWhatsappAccount('read');
const register = requireWhatsappAccount('register');

// ─────────────────────────────────────────────────────────────────────────────
// 1) Hesap & Cihazlar — her cihazda çalışır, WhatsApp durumu aranmaz.
// ─────────────────────────────────────────────────────────────────────────────
// ★2026-08-19 Yakalanan WhatsApp medyasini INDIR (dis entegrasyon).
// Webhook yukundeki `mediaUrl` bu ucu gosterir. `fetch-media`den FARKLI:
//   • /v1/whatsapp/fetch-media -> cihazdan ceker, IS olusturur (jobId doner)
//   • bu uc                    -> sunucuda ZATEN saklanan dosyayi ANINDA verir
// Workspace API anahtarindan cozulur; baska kiracinin dosyasi 404.
mount('get', '/v1/whatsapp/media/:deviceId/:file', asyncHandler(serveMediaPublicHandler));
mount('get', '/v1/me', asyncHandler(meHandler));
mount('get', '/v1/devices', asyncHandler(listDevicesHandler));
// Add / remove / replace a device's tags (e.g. "#test") — write scope, rate-limited.
mount('post', '/v1/devices/:id/tags', asyncHandler(deviceTagsHandler), { use: [apiRateLimiter] });
// Rename a device (cosmetic label only) — write scope, rate-limited.
mount('post', '/v1/devices/:id/rename', asyncHandler(deviceRenameHandler), { use: [apiRateLimiter] });

// ─────────────────────────────────────────────────────────────────────────────
// 2) Kurulum & Kayıt — boş cihazın (category=empty) tek girişi.
//    ⚠️ Express sırası: '/v1/devices/provision*' yolları '/v1/devices/:id'den ÖNCE
//    tanımlanmalı, aksi halde ':id' onları yutar.
// ─────────────────────────────────────────────────────────────────────────────
mount('post', '/v1/devices/provision', asyncHandler(provisionDeviceHandler), { use: [heavyOperationRateLimiter] });
// Batch one-click provision (1–20 devices, adet + isim öneki + proxy ülkesi).
mount('post', '/v1/devices/provision/batch', asyncHandler(provisionBatchHandler), { use: [heavyOperationRateLimiter] });
// Live step-by-step provision progress (same data the dashboard modal shows).
mount('get', '/v1/devices/provision/:jobId/status', asyncHandler(provisionStatusHandler));
mount('post', '/v1/whatsapp/register', asyncHandler(registerWhatsappHandler), { use: [heavyOperationRateLimiter, register] });
mount('post', '/v1/whatsapp/register/:id/otp', asyncHandler(registerWhatsappOtpHandler), { use: [apiRateLimiter] });
// Operator picks SMS/voice/missed-call when registration parks on the method sheet.
mount('post', '/v1/whatsapp/register/:id/verify-method', asyncHandler(registerWhatsappVerifyMethodHandler), { use: [apiRateLimiter] });
mount('get', '/v1/whatsapp/register/:id/status', asyncHandler(registerWhatsappStatusHandler));
// ★2026-07-30 Tekrar dene: AYNI hesap satırıyla, çıkış IP'si yenilenerek. Cihazı
// sürdüğü için ağır-limit; bekleme cezası dolmadan çağrılırsa 409 WAIT_IN_PROGRESS,
// kesin ban'da 409 NUMBER_BANNED döner.
// ⚠️ `register` guard'ı BİLEREK YOK: o guard `category==='registering'` cihazda 409
// verir, oysa bu uç tam olarak takılı/başarısız bir kaydı kurtarmak için var (hesap
// AWAITING_OTP → kategori 'registering'). Guard eklenirse uç kendi amacını bloke eder.
// Yetki/kapsam kontrolü handler'da: hesap workspace'e ait mi + cihaz hazır mı
// (assertDeviceReady) + kesin ban mı — üçü de retryWhatsappRegister içinde.
mount('post', '/v1/whatsapp/register/:id/retry', asyncHandler(registerWhatsappRetryHandler), { use: [heavyOperationRateLimiter] });

// Tek cihaz + yetenek listesi. provision yollarından SONRA gelir (bkz. yukarıdaki not).
mount('get', '/v1/devices/:id', asyncHandler(getDeviceHandler));

// ─────────────────────────────────────────────────────────────────────────────
// 3) WhatsApp — Gönderim. Hepsi gerçek bir cihazı sürer → rate-limit + `send` guard
//    (boş / kayıt-süren / banlı-çıkışyapmış cihazda 409).
// ─────────────────────────────────────────────────────────────────────────────
mount('post', '/v1/whatsapp/send/text', asyncHandler(sendHandler), { alias: '/v1/whatsapp/send', use: [apiRateLimiter, send] });
mount('post', '/v1/whatsapp/send/media', asyncHandler(sendMediaHandler), { alias: '/v1/whatsapp/send-media', use: [apiRateLimiter, send] });
// Bulk send (many distinct messages, one call) — heavy-limited (dispatches up to 100 device jobs).
// ⚠️ Guard YOK: gövde çok cihazlı olabilir (messages[].deviceId), tek deviceId yok.
// Her mesaj zaten sendFromDevice'ın kendi kontrolünden geçer.
mount('post', '/v1/whatsapp/send/bulk', asyncHandler(bulkSendHandler), { use: [heavyOperationRateLimiter] });
mount('post', '/v1/whatsapp/send/broadcast', asyncHandler(broadcastHandler), { alias: '/v1/whatsapp/broadcast', use: [apiRateLimiter, send] });

// ─────────────────────────────────────────────────────────────────────────────
// 4) WhatsApp — Sohbetler & Etiketler (okuma + sohbet durumu).
// ─────────────────────────────────────────────────────────────────────────────
mount('get', '/v1/whatsapp/chats', asyncHandler(conversationsHandler), { alias: '/v1/whatsapp/conversations', use: [read] });
mount('get', '/v1/whatsapp/chats/thread', asyncHandler(threadHandler), { alias: '/v1/whatsapp/thread', use: [read] });
mount('get', '/v1/whatsapp/chats/messages', asyncHandler(messagesHandler), { alias: '/v1/whatsapp/messages', use: [read] });
mount('post', '/v1/whatsapp/chats/read', asyncHandler(markReadHandler), { alias: '/v1/whatsapp/thread/read', use: [apiRateLimiter, read] });
mount('post', '/v1/whatsapp/chats/state', asyncHandler(stateHandler), { alias: '/v1/whatsapp/conversations/state', use: [read] });
mount('post', '/v1/whatsapp/chats/labels', asyncHandler(setLabelsHandler), { alias: '/v1/whatsapp/conversations/labels', use: [read] });
mount('post', '/v1/whatsapp/chats/clear', asyncHandler(clearChatHandler), { alias: '/v1/whatsapp/clear-chat', use: [apiRateLimiter, read] });
mount('post', '/v1/whatsapp/chats/summary', asyncHandler(chatSummaryHandler), { alias: '/v1/whatsapp/chat-summary', use: [apiRateLimiter, read] });
mount('post', '/v1/whatsapp/chats/delete-message', asyncHandler(deleteMessageHandler), { alias: '/v1/whatsapp/delete-message', use: [apiRateLimiter, read] });
// deviceId opsiyonel (tüm workspace'i özetler) → guard deviceId yoksa kendini atlar.
mount('get', '/v1/whatsapp/chats/stats', asyncHandler(statsHandler), { alias: '/v1/whatsapp/stats', use: [read] });
// Etiketler workspace seviyesindedir (cihaza bağlı değil) → guard yok.
mount('get', '/v1/whatsapp/labels', asyncHandler(labelsHandler));
mount('post', '/v1/whatsapp/labels', asyncHandler(createLabelHandler));

// ─────────────────────────────────────────────────────────────────────────────
// 5) WhatsApp — Kişi işlemleri (karşı taraf: profil, engelleme, rehber).
// ─────────────────────────────────────────────────────────────────────────────
mount('post', '/v1/whatsapp/contacts/list', asyncHandler(contactsHandler), { alias: '/v1/whatsapp/contacts', use: [apiRateLimiter, read] });
mount('post', '/v1/whatsapp/contacts/profile', asyncHandler(profileHandler), { alias: '/v1/whatsapp/profile', use: [apiRateLimiter, read] });
mount('post', '/v1/whatsapp/contacts/block', asyncHandler(blockHandler), { alias: '/v1/whatsapp/block', use: [apiRateLimiter, read] });
mount('post', '/v1/whatsapp/contacts/blocklist', asyncHandler(blocklistHandler), { alias: '/v1/whatsapp/blocklist', use: [apiRateLimiter, read] });
mount('post', '/v1/whatsapp/contacts/group-members', asyncHandler(groupMembersHandler), { alias: '/v1/whatsapp/group-members', use: [apiRateLimiter, read] });

// ─────────────────────────────────────────────────────────────────────────────
// 6) WhatsApp — Kendi hesabım.
//    ★health ve number bilerek GUARD'SIZ: ikisi de gerçeği CİHAZDAN okur, yani
//    "DB'de satır yok ama cihazda hesap var" durumunun kaçış valfidir (canlı filoda
//    böyle cihazlar mevcut). Guard koysaydık, kaydı tazeleyecek tek uç da 409 verir
//    ve cihaz kalıcı olarak 'empty' kalırdı.
// ─────────────────────────────────────────────────────────────────────────────
mount('post', '/v1/whatsapp/account/health', asyncHandler(accountHealthHandler), { alias: '/v1/whatsapp/account-health', use: [apiRateLimiter] });
mount('post', '/v1/whatsapp/account/number', asyncHandler(myNumberHandler), { alias: '/v1/whatsapp/mynumber', use: [apiRateLimiter] });
// Change the device's OWN profile — display name + picture. On-device jobs, write scope.
mount('post', '/v1/whatsapp/account/name', asyncHandler(setNameHandler), { alias: '/v1/whatsapp/profile/name', use: [apiRateLimiter, send] });
mount('post', '/v1/whatsapp/account/avatar', asyncHandler(setAvatarHandler), { alias: '/v1/whatsapp/profile/avatar', use: [heavyOperationRateLimiter, send] });

// ─────────────────────────────────────────────────────────────────────────────
// 7) WhatsApp — Veri okuma (root-DB). Ajan WhatsApp'ın kendi SQLite'ını okur (UI
//    gezinmesi yok). Hepsi jobId döner. Banlı hesapta da ÇALIŞIR (msgstore.db
//    cihazda durur) — cevaba accountWarning eklenir.
// ─────────────────────────────────────────────────────────────────────────────
const dataEndpoints: Array<[string, RequestHandler]> = [
  ['receipts', asyncHandler(receiptsHandler)],
  ['media', asyncHandler(mediaHandler)],
  ['fetch-media', asyncHandler(fetchMediaHandler)],
  ['calls', asyncHandler(callsHandler)],
  ['search', asyncHandler(searchHandler)],
  ['unread', asyncHandler(unreadHandler)],
  ['deleted', asyncHandler(deletedHandler)],
  ['links', asyncHandler(linksHandler)],
  ['reactions', asyncHandler(reactionsHandler)],
  ['polls', asyncHandler(pollsHandler)],
  ['read-by', asyncHandler(readByHandler)],
  ['starred', asyncHandler(starredHandler)],
  ['labels-list', asyncHandler(labelsListHandler)],
  ['view-once', asyncHandler(viewOnceHandler)],
  ['voice-notes', asyncHandler(voiceNotesHandler)]
];
for (const [name, handler] of dataEndpoints) {
  mount('post', `/v1/whatsapp/data/${name}`, handler, {
    alias: `/v1/whatsapp/${name}`,
    use: [apiRateLimiter, read]
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 8) İşler (jobs) — her on-device ucun döndürdüğü jobId'nin evrensel poll hedefi.
// ─────────────────────────────────────────────────────────────────────────────
mount('get', '/v1/jobs/:jobId', asyncHandler(jobHandler));
// Long-poll variant: block (server-side) until the job finishes or ?timeout= s
// elapses, so an integrator gets the result in ONE request instead of a poll loop.
mount('get', '/v1/jobs/:jobId/wait', asyncHandler(jobWaitHandler));
