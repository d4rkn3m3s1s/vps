---
name: whatsapp-full-suite-hardening
description: "★2026-07-05 3. SESSION★ 9 WhatsApp özelliği (send/profile/block/blocklist/mynumber/send-media/delete/clear/read) uçtan uca test+SS doğrulandı+CANLI deploy; Telegram sonuç-bildirimi kopukluğu çözüldü (agent.service complete→notifyWhatsappJob); dashboard'a 4 özellik+proxy; job optimize (seri+jobBusy+rate-limit); medya+clear-chat yalan-SENT/CLEARED bugları düzeltildi; whatsapp-api.md doküman; 3-job-üst-üste hatasız"
metadata:
  node_type: memory
  type: project
  originSessionId: 8fd1c43c-5038-4f59-b9c0-99b288fe6a4b
---

★2026-07-05 (3. SESSION, DEVASA) — "hepsini siteye+telegrama ekle, logları düzelt, optimize, hepsini test+SS, dokman, deploy"★ HEPSİ CANLI. Cihaz Waydroid A13 `192.168.240.112:5555`, WhatsApp 2.26.25.81, 1080x2400. İlgili: [[whatsapp-profile-block-suite]] [[prod-deploy-workflow-scaleway]] [[whatsapp-public-api-suite]].

## ★KRİTİK TEST ARACI (agent.mjs sonu)★
`FLEET_TEST_JOB='{"type":"...","serial":"...","payload":{}}' node /opt/agent.mjs` → tek job'ı gerçek `runJob` ile API/kuyruk olmadan çalıştırır, `TEST_RESULT_JSON:` basar. `FLEET_TEST_JOB` varsa API-env zorunlu değil. Test için `systemctl stop fleet-agent` (çakışma önle) → testler → `start`. Ayrıca payload debug flag'leri: `debugCab`/`debugDialog` (delete), `debugClear` (clear) → CAB/dialog dump'ını döndürür. Job sonucunu DB'den okuma: `cp jobcheck.mjs /opt/fleet/apps/api/ && node jobcheck.mjs <id>` (prisma .env'den bağlanır, kimlik gerekmez).

## ★9 ÖZELLİK — HEPSİ runJob+SS DOĞRULANDI★
send(SENT)✅ profile(isim+numara+avatar)✅ block/unblock(unblock→count0→reblock)✅ blocklist(+90 552 944 06 42)✅ mynumber(+57 310 8228143)✅ send-media(foto gitti)✅ delete-msg HERKESTEN("You deleted this message"+🚫)✅ clear-chat(sohbet BOŞ)✅ read(mesajlar)✅.

## ★2 YENİ YALAN-BAŞARI BUGU DÜZELTİLDİ (bu session)★
1. **send-media yalan SENT**: eski kod attach koordinatı yanlış (sw*0.88 yerine ~0.80), Gallery'ye girip sabit koordinata basıyordu, foto seçilmiyor, sadece caption compose'a yazılıp kalıyordu → yalan SENT. FIX: `whatsappSendMedia` yeniden yazıldı. Attach sheet'te **foto grid INLINE** (Gallery'ye girme!) — `content-desc="Photo, date <en yeni>…"` node'unu seç (push'lanan dosya en yeni). Push /sdcard/Pictures + MEDIA_SCANNER + 1.5sn bekle. Tüm sheet/preview tap'leri SYNTHETIC. Caption'dan ÖNCE `clearField()` (iki caption birleşmesini önler). Gönder DOĞRULAMA: Send node'u gitti + entry geri geldi mi → gerçek SENT, yoksa ATTACH_FAILED/SEND_UNCONFIRMED (dürüst).
2. **clear-chat yalan CLEARED**: `tapSynIf('Clear chat','any')` dialog BAŞLIĞINA basıyordu (onay butonu değil). Onay butonu **"CLEAR CHAT (52 KB)" BÜYÜK HARF**, radio "All messages (52 kB)" de `(NN KB)` içeriyor → suffix-match yanlış node aldı. FIX: onay = `clickable && cy>sh*0.5 && /^(clear chat|temizle...)/i` (verb-prefix, suffix DEĞİL), match'ler arası EN ALTTAKİ (sort cy desc). Dialog kapandı mı DOĞRULA → CLEARED yoksa ATTEMPTED. Chat ⋮→"More"→"Clear chat" yolu (synthetic).

## ★TELEGRAM LOG KOPUKLUĞU ÇÖZÜLDÜ (kullanıcının ana şikayeti)★
Kök: `createJobRecord` PENDING döner, Telegram sadece "Siliniyor…/Engelleniyor…" der, job COMPLETED/FAILED olunca HİÇBİR sonuç bildirimi gitmezdi (`complete()`'te DELETE/CLEAR/MYNUMBER handler bile yoktu). FIX: `agent.service.ts complete()` → `deviceHub.broadcast` sonrası `if type.startsWith('WHATSAPP_') && workspaceId: notifyWhatsappJob(...)`. **`notifyWhatsappJob`** (agent.service.ts sonu, modül helper): job tipini Türkçe insan-okunur bildirime çevirir (🗑 Mesaj silindi/🧹 Sohbet temizlendi/🚫 Kişi engellendi/📋 Engellenenler/📱 Kendi numaran/👤 Profil/🖼 Medya) + `notificationsService.dispatch(workspaceId, {title,detail})` → workspace'in tüm Telegram/Slack/Discord kanallarına. WHATSAPP_SEND atlanır (zaten SENT bubble+webhook var). delete için scope + everyoneUnavailable raporlanır.

## ★TELEGRAM'A EKLENEN (telegram.service.ts)★
Zaten vardı: profilefetch/blocktoggle/delmsg(everyone!)/clearchat/blocklist/mynumber. YENİ: **send-media** — thread butonuna "🖼 Medya gönder" (sendmedia callback → `awaiting_media` state → "<url> [açıklama]" bekle → `batchService.sendMedia`). mode union'a `awaiting_media` eklendi. Thread butonları yeniden düzenlendi (Medya/Sil/Temizle/Engellenenler satırları). "Sonuç işlem bitince bildirilecek" notu eklendi.

## ★DASHBOARD'A EKLENEN (WhatsappView.tsx + 4 proxy)★
4 eksik özellik UI'ya girdi (backend zaten hazırdı): **delete-message** (chat header Trash2 → scope modalı, "Herkesten sil" VURGULU + Benden sil), **clear-chat** (Eraser → geri-alınamaz onay), **mynumber** (sidebar Phone → job-poll `GET /api/jobs/{id}` 2sn×20 → sonuç modalı), **send-media** (compose Paperclip → mediaUrl+caption modalı). 4 yeni proxy: `api/accounts/whatsapp/{mynumber,send-media,delete-message,clear-chat}/route.ts` (send/route.ts deseni, thin passthrough). CSS `.wa-modal-sm/.wa-modal-actions`. Escape handler'a 4 modal-close.

## ★JOB/ENDPOINT OPTİMİZE★
- **Race YOK zaten**: agent loop SERİ (host başına tek-thread, `await runJob` bitmeden yeni claim yok; agent.mjs:3262). Aynı cihaza 2 job → sırayla, çakışmaz.
- **jobBusy flag (agent.mjs)**: job çalışırken `whatsappInboxTick` (her 3sn dumpsys/screencap) DURAKLAR → job'ın ADB'si exklüzif, kararsızlık azalır. `let jobBusy` loop'ta job başı true/finally false.
- **Opt (API fork)**: `createJobRecord` payload.deviceId varken gereksiz `emulator.findUnique` atlar (jobs.service.ts); 8 ağır WhatsApp route'una `heavyOperationRateLimiter` (accounts.routes.ts); blocklist completion N update → 2 `updateMany` (agent.service.ts:298).
- **★waOpenSettings RETRY HARDENING★**: polling-modu ilk çalıştırmada bazen "Ayarlar ekranı açılamadı" (NOT_FOUND) — ⋮/Settings tap chat-list tam interaktif olmadan düşüyor. FIX: tüm akış `attempt()` fonksiyonuna alındı, Account görünmezse TÜM akış 1 kez daha denenir. Sonra: **3 job üst üste (mynumber/blocklist/mynumber) HEPSİ hatasız COMPLETED** (kullanıcının "üst üste bug olmasın" isteği kanıtlandı).

## ★DOKÜMAN★
`docs/whatsapp-api.md` (YENİ, 18 uç kapsamlı Türkçe: giriş/flk_key/scope + endpoint referansı param-tablo+curl+örnek-yanıt + asenkron-iş-modeli + webhook + hata kodları). `docs/openapi.yaml` güncellendi (20 yeni /public/v1 path, valid).

## ★MESAJ GÖNDERME HIZLANDIRMA (bozmadan, canlı ölçüldü)★
Kullanıcı "mesaj göndermeyi bozmadan hızlandır" dedi. `FLEET_SEND_TIMING=1` ile per-adım ölçüm (test-mode stderr): eski akış ~16-18s. 2 KÖK YAVAŞLIK bulundu+düzeltildi (whatsappSend):
1. **screenText ayrı dump (~2.2s boşa)**: `dismissBlockingDialogs` (kendi dump'ı) + `screenText()` (2. dump) art arda. FIX: TEK dump alıp hem alert-sweep hem invalid-recipient kontrolü yapılıyor (yaygın yolda 1 dump).
2. **★send butonu vtouch'ı YOK SAYIYOR★**: izole test kanıtı — 1 synthetic `input tap` compose'u boşaltıp gönderiyor, vtouch FIFO tap compose'u DOLU bırakıyor (ıskalıyor). Eski kod tap0=vtouch (hep ıskalar→still=true→boşa ~3.8s), tap1=synthetic (gönderir). FIX: HER İKİ tap SYNTHETIC (`input tap`). Sonuç: **tek tap'te gider (taps=1)**, ses-kaydı riski de azaldı. Ayrıca send-sonrası 1400ms sabit sleep → `waitCleared` poll (350ms adım, compose boşalınca erken çık).
**SONUÇ: 5/5 SENT taps=1 ~11s (test-mode, node başlatma dahil); gerçek API→job akışı 13.5s COMPLETED; saf gönderim ~16-18s→~9-10s (~%40 hız).** ⚠️DERS: synthetic-first + poll + sleep-kaldırma HEP BİRDEN yapınca bozuldu (ses kaydı/Clock açıldı); TEK TEK izole edip 5-ardışık-test ile doğrulanınca kararlı. `FLEET_SEND_TIMING=1` gizli profiling aracı kaldı.

## ★KALAN AKIŞLARIN HIZLANDIRILMASI (bozmadan, canlı ölçüldü)★
Kullanıcı "diğer tüm özellikleri de bozmadan en kısa/hatasız". Yöntem: canlı ölç → tek-tek izole opt → ardışık test. **KÖK DARBOĞAZ: `uiautomator dump` ~2.2s SABİT** (3 yöntem de aynı: file+cat / --compressed / /dev/tty — Android view-serialize maliyeti, I/O değil). Çözüm = dump SAYISINI azalt, sleep'leri kısalt.
- **Ortak helper**: `waOpenChat` sabit 8000ms → 2000ms + entry(`id/entry`) poll (chat ~2-3s'de açılır, boş compose'da ANR yok). `pollNode` 800→400ms, `seen` 800→400, `waitFor` 1000→500 (dump zaten ~2s, kısa gap yeter).
- **★MYNUMBER 24s→~9s (%58)★**: Settings→You→Profile HİÇ GEREKMİYOR — chat listesinde self-chat satırı `text="+57 310 8228143 (You)"` var. HomeActivity aç → 1 dump → "(You)" numarayı oku. Self-chat yoksa (kullanıcı kendine yazmamışsa) eski Settings yoluna FALLBACK (bozmadan).
- **BLOCK 23s→~19s**: `waOpenContactInfo` sabit 3000ms→1500ms + probe-arası 1200→600ms.
- **BLOCKLIST 35s→~34s**: swipe sleep 800→450, scrape erken-çıkış (page boşsa dur), Contacts-hub dump reuse. Sınırlı — doğası gereği ~12-15 dump (Settings+Privacy+scroll+Contacts+liste).
- **DELETE 26s→~23s**: openCab long-press sonrası 1400→1000ms, poll 700→500ms.
- **PROFILE ~15s→~12s** (waOpenChat poll). MEDIA ~34s (galeri yüklenmesi ağırlıklı, dokunulmadı; caption clearField fix korundu — "opt medya" temiz gitti).
**SONUÇ (test-mode, node~2s dahil): mynumber 9s / profile 12s / block 19s / delete 23s / blocklist 34s — HEPSİ ARDIŞIK TESTLERDE KARARLI (doğru sonuç). Gerçek production job: mynumber 9.2s COMPLETED.** SEND (önceki tur) 17s→~11s. Ders yine: dump ~2.2s duvarı nedeniyle Settings-nav akışları doğası gereği yavaş; en büyük kazanç NAVİGASYONU ATLAMAK (mynumber self-chat kısayolu).

## DEPLOY (canlı doğrulandı)
API src (agent/telegram/jobs/accounts.routes .ts) + dashboard (WhatsappView/globals.css/4 proxy) + docs → scp `/opt/fleet/...`. API `npm run build` (tsc)✅ + dashboard `npm run build` (next, whatsapp 19kB)✅. `systemctl restart fleet-api fleet-dashboard` + agent restart (retry kodu için ŞART — agent.mjs bir kez yüklenir). agent.mjs `/opt/agent.mjs` (md5=yerel). 4 servis active, cihaz online, health 200. İKİ APP tsc TEMİZ.
