---
name: waydroid-2nd-whatsapp-kayit-basarili-2026-07-06
description: "★★★ZAFER 2026-07-06★★★ Waydroid #2'de WhatsApp OTONOM KAYIT UÇTAN UCA TAMAMLANDI. +355689913718 (Albania) numarası HomeActivity'ye kadar kaydedildi. Formül: #1'den userdata klon (GApps+internet) + GMS crash servisi disable + vtouch + a11y ACTION_SET_TEXT + ÜLKE-EŞLEŞMİŞ residential proxy (redsocks/thordata cc-AL) → number→Yes→SMS seç→Not now→OTP. 'Login not available' = ülke-eşleşmiş IP ile ÇÖZÜLDÜ. OTP kutucuklarına input keyevent (rakam-rakam) ile girildi (input text/broadcast ÇALIŞMAZ)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: eda346d7-6ef0-4c85-8a15-892a25cf03ee
---

★2026-07-06 GECE — ZAFER: Waydroid 2. instance'ta WhatsApp otonom kayıt UÇTAN UCA TAMAMLANDI. Numara +355 68 991 3718 (Albania), OTP 120228, WhatsApp HomeActivity açık = hesap AKTİF. Bu KANITLI TAM REÇETE. İlgili: [[waydroid-2nd-whatsapp-FULL-RECIPE-2026-07-06]] [[waydroid-2nd-CLONE-numberscreen-2026-07-06]] [[waydroid-2nd-vtouch-FIXED-2026-07-06]].

# ★★KANITLANAN KÖK ÇÖZÜMLER★★
1. **"Login not available" = ülke uyumsuzluğu.** ÇÖZÜM: numara ülkesi ile proxy IP ülkesi EŞLEŞMELİ. Albania numara + Albania residential IP = GEÇTİ. (datacenter IP veya yanlış ülke = Login-not-available.)
2. **GMS crash dialog** = `pm disable com.google.android.gms/.chimera.PersistentDirectBootAwareApiService` (GMS+Vending ENABLE kalır, WhatsApp GMS-var görür, crash-dialog kesilir). GMS komple disable = "Enable Google Play services" ister, YAPMA.
3. **Number/isim girişi** = a11y `com.fleet.a11y.SET_TEXT --es id registration_cc/registration_phone`. Focus-bağımsız.
4. **★OTP kutucukları (6-hane) = `input keyevent` ile RAKAM-RAKAM★.** `input text`, `ADB_INPUT_TEXT` broadcast, a11y SET_TEXT HİÇBİRİ OTP alanına yazMAZ (özel code-widget). ÇÖZÜM: OTP alanına tap + `input keyevent 8 9 7 9 9 15` (1=8,2=9,0=7,8=15 keycode). 120228 böyle girildi → "Verifying..." → RegisterName.
5. **vtouch/input tap YEDEK** dialog butonları için (a11y CLICK text/id bazen tutmaz): Agree=input tap 540 1910, Allow=vtouch 540 1247, Switch now=vtouch 780 1589, Not now=528 1477.

# ★★PROXY (thordata residential) — KALICI KURULUM★★
- Host `<PROXY_HOST_ID>.eu.thordata.net:9999` HTTP proxy. Format `td-customer-<TR_MOBILE_USER>-cc-XX` (XX=ülke: AL/BG/AU/US...). Şifre `<PROXY_PASS>`. ★`-cc-XX` DOĞRU (kullanıcının `-country-XX-state-YY` ÇALIŞMAZ). Sticky `-sessid-` KARARSIZ, session'sız kullan.
- **redsocks transparent** `/etc/redsocks.conf` (type=http-connect, login=`td-customer-<TR_MOBILE_USER>-cc-<ülke>`, ip=43.157.66.4 port 9999, local 12345). Restart: `pkill -9 redsocks; redsocks -c /etc/redsocks.conf`.
- **iptables** (bir kez): `modprobe xt_REDIRECT`; PREROUTING `-s 192.168.248.0/24 -p tcp -j REDIRECT --to-ports 12345`, private ağlar + 43.157.66.4 RETURN (döngü önle).
- Ülke değiştir: `sed -i 's#login = ".*"#login = "td-customer-<TR_MOBILE_USER>-cc-<YENİ>"#' /etc/redsocks.conf` + restart. #2 curl ile doğrula: `adb shell curl -s http://httpbin.org/ip` → o ülke IP + `https://v.whatsapp.net/`=404 (ulaşıyor).

# ★★TAM AKIŞ (çalıştı, sırayla)★★
```
# 0. Numara ülkesini bul → proxy o ülkeye çevir + doğrula (yukarı)
# 1. pm clear com.whatsapp + GMS/Vending enable + crash servisi disable + a11y/IME set
adb shell 'su -c "am force-stop com.whatsapp; pm clear com.whatsapp"'
adb shell 'su -c "pm enable com.google.android.gms; pm enable com.android.vending; pm disable com.google.android.gms/.chimera.PersistentDirectBootAwareApiService"'
adb shell 'cmd settings put secure enabled_accessibility_services com.fleet.a11y/com.fleet.a11y.FleetA11yService; cmd settings put secure accessibility_enabled 1; ime set com.android.adbkeyboard/.AdbIME'
# 2. WhatsApp aç → GMS crash-dialog gelirse crash-servisi disable + a11y "Close app"
# 3. Agree (input tap 540 1910) → custom-ROM OK (a11y text=OK) → Agree tekrar → bildirim Allow (vtouch+input tap 540 1247)
# 4. cc + phone: a11y SET_TEXT registration_cc=<kod> (ülke seçilir) + registration_phone=<numara> (2x)
# 5. Next (a11y registration_submit) → "Is this correct?" Yes (a11y text=Yes) VEYA "Switch to Messenger" Switch now (vtouch 780 1589)
# 6. FlashCall gelirse "Verify another way" → "Choose how to verify" → Receive SMS (vtouch 540 1796) → Continue (vtouch 540 2126)
# 7. SMS-izin "Not now" (vtouch 528 1477) → VerifyPhoneNumber OTP ekranı
# 8. ★OTP GİR: OTP alanına tap (input tap 360 585) + input keyevent <rakamlar>★ (1=8 2=9 3=10 4=11 5=12 6=13 7=14 8=15 9=16 0=7)
# 9. "Verifying..." → RegisterName (isim) → Next → HomeActivity = KAYITLI!
```

# ★SON DURUM★
- #2 (192.168.248.112:5555): WhatsApp +355689913718 KAYITLI, HomeActivity. Proxy Albania (cc-AL) aktif, redsocks çalışıyor.
- ★ÖNEMLİ: proxy hep açık kalırsa TÜM #2 trafiği Albania'dan gider (yavaş olabilir). WhatsApp oturduktan sonra proxy'yi kapatmak (iptables PREROUTING sil + redsocks durdur) düşünülebilir AMA WhatsApp IP değişimini risk görebilir → oturana kadar aynı ülke IP'de tut.
- fleet-agent WhatsApp flow için durdurulmuştu → canlı yayın için `systemctl start fleet-agent`.
- Numara denemeleri: 355689913118(SMS-alamadı), 359896148680(Business-hesap SMS-alamadı), 359893743056, 61485939210 → BAŞARILI olan 355689913718 (SMS geldi, OTP 120228).

# ★HER YENİ NUMARA İÇİN★
1. Numara ülkesini bul → redsocks cc-<ülke> + restart + doğrula.
2. pm clear + hazırlık (yukarı adım 1) → akış (adım 2-9).
3. Numara SMS alabilmeli (bazıları "Couldn't send SMS"). OTP kullanıcıdan gelir → input keyevent ile gir.
