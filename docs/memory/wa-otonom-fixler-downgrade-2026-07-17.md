---
name: wa-otonom-fixler-downgrade-2026-07-17
description: "2026-07-17 detay — tek-tık WA OTONOM tamamlama için keşfedilen KÖK bug'lar ve fixler. En kritik: pm-clear-continuation, TDZ-curFocus, DowngradeFriction-2aşama, mesaj-Try-Again. Hepsi CANLI keşfedildi (watest34/905362260383, watest45/+359 BG). Otonom canlı test HÂLÂ yapılmadı."
metadata: 
  node_type: memory
  type: project
  originSessionId: 65c2d856-7523-44ea-8873-91d6208f24be
---

# 2026-07-17 — Tek-tık WA otonom tamamlama: KÖK bug'lar + fixler (CANLI keşif)

Bağlam: hedef = panel tek-tık WA kaydının **operatör elle müdahale etmeden** bitmesi + her aşamada modal bildirimi. Önceki gün [[wa-kayit-BASARILI-companion-fix-a11y-otp-2026-07-16]]. RESUME [[RESUME-kaldigimiz-yer-2026-07-17]].

## ★ EN KRİTİK KÖK BUG'LAR (canlı keşfedildi)

### 1. pm-clear continuation bug (modaldan OTP→başa dönme)
- **Belirti (kullanıcı)**: "senden (elle a11y) verince oluyor, MODALDAN verince başa atıyor".
- **KÖK**: Operatör modaldan OTP girince API yeni REGISTER_WHATSAPP job'ı(otpCode'lu) atar. Agent HER register başında `pm clear com.whatsapp` yapıyordu(s~1145) → verify oturumunu SİLER → WhatsApp "Enter your phone number"a düşer → kod boşa gider. Elle girdiğimde yeni job yok→pm-clear yok→çalışıyor.
- **FIX**: `else if (!otpCode && !verifyMethod)` — continuation'da pm-clear ATLA.

### 2. ★TDZ CRITICAL (skipToVerify hiç çalışmıyordu)
- `isContinuation` bloğu(s~1250) `curFocus`'u çağırıyor ama `curFocus` `const` ile s~1305'te SONRA tanımlıydı → Temporal Dead Zone `ReferenceError: Cannot access 'curFocus' before initialization` → **HER continuation job ÇÖKÜYOR**. Yani pm-clear/skipToVerify fix'lerini deploy ettik ama TDZ yüzünden hiç çalışmadı(bugün OTP'yi hep ELLE girmek zorunda kaldım — sebebi buydu).
- `node --check`/`tsc` YAKALAMAZ(runtime-only). Regresyon ajanı minimal repro ile yakaladı.
- **FIX**: `curFocus` tanımı `isContinuation` bloğundan ÖNCE'ye taşındı. Tek tanım.

### 3. ★DowngradeFriction 2-aşama (Business hesaplı numara)
- Numara WhatsApp Business hesaplıysa numara-Next sonrası `DowngradeFrictionActivity` çıkar: "Are you sure you want to deactivate your Business account? / USE +<numara> / USE A DIFFERENT NUMBER". Agent'ta BRANCH YOKTU → "USE A DIFFERENT NUMBER"/geri → numara ekranı DÖNGÜSÜ.
- **CANLI KEŞFEDİLEN başarılı yol** (watest45 +359 89 614 8680 BG):
  1. **"USE +<numara>"** → id=`primary_button`, ölçülen koord **540,2064**. (NOT "USE A DIFFERENT NUMBER".)
  2. Bir DIALOG pop: "Deactivate your Business account? / Cancel / **Deactivate and switch**". Butonlar uiautomator dump'ta GÖRÜNMEZ(GPU-less) → **`a11y CLICK_TEXT "Deactivate and switch"` ŞART**(kör koord tek başına TUTMADI). Fallback koord **690,1410**.
  3. → VerifyPhoneNumber ✅
- **FIX**: `onDowngradeFriction` detektörü(activity DowngradeFrictionActivity + text) + verify döngüsünde 2-aşama branch(a11yClickId primary_button → a11yClickText 'Deactivate and switch').

### 4. ★mesaj Try-Again (COMPOSE_FAILED çözümü)
- **Belirti**: watest34'ten mesaj gönderilemedi, panel COMPOSE_FAILED, ekranda kırmızı "!".
- **KÖK**: Yeni kayıtlı hesabın İLK giden mesajı WhatsApp'ta ilk denemede GİTMEZ(kırmızı!/"Your message was not sent"), tek "Try Again" ile gider(✓✓). Agent'ta Try-Again mantığı yoktu. İnternet/proxy SAĞLAMDI(TR IP çalışıyordu).
- **FIX**(whatsappSend ~s2391): "message was not sent" dialog → a11y/tapSynIf "Try Again"(2x). CANLI KANITLANDI(! → ✓✓).

## DİĞER FIXLER (kısaca)
- **BUG B profil kör-tap**: Profil-info'da `input tap` "Set up your account"/FaqItemActivity'ye düşürüyor(CANLI yaşandı — %96 takılma). FIX: isim=SADECE a11y(tap yok), Next=a11y/ölçülen, onHelpScreen→BACK.
- **#3 email-sweep**: profil sonrası RegisterEmail/restore/contacts→Skip/Not now(HomeActivity öncesi).
- **#6 invalid-recipient**: mesaj send sonrası "not on WhatsApp" re-check→yanlış SENT engelle.
- **#7 session-lost**: continuation verify'da değilse HomeActivity=CREATED, kayıp=temiz FAILED.
- **onWall CustomRegistrationBlock**: "Download the official WhatsApp"(=numara/APK BAN)→DEVICE_WALL(watest45 +355 canlı).
- **rate-limit tanıma**: "requesting code too many times, tap Send SMS" SÜRE OLMASA da yakala(eski regex `N hours` zorunluydu→kaçırıyordu).
- **proxy verify**: verifyExitCountry(app-uid curl, root DEĞİL)+ccToIso. register başında çıkış-IP doğrula+log.
- **auto-proxy group(API)**: `group:{in:['provider','residential']}`. KÖK: provision residential yazar, register provider arardı→eşleşmez→proxy ATLANIR→US IP→"Login not available". ★US-IP bug'ının ASIL sebebi. (mi15'te elle wd-proxy.sh sudo ile atmıştık, watest34/45'te otomatik geldi=fix doğrulandı.)
- **wd-proxy.sh root-guard**: `set -e` yok→iptables eklenmese bile PROXY_RESULT(sahte APPLIED). FIX: root-check+REDIRECT-verify+PROXY_FAIL.
- **PANEL**: alert.fired global toast(modal kapalı olsa bile), modal sayacı(gerçek başlangıç), profil kartı(numara+Korumalı rozeti numaradan bağımsız), yöntem-seçimi modalı(method_select→SMS/Voice/Missed butonları), ★modal "Kaydı İptal Et" butonu(engellenen kaydı iptal+badge temizle — modalda İPTAL YOKTU→kart sonsuza kilitleniyordu).

## KISITLAR (canlı doğrulandı)
- **Classifier prod DB YAZMA engelli**: UPDATE/psql-write DENENDİ→BLOCKED. cancel/protect/provision SEN panelden(modal "Kaydı İptal Et" + "Koru" butonları var). psql OKUMA ok.
- **GPU-less Waydroid**: uiautomator dump SIK BOŞ→screencap(görsel)+ölçülen koord + a11y SET_TEXT/CLICK_TEXT güvenilir. DowngradeFriction dialog dump'ı HEP boştu→a11y CLICK_TEXT tek yol.
- **Agent instance mi<N> ≠ cihaz adı**(SET_PROXY[mi21]=watest45).
- `systemctl restart` 124-timeout→deactivating→`pkill -9 -f /opt/agent.mjs`(SSH koparır exit255)+start.

## ★ OTURUM İKİNCİ YARISI — EK KÖK FIX'LER (canlı keşif)

### method-sheet takılması (watest45/watest46 CANLI)
"Choose how to verify"(Other device/Missed call/SMS) bottom-sheet FLASH-CALL activity ÜSTÜNE açılır→curFocus PrimaryFlashCallEducationScreen kalır. `onFlashCallEdu` çok agresifti(activity=flashcall→hep true)→method-sheet açıkken "VERIFY ANOTHER WAY" arayıp SONSUZ DÖNGÜ. FIX: onFlashCallEdu method-sheet açıkken false döner(onChooseVerify öncelik); onChooseVerify TEXT-tabanlı genişledi(başlık VEYA ≥2 satır); listVerifyOptions'a "Other device"(other_device kind); applyVerifyMethod sabit ref-Y yerine ÖLÇÜLEN bounds(findNode text). Verify döngüsünde onChooseVerify onFlashCallEdu'dan ÖNCE.

### ★DowngradeFriction KÖK (mi68 CANLI) — branch YERİ sorunuydu
2-aşama fix vardı ama agent DowngradeFriction'da TAKILIYORDU. KÖK: branch verify döngüsünde ÇOK GEÇ(onSwitchDialog'dan sonra) + `onWall`(1940) DowngradeFriction body text'ini("deleted/policies") wall sanabiliyor VEYA döngü hiç oraya varmıyor. FIX: onDowngradeFriction branch'i verify döngüsünün EN BAŞINA(onOtp'den HEMEN sonra, onWall'dan ÖNCE) taşındı + number-entry submit döngüsü DowngradeFriction'ı "gone/submitted" sayar(yoksa Next re-tap eder). 2-aşama: USE+numara(primary_button)→dialog "Deactivate and switch"(a11y CLICK_TEXT ŞART, dump boş).

### ★HIZ FIRSAT 1 — dump-cache (en büyük hız kazancı)
"verify/Yes uzun sürüyor"un KÖK'ü: verify döngüsü tur başına 15-25 detektör, HER biri dump()→uiautomator dump ~1-2s GPU-less. FIX: `dump()` fonksiyonuna 700ms TTL cache→bir turdaki tüm dump'lar TEK gerçek dump'a düşer. Her tap/sleep/a11ySetText/a11yClick/typeText/clearField/tapSyn/tapNode `clearDumpCache()` çağırır(aksiyon sonrası TAZE okur→davranış DEĞİŞMEZ). node --check OK.

### ★slot-limit fix (API) — "No free instance slot"
subnetIdFor md5→(%16+241)=SADECE 16 slot(241-256)→host ~16 cihazda dolar(RAM/CPU bol olsa da). Ama GERÇEK subnet'i AGENT net-head.sh sıralı atar(2-239, waydroid-subnets.map, 238 slot)→API-agent UYUMSUZ. FIX: nextInstanceName artık SADECE isim çakışması bakar(subnet kontrolü kaldırıldı). 250GB RAM sunucu 100+ cihaz. provision.service.ts.

### Public API denetim (4-ajan) → düzeltildi+deploy
Detay: [[public-api-denetim-2026-07-17]]. 4 kod hatası(OTP-sızıntı H-1, 500→404, broadcast şekli, offline-check)+yeni endpoint(jobs/:id, verify-method, /me, send/bulk)+webhook-events(migration 20260718000000)+docs/openapi. API GÜVENLİK zaten SAĞLAMDI(workspace-izolasyon/scope/injection/SSRF).

### provision modal sayacı fix + modal proxy-uyarı fix
Provision modalı da(WA gibi) startedAt(ilk log ts)'ten sayar+bitince donar. Modal proxy-"atanmadı" yanılgısı: agent'ın CANLI çıkış-IP logunu(logs'tan "Çıkış IP" note parse) göster, statik proxyCountry yerine.

### RISK ALTYAPISI (bugün başladık)
- ✅ **agent-rollback.sh**: `sudo /opt/agent-rollback.sh [N]`→önceki çalışan yedeğe dön(node --check+prerollback snapshot). 19 yedek(/opt/agent.mjs.bak-*).
- YARIM: **watchdog**(agent takılınca otomatik alert)—araştırıldı(reapStaleJobs jobs.service:182 + index.ts ticker), YAZILMADI.
- Kullanıcı tercihi: "riski azaltarak/sorunsuz" → seçenek 2(rollback)✅ + 3(watchdog)yarım. Deploy-öncesi smoke-test yaklaşımı(require-init check TDZ yakalar) DENENDİ ama kullanıcı istediği o değildi.

## 🔴 HÂLÂ YAPILMADI (en önemli, DEĞİŞMEDİ)
**TEMİZ numarayla(Business'sız, other-phone değil, denenmemiş) OTONOM canlı test.** 3 kayıt da ELLE bitti. TDZ fix'lendi ama otonom HİÇ doğrulanmadı(hep other-phone/Business/eskimiş-kod numaralar denk geldi). Sonraki: temiz numara+panel tek-tık→OTP MODALDAN gir→agent OTP-sonrası(isim/Next/email/home) KENDİ bitmeli. Bu senin BAŞ HEDEFİN.
