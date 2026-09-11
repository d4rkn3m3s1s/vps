---
name: whatsapp-stable-api-inbound
description: "WhatsApp'ı stabil API'ye çevirme — gerçek dokunma (vtap) entegrasyonu + gelen mesaj yakalama (notification poll) + inbound endpoint/webhook/bildirim + messages GET; kod tamam+tsc temiz+migration uygulandı, canlı API testi bekliyor"
metadata: 
  node_type: memory
  type: project
  originSessionId: d62c1f55-2d82-4651-aba7-ec4f1b96d544
---

**2026-07-03: WhatsApp otomasyonu stabil API'ye dönüştürüldü** (kullanıcı hedefi: gönder + gelen mesaj oku + bize bildirim). Plan: `~/.claude/plans/ethereal-humming-cherny.md`. İlişkili: [[waydroid-uinput-real-touch-SOLVED]] [[whatsapp-rpa]] [[new-feature-modules]].

## ★KRİTİK BUG ÇÖZÜLDÜ: mesaj gönderme çalışmıyordu (FIFO izin + koordinat)★
Frontend'den gönder → mesaj compose'a yazılıyor ama GÖNDERİLMİYORDU. İki kök sebep:
1. **FIFO izin (asıl sebep):** Agent `vtapReal` FIFO'ya `adbSu(serial, "echo X Y > fifo")` = `adb shell su -c "echo > fifo"` yazıyordu. Ama redirect `>` OUTER adb-shell'de (uid 2000 shell) çalışır, root'ta DEĞİL → FIFO root-owned → **"Permission denied"** → tap sessizce hiç gitmiyordu. Manuel test `adb shell "su -c 'echo > fifo'"` (redirect root shell'de) çalıştığı için karışmıştı. **ÇÖZÜM:** FIFO'yu 666 yap (`wa-bringup.sh`'a `chmod 666 /data/local/tmp/vt.fifo` eklendi + `vtapReal` artık su-SUZ `adb shell echo X Y > fifo` yazıyor). Bu tüm gerçek-dokunma yolunu (register/send/read) etkiliyordu.
2. **Koordinat (ikincil):** `wm size` HEM "Physical size: 720x1248" HEM "Override size: 720x1280" basar. Eski regex Physical'ı (ilk match) alıyordu → sendY=1248*0.932=1163, Send butonu bounds [_,1166]..[_,1220] ARALIĞININ ÜSTÜNDE, 3px ıskalıyordu. **ÇÖZÜM:** `vtouchInfo` + whatsappSend Override-öncelikli okur (`Override size` regex ÖNCE) → sendY=1280*0.932=1193 (buton merkezi) → vtap physical 2237. Manuel çalışan koordinatla birebir.
- whatsappSend Send butonuna artık uiautomator dump'a GÜVENMEZ (compose'da metin varken dump idle olamıyor → find('Send') null → tap atlanıyordu). SABİT ORANSAL nokta kullanır: sendX=sw*0.954, sendY=sh*0.932 (Override). Doğrulama: message_text balonu (compose dump güvenilmez). Kanıt: SUSUZ FIFO 999 → ✓✓ teslim, job "SENT".

## Yapıldı (kod tamam, tsc temiz api+dashboard, migration uygulandı)

**A. Agent gerçek-dokunma (`deploy/kvm-host/agent/agent.mjs`, zero-dep korundu):**
- `adbSu(serial,cmd)` = root shell (`su -c`). `vtouchInfo`/`ensureVtouch`/`vtapReal`/`tapReal` — vtouch (uinput) varsa FIFO'ya koordinat yaz (logical→physical rescale: `wm size` vs ABS_MT max), yoksa `input tap` fallback. `ensureVtouch` reboot sonrası `/data/adb/wa-bringup.sh` çağırır (self-heal).
- `waHelpers.tapNode` → `tapReal`'e yönlendirildi → TÜM WA akışları (register/send/read) gerçek dokunma. `whatsappSend`/`whatsappRead` başına `h.ensureTouch()`+`h.ensureAdbKeyboard()` eklendi.

**B. Gelen mesaj yakalama (agent.mjs, notification poll — APK YOK):**
- `parseWaNotifications(dump)` + `pickExtra` — `dumpsys notification --noredact` parse. KRİTİK format: extras `android.title=SpannableString (DEĞER)` (tip başta, değer PARANTEZ içinde — ilk denemede yanlış varsaymıştım, düzeltildi). bigText>text tercih, özet/"3 new messages"/setup bildirimleri filtrelenir. **Gerçek dump + sentetik mesajla izole test edildi ✅** (scratchpad/test-parse.mjs, 4 test geçti).
- `pollWhatsappInbox`/`whatsappInboxTick` ticker (her `FLEET_WA_INBOX_MS`=3sn), sha256 dedup (`waSeen` Set, cap 400), `POST /agent/whatsapp/inbound {serial,from,text,ts}`. loop()'a bağlandı, shutdown'da temizlenir. `FLEET_WA_INBOX=0` ile kapatılır.

**C. API (`apps/api`):**
- `schema.prisma`: `WhatsappMessage` model (workspaceId,deviceId,direction IN/OUT,peer,body,waTimestamp) + Device.whatsappMessages + `WebhookEvent.WHATSAPP_MESSAGE`. Migration `20260703120000_whatsapp_messages` (idempotent, ADD VALUE IF NOT EXISTS). **Uygulandı (prisma migrate deploy).** prisma generate WSL'de yapılmalı (Windows EPERM — DLL kilidi).
- `agent.service.ts inboundWhatsapp(host,{serial,from,text,ts})`: serial→deviceId (host-scoped, updateDeviceMetrics deseni), WhatsappMessage yaz + deviceHub `whatsapp.message` broadcast + webhook dispatch + `notificationsService.dispatch` (Telegram/Slack/Discord). complete()'e WHATSAPP_SEND→OUT kaydı eklendi.
- `agent.routes.ts`: `POST /agent/whatsapp/inbound` (agent-auth). `agent.controller.ts`: whatsappInboundHandler+zod.
- `batch.service.ts listMessages` (workspace-scoped device okuma) + `batch.controller.ts listWhatsAppMessagesHandler` + `accounts.routes.ts GET /accounts/whatsapp/messages?deviceId=&limit=&direction=`.
- dashboard proxy: `app/api/accounts/whatsapp/messages/route.ts`.

## Deploy durumu
- Agent `/opt/agent.mjs` (systemd `fleet-agent.service`, host 51.158.107.121). Yeni kod deploy+restart edildi, **active** (yedek `/opt/agent.mjs.bak`). Log `/var/log/fleet-agent.log`.
- Agent env: `FLEET_API_URL=https://...trycloudflare.com` (Cloudflare tunnel → Windows'taki API). FLEET_API_KEY/HOST_KEY systemd Environment'ta.

## ★CANLI TEST GEÇTİ (2026-07-04)★
Stack ayağa kaldırıldı ([[wsl-redroid-netstack-route-fix]] ile WSL internet onarıldı → yeni cloudflared tunnel → agent restart). Cihaz `cmr3r9l8s00dwj5rsh1zi8wml` ONLINE. **Test 1 (gönderme):** `POST /accounts/whatsapp/send {deviceId,to,message}` → job WHATSAPP_SEND COMPLETED, `result.status=SENT`, error yok (~15sn, vtap gerçek dokunma). **Test 3 (listeleme):** `GET /accounts/whatsapp/messages?deviceId=` 12 mesaj döndü, yeni OUT kaydı en üstte + geçmiş IN kayıtları (inbound poll da çalışmış). Test 2 (canlı inbound) için dışarıdan mesaj at → ~3sn'de yeni IN satırı. Send gövdesi: `{deviceId, to, message}`. Login: `data.accessToken` wrapper'ı içinde.

## (ESKİ) KALAN — çözüldü
API şu an DOWN (agent log'unda Cloudflare **502**) — Windows/WSL'de API çalışmıyor. Ben başlatamadım: `wsl -d Ubuntu bash -lc` arka plan process tutmuyor; `up.cmd`→`up.sh` sudo+dockerd gerektiriyor (route silme riski, "bilinmiyor" [[local-stack-startup]]). **Kullanıcı `up.cmd` ile stack'i başlatınca test:** (1) WHATSAPP_SEND→vtap→✓✓ + OUT kaydı, (2) dışarıdan +57 310 8228143'e mesaj→agent poll yakalar→inbound→DB+bildirim, (3) `GET /accounts/whatsapp/messages?deviceId=` döner. Cihaz deviceId: `cmr3r9l8s00dwj5rsh1zi8wml`.
