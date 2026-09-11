---
name: bugun-2026-07-15-oturum2-audit-wa-recete-fixes
description: ★★★2026-07-15 2. OTURUM TAM ÖZET★★★ Mega-audit(34 agent, 55 bulgu) + 6 reçete/güvenlik bug DÜZELTİLDİ+DEPLOY (auto-proxy CANLI KANIT, companion, other-phone→AWAITING_OTP, proxy-plaintext, webhook-crash, WA-clear, KillMode). WA reçetesi temiz2'de SMS-OTP'ye kadar KUSURSUZ kanıtlandı. KALAN: companion GPU'suz cihazda aralıklı takıyor + OTP modal 4 senaryo + Instagram + temiz numara ile ACTIVE.
metadata:
  node_type: memory
  type: project
  originSessionId: ecf6878b-cb13-4eb4-9c43-87a0f72a2804
---

**★★★ 2026-07-15 2. OTURUM — MEGA-AUDIT + WA REÇETE DÜZELTMELERİ ★★★**

Kullanıcı: (1) "sahte özellik+güvenlik+optimizasyon çok-ajanlı tarama, bozmadan yakala+düzelt" (2) PARALEL WhatsApp tek-tık SS-ala-ala uçtan uca stabil+hızlı+proxy'li reçete. İlgili: [[RESUME-kaldigimiz-yer-2026-07-15]], [[bugun-2026-07-15-basarilar-tam-ozet]], [[whatsapp-statemachine-yeni-senaryolar-2026-07-15]].

## 🏆 MEGA-AUDIT (34 agent workflow, 55 bulgu, adversarial doğrulama)
4-eksen: güvenlik(8) + sahte-özellik(15) + performans(22) + kalite(25). Rapor: `scratchpad/mega-audit.mjs` + task çıktısı. **EN KRİTİK 10 (doğrulandı):**
1. **Cross-tenant heartbeat IDOR** (device.routes.ts:53) — POST /devices/:id/heartbeat JWT'siz+scope'suz→başka tenant cihazını OFFLINE+metrik uydurma. safe-autofix DEĞİL.
2. **Stream hub fail-open** (stream.hub.ts:243) — `A&&B&&A!==B`→workspace'siz token başka cihaza canlı DOKUNMA/kontrol.
3. **x-service-auth 2FA bypass** (serviceAuth.ts:8) — herhangi geçerli key 2FA'yı atlıyor.
4. **Proxy şifresi Job.payload'a DÜZ METİN** (proxy.service.ts:275) — GET /jobs/:id ile okunur. ★DÜZELTTİM.
5. **Farm ban-savunması ÖLÜ** (farm.service.ts:675) — recordOutcome sadece BullMQ'dan çağrılıyor, agent yolunda hiç çağrılmıyor→health/auto-pause çalışmıyor.
6. **X OAuth kalıcı 401** (social.controller.ts:16) — req.user hiç set edilmez (authenticateJwt req.auth doldurur), `as any` gizliyor.
7. **agentKeyHash INDEKSSIZ** (schema.prisma:108) — her agent poll(3sn) tam Host tablo taraması. migration gerek.
8. **Webhook SSRF** (webhook.queue.ts:103) — teslimatta redirect/DNS-rebinding yeniden-doğrulama yok.
9. **Trendler her workspace BOŞ** (trends.service.ts:120) — writer null-ws yazıyor, reader scoped okuyor.
10. **heartbeat 100 cihaz seri N-yazma** (agent.service.ts:656) — updateMany'e çökertilmeli.
+ **20 safe-autofix** listesi task çıktısında. UYGULANMADI (kalan): heartbeat-broadcast-ws, telegram/cloud/bulk N+1, WallView memo, poll document.hidden guard, notifications crash-guard, index.ts .catch, dead-code (requireRole.ts/enqueueDemoJobHandler/HeroLanding/AutomationCenter/DeviceMap.tsx).

## ✅ 6 REÇETE/GÜVENLİK BUG DÜZELTİLDİ+DEPLOY (bu oturum)
1. **auto-proxy startOperatorRegister'da çağrılmıyordu** (batch.service.ts:840). Eski kod `countryCode:iso, status:{not:FAILED}` ayrı proxy arıyordu→DB'de TR-countryCode proxy YOK+tek provider FAILED→hiç eşleşmiyor→proxy'siz kayıt→ban. FIX: `autoAttachCountryProxy(deviceId,instance,phoneE164,ws)` çağır (registerAccount:390 ile tutarlı, provider proxy'yi `-cc-CC` ile kullanır, status-bağımsız). CC_TO_ISO+isoFromPhone ölü kod silindi. ★CANLI KANIT: EMULATOR_SET_PROXY COMPLETED→cihaz çıkış IP TR(Turkcell Ankara 176.218.33.143, T.Telekom 88.253.47.182)+BG(A1 Bulgaria Sofia 151.251.124.173).
2. **companion QR ekranı text-detect** (agent.mjs round loop) — activity-signal `companionmode` yeni WA'da gelmiyor→`|| await onCompanion()` eklendi (text: "Link as companion").
3. **companion→RegisterPhone koordinat** — "Register new account" TextView clickable=false bounds[596,402][1028,459](center 812,430) ama ROW parent[554,211][1070,525](center **812,368**). tapScaled(812,368)+sonra 812,430. ★ELLE KANIT: menü açıp 812,368 tap→RegisterPhone geçti.
4. **other-phone verify → AWAITING_MANUAL yerine AWAITING_OTP** (agent.mjs:1637) — numara başka cihazda kayıtlı→kod diğer telefona gider AMA operatör girebilir(aynı verify_sms_code_input). AWAITING_MANUAL modal göstermiyordu→AWAITING_OTP+otpChannel:'other_phone'→panel OTP modalı gösterir. (kullanıcının "OTP modalı yok" bug'ı).
5. **proxy şifresi passwordEnc** (proxy.service.ts:275) — decryptString→düz metin yerine `...(provider.password?{passwordEnc:provider.password}:{})`. materializePayload claim'de çözer.
6. **webhook dispatch crash-guard** (webhooks.service.ts:87) — try/catch+logger import (unhandledRejection→process crash önle). + scheduler.service.ts:110 createJobRecord'a workspaceId eklendi.

## ✅ 2 YENİ REÇETE BUG (kullanıcının "yeni cihazda tıklama problemleri olmamalı" talebi)
- **BUG1: yeni cihazda eski WA verisi temizlenmiyor** (agent.mjs:1046) — aynı instance(mi10) yeniden kullanılınca eski numaranın WA state'i kalıyor→"You've tried to register <eski#> recently"/verify ekranı→yeni numara girilemiyor. FIX: register başında WA kuruluysa `am force-stop + pm clear com.whatsapp`→first-run'a döner. ★KANIT: register FAILED "ilk ekranlar geçilemedi"=WA temiz first-run'da.
- **BUG2: agent restart çalışan cihaz session'ını öldürüyor** — fleet-agent.service KillMode=control-group(default)→restart agent cgroup'undaki TÜM child(weston/wd-run/container) öldürüyor→cihaz STOPPED. FIX: `/etc/systemd/system/fleet-agent.service.d/killmode.conf` [Service] KillMode=process. ★KANITLANDI: restart önce/sonra container RUNNING kaldı. ⚠️YAN-ETKİ: agent restart sonrası cihaza otomatik `adb connect` yapmıyor→device OFFLINE kalıyor, elle adb connect→ONLINE. Agent startup'a reconnect eklenebilir(kalan iş).

## 🎯 WA REÇETE KUSURSUZ KANITLANDI (temiz2 cihazı)
Sıfır cihaz→auto-proxy TR(Türk IP)→companion+vtouch→numara(+90531)→**SMS OTP ekranı**(AWAITING_OTP/OTP_WAIT "SMS kodu bekleniyor"). Uçtan uca çalıştı. Numara +90531 WhatsApp **1-saat SMS-blok** koydu("try again in 1 hour")=numara rate-limit, reçete değil.

## 🔴 KALAN SORUN: companion GPU'suz cihazda ARALIKLI TAKIYOR
temiz2'de companion→numara GEÇTİ, temiz3'te GEÇEMEDİ("Numara ekranına ulaşılamadı"). Kök: GPU'suz Waydroid'de screencap ADB kilitliyor+dumpsys/uiautomator yavaş→companion ekran-tanıma güvenilmez. FIX DENENDİ (agent.mjs:1315): openRegisterMenu `eulaTaps>0` gate KALDIRILDI+idleRounds>=2'de menu 3x RETRY+her denemeden sonra onPhoneScreen kontrol. DEPLOY EDİLDİ ama tam doğrulanamadı (tekrarlı test cihazı half-boot'a düşürdü: `service check package`=not found, system_server yarım). Sonraki: TAZE cihazda tek-sefer test.

## 📱 NUMARA DURUMU
- +90 554 161 86 96 → zaten WhatsApp kayıtlı (other-phone verify)
- +90 531 631 08 34 → WhatsApp 1-saat SMS-blok (~19:05 başladı, ~20:05 kalkar)
- +359 89 614 86 80 (BG) → kirli mi10 state'ine düştü + son test half-boot'ta fail
- ★TEMİZ (hiç WA denenmemiş) numara + TAZE cihaz + TEK-SEFER (tekrarsız) test = ACTIVE garantisi

## KRİTİK DERSLER (tekrarlama)
- ★Agent register çalışırken BEN adb connect/screencap YAPMA→agent'ın ADB'siyle çakışır→job FAILED("pm list packages Command failed").
- ★Aynı instance(mi10) tekrar tekrar provision→hep aynı /var/lib/waydroid.mi10 dizini→çakışma. subnet-map sil(`sed -i /^mi10 /d`)+wd-stop ile temizle. Gerçek fleet'te her cihaz farklı instance.
- ★GPU'suz cihazda exec-out screencap 0-byte döner→`screencap -p /sdcard/x.png`+`pull` kullan (o da ADB kilitler, agent meşgulken çakışır).
- ★Provision "Proxy istenmedi—datacenter IP" NORMAL (env FLEET_PROXY_HOST boş)→proxy WA register'da auto-proxy ile gelir.
- ★DEVICE_BUSY "Proxy ayarlama sürüyor"→EMULATOR_SET_PROXY bitene kadar bekle(~10sn)+tekrar register.
- ★node -e heredoc'ta `$disconnect` kaçış bozuluyor→ayrı komut/dosya kullan.
- Deploy: agent scp→/opt/agent.mjs+node --check+restart. API scp src→/opt/fleet/apps/api+tsc+`npm run build`+restart fleet-api. SSH phoenixnap_y ubuntu@125.253.73.45. DEV cmrmfxnjw0068(temiz2)+cmrmh7vyc(temiz3) KORU(silme). Login=data.accessToken. Route auth=Bearer+x-api-key İKİSİ şart.
