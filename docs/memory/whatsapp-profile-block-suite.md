---
name: whatsapp-profile-block-suite
description: "WhatsApp profil resmi/engelle/liste + medya/mesaj-sil/temizle/kendi-numara (7 job type, uçtan uca) — SCALEWAY'E DEPLOY EDİLDİ + CANLI; avatar/engelleme/medya çalışıyor, Settings-nav (numara/blocklist) cihaz kararsız"
metadata: 
  node_type: memory
  type: project
  originSessionId: cf4be9c1-673f-4470-b5c8-320e4609a2dd
---

★2026-07-05 (2. SESSION) — KARARSIZ 4 AKIŞ ÇÖZÜLDÜ + CANLI DOĞRULANDI★
Kullanıcı: "mesaj sil + kendi no + testlere devam, canlı çalışsın". WhatsApp **2.26.25.81** (ekran 1080x2400, cihaz Waydroid `192.168.240.112:5555`). HEPSİ agent'ın gerçek `runJob`'ıyla + screenshot'la kanıtlandı, deploy edildi (`/opt/agent.mjs` md5=yerel). **4 KÖK BULGU (agent.mjs):**
1. **exec-out cat ŞART**: `adb shell cat /sdcard/uidump.xml` STALE (önceki dump'ı verir); `adb exec-out cat` taze. `uiDumpXml` artık `adbExecOutText` (exec-out) kullanıyor — tüm poll'lu navigasyonun temeli buydu.
2. **Menü/CAB/dialog = SYNTHETIC tap, vtouch DEĞİL**: ⋮ overflow PopupWindow + Settings alt-ekranları + CAB + onay-dialog'u **vtouch FIFO-tap'i yok sayıyor** (menü açılıp anında kapanıyor, screenshot'la kanıt); `input tap` açık tutuyor. `waHelpers.tapSyn/tapSynNode/tapSynIf` eklendi, navigasyon bunları kullanıyor. AMA mesaj-bubble long-press vtouch İSTER (aşağı).
3. **Long-press = vtouch MT-B sendevent** (`longPressReal`): `input swipe x y x y 800` CAB açmıyor. Doğru: /dev/input/eventN'e SLOT+TRACKING_ID+**TOUCH_MAJOR+PRESSURE**+POS_X/Y+BTN_TOUCH down+SYN → hold → TRACKING_ID=-1+up+SYN. TOUCH_MAJOR/PRESSURE olmadan yok sayılıyor. `vtouchInfo` artık event node'u (event1) sysfs'ten bulup `info.node`'a koyuyor.
4. **CAB Delete node seçimi**: `pollNode('Delete','any')` "You **delete**d this message" balonuyla eşleşiyordu (includes bug). `findCabDelete` = `desc==='Delete' && cy<sh*0.15` (çöp ikonu, [721,84][848,210] merkez 785,147). `pickBubble` "You deleted this message" sistem-balonunu atlar (isRealBubble).

**GERÇEK YOLLAR (2.26.25.81, canlı doğrulandı):**
- **Kendi no** (`whatsappMyNumber`→`waOpenSettings`): ⋮→Settings→"You" profil satırı→Profile ekranı→"Phone" label altındaki numara. Sonuç: `+57 310 8228143` ✅
- **Blocklist** (`whatsappBlocklist`): Settings→Privacy→2 swipe→"Contacts" satırı→**clickable container `block_list_privacy_contacts_preference`** (text-node tıklanmaz!)→"Blocked accounts" listesi. Sonuç: `+90 552 944 06 42` ✅ (unblock→count0→reblock çapraz-doğrulandı)
- **Mesaj sil** (`whatsappDeleteMsg`): wa.me chat→son gerçek bubble MT-B long-press→CAB çöp(desc=Delete)→dialog→**"Delete for everyone"** synthetic tap. `scope='everyone'` "You deleted this message"+🚫 ile GÖRSEL kanıtlandı ✅. everyone yoksa me'ye düşüp `everyoneUnavailable:true` DÜRÜST raporluyor (eski bug: me'ye düşse de "everyone" diyordu). API+Telegram zaten `scope:'everyone'` gönderiyor.
- **Clear chat** (`whatsappClearChat`): chat ⋮→**"More"**→"Clear chat"→onay (hepsi synthetic). Menü yolu doğrulandı, gerçek-çalıştırma yapılmadı (tüm geçmişi siler, geri alınamaz).
- **`waOpenSettings`** ortak helper: force-stop→HomeActivity→⋮(synthetic)→"New group" görününce Settings(synthetic)→"Account" görününce hazır. `.settings.Settings` deep-link ÖLDÜ (Error type 3).

**TEST ARACI (kalıcı)**: agent.mjs sonuna `FLEET_TEST_JOB` env-mode: tek job'ı gerçek `runJob` ile API/kuyruk olmadan çalıştırıp `TEST_RESULT_JSON:` basar (`FLEET_TEST_JOB` varsa API-env zorunlu değil). Test için `systemctl stop fleet-agent` (çakışma önler), sonra `start`. Kullanım: `FLEET_TEST_JOB='{"type":"WHATSAPP_MYNUMBER","serial":"192.168.240.112:5555","payload":{}}' node /opt/agent.mjs`. debugCab/debugDialog payload flag'leri de var (CAB/dialog dump'ını döndürür).

İlgili: [[prod-deploy-workflow-scaleway]] [[whatsapp-web-chat-suite]] [[waydroid-uinput-real-touch-SOLVED]].

──────────────────────────────
★2026-07-05 GÜNCELLEME — SCALEWAY'E DEPLOY EDİLDİ + CANLI★
Deploy: scp → /opt/fleet + `prisma migrate deploy` (2 migration: 20260705180000_whatsapp_profile_block + 20260705190000_whatsapp_media_delete) + npm run build (api tsc / dash next) + agent /opt/agent.mjs güncellendi (ExecStart /opt/agent.mjs, /opt/fleet/deploy/... DEĞİL!) + systemctl restart fleet-api/dashboard/agent. HEPSİ active. DB=fleet, online cihaz=Waydroid A13 (id cmr3r9l8s00dwj5rsh1zi8wml, serial 192.168.240.112:5555).

**7 JOB TYPE (schema.prisma enum + job.types.ts):** WHATSAPP_PROFILE, WHATSAPP_BLOCK, WHATSAPP_BLOCKLIST, WHATSAPP_MYNUMBER, WHATSAPP_SEND_MEDIA, WHATSAPP_DELETE_MSG, WHATSAPP_CLEAR_CHAT.

**CANLI TEST SONUÇLARI (gerçek job'larla):**
- ✅ AVATAR ÇEKME — 2 numarada gerçek foto çekildi+DB+görsel doğrulandı. KİLİT: contact-info & foto-viewer ekranları bu Waydroid'de screencap'i ENGELLİYOR (size=0); CONVERSATION ekranı screencap çalışıyor → toolbar avatarı ZERO-DEP PNG KIRPICI (node:zlib, agent.mjs `cropPng`) ile kırpılıyor (126x126 data-URI).
- ✅ ENGELLEME — BLOCKED döndü, blocked=t. KİLİT: force-stop+8sn + isim-tap(%40gen/%6yük, avatar DEĞİL—avatar foto-viewer açar) → contact-info → swipe → Block satırı (dump veya %40/%82 koordinat fallback).
- ✅ MEDYA GÖNDERME — SENT (download→push /sdcard/DCIM→attach %88/%92→Gallery→ilk item→caption→send %90/%90).
- ⚠️ KENDİ NUMARASI — NOT_FOUND (Settings navigasyonu kararsız). ⚠️ BLOCKLIST — NO_LIST (`am start com.whatsapp/.settings.Settings`=Error type 3; gerçek ad com.whatsapp.settings.ui.*).
- MESAJ SİL/TEMİZLE — deploy+pipeline OK, görsel doğrulanmadı.

**CİHAZ KARARSIZLIĞI (kök engel):** Waydroid ADB-ağır komutlarda (uiautomator dump/dumpsys/screencap) aralıklı ASILIYOR/size=0, özellikle WhatsApp yükünde. `am start wa.me` bazen Clock uygulaması gösteriyor. Normal WHATSAPP_SEND bile bazen COMPOSE_FAILED. Çözüm: agent.mjs'e `adbT`(timeout+SIGKILL), `uiDumpXml` timeout'lu, `grabPng`, `wmSize` cache, `waOpenChat`(force-stop+8sn dumpsys'siz), `waOpenContactInfo`(isim-tap+blank-dump toleransı).

**API DOC + TELEGRAM + PUBLIC API — CANLI:** Public /public/v1/whatsapp/{profile,block,blocklist,mynumber,send-media,delete-message,clear-chat} (flk_ key, write, rate-limit). API doc (admin/api-keys/page.tsx): 2 kategori+curl+index+playground. Telegram (telegram.service.ts): thread butonları (Profil/Engelle/Sil/Temizle)+callback'ler+/engellenenler+/numaram+sendPhotoDataUri. getContactInfo→blocked/profileInfo/hasAvatar. jobs/[id] proxy blocklist polling için.

İlgili: [[prod-deploy-workflow-scaleway]] [[whatsapp-web-chat-suite]] [[whatsapp-public-api-suite]].

──────────────────────────────
★2026-07-05 (İLK YAZIM, artık DEPLOY EDİLDİ)★ Kullanıcı isteği: "profil resmini çektirmen + kullanıcı engelle + engellenenleri çektirmen".

**3 yeni job type** (schema.prisma JobType enum + job.types.ts JobTypes const İKİSİNE de eklendi): `WHATSAPP_PROFILE`, `WHATSAPP_BLOCK`, `WHATSAPP_BLOCKLIST`.

**agent.mjs** (deploy/kvm-host/agent, zero-dep korundu):
- `whatsappProfile(serial, payload{to?,from?})`: sohbet aç (waOpenChat) → contact-info aç (waOpenContactInfo, toolbar title tap + overflow "View contact" fallback) → profil metni kazı (name/about/phone) → avatar photo_btn'e dokun → `screencap -p` ile TAM EKRAN PNG → data:image/png;base64 döndür. WhatsApp fotoğrafı şifreli sakladığı için ekran yakalama tek ADB yolu. Dönüş: {status:'OK', profile, avatarBase64?}
- `whatsappBlock(serial, {to?,from?,block=true})`: contact-info → aşağı swipe → Block/Unblock satırı (EN+TR regex) → tıkla → onay dialog. Dönüş: BLOCKED/UNBLOCKED/ALREADY_*/NO_ACTION
- `whatsappBlocklist(serial)`: Settings (am start com.whatsapp/.settings.Settings, fallback overflow menu) → Account→Privacy→Blocked contacts → satırları scroll+kazı. Dönüş: {status:'OK', count, blocked:[str]}
- Yeni yardımcılar: `waOpenChat`, `waOpenContactInfo` (whatsappRead'in yanında). Dispatch switch'e 3 case eklendi.

**API** (apps/api):
- batch.service.ts: `fetchProfile`/`blockContact`/`listBlocked` (device-scoped, assertDeviceInWorkspace guard, createJobRecord)
- batch.controller.ts: 3 zod handler (fetchWhatsAppProfileHandler/blockWhatsAppContactHandler/listWhatsAppBlockedHandler)
- accounts.routes.ts: POST /accounts/whatsapp/{profile,block,blocklist}
- agent.service.ts complete(): WHATSAPP_PROFILE→conversation.avatarBase64(≤1.4MB cap)+profileInfo yaz; WHATSAPP_BLOCK→blocked flag reconcile; WHATSAPP_BLOCKLIST→tüm thread'lerin blocked'ını listeye göre reconcile (numara tail eşleşmesi)
- whatsapp.service.ts: ConversationRow'a `blocked`+`hasAvatar` (avatar data-URI listede TAŞINMAZ, perf), getContactInfo genişletildi (blocked/profileInfo/hasAvatar), yeni `getAvatar` (lazy). GET /whatsapp/conversations/avatar eklendi.
- **Prisma**: WhatsappConversation'a blocked/avatarBase64/avatarAt/profileInfo. Migration: 20260705180000_whatsapp_profile_block (ADD VALUE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS). `npx prisma generate` yapıldı.

**Dashboard** (@vps/web):
- Proxy: app/api/whatsapp/conversations/avatar (GET), app/api/accounts/whatsapp/{profile,block,blocklist} (POST). jobs/[id] proxy zaten vardı (blocklist polling için kullanılıyor).
- WhatsappView.tsx: `Avatar` bileşeni (img+initials fallback), lazy avatar cache (avatars state + loadAvatar, hasAvatar olan thread'leri otomatik yükler). Chat başlığına Profil-çek + Engelle butonları. Contact panel'e profil kartı (avatar+ad+durum+"Profili çek") + Engelle/Kaldır butonu. Sidebar'a Engellenenler (ShieldBan) butonu → modal (job poll ile liste). Türkçe. globals.css'e ~15 yeni sınıf.

**KRİTİK sonraki adımlar**: (1) [[prod-deploy-workflow-scaleway]] ile deploy — scp → /opt/fleet + `prisma migrate deploy` (migration ŞART, yeni kolonlar+enum yoksa çöker) + build + restart fleet-api/dashboard, agent.mjs'i de host'a kopyala. (2) Gerçek cihazda test: resource-id'ler (photo_btn/profile_info/message_text) WhatsApp sürümüne göre değişebilir — profil/block akışı canlı doğrulanmalı. İlgili: [[whatsapp-web-chat-suite]] [[whatsapp-public-api-suite]].
