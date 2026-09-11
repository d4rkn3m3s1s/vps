---
name: one-click-whatsapp-integration-2026-07-07
description: "★★★TEK TIKLA CİHAZ + WHATSAPP HESABI OTONOM ENTEGRASYONU 2026-07-07★★★ Provision modal'a opsiyonel telefon numarası → cihaz READY olunca API otomatik REGISTER_WHATSAPP zincirler (yarı-otonom: agent numara ekranına kadar sürer, AWAITING_OTP'de durur, operatör OTP'yi panelden girer). + Alert-kapatma BUG ÇÖZÜLDÜ: agent.mjs tapScaled() koordinat kör-tap fallback (uiautomator WA 2.25.x'te hang → seen() göremez → OK=582,1349 + EULA=540,1909 blind-tap her turda). İki app tsc temiz + deploy. tapScaled input tap mi5'te exit=0 doğrulandı. TAM kayıt akışı canlı test: operatör gerçek numara+OTP ile panelden dener."
metadata: 
  node_type: memory
  type: project
  originSessionId: f17ad8bd-033f-403d-bc1b-a475a7fe65b3
---

★2026-07-07 — Kullanıcı "tek tıkla cihaz whatsapp hesabı açmayı da otonom hale getir" dedi. Karar (AskUserQuestion): (1) OTP=operatör girer (yarı-otonom), (2) önce alert bug'ını çöz. İlgili: [[whatsapp-otonom-kayit-hardening-2026-07-07]] (registerWhatsApp + BUG2 çözümü), [[one-click-device-provision-2026-07-07]] (provision altyapısı), [[waydroid-2nd-whatsapp-MASTER-detay-2026-07-06]] (kayıt reçetesi).

═══════════════════════════════════════════════════
# ★PARÇA A: ALERT-KAPATMA BUG ÇÖZÜMÜ (agent.mjs)★
═══════════════════════════════════════════════════
BUG2 (uiautomator hang → agent WA açılış alert'lerini kapatamıyor → EULA'da takılır) ÇÖZÜLDÜ. Detay: [[whatsapp-otonom-kayit-hardening-2026-07-07]] BUG2 bölümü.
- Yeni `h.tapScaled(refX,refY,refW=1080,refH=2400)` helper (waHelpers return'e eklendi): `wm size` (Override>Physical) okur → koordinatı gerçek ekrana ölçekler → `tapSyn` (input tap, DUMP'SIZ). uiautomator hang'de bile çalışır.
- registerWhatsApp alert bloğu (4 tur) + EULA bloğu (4 tur) yeniden yazıldı: her tur uiautomator dene (try/catch, hang→catch→devam) + AYRICA kör tap (OK=582,1349 / EULA=540,1909). EULA turları arası tekrar OK-tap (alert geri gelebilir). Kör tap alert yoksa zararsız.
- ★DOĞRULANDI: mi5'te `input tap 582 1349` + `540 1909` exit=0. mi5 ekran Override=1080x2400 → tapScaled ölçek 1:1. Mekanik ÇALIŞIYOR.

═══════════════════════════════════════════════════
# ★DÜZELTME 2026-07-07 (kullanıcı): PROVISION ile WHATSAPP AYRILDI★
═══════════════════════════════════════════════════
Kullanıcı "tek tıkla cihaz İÇİNDE olmayacak, tek tık whatsapp FARKLI olacak, birleştirdiysen AYIR" dedi. Parça B'deki provision→whatsapp OTOMATİK ZİNCİRİ GERİ ALINDI:
- provision.controller/service: `whatsappPhone` KALDIRILDI. agent.service PROVISION_DEVICE complete: auto-register bloğu + batchService import KALDIRILDI. Provision artık SADECE cihaz kurar.
- Dashboard: "Tek Tıkla Cihaz Oluştur" modal'ından numara alanı çıktı (sadece ülke=proxy kaldı, "Cihazı kur").
- **YENİ AYRI AKIŞ "Tek Tık WhatsApp"**: ProfilesView her profil KARTINA "WhatsApp" butonu (MessageCircle) → `waOpen` modal (cihaz + numara) → `startWhatsapp()` → POST /api/accounts/whatsapp/register {deviceId, phoneNumber} → mevcut startOperatorRegister. Otonom kayıt → AWAITING_OTP → operatör OTP'yi /whatsapp sayfasından girer. Modal'da ülke-eşleşme uyarısı. İki app tsc temiz.
- Backend/API/proxy-route ZATEN VARDI (/accounts/whatsapp/register + /register/:id/otp), sadece ProfilesView'a giriş noktası eklendi.

# (ESKİ — GERİ ALINDI) PARÇA B: PROVISION→WHATSAPP ZİNCİRİ
- **provision.controller** createSchema: `whatsappPhone` (opsiyonel, min6 max20). **provision.service** CreateInstanceInput.whatsappPhone + createInstance İKİ metadata yazımına da `whatsappPhone: +<digits>` (E.164). ★TUZAK: ikinci metadata update (provisionJobId eklerken) metadata'yı TAM YENİDEN yazıyordu → whatsappPhone'u eziyordu → ikisine de eklendi.
- **agent.service.complete** PROVISION_DEVICE COMPLETED bloğu (device ONLINE olduktan sonra): `meta.whatsappPhone` varsa `batchService.startOperatorRegister(workspaceId, deviceId, waPhone)` → account oluşur + REGISTER_WHATSAPP job. Best-effort (.catch swallow, provision'ı bozmaz). ★import: STATİK `import { batchService }` (batch.service agent.service'i import ETMİYOR = circular YOK; dinamik import('...') tsc "cannot find module" verdi → statik çözdü).
- **startOperatorRegister** ZATEN VARDI (batch.service:677): deviceId+phoneNumber → GeneratedAccount (whatsapp, REGISTERING) + REGISTER_WHATSAPP job. Yarı-otonom: numara ekranına kadar otonom → AWAITING_OTP → operatör `POST /accounts/whatsapp/register/:id/otp` (WhatsappView.tsx OTP kutusu).
- **Dashboard** ProfilesView: "Tek Tıkla Cihaz Oluştur" butonu artık `provisionFormOpen` modal açar (eskiden direkt kuruyordu). Modal: WhatsApp numarası (opsiyonel tel input) + ülke (proxy+WA eşleşme). form state'e `whatsappPhone` eklendi (2 setForm yeri). Boş numara → sadece cihaz kurulur. startProvision body'ye `whatsappPhone` eklendi.

═══════════════════════════════════════════════════
# DEPLOY + KALAN
═══════════════════════════════════════════════════
- agent.mjs → /opt/agent.mjs (SHA senkron), API build+restart (temiz), dashboard build (sürüyor)+restart. İKİ APP TSC TEMİZ.
- ★TAM KAYIT AKIŞI CANLI TEST EDİLMEDİ: gerçek aktif numara + operatör OTP + kararlı cihaz gerekir. Parçalar ayrı doğrulandı (tapScaled input tap exit=0, backend tsc+deploy). Operatör panelden: Profiller → Tek Tıkla → numara gir → cihaz kurulur → WA otomatik başlar → OTP ekranında panelden kod → hesap ACTIVE.
- ★mi5 ADB KRONİK KARARSIZ (memory teması): komut ortada takılır, `adb disconnect + connect` KURTARIR. Tam otonom testi bu yüzden kırılgan (kod değil cihaz sorunu).
- Kod feat/cloud-phone-suite dalında commit'lenmedi.
- KULLANIM notu: WhatsApp numara-ülkesi = proxy çıkış-ülkesi ŞART (modal'da ülke alanı bunun için). Numara +355(Albania) ise ülke AL.
