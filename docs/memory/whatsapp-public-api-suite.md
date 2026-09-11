---
name: whatsapp-public-api-suite
description: "★2026-07-04 BÜYÜK SESSION★ WhatsApp suite: (1) Public API /public/v1/* (flk_ key JWT'siz: devices/send/messages), (2) tek-tık operatör-OTP kayıt, (3) WHATSAPP_MESSAGE webhook, (4) DETAYLI API doc + CANLI API TEST PLAYGROUND (admin/api-keys), (5) İKİ-YÖNLÜ TELEGRAM BOT (long-poll, komut+inline buton), (6) agent whatsappSend 6 bug fix (ses kaydı/özel karakter/ANR/yalan-SENT/recorder/hız 24→6sn), (7) inbound dedup+ardışık fix, (8) bulk delete/stop + devices search. HEPSİ CANLI TEST GEÇTİ, Scaleway'de deploy."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9f16155e-477c-4af9-969a-7451c269df70
---

**2026-07-04: WhatsApp Public API + tek-tık kayıt + webhook eklendi, PRODUCTION'DA CANLI TEST GEÇTİ.** İlişkili: [[production-deploy-scaleway]] [[whatsapp-stable-api-inbound]] [[waydroid-uinput-real-touch-SOLVED]].

## Ne eklendi (kod, her iki app tsc temiz)
1. **Harici Public API** (`apps/api/src/modules/public/`): `/public/v1/devices` (GET), `/public/v1/whatsapp/send` (POST {deviceId,to,message}), `/public/v1/whatsapp/messages` (GET ?deviceId=&limit=&direction=). `requireApiKey` VAR ama `authenticateJwt` YOK — sadece `flk_` key ile. `public.guards.ts`: `requirePublicWorkspace` (workspaceId undefined=servis key→403 WORKSPACE_REQUIRED, IDOR guard) + `requireScope` (send için write/admin şart). Mevcut `batchService.sendFromDevice/listMessages` + `DeviceService.listDevices` YENİDEN KULLANILDI (hepsi ws-scoped). `routes/index.ts`'e `app.use('/public', publicRouter)`.
2. **Tek-tık operatör-OTP kayıt** (kendi numaran, OTP'yi sen girersin — auto-register'ın ücretli-numara kiralamayan muadili): `batch.service.ts` → `startOperatorRegister(ws,deviceId,phone)` (identity'den rastgele isim + REGISTERING + pass1 REGISTER_WHATSAPP otpCode'suz) + `provideOperatorOtp(ws,accId,otp)` (AWAITING_OTP guard + otpCodeEnc + pass2 otpCode'lu). Route: `POST /accounts/whatsapp/register` + `/register/:id/otp`. Dashboard: `whatsapp/WhatsappView.tsx`'e "WhatsApp Hesap Aç" paneli (cihaz+numara→OTP bekleniyor→OTP gir→ACTIVE, 3sn poll `GET /api/accounts/batch/accounts/:id`).
3. **★KRİTİK BUG FIX★**: `agent.service.ts complete()` REGISTER_WHATSAPP sonucunu HİÇ işlemiyordu → hesap REGISTERING'de takılıydı. Eklenen hook: result.status OTP_WAIT→AWAITING_OTP, CREATED/OK→ACTIVE, diğer(DEVICE_WALL/OTP_REJECTED)→FAILED. `GeneratedAccountStatus` enum tipi import edildi.
4. **Webhook subscribe**: `WHATSAPP_MESSAGE` backend'de dispatch ediliyordu ama `webhooks.controller.ts WEBHOOK_EVENTS` + dashboard `WebhooksView.tsx EVENT_OPTIONS`'ta yoktu → eklendi (artık abone olunabilir).
5. **API export UI**: `admin/api-keys/page.tsx`'e "WhatsApp API — harici kullanım" bloğu (write-key + kopyalanabilir curl örnekleri). `.api-doc-*` + `.wa-register/.wa-reg-badge` CSS globals.css'e eklendi.

## ★CANLI TEST GEÇTİ (Waydroid A13 GApps cihazı → 905464022835)★
- `flk_` write-key DB'ye elle yazıldı (workspace `cmqlrdynh0002j50f0d5oimqv`, cihaz `cmr3r9l8s00dwj5rsh1zi8wml`). Key üretimi: `crypto.createKeyPair` = `sha256("flk_<8byteprefix>.<32bytesecret>")`, requireApiKey `sha256(tümkey)` ile eşler.
- API→devices listeledi ✓, send job PENDING→RUNNING→**COMPLETED status:SENT** ✓ (ekran görüntüsüyle ✓✓ teyitli), messages GET OUT kaydını döndürdü ✓.

## ★KRİTİK AGENT whatsappSend FIX'LERİ (2026-07-04, ÇOK TURDA ÇÖZÜLDÜ — canlı ✓✓ + 6sn)★
Waydroid A13'te (1080x2400 Override) `whatsappSend` bir dizi bug'la boğuşuldu, hepsi çözüldü. Nihai hız 24sn→**6sn**, tüm mesajlar ✓✓ gitti, dürüst raporlama.
1. **vtap Send ıskalıyor** → synthetic `input tap` fallback (ilk denemeler vtouch, sonra `adb input tap`).
2. **Özel karakter çökmesi**: `am start -d "wa.me/...?text=..."` URL'sindeki `)` (encoded `:)` smiley), `&` vb. → adbd cihaz `/system/bin/sh`'ine re-parse ettirince `syntax error: unexpected ')'`. **FIX: `-d` değerini `shArg(url)` ile single-quote'la** (whatsappSend + whatsappRead).
3. **★EN ÖNEMLİ: `uiautomator dump` WhatsApp'ı ANR'a sokuyor★** ("WhatsApp isn't responding"). Compose'da metin varken TEKRARLI dump (findSendButton/bubbleSent LOOP) WA'yı dondurup send'i tümden bloke ediyor. **FIX: send yolu DUMP-FREE.** Deep-link compose'u zaten dolduruyor → sabit Send koordinatına (sw*0.929, sh*0.916 — dump'tan okunan gerçek bounds [940,2134][1066,2260] merkezi) tap. Doğrulama için dump LOOP'u değil, iterasyon başına 1 guarded dump (compose id/entry text hâlâ dolu mu). TEK dump ANR yapmaz, loop yapar.
4. **Yalan SENT**: "compose boş = gönderildi" yanlış-pozitifti (dump compose text'i okuyamayınca boş sanıp SENT diyordu, mesaj hâlâ kutudaydı). **FIX: sadece compose'un GERÇEKTEN temizlendiğini (still===false) SENT say; okunamadıysa (null) son bir dump ile teyit. Aksi COMPOSE_FAILED (dürüst).**
5. **Ses kaydı bug'ı**: fazladan tap (mesaj gidince compose boşalır→buton MİC olur→tap kaydı/`Can't set up recorder` başlatır). **FIX: MAX 2 tap, her tap'ten sonra compose temizlendi mi kontrol et, temizse DUR. Recorder/recording dialogu çıkarsa OK'la+BACK.**
6. **Hız**: `ensureAdbKeyboard` her mesajda 3 ADB komutu çalıştırıyordu → modül-seviyesi `adbKbReady` Set cache'ine bağlandı (waHelpers içindeki versiyon). Chat açılış 5sn sabit bekleme → id/entry belirene dek akıllı poll (max 4.5sn). `FLEET_POLL_MS` 2000→1000 (override.conf). Sonuç 6sn.
NOT: vtouch altyapısı sağlamdı (process çalışıyor, /dev/uinput, FIFO 666, event1). Send butonu dump bounds: `com.whatsapp:id/send` ImageButton desc="Send" [940,2134][1066,2260].

## ★GELEN MESAJ TEKRARI (inbound dedup) FIX★
Gelen mesaj API'ye 5-6 kez tekrar kaydediliyordu. Kök neden: `scrapeIncomingBubbles` signature'ı `text|cy|count` idi → scroll (cy değişir) veya yeni bubble (count değişir) → SAME mesaj için farklı sig → her poll'de yeni `seq` → seen-set key'i (`from|text|whenMs|seq`) hep farklı → tekrar push. **FIX: sig = SADECE `newest.text` (cy/count/seq ÇIKARILDI).** Aynı metin ardışık tick'lerde tek push'a dedup olur; farklı metin gelince fire eder. seen-set key artık `from|text|0` = aynı metin asla re-push. Bedeli: hemen tekrarlanan AYNI metin mesajı kaçabilir (nadir, flood'dan iyi). CANLI DOĞRULANDI: "Okudun mu" 1 kez (eskiden 5-6), "Oooo" tek. Sınırlama: 3sn poll aralığında ART ARDA gelen çok mesajda agent sadece EN YENİ bubble'ı alır (aradakiler kaçabilir) — gerçek kullanımda sorun değil.

## API ile IN/OUT okuma CANLI GEÇTİ
`GET /public/v1/whatsapp/messages?direction=IN` senin gerçek cevaplarını (metin) döndü ("Okudysan okudum yaz", "Oooo"). `body:"."` eski medya/sesli mesajlardandı, gerçek metin düzgün. Karşılıklı yazışma testi (ben API→sen telefon→ben API oku) tam çalıştı. Test flk_ key: workspace `cmqlrdynh0002j50f0d5oimqv`, cihaz `cmr3r9l8s00dwj5rsh1zi8wml` (Waydroid A13 GApps), test numarası 905464022835.

## Deploy detayları (Scaleway 51.158.107.121)
- `/opt/fleet` GIT DEĞİL (rsync). API `npm start`=dist/index.js, dashboard `npm start`=next build. İkisi de KAYNAK push + sunucuda BUILD ister.
- **Tuzak:** sadece değişen dosyaları push edince `routes/index.ts` sunucuda OLMAYAN `provision` modülünü import edip build patladı → çözüm: `rsync apps/api/src/ + apps/dashboard/src/` TÜMÜNÜ (--delete'siz) senkronize et. Sunucudaki /opt/fleet yerelden eskiydi.
- Build: `cd apps/api && npx prisma generate && npm run build`; dashboard `npm run build` (arka planda /tmp/dash-build.log). Migrate deploy "No pending". Restart: `systemctl restart fleet-api fleet-dashboard fleet-agent`.
- **★Caddy: `/public/*` → localhost:4000 EKLENMESİ ŞART★** (yedek Caddyfile.bak). Eski Caddyfile sadece `/ws/*`→4000, kalan→dashboard:3000 idi → `/public/*` dashboard'a düşüp 404 verirdi. Yeni blok: `@public path /public/* \n reverse_proxy @public localhost:4000`. `caddy validate` + `systemctl reload caddy`.
- DB adı **`fleet`** (memory'lerdeki `vps_emulator` WSL'deki eski isim). 2 admin: admin@fleet.local (prod) + admin@local.dev (eski). Login 429 = brute-force kilidi → `systemctl restart fleet-api` temizler.

## ★TELEGRAM İKİ-YÖNLÜ BOT (2026-07-04, CANLI ÇALIŞIYOR)★
Kullanıcı: "Telegram'dan mesaj gönder + komut paleti + şık arayüz". Mevcut Telegram SADECE outbound bildirimdi (notifications.service.ts sendMessage), inbound SIFIRDI. **Eklendi: `apps/api/src/modules/telegram/telegram.service.ts`** — long-polling (getUpdates, HTTP'de çalışır, webhook/HTTPS gerekmez). `startTelegramBot()` index.ts'te (self-scheduling loop, setInterval DEĞİL — getUpdates 25sn long-poll). Her workspace'in NotificationChannel(type=telegram, botToken+chatId şifreli) botunu yükler, loadBots her döngüde reload (restart'sız yeni bot). **Komutlar:** /menu /start /cihazlar /gonder /mesalar + hızlı `/gonder 905... mesaj`. **Inline butonlar:** 📱 Cihazlar / ✉️ Mesaj Gönder / 📨 Mesajları Oku / ℹ️ Yardım. Mesaj gönder akışı: cihaz seç butonu→numara iste→mesaj iste (per-chat ChatState mode makinesi). **Güvenlik:** sadece kayıtlı chatId komut verebilir (başka chat→"yetkisiz"). Mevcut `batchService.sendFromDevice/listMessages` + `DeviceService.listDevices` yeniden kullanıldı (ws-scoped). HTML parse_mode + esc(). tsc temiz, deploy, log "telegram bot loop starting", kullanıcı CANLI test etti ÇALIŞIYOR.

## İNBOUND İYİLEŞTİRME (ardışık mesaj)
`scrapeIncomingBubbles` artık sadece EN YENİ bubble değil, son emit'ten (prev.sig) SONRAKİ tüm bubble'ları emit eder (texts.slice(idx+1)). Anchor görünmezse sadece newest. Hızlı ardışık cevaplar (3sn poll içinde birden fazla) kaçmaz; seen-set (from|text) tekrarı önler.

## KALAN OPTİMİZASYONLAR — YAPILDI
- **Bulk delete/stop**: `bulkService.stopDevices` (EMULATOR_STOP fan-out) + `deleteDevices` (ws-scoped deleteMany) + controller (bulkStopHandler/bulkDeleteHandler, audit) + routes `POST /bulk/stop`, `/bulk/delete`. (Dashboard /profiles zaten çoklu-seçim + bulk yapıyordu, artık dedike endpoint var.)
- **Devices search**: `listDevices(ws, tag, search)` → `name: {contains, mode:insensitive}`. controller `?search=` query. (Dashboard /profiles zaten client-side isim/tag arama yapıyordu.)

## ★CANLI API TEST PLAYGROUND (admin/api-keys sayfası)★
Kullanıcı "canlı api test yeri" istedi. Eklendi: `admin/api-keys/page.tsx`'e "Canlı API Test" HoloPanel — key yapıştır + endpoint seç (devices/send/messages) + parametre (deviceId/to/message) + "Çalıştır" → gerçek /public/v1 çağrısı → JSON yanıt + HTTP status rozeti. Proxy: `apps/dashboard/src/app/api/public-test/route.ts` (server-side, kullanıcının x-api-key'iyle NEXT_PUBLIC_API_URL/public/* çağırır, sadece /public/* izinli = açık-proxy değil, CORS/mixed-content yok). `.api-test-*` CSS globals.css'te. NOT: /api/public-test middleware ile korumalı (login ister) — tarayıcıda giriş yapmış kullanıcıda çalışır; curl'de session cookie yoksa /welcome'a redirect (BEKLENEN).

## ★SESSION DURUMU (9f16155e, 2026-07-04) — SONRAKİ AÇILIŞ İÇİN★
BU SESSION'DA YAPILAN HER ŞEY DEPLOY EDİLDİ + CANLI TEST GEÇTİ (Scaleway 51.158.107.121):
1. Public API /public/v1/{devices,whatsapp/send,whatsapp/messages} — flk_ key, JWT'siz, IDOR-guard. Caddy'ye /public/*→4000 route eklendi (Caddyfile.bak yedek).
2. Tek-tık operatör-OTP kayıt (/accounts/whatsapp/register + /:id/otp) + dashboard WhatsappView "WhatsApp Hesap Aç" paneli + REGISTER_WHATSAPP job-completion hook (kritik bug fix, agent.service.ts).
3. WHATSAPP_MESSAGE webhook subscribe (webhooks.controller WEBHOOK_EVENTS + WebhooksView EVENT_OPTIONS).
4. Detaylı API doc + Canlı API Test playground (admin/api-keys).
5. İKİ-YÖNLÜ TELEGRAM BOT (modules/telegram/telegram.service.ts, index.ts startTelegramBot). Long-poll, /menu /cihazlar /gonder /mesajlar + inline butonlar. Kullanıcı CANLI test etti ÇALIŞIYOR. Bot token DB'de (NotificationChannel telegram, workspace cmqlrdynh0002j50f0d5oimqv).
6. agent whatsappSend TAM ELDEN GEÇTİ (yukarıdaki KRİTİK FIX bölümü): ses kaydı, özel karakter (shArg), ANR (dump-free send), yalan-SENT, recorder dialog, hız 24→6sn. Dump-FREE send: sabit koordinat (sw*0.929, sh*0.916) MAX 2 tap + iterasyon başına 1 guarded dump.
7. Inbound: dedup fix (sig=text-only) + ardışık mesaj fix (son emit'ten sonraki tüm bubble'lar).
8. bulk delete/stop (bulkService.stopDevices/deleteDevices + /bulk/stop /bulk/delete) + devices search (listDevices search param, name contains).

**Test flk_ key (DB'de, "WhatsApp API Test", write scope, workspace cmqlrdynh...):** `flk_<API_KEY>.fcbb3371101f26040b566866fdd043c5ec04e11b6cf50b45329a4f6f6f8b11d7` — kullanıcı isterse iptal edip panelden yeni üretsin. Test cihazı: Waydroid A13 GApps `cmr3r9l8s00dwj5rsh1zi8wml`. Test numarası: 905464022835 (kullanıcının, karşılıklı yazışma yapıldı).

**KALAN (opsiyonel, sonraki):** Telegram botu kullanıcı test etti/çalışıyor ama daha fazla komut eklenebilir (durum/health). IN mesajlar bazen OUT'u da yakalıyor (self-chat test tuhaflığı, gerçekte cx ile ayrılır). /api/public-test'i middleware PUBLIC_PATHS'e eklemek gerekmez (login'li kullanım doğru).
