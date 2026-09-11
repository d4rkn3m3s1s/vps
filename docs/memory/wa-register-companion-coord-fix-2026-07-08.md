---
name: wa-register-companion-coord-fix-2026-07-08
description: "WhatsApp 'Numara alani dolmadi cc=?' KÖK NEDEN = companion popup 'Register new account' koordinatı 802,433 YANLIŞ → doğrusu 812,430 (uiautomator ölçümü). mi7 +49 canlı test ile kanıtlandı, akış OTP'ye kadar gitti, WhatsApp CustomRegistrationBlock ile banladı (numara sorunu)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: f17ad8bd-033f-403d-bc1b-a475a7fe65b3
---

★2026-07-08 CANLI TEST (mi7, +4915219598639 Almanya)★ Kullanıcı panelde 'number ❌ Numara alani
dolmadi (cc=?, phone bos)' hatası gördü, '+ ekledim ondan mı, ⋮'ya basamamış mıydı' diye sordu.

**KÖK NEDEN (uiautomator ile canlı ölçülüp KANITLANDI):**
- '+' SORUN DEĞİL — splitE164 ilk satır replace(/[^\d]/g,'') tüm +/boşluğu siler. +49→cc=49 doğru.
- GERÇEK sorun: WhatsApp yeni sürüm VARSAYILAN companion/QR ekranına açılıyor
  (com.whatsapp.companionmode.registration.ui.RegisterAsCompanionActivity, ekranda 'Link as
  companion device'). Numara ekranı ⋮ menü → 'Register new account' ARKASINDA.
- ⋮ menü AÇILIYOR (popup) ama 'Register new account' TIKLANAMIYOR çünkü:
  - Item TextView clickable=false → a11yClickText kaçabilir.
  - Synthetic tap koordinatı agent'ta 802,433 idi → 10px YANLIŞ + güvenilmez.
- 'cc=?' = numara ekranına HİÇ ulaşılamadı (registration_cc alanı yok) → agent yine de number
  adımına geçip 'phone bos' raporladı (kafa karıştırıcı).

**★KANITLI KOORDİNATLAR (uiautomator dump, 1080x2368 mi7):★**
- ⋮ overflow: bounds [975,84][1080,210] → merkez (1027,147). resource-id menuitem_overflow, desc 'More options'.
- 'Register new account': bounds [596,402][1028,459] → merkez **(812,430)**. resource-id com.whatsapp:id/title.
- ELLE (812,430) synthetic tap → EKRAN ANINDA companion→RegisterPhone (registration_cc+phone ALANLARI GELDİ).

**FIX (agent.mjs deploy edildi):** register bloğu (a) sawCompanion=false OLSA BİLE onPhoneScreen()
değilse ⋮ menüyü 6× dene (eskiden sadece sawCompanion true'da), (b) ⋮ tapSyn(1027,147),
(c) 'Register new account' fallback tapSyn(812,430) (was tapScaled 802,433), (d) ulaşılamazsa
done('register_failed', REGISTER_FAILED) net hata (eskiden number'a limp edip 'phone bos' derdi).

**REGISTER SONRASI AKIŞ SORUNSUZ (mi7 +49 canlı):** numara ekranı→a11y SET_TEXT cc=49
phone=15219598639→submit→Next/Yes→PrimaryFlashCallEducationScreen→verify. HEPSİ GEÇTİ. DE proxy
(178.12.66.96 Frankfurt) ile 'Login not available' YOK. ★AMA sonda WhatsApp
CustomRegistrationBlockActivity (DEVICE_WALL) = NUMARA/CİHAZ BAN (x86 emülatör + numara itibarı,
TEKNİK DEĞİL). COMPLETED-yalan fix çalıştı: job COMPLETED ama account+panel FAILED+net sebep.

**mi7 HAZIRLIK REÇETESİ (bu testte kullanılan):**
1. `/opt/fleet-agent/waydroid/wd-run.sh mi7` (boot ~85sn, sys.boot_completed=1).
2. `adb connect 192.168.252.57:5555`.
3. DE proxy: eski redsocks 12345'i öldür (kill $(pgrep redsocks)), sonra
   `/opt/fleet-agent/waydroid/wd-proxy.sh mi7 DE td-customer-<AL_RESIDENTIAL_USER> <PROXY_PASS> <PROXY_HOST_ID>.eu.thordata.net 5555`
   → PROXY_RESULT + çıkış 178.12.66.96 Frankfurt DE. ★redsocks tek-port(12345) paylaşımlı, önce eskiyi öldür.
4. WhatsApp temiz: `am force-stop com.whatsapp; pm clear com.whatsapp` + a11y re-grant
   (settings put secure enabled_accessibility_services com.fleet.a11y/com.fleet.a11y.FleetA11yService).
   ★a11y servis adı FleetA11yService (FleetAccessibilityService DEĞİL).
5. ★EKRAN TUZAĞI: mi7 native 1080x2368, wm size 1080x2400 UYGULANMIYOR (reset bile 2368). a11y
   SET_TEXT koordinat kullanmaz→numara girişi etkilenmez, kör-tap koordinatları hafif kayar.
6. ★wd-proxy.sh port-reuse BUG ÇÖZÜLDÜ+DEPLOY (2026-07-08):★ Eski kod `pkill -f "redsocks -c
   /etc/redsocks-"` sadece KENDİ per-country config'lerini öldürüyordu; legacy /etc/redsocks.conf
   (tire yok) port 12345'i tutunca `redsocks -c $CONF` "Address already in use"→FAILED. FIX: pgrep
   ile aynı config zaten çalışıyorsa reuse; değilse `pkill -x redsocks` + `pkill -f "redsocks -c"` +
   `fuser -k 12345/tcp` + port serbest kalana kadar (10×0.5s) bekle + başlat. DE→TR→AL geçişleri
   ELLE ve AGENT JOB (EMULATOR_SET_PROXY) ile DOĞRULANDI: her ülke doğru çıkış (DE=Frankfurt,
   TR=5.25.152.8, AL=141.98.140.49 Tirana). Artık proxy modalından ülke gömme güvenilir.

★AGENT SHUTDOWN-HANG TUZAĞI (2026-07-08):★ `systemctl restart fleet-agent` bazen ESKİ process'i
'shutting down'da asılı bırakıp YENİ process'i başlatmıyor (systemd 'active' der ama job çekmez,
ps etimes eski). ÇÖZÜM: `pkill -9 -f agent.mjs` + reset-failed + restart. Agent job çekmiyorsa
ps -o etimes ile process yaşını KONTROL ET (taze mi?), log'da yeni 'starting — polling' var mı bak.

İlgili: [[whatsapp-otonom-kayit-hardening-2026-07-07]] [[wa-panel-guard-reroll-2026-07-08]]
[[public-api-jobhang-proxy-modal-2026-07-08]] [[waydroid-2nd-whatsapp-KAYIT-BASARILI-2026-07-06]]
