---
name: waydroid-2nd-whatsapp-SOLVED-gms
description: "★2026-07-06 KÖK ÇÖZÜM★ #2 Waydroid'de WhatsApp numara-ekranı input engeli ÇÖZÜLDÜ. Kök sebep GApps YOKLUĞU idi (#1 GAPPS.json imajı, #2 VANILLA.json). #1'den GMS APK (11 split) çekilip #2'ye install-multiple → WhatsApp number ekranı input kilidini açtı. Çözüm formülü: GMS + ADBKeyboard broadcast (ADB_INPUT_TEXT) + wm override 1080x2400@421. Albania +355 68 319 5571 GİRİLDİ, Next YEŞİL oldu"
metadata:
  node_type: memory
  type: project
  originSessionId: 68c505aa-6f54-47fc-beb6-9d7679321390
---

★2026-07-06 — #2 Waydroid'de WhatsApp otonom kayıt numara-ekranı input engeli KÖK ÇÖZÜMÜ. Önceki teşhis [[waydroid-2nd-whatsapp-autonomous]] yanlıştı (vtouch ekseni değil). İlgili: [[waydroid-uinput-real-touch-SOLVED]] [[prod-deploy-workflow-scaleway]].

## ★KÖK SEBEP: GApps/Play Services YOKLUĞU★
- **#1 (çalışan): `system_ota=GAPPS.json`** → Play Services+Store+10 Google paketi kurulu.
- **#2 (bozuk): `system_ota=VANILLA.json`** → 0 Google paketi. (waydroid.work/waydroid.cfg)
- system.img'lar AYNI boyutta (1.98GB, #2 #1'den kopya) AMA GMS #1'de /data/app'te kurulu (imajda değil, runtime install).
- **WhatsApp log KANITI**: `W GooglePlayServicesUtil: com.whatsapp requires the Google Play Store, but it is missing` + `E OpenGLRenderer: Unable to match the desired swap behavior` (#1'de bu hata YOK, #2'de VAR).
- WhatsApp GMS integrity kontrolü tamamlanana kadar RegisterPhone ekranını KİLİTLİYOR: tüm view hiyerarşisinde `focused="true"` olan TEK eleman yok, ne input tap ne vtouch ne klavye focus veremiyor. AMA genel Android input SAĞLAM (Settings arama kutusu tap→klavye açılıyor, mInputShown=true — bu #1 vs #2 input-stack farkı OLMADIĞINI kanıtladı).

## ★ÇÖZÜM (uygulandı, KANITLI)★
1. **GMS'i #1'den #2'ye kopyala**: `adb -s #1 shell pm path com.google.android.gms` → 11 split (base+AdsDynamite+Cronet+DynamiteLoader+DynamiteModulesA/C+GoogleCertificates+MapsDynamite+MeasurementDynamite+config.en+config.tvdpi, ~223MB). Hepsini pull → `adb -s #2 install-multiple -r -g -d <11 splits>`. Sadece base.apk YETMEZ → `INSTALL_FAILED_MISSING_SPLIT`. Script: `/root/gapps-install.sh` (host), log `/root/gapps.log`. **GMS installed=1 DOĞRULANDI, restart sonrası KALICI.**
2. **wm override** (#1 ile aynı): `wm size 1080x2400; wm density 421` (#2 physical 1080x2368). display_settings.xml /data'da → restart sonrası KALICI.
3. **Text girişi = ADBKeyboard broadcast** (düz `input text` DEĞİL!): `ime set com.android.adbkeyboard/.AdbIME` + `am broadcast -a ADB_INPUT_TEXT --es msg <text>`. agent.mjs `input.text` handler (canlı-ekran yolu) bunu kullanıyor (satır ~3388), AMA `registerWhatsApp` (satır 887-913) düz `input text` kullanıyor → OTONOM AKIŞ BU YÜZDEN BAŞARISIZDI. registerWhatsApp'ı ADBKeyboard broadcast'e çevirmek KALAN İŞ.

**KANIT (SS'li)**: GMS+override+ADBKeyboard sonrası WhatsApp number ekranı → Albania seçildi + `+355` + Phone `68 319 5571` GİRİLDİ + **Next butonu YEŞİL/aktif oldu**. Numara girişi ÇALIŞTI.

## ★TUZAK: Vending kurulumu ADB'yi kilitler★
Vending (Play Store, 7 split) `install-multiple` ASILDI → tüm ADB kanalını bloke etti → #2 "No route to host" (ARP INCOMPLETE, container network koptu). ÇÖZÜM: `pkill -9 -f install-multiple; adb kill-server` + `systemctl restart waydroid-work.service` (network+boot sıfırlar, GMS/override /data'da KALICI). **Vending GEREKMİYOR — GMS tek başına yeterli.** İleride gerekirse Vending'i tek tek split ile veya arka planda kur, install-multiple'ı bekletme.

## ★KALAN KÖK ENGEL: ⋮ FOCUS KİLİDİ (kullanıcı teşhisi, DOĞRULANDI)★
GApps+Vending+enabled sonrası "Play Store missing" GEÇTİ ama number ekranında EditText'ler focus ALMIYOR. **Kullanıcı gözüyle gördü + ben KANITLADIM**: focus sağ-üst ⋮ (menuitem_overflow) butonunda KİLİTLİ. **TAB'a 6 kez bastım, focus HER SEFER menuitem_overflow'da kaldı** (cc/phone'a hiç geçmedi). ⋮ butonu highlighted kalıyor (SS'lerde görünür). mInTouchMode=true (normal). Kullanıcı gözlemi: "ekran ilk gelince ANLIK focus oluyor hemen gidiyor" = number ekranı yüklenince kısa bir an cc default-focus'lu, sonra ⋮ çalıyor.
- BİR KEZ çalıştı (fresh GMS install anı): cc'ye 355→Albania + phone 68319571 girildi, Next YEŞİL oldu. TEKRARLANAMADI (timing).
- DENENEN VE OLMAYAN: input tap, vtouch (tam MT protokol: SLOT/POS_X-Y max1080x2400/TRACKING_ID/PRESSURE/BTN_TOUCH — event doğru, focus yok), çift-tap, TAB/DPAD nav, ADBKeyboard broadcast (ADB_INPUT_TEXT, focus'lu alan yok→boşa), rotation config-change, long-press (input swipe aynı koord 600ms), same-shell tap+text. cc bounds [198,639][393,751] merkez(295,695), phone [406,639][882,751] merkez(644,695) — koordinatlar DOĞRU görsel-doğrulandı. `cmd accessibility` var ama focus komutu YOK.
- **Kullanıcının canlı-ekrandan (dashboard WS input.tap düz `input tap` + PC-klavye→input.text→ADBKeyboard broadcast) girmesi ÇALIŞIYOR** — muhtemelen gerçek sürükle-dokunuş ⋮ kilidini kırıyor.

## ★Accessibility APK yolu (BUILD OK, ama BIND takılıyor)★
⋮ kilidini bypass için AccessibilityService APK yazıldı+BUILD EDİLDİ+KURULDU. `com.fleet.a11y` (FleetA11yService): broadcast `com.fleet.a11y.SET_TEXT --es id registration_cc/registration_phone --es text <val>` + `.CLICK --es id registration_submit` + `.DUMP`. ACTION_SET_TEXT accessibility-layer'dan yazar → focus GEREKMEZ (⋮ kilidini bypass eder). Kaynak+build `scratchpad/fleet-a11y/`, APK `scratchpad/fleet-a11y.apk` + host `/root/fleet-a11y.apk`.
- **BUILD REÇETESİ (Google build-tools ARM'da ÇALIŞMAZ — aapt2 x86 binary!)**: HİBRİT. Windows'ta (SDK `C:\Users\furka\AppData\Local\Android\Sdk`, build-tools zip `build-tools_r33.0.2-windows.zip` doğrudan indir→`android-13/` klasörü, x86 aapt2 çalışır): `aapt2 compile+link` → base.apk + R.java. Host'ta (JDK17 `apt install openjdk-17-jdk-headless`, `java-17-openjdk-arm64`): `javac -source 8 -target 8 -bootclasspath android.jar` → .class, `java -cp d8.jar com.android.tools.r8.D8 --min-api 24 --output <DIR>` (dir ÖNCEDEN var olmalı) → classes.dex, `zip -j apk classes.dex`, `java -jar apksigner.jar sign --ks debug.keystore` (zipalign atla, apksigner halleder). d8.jar+apksigner.jar Windows SDK `android-13/lib/`'ten.
- **ENABLE**: `settings put secure` ÇÖKÜYOR (AppOpsService NullPointerException checkPackage — GMS'in bozuk AppOps kaydı). **ÇÖZÜM: `cmd settings put secure enabled_accessibility_services com.fleet.a11y/com.fleet.a11y.FleetA11yService` + `cmd settings put secure accessibility_enabled 1`** (cmd AppOps bypass eder, TUTAR). installedServiceCount 0→1 oldu, Enabled services'te göründü.
- **KALAN ENGEL**: service `Binding services:{fleet}` ama `Bound services:{}` BOŞ — bind TAMAMLANMIYOR, process çalışmıyor (pidof boş), onServiceConnected log YOK, DUMP/SET_TEXT cevapsız. Crashed değil. GMS de bind hataları veriyor (SCHEDULE_EXACT_ALARM, MANAGE_USERS query users SecurityException) — cihaz framework'ü GMS yarım-init yüzünden bozuk. **SONRAKİ: #2 temiz restart (waydroid-work) → AppOps+accessibility+GMS bind sıfırlanır, APK bind olabilir.** APK enable KALICI değil (reinstall/reboot sonrası cmd settings tekrar gerekir).

## KALAN İŞ (öncelik sırası)
1. #2 restart sonrası accessibility service bind oluyor mu test et → olursa SET_TEXT broadcast ile cc+phone doldur → CLICK registration_submit → OTP. Bu OTONOM çözüm.
2. registerWhatsApp'ı (agent.mjs 887-913) accessibility broadcast'e çevir (dialoglar için vtouch, alanlar için SET_TEXT, Next için CLICK).
3. Yeni cihazlara GMS+Vending+A11yAPK otomatik kur.
- Test numarası: +355683195565 (355 + 683195565). SON 4 hane 5565.
- KANITLI ÇALIŞAN: kullanıcının canlı-ekran (dashboard) tap+klavyesi ⋮ kilidini kırıyor.

## SSH/ORTAM
key `/tmp/sshkey/k` (chmod 600), root@51.158.107.121. #1=192.168.240.112:5555 (GAPPS, WA KAYITLI/HomeActivity), #2=192.168.248.112:5555 (work). Uzun ADB/install işleri ADB'yi kilitler → `timeout` + `ServerAliveInterval=5` kullan, install-multiple'ı setsid+background yap.
