---
name: whatsapp-otonom-kayit-hardening-2026-07-07
description: "★★★WhatsApp otonom kayıt SAĞLAMLAŞTIRMA 2026-07-07★★★ registerWhatsApp'a izin ön-verme(23 izin+appops)+her adımda SS(snap/shots)+kırılgan adım retry(EULA 3x/submit doğrula/OTP geri-oku+keyevent fallback/HomeActivity teyidi) KODLANDI+DEPLOY. Dashboard /shots endpoint. Canlı test #3'te 2 GERÇEK BUG: (1)ÇÖZÜLDÜ 'Active default network:none'→WhatsApp'internet yok'→kök:elle eth0 down/up AĞI BOZAR, çözüm=TEMİZ wd-stop+wd-run RESTART(→network:100). (2)agent alert(custom-ROM/internet)kapatamıyor çünkü uiautomator bu WA build'inde HANG→butonları göremiyor→KALAN İŞ:koordinat-tabanlı fallback tap. OTP=operatör elle(yarı-otonom). Numara +355682342382 Albania"
metadata: 
  node_type: memory
  type: project
  originSessionId: cfb27ac2-236a-4e57-bdbf-a6c3555e147a
---

★2026-07-07 — Kullanıcı "WhatsApp otonomu sorunsuz her cihazda çalışsın, izinlerin tamamını baştan ver, her adımı SS ile izle, bug olunca düzelt, OTP operatör girer" dedi. Faz 4. Test cihazı #3 (mi3), numara **+355682342382 (Albania)**. İlgili: [[one-click-device-provision-2026-07-07]] (cihaz kurulumu), [[waydroid-2nd-whatsapp-MASTER-detay-2026-07-06]] (kayıt reçetesi), [[waydroid-3rd-mi3-setup-2026-07-07]] (#3 kurulum).

═══════════════════════════════════════════════════
# ★KODLANDI + DEPLOY EDİLDİ (agent.mjs + API, çalışıyor)★
═══════════════════════════════════════════════════
`registerWhatsApp` (deploy/kvm-host/agent/agent.mjs ~797) sağlamlaştırıldı — SIFIRDAN yazılmadı, mevcut güçlü fonksiyon güçlendirildi:
1. **İzin ön-verme (23 izin + appops)**: WA_PERMS listesi (RECEIVE_SMS/READ_SMS/CALL_PHONE/ANSWER_PHONE_CALLS/LOCATION×2/PHONE_NUMBERS/STORAGE×2/MEDIA×3/BLUETOOTH/NEARBY_WIFI/MEDIA_LOCATION+eskiler) pm grant döngü + `appops set <pkg> <op> allow` (RECEIVE_SMS/READ_SMS/SEND_SMS/READ_CALL_LOG/READ_PHONE_NUMBERS root fallback). → WhatsApp mid-flow izin dialog'u AÇMAZ.
2. **SS + hata yakalama**: `shots[]` dizisi + `snap(label)` helper (grabPng→base64+label+ts, son 12) + `done(label,obj)` wrapper (return'e shots ekler). Her ana adım+hata dönüşünde snap. Dönüş status'leri: NUMBER_ENTRY_FAILED/DEVICE_WALL/OTP_SCREEN_NOT_REACHED/OTP_WAIT/OTP_REJECTED/PROFILE_INCOMPLETE/CREATED — hepsi shots taşır.
3. **Kırılgan adım sağlamlaştırma**: EULA 3x retry+text-gitti-mi doğrula; submit re-tap 3x + ekran-değişti doğrula; typeOtp input text→geri-oku→olmadıysa keyevent rakam-rakam FALLBACK (keycode d+7); profil isim geri-oku; ★HomeActivity TEYİDİ (dumpsys window HomeActivity/fab → CREATED, yoksa PROFILE_INCOMPLETE) yanlış-pozitif önler.
4. **API**: agent.service complete REGISTER_WHATSAPP shots→Job.result. Yeni `GET /accounts/batch/accounts/:id/shots` (batch.service getRegistrationShots: son REGISTER_WHATSAPP job'ın result.shots). Dashboard SS gösterimi HENÜZ eklenmedi (WhatsappView).

═══════════════════════════════════════════════════
# ★CANLI TEST #3 — 2 GERÇEK BUG BULUNDU★
═══════════════════════════════════════════════════
Test: `FLEET_TEST_JOB='{"type":"REGISTER_WHATSAPP","serial":"192.168.255.113:5555","payload":{"phoneNumber":"+355682342382","fullName":"..."}}' node /opt/agent.mjs`. Akış EULA'da TAKILDI.

## BUG 1 — ★ÇÖZÜLDÜ★ "Active default network: none" (WhatsApp "internet yok" alert)
- **BELİRTİ**: WhatsApp EULA→"An internet connection is required to activate" alert. `dumpsys connectivity | grep "Active default network"` = **none** (#2 çalışanı=100).
- **KÖK SEBEP**: curl/ping çalışıyor (redsocks Albania IP OK) AMA Android ConnectivityService ethernet'i CONNECTED+VALIDATED görmüyor. `dumpsys ethernet` → "Current Ethernet state:" BOŞ (#2'de eth0 tracked+CONNECTED). EthernetNetworkFactory eth0 için sadece NetworkOffer üretmiş, NetworkAgentInfo CONNECTED YOK.
- **★ÇÖZÜM (kanıtlı)**: elle `ip link set eth0 down/up` YAPMA (ağı BOZAR, ADB de kopar). Çözüm = **TEMİZ RESTART**: `bash /opt/fleet-agent/waydroid/wd-stop.sh mi3` + `nohup setsid bash wd-run.sh mi3 &` → boot sonrası route ekle → `Active default network: 100` (VALIDATED). Statusbar'da ethernet ikonu belirir, internet-alert kaybolur.
- **DERS**: WhatsApp "internet yok" = Active-network:none = **temiz wd-restart** (elle route/eth0 oynatma değil). Her cihazda ilk kurulumda ethernet register olmayabilir → restart garantiler.

## BUG 2 — ★ÇÖZÜLDÜ 2026-07-07 (koordinat kör-tap fallback KODLANDI+DEPLOY)★
- **BELİRTİ**: WhatsApp açılışında "You have a custom ROM installed / OK" + "internet required / OK" alert'leri. Agent'ın `seen()`/EULA tap'ı ÇALIŞMIYOR → alert açık → EULA erişilemez → EULA'da takılır.
- **KÖK SEBEP**: agent `seen()`/`tapSynIf()` **uiautomator dump'a dayanıyor**, uiautomator bu WA build'inde (2.25.x) HANG → agent butonları GÖREMİYOR.
- **★ÇÖZÜM (deploy edildi, agent.mjs)**: yeni `h.tapScaled(refX,refY,refW=1080,refH=2400)` helper — `wm size` okur (Override/Physical), koordinatı gerçek ekrana ölçekler, `input tap` (synthetic, dump'sız) yapar. Alert bloğu (4 tur) + EULA bloğu (4 tur) HER TURDA: uiautomator dene (try/catch, hang'de catch→devam) + AYRICA **kör koordinat tap** yap (garanti). OK=**582,1349**, EULA=**540,1909** (küçük harf casing sorunu da tapScaled ile bypass, hem büyük hem küçük tapSynIf + blind). EULA turları arası tekrar OK-tap (alert geri gelebilir). Kör tap alert yoksa zararsız no-op.
- KANITLI KOORDİNATLAR (1080x2400): OK=582,1349, "Agree and continue"=540,1909.

═══════════════════════════════════════════════════
# ORTAM / KOMUTLAR (sonraki session)
═══════════════════════════════════════════════════
- **#3 hazır durum**: root(uid=0)✓, vtouch(wa-bringup)✓, a11y bind✓, ekran 1080x2400@421✓, proxy Albania(cc-AL, çıkış IP 141.98.143.153/79.106.x Albania)✓, Active network 100✓ (TEMİZ restart sonrası).
- **#3 ADB KRONİK KARARSIZ** (restart sonrası beter): her komut timeout/kesme. `exec-out screencap -p > /tmp/x.png` (shell screencap'ten stabil). Kurtarma: `adb disconnect; adb connect 192.168.255.113:5555`. ★SS Windows'ta oku: 1080x2400 > 2000px limit → PowerShell System.Drawing ile 0.55 resize (convert/PIL YOK sunucuda).
- **Kayıt hazırlık**: `su -c "am force-stop com.whatsapp; pm clear com.whatsapp; pm disable com.google.android.gms/.chimera.PersistentDirectBootAwareApiService"`.
- **OTP**: operatör elle girer (yarı-otonom). Numara ekranına kadar otonom→OTP_WAIT→operatör OTP→devam. Dashboard OTP UI: WhatsappView.tsx (mevcut, AWAITING_OTP'de kutu açılır).
- Deploy: agent→/opt/agent.mjs + API build+restart (Faz4 deploy edildi).
