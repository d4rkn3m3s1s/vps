---
name: wa-panel-guard-reroll-2026-07-08
description: WhatsApp canlı adım-adım panel + COMPLETED-yalan fix + cihaz iş sıra/limit guard + tek-tık kimlik reroll — hepsi deploy+doğrulandı 2026-07-08
metadata: 
  node_type: memory
  type: project
  originSessionId: f17ad8bd-033f-403d-bc1b-a475a7fe65b3
---

★2026-07-08 BÜYÜK SESSION, CANLI DEPLOY+DOĞRULANDI★ Kullanıcının 8 maddelik isteği tamamlandı.

**1) COMPLETED-YALANI KÖK SEBEP+FIX (en kritik):** WhatsApp kaydı `RegisterPhone`'da takılıp
job DB'de COMPLETED görünüyordu → panele hata gitmiyordu. Kök: agent `registerWhatsApp`
`done('...', {status:'DEVICE_WALL'/'NUMBER_ENTRY_FAILED'/...})` döndürüyor ama bu **iş sonucu**,
job lifecycle değil → agent `complete()` ile gönderince job COMPLETED oluyor. FIX: agent.mjs `done()`
wrapper'ına `OK_STATUSES={CREATED,OTP_WAIT}` kontrolü — bunun DIŞINDAKİ her status için
`waProgress(curStep, curPct, '❌ '+reason, 'FAILED')` atıyor → panel kırmızı+kaldığı SS+sebep gösterir.
`NOT_INSTALLED` erken-return da `done()`'a çevrildi. [[whatsapp-otonom-kayit-hardening-2026-07-07]]

**2) CANLI ADIM-ADIM PANEL:** `WhatsappRegisterModal.tsx` (ProvisionModal fork, accountId korelasyon,
12 adım ✓/spinner/kırmızı, SS opsiyonel toggle, panelde OTP kutusu). API: `wa-register.service.ts`
(broadcast 'whatsapp.register.progress' + GeneratedAccount.registerLog Json'a persist, migration
20260708000000_wa_register_log). agent.service reportProgress job.type'a göre dallanıyor
(REGISTER_WHATSAPP→waRegisterService, else provisionService). ProfilesView startWhatsapp dönüşten
{accountId,steps} alıp modal açıyor.

**3) CİHAZ İŞ SIRA+LİMİT GUARD (tek job):** `jobs/job.types.ts` `EXCLUSIVE_JOB_TYPES` set (REGISTER_*,
WHATSAPP_*, RPA_RUN, APPLY_FINGERPRINT, PROVISION_*, snapshot, SET_PROXY, WAKE/SLEEP). `createJobRecord`
içinde `assertDeviceIdle`: aynı cihazda (payload.deviceId VEYA emulatorId) aktif PENDING/RUNNING
exclusive job varsa `AppError('Cihaz meşgul...', 409, 'DEVICE_BUSY')`. OTP 2. job'a `{skipBusyCheck:true}`
(job1+job2 sıralı zaten ama garanti). bulk.runJob Promise.all→allSettled (busy cihaz skip edilir,
{skipped} döner). Panel 409'u toast'la gösterir. ★DOĞRULANDI: RUNNING fake job varken guard sorgusu
onu buluyor→409; COMPLETED olunca serbest.

**4) TEK-TIK KİMLİK REROLL:** `fingerprint.service.rerollIdentity` — mevcut fp'nin
model/os/resolution/dpi/country/GPS'i KORUR, sadece imei/androidId/serialNo/macAddress/buildNumber
yeniden üretir, `applyIdentityJob({includeScreen:false})` ile APPLY_FINGERPRINT dispatch (resolution/dpi/
timezone GÖNDERMEZ→agent wm size/density çağırmaz→WhatsApp 1080x2400 layout bozulmaz). Endpoint
POST /fingerprints/:deviceId/reroll. Kart + kimlik-detay panelinde "Kimlik/Yeni kimlik" butonu.
★DOĞRULANDI: mi6'da identity-only apply sonrası ekran 720x1248@180 DEĞİŞMEDİ, serialno+android_id
uygulandı. [[one-click-device-provision-2026-07-07]]

**5) MODAL GERİ-AÇ (arka plan takip):** provision zaten `metadata.provisionStatus/provisionJobId`+
"⚡Kuruluyor" rozetiyle yapıyordu. WA için simetrik: startOperatorRegister device.metadata'ya
waRegisterStatus/waRegisterAccountId/waRegisterPhone yazıyor→kartta "WA kaydı sürüyor/Kod bekleniyor"
rozeti→tıkla modal geri açılır (WhatsappRegisterModal getStatus ile geçmişi yükler). agent.service WA
completion hook terminal (ACTIVE/FAILED) durumda metadata temizler, AWAITING_OTP'de günceller.

**6-8) UI/TASARIM:** Kart card-foot yeniden (durum satırı ayrı + 3 eşit grid buton: Parmak izi·Kimlik·
WhatsApp), fleet-toast (sağ-alt, ok/warn/err). Kimlik detay .row→.fp-detail grid (uzun IMEI/MAC
sarmalanır, üst üste binmez). Konsol .console-quick-btn dikey flex + .console-quick-cmd nowrap ellipsis
(komut yazıları artık binmiyor). globals.css'e eklendi.

**DEPLOY:** scp→/opt/fleet + /opt/agent.mjs, prisma migrate deploy (registerLog uygulandı)+generate,
api npm run build (tsc temiz), dashboard next build (temiz), systemctl restart fleet-api/dashboard/agent
→ hepsi active, /health ok. Prod: [[prod-deploy-workflow-scaleway]] [[production-deploy-scaleway]]

**AÇIK NOT:** mi7 (Cihaz mi7, 192.168.252.57, id cmrbdyy0j021s7m5zgcfc5pb3) ADB'de kopmuş
(device not found)—canlı WA test için önce mi7 ADB reconnect/wd-run gerekir. Numaralar hâlâ
kullanıcının sorumluluğu (WA-özel SMS servisi şart). [[waydroid-3rd-mi3-setup-2026-07-07]]
