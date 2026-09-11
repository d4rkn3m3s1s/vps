---
name: whatsapp-profil-degistirme-2026-07-07
description: "★★★WhatsApp PROFİL DEĞİŞTİRME (foto+isim) KANITLI REÇETE 2026-07-07★★★ #2'de AVVABET logo + 'Zara' ismi UÇTAN UCA BAŞARILI (SS-SS koordinat-tabanlı, synthetic input tap + ADBKeyboard). Tam akış: ⋮menü(1024,118)→Settings(672,936)→profil-kartı(536,490)→avatar→Gallery→logo-seç→CropImage Done(896,2211)→Name-satırı(245,1064)→5×DEL+ADB_INPUT_TEXT→Save(536,2118). Logo galeri: /sdcard/DCIM/Camera + MEDIA_SCANNER_SCAN_FILE broadcast. ★#1 restart dersi: WhatsApp package 'No activity found'/ağ 'none' → TEMİZ session restart(weston /tmp/xdg wayland-1) DÜZELTİR. #1 'You have been logged out' (numara kayıtsız, yeniden giriş gerek)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: cfb27ac2-236a-4e57-bdbf-a6c3555e147a
---

★2026-07-07 — Kullanıcı "1. cihaza Melis, 2. cihaza Zara ismi + AVVABET logosu profil yap, SS al adım adım" dedi. Logo: AVVABET Casino&Sport Betting (siyah zemin, altın AVVA + gümüş BET). #2 TAMAMLANDI, #1 logout. İlgili: [[waydroid-2nd-whatsapp-MASTER-detay-2026-07-06]] [[one-click-device-provision-2026-07-07]].

═══════════════════════════════════════════════════
# ★#2'DE UÇTAN UCA BAŞARILI — TAM KOORDİNAT REÇETESİ (1080x2400)★
═══════════════════════════════════════════════════
Cihaz #2 = 192.168.248.112:5555 (WhatsApp KAYITLI +355 68 991 3718, HomeActivity). Ekran 1080x2400. ★TÜM tap'ler `input tap` (SYNTHETIC) — menü/dialog/liste için çalıştı (vtouch FIFO GEREKMEDİ bu akışta). SS: `exec-out screencap -p > /tmp/x.png` (shell screencap'ten stabil), Windows'ta PowerShell System.Drawing 0.55 resize (1080x2400>2000px Read limiti; convert/PIL sunucuda YOK).

## 0) LOGO GALERİYE (ŞART — WhatsApp Gallery boş gelir yoksa)
```
scp logo → sunucu /tmp/avvabet.jpg
adb -s $D2 push /tmp/avvabet.jpg /sdcard/Pictures/avvabet.jpg
adb -s $D2 shell su -c "mkdir -p /sdcard/DCIM/Camera; cp /sdcard/Pictures/avvabet.jpg /sdcard/DCIM/Camera/avvabet.jpg"
adb -s $D2 shell su -c "am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/DCIM/Camera/avvabet.jpg"
```
★İlk Gallery açılışı BOŞ olabilir (media henüz taranmamış) → picker'ı BACK ile kapat, avatar'a tekrar tap, Gallery tekrar aç → logo görünür (DCIM/Camera+Pictures'tan 2-3 kopya çıkar).

## 1) WhatsApp aç + Settings'e git
- `am start -n com.whatsapp/.Main` → HomeActivity (chat listesi).
- ⋮ (More options, sağ üst): `input tap 1024 118` → PopupWindow açılır (New group/Broadcast/Linked devices/Starred/Read all/**Settings**).
- **Settings**: `input tap 672 936` → SettingsTabActivity.

## 2) Profil ekranına gir
- Settings'te ÜST profil kartına (avatar+isim): `input tap 536 490` → ProfileInfoActivity.
- ★Bu ekranda avatar'a TEKRAR `input tap 536 490` → "Profile picture" alt-menü (Camera/Gallery) açılır VE tam "Profile" ekranı (Name/About/Username/Phone) görünür.

## 3) FOTO değiştir (AVVABET)
- **Gallery**: `input tap 254 2200` → MediaPickerActivity (Recents).
- **Logo seç** (sol-üst thumbnail): `input tap 173 390` → CropImage ekranı (Cancel/döndür/Done altta).
- **Done**: `input tap 896 2211` → ProfileInfoActivity'ye döner, avatar AVVABET olur. ✓

## 4) İSİM değiştir (Zara / Melis)
- **Name satırı**: `input tap 245 1064` → ProfileInfoFragmentHost (isim düzenleme, "Your name" alanı odaklı, altta "ADB Keyboard {ON}" + yeşil Save).
- **Mevcut sil**: `input keyevent KEYCODE_DEL ×5` (mevcut isim "q" idi, 1 char ama 5 DEL güvenli).
- **Yeni isim yaz**: `am broadcast -a ADB_INPUT_TEXT --es msg Zara` (ADBKeyboard broadcast — input text DEĞİL). ✓ "Zara" (4/25) göründü.
- **Save**: `input tap 536 2118` (yeşil buton alt) → ProfileInfoActivity, Name=Zara. ✓

## SONUÇ #2: avatar=AVVABET, Name=Zara, Phone=+355 68 991 3718 KAYITLI. ✓✓

═══════════════════════════════════════════════════
# ★#1 (240.112) — KRİTİK BULGULAR + LOGOUT★
═══════════════════════════════════════════════════
- **BUG**: #1 WhatsApp `am start` → "Activity class com.whatsapp/.Main does not exist" + `resolve-activity` → "No activity found". APK var (base.apk), enabled, msgstore.db 2.5MB (kayıt verisi VAR) ama runtime'da package ÇÖZÜLEMİYOR. + `Active default network: none` (#3'teki ile aynı ağ sorunu). Kök: #1 bozuk/yarım boot (package DB senkronsuz).
- **★ÇÖZÜM: TEMİZ SESSION RESTART** (#1 = default waydroid instance):
  - #1 weston `--socket=wayland-1 --width=720 --height=1280`, `XDG_RUNTIME_DIR=/tmp/xdg` (wayland-0 DEĞİL!). Socket `/tmp/xdg/wayland-1`.
  - `waydroid session stop` sonra ★`env XDG_RUNTIME_DIR=/tmp/xdg WAYLAND_DISPLAY=wayland-1 waydroid session start` (düz `waydroid session start` "Wayland socket doesn't exist" verir — ENV ŞART). weston zaten çalışıyordu (durdurma).
  - Boot ~70sn → resolve-activity `com.whatsapp/.Main` ✓ + Active network **100** ✓ + root uid=0 ✓. HER İKİ sorun (package+ağ) temiz restart ile düzeldi.
- **★AMA #1 WhatsApp "You have been logged out"** (LogoutMessageActivity): "Your phone number is no longer registered with WhatsApp on this phone" + "Log back in" butonu. #1'in numarası artık kayıtlı DEĞİL (oturum sonlanmış/başka cihazda açılmış). Profil için ÖNCE yeniden giriş (numara+OTP) gerekir → kullanıcı numara vermeli.

═══════════════════════════════════════════════════
# DERSLER (her cihazda profil için)
═══════════════════════════════════════════════════
- WhatsApp profil: tamamı SYNTHETIC `input tap` + koordinat (uiautomator WA'da HANG eder, seen()/screenText() güvenilmez → SS-SS koordinat sür).
- Logo galeri: DCIM/Camera + MEDIA_SCANNER broadcast; ilk Gallery boşsa BACK+tekrar-aç.
- İsim: ADBKeyboard `ADB_INPUT_TEXT` broadcast (input text değil).
- Cihaz WhatsApp bozuk (activity/ağ) → temiz session restart (default #1: env XDG/wayland-1; diğerleri wd-stop+wd-run).
- SS: exec-out screencap + PowerShell resize (Windows), veya agent snap/grabPng.
