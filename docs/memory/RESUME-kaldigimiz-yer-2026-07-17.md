---
name: RESUME-kaldigimiz-yer-2026-07-17
description: ★YENİ OTURUMDA İLK BUNU AÇ★ 2026-07-17/18 oturum sonu. tek-tık WA OTONOM için ~28 fix DEPLOY(agent akış+hız+slot+DowngradeFriction/method-sheet/ChatTransfer kök-fix)+Public API denetim(4 kod hatası+jobs/verify-method/me/bulk-send endpoint+webhook-events+docs)+risk-altyapı(rollback scripti). 3 WA kaydı ELLE başarılı. ★★TEK KRİTİK KALAN: TEMİZ(Business'sız) numarayla OTONOM canlı test HİÇ yapılmadı — kod hazır, sadece doğrulanmadı.
metadata:
  node_type: memory
  type: project
  originSessionId: 65c2d856-7523-44ea-8873-91d6208f24be
---

**★ YENİ OTURUMDA İLK BUNU AÇ — 2026-07-17/18 OTURUM SONU ★**

Bugünün detayları: [[wa-otonom-fixler-downgrade-2026-07-17]] · [[public-api-denetim-2026-07-17]]. Önceki: [[wa-kayit-BASARILI-companion-fix-a11y-otp-2026-07-16]].

## 🎯 ANA HEDEF: tek-tık WA'nın SEN OLMADAN (operatör müdahalesiz) otonom bitmesi + her aşamada modal

## ✅ 3 WA KAYDI BAŞARILI (hepsi ELLE OTP ile — otonom DEĞİL)
mi15/905380590746, watest34/905362260383, watest46/905305620532. Hepsi HomeActivity/aktif.

## ✅ DEPLOY EDİLEN ~28 FIX (hepsi phoenixNAP'te CANLI, 3 servis active)

### AGENT (deploy/kvm-host/agent/agent.mjs → /opt/agent.mjs)
- **pm-clear gate**: continuation(otpCode/verifyMethod) WA'yı silmez → modaldan OTP'de başa dönmüyor
- **★TDZ fix(CRITICAL)**: curFocus kullanımdan önce tanımlı → her continuation ÇÖKÜYORDU(tsc yakalamaz). Regresyon-ajanı buldu.
- **skipToVerify**: continuation verify'daysa number-entry atla, doğrudan typeOtp
- **profil kör-tap fix(BUG B)**: isim=SADECE a11y(tap yok), Next=a11y/ölçülen, FAQ'a düşerse BACK
- **email-sweep**: profil sonrası RegisterEmail/restore→Skip/Not now(home öncesi)
- **mesaj Try-Again**: "message was not sent"→otomatik retry(yeni hesap ilk mesaj)
- **ChatTransfer**: "Transfer chat history"→NOT NOW otomatik(CANLI DOĞRULANDI)
- **★DowngradeFriction 2-aşama+KÖK**: Business hesap. (1)USE+numara(primary_button 540,2064) (2)dialog"Deactivate and switch"→a11y CLICK_TEXT(690,1410 fallback). ★KÖK: branch verify döngüsünün EN BAŞINA taşındı(onOtp'den sonra, onWall'dan önce)+submit döngüsü DowngradeFriction'ı "gone" sayar. CANLI KEŞFEDİLDİ(watest45/mi68 +90/+359).
- **★method-sheet fix**: "Choose how to verify"(flash-call activity altında overlay) takılması. onFlashCallEdu method-sheet açıkken false döner, onChooseVerify genişledi(Other device/Missed call/SMS), listVerifyOptions'a Other device, applyVerifyMethod ölçülen-bounds. CANLI KEŞFEDİLDİ(watest45).
- **onWall CustomRegistrationBlock**: "Download official WhatsApp"=ban→DEVICE_WALL
- **rate-limit tanıma**: "requesting code too many times" süre olmasa da yakala
- **proxy verify**: verifyExitCountry(app-uid curl)+ccToIso, register başında çıkış-IP doğrula
- **★HIZ FIRSAT 1(dump-cache)**: dump() 700ms TTL cache→verify döngüsü 15-25 dump/tur yerine ~1. Her tap/sleep/a11y/type cache temizler(davranış değişmez). "Yes/verify uzun sürüyor" çözümü.
- **FIRSAT 2**: verify-method sleep 2500→1500. **FIRSAT 4**: adbkeyboard çift-probe→pm-path
- **heartbeat SS**: 10sn canlı thumbnail. APK-install throw'da stopHeartbeat(leak fix)

### API (apps/api → /opt/fleet)
- **★slot-limit fix**: subnetIdFor md5→16 slot(241-256) CAP'liyordu. nextInstanceName artık SADECE isim çakışması bakar(subnet'i agent net-head.sh sıralı atar, 238 slot). "No free instance slot" ÇÖZÜLDÜ. Güçlü sunucu 100+ cihaz.
- **★Public API 4 kod hatası**: OTP-sızıntı(H-1 toPublic decrypt→projekte), 500→404(getStatus AppError), broadcast şekli({broadcastId,queued}), offline-check(assertDeviceReady OTP/verify-method)
- **Public API yeni endpoint**: GET /v1/jobs/:id(async sonuç oku), POST verify-method, GET /v1/me(scope/deviceCount), POST send/bulk(100 mesaj tek çağrı)
- **★webhook-events**: WHATSAPP_AWAITING_OTP/REGISTERED/REGISTER_FAILED + DEVICE_PROVISIONED(migration 20260718000000, agent.service dispatch). Register/provision artık poll-only değil.
- **auto-proxy group fix**(önceki): {in:['provider','residential']} — US-IP kök
- **provision-status percent/phase tutarsızlığı**: ready iken percent≥100
- **alert.fired global uyarı**+cancel badge-temizleme(önceki)

### DASHBOARD (apps/dashboard)
- **modal proxy-uyarı fix**: agent'ın CANLI çıkış-IP logunu göster(statik proxyCountry yerine)→"atanmadı" yanılgısı bitti
- **modal sayacı**(WA+provision): gerçek başlangıçtan sayar, modal-açılışta 0'lanmıyor
- **modal "Kaydı İptal Et" butonu**+kart numara/koruma rozeti+yöntem-seçimi butonları(önceki)

### RISK ALTYAPISI (bugün başladık)
- **✅ agent-rollback.sh**: `sudo /opt/agent-rollback.sh [N]` → önceki çalışan yedeğe dön(syntax-check+prerollback snapshot). 19 yedek var(/opt/agent.mjs.bak-*).
- **YARIM: watchdog**(agent takılınca otomatik alert) — araştırıldı, YAZILMADI(reapStaleJobs var jobs.service:182).

## 🔴 KALAN İŞLER (öncelikli)
1. **★★TEMİZ numarayla OTONOM CANLI TEST(EN KRİTİK)**: 3 kayıt ELLE bitti. OTP'yi MODALDAN girince agent OTP-sonrasını(isim/Next/email/home) KENDİ bitirmeli — kod hazır+deploy, HİÇ doğrulanmadı. Business/other-phone/eskimiş-kod numaralar test için KÖTÜ. Business-hesapSIZ, denenmemiş TEMİZ numara gerekir. Bu senin BAŞ HEDEFİN.
2. **DowngradeFriction+method-sheet+ChatTransfer otomatik-geçiş** kök-fix'ler deploy AMA Business-numarayla CANLI otomatik-geçiş doğrulanmadı(hep elle geçtik).
3. **Yöntem-seçimi modalı**(SMS/voice/missed/other-device butonları) canlı test edilmedi.
4. **slot-fix + webhook-events + /me + bulk-send** deploy AMA canlı doğrulanmadı(yeni cihaz oluşturulmadı, webhook tetiklenmedi).

## 🟡 KÜÇÜK KALANLAR
- **warte33/mi15 kartında numara yok**(test-job metadata boş) + **mi68 panelde takılı badge** → SEN panelden(numara/İptal). Classifier DB-write engelli.
- **905360452827**(güvenlik-duvarı) + **905386929621**(Business,yorgun) numaraları bırakıldı.
- **watchdog** yarım(başla: reapStaleJobs jobs.service.ts:182, index.ts ticker).
- **panel-parite**(mark-read/canned/wake/webhook-mgmt) + listDevices-pagination + idempotency-key(hiç başlanmadı).
- **HIZ FIRSAT 3/5/6**(number-entry poll, APK-paralel) riskli, ertelendi.

## KRİTİK KISITLAR (değişmedi)
- **Classifier prod DB YAZMA + kimlik/secret HER yolu engelliyor**: UPDATE/psql-write DENENDİ→BLOCKED. cancel/protect/provision/numara-metadata SEN panelden(modal butonları var). psql OKUMA + enum-migration(idempotent SQL) GEÇER.
- GPU-less Waydroid: uiautomator dump SIK BOŞ→screencap+ölçülen koord+a11y SET_TEXT/CLICK_TEXT. DowngradeFriction dialog dump'ı HEP boş→a11y CLICK_TEXT tek yol. Profil ekranında kör input tap TEHLİKELİ(FAQ'a düşer).
- SSH `pkill -f` oturumu koparır(exit255)→yeniden bağlan. `systemctl restart` 124-timeout→pkill -9+start. Agent instance mi<N> ≠ cihaz adı(SET_PROXY[mi68]=mi68 cihazı).

## DEPLOY/ERİŞİM
- phoenixNAP: `ssh -i ~/.ssh/phoenixnap_y ubuntu@125.253.73.45`. Agent: /opt/agent.mjs(scp+node --check+cp+pkill -9+start). API+dashboard: /opt/fleet(scp+npm run build+restart). psql OKU: `sudo docker exec -i fleet-postgres psql -U postgres -d fleet`. Rollback: `sudo /opt/agent-rollback.sh`.
- Cihazlar: mi5-mi7/mi9/mi10-13, warte33/mi15(905380590746 aktif), watest34/mi17(905362260383), watest45/mi21(+359 yorgun), warte46/mi32(905305620532 AKTİF-korundu), mi68(192.168.14.112 boşta+takılı-badge). 13 waydroid instance.
