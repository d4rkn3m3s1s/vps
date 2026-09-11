---
name: waydroid-2nd-whatsapp-autonomous
description: "★2026-07-06★ #2 Waydroid TAM KURULU (root/Magisk+S21 spoof+vtouch+1080x2400+fleet ONLINE) + agent.mjs'e 4 bug fix (dialog/menü synthetic tap, çözünürlük, numara-doğrulama). WhatsApp kayıt akışı numara EKRANINA kadar %100 çalışıyor. KALAN KÖK ENGEL: numara ekranında EditText FOCUS ALMIYOR (mServedView=null, focused=false — ne synthetic ne vtouch ne AdbKeyboard klavye açamıyor)"
metadata:
  node_type: memory
  type: project
  originSessionId: 68c505aa-6f54-47fc-beb6-9d7679321390
---

★2026-07-06 — Kullanıcı: "#2'de WhatsApp tam otonom bugsuz: numara ver→OTP→kayıt→hesap aç, SS'li; BÜTÜN yeni cihazlarda hatasız çalışsın (agent.mjs fix)". İlgili: [[waydroid-second-instance-scaleway]] [[whatsapp-full-suite-hardening]] [[waydroid-uinput-real-touch-SOLVED]].

## ★#2 TAM KURULU (hepsi canlı doğrulandı, KALICI)★
- **Root**: Magisk `/data/adb` + overlay `/var/lib/waydroid.work/overlay/system/etc/init/magisk` + **bootanim.rc** boot-hook (#1'den klonlandı — data-kopyası TEK BAŞINA yetmez, overlay+bootanim.rc ŞART; magiskinit boot-time enjekte olur). `su -c id`→uid=0. `/opt/wd2-magisk.sh` scripti.
- **Spoof**: `/data/adb/wa-bringup.sh` (resetprop S21: fingerprint samsung/o1seea/o1s:13/.../G991BXXU5CVK1:user/release-keys, verifiedbootstate green, flash.locked 1). `getprop ro.product.model`→SM-G991B, tags→release-keys. WhatsApp "Login not available" GEÇİLDİ (sadece zararsız "custom ROM" uyarısı çıkıyor).
- **vtouch**: `/data/adb/vtouch` binary + FIFO `/data/local/tmp/vt.fifo` + `/dev/input/event1`="vtouch". `/dev/uinput` config_nodes'a bind eklendi (`lxc.mount.entry = /dev/uinput dev/uinput ...`). wa-bringup boot-sonrası wrapper'da çalışıyor.
- **Çözünürlük**: `/opt/wd2-run.sh` weston `--width=1080 --height=2400` (BAŞTA 720x1280'di→vtouch 1080x2400 için derlenmiş, uyumsuzdu→düzeltildi). wm size 1080x2368.
- **APK**: WhatsApp 2.26.25.81 + AdbKeyboard #1'den `/data/app`'ten host-kopya + `adb install` (VANILLA'da Play yok). WhatsApp APK host'ta `/tmp/whatsapp.apk` (143MB).
- **freeze fix**: `suspend_action=none` YETMEZ (waydroid hardware_manager.suspend() `none` bilmiyordu→hep freeze). FIX: `/opt/waydroid-mi2/tools/services/hardware_manager.py suspend()`'e `if action=="none": return` eklendi. Artık idle'da FROZEN olmuyor.
- **fleet**: Device "Waydroid #2 (work)" id `cmr8hbj3y01is7m99w1ar0ue1`, `192.168.248.112:5555`, host Scaleway ARM PAR1 (`cmr3o4l24000fj5rsf2kjxvrd`). POST /devices + PUT hostId. fleet-agent override'a `ExecStartPre=adb connect 192.168.248.112:5555`. **ONLINE**, agent iki cihaza da job dağıtıyor (serial job'dan gelir, tek agent N cihaz).

## ★agent.mjs'e 4 BUG FIX (yerelde /scratchpad/agent.mjs, /opt/agent.mjs'e deploy)★
registerWhatsApp yeni WhatsApp 2.26 akışına göre (hepsi = BÜTÜN cihazlarda geçerli):
1. **Custom-ROM alert + EULA dialog → SYNTHETIC tap** (`tapSynIf` — vtouch dialogları açıp anında kapatıyor, akış EULA'da takılıyordu). 3x retry loop.
2. **Companion QR ekranı → ⋮ "Register new account" → synthetic + 4x retry** (WhatsApp modern varsayılan "Link as companion device" açıyor, new-number signup ⋮ menüsünde).
3. **Confirmation OK → synthetic**.
4. **Numara-giriş doğrulaması + dürüst hata**: numara girilmezse OTP_WAIT DÖNMEZ (eskiden yalan-pozitif OTP_WAIT vardı, WhatsApp SMS göndermeden), `NUMBER_ENTRY_FAILED`/`OTP_SCREEN_NOT_REACHED` döner. OTP ekranı `seen('digit code')`/verify_sms_code_input ile DOĞRULANIR.
**KANIT: akış WhatsApp aç→custom-ROM OK→EULA→Register new account→NUMARA EKRANI (RegisterPhone) hepsi ÇALIŞIYOR** (screenshot'larla, +355683195565 ile).

## ★★KALAN KÖK ENGEL — NUMARA EKRANI EditText FOCUS ALMIYOR★★
`com.whatsapp:id/registration_cc` + `registration_phone` DÜZ EditText (bounds cc[393,307][476,355] phone[482,307][686,355]). AMA:
- **Ne synthetic `input tap`, ne vtouch FIFO, ne AdbKeyboard** alana focus veremiyor.
- **KESIN TEŞHİS (dumpsys input_method)**: tap sonrası `focused="false"`, `mServedView=null`, `mInputShown=false` — HİÇBİR view input'a bağlanmıyor, KLAVYE AÇILMIYOR.
- `input text` yazınca alan boş kalıyor (focus yok çünkü).
- **Tuhaf**: bir denemede `input tap`+`input text 355` CC'ye yazıldı→Albania seçildi (nadir başarı), ama tekrarlanamıyor → TIMING/FOCUS KARARSIZLIĞI.
- vtouch physical eksen 1080x2400, ekran 1080x2368 (Y'de 32px fark — muhtemelen zararsız).
- IME'ler kurulu: LatinIME (default) + AdbKeyboard.

**★#1 vs #2 KIYAS (dumpsys input, canlı) — EN DEĞERLİ İPUCU★:**
- #1 (ÇALIŞIYOR): weston `--width=720 --height=1280`, vtouch InputReader **X max=719, Y max=1247**, wm size 1080x2400.
- #2 (BOZUK): weston (denendi 720 VE 1080), vtouch InputReader **X max=1079, Y max=2367**, wm size 1080x2368.
- config_nodes uinput bind İKİSİNDE de AYNI. getevent ikisinde de event1="vtouch".
- **KİLİT**: #1'in vtouch ekseni (719/1247) ekranından (1080/2400) FARKLI ama yine de focus veriyor (agent rescale ediyor). #2'nin vtouch ekseni (1079/2367) ekranına yakın ama focus VERMİYOR. Yani eksen-boyutu tek başına neden DEĞİL.
- weston 1080→720 değiştirmek #2 wm size'ı değiştirmedi (hâlâ 1080x2368) — Waydroid çözünürlüğü weston pencere boyutundan bağımsız (lcd_density/prop'tan).

**HİPOTEZLER (sonraki tur, ADB stabilken):**
1. **En güçlü**: #2 vtouch binary yanlış eksende (1080x2367) oluşturulmuş — wa-bringup vtouch'ı ekran boyutundan alıyor olabilir; #1'inki 719x1247. vtouch'ı #1 ile AYNI eksende yeniden oluştur (wa-bringup vtouch binary'sine boyut parametresi?) VEYA #1'in vtouch binary+config'ini birebir kullan.
2. weston headless touch→InputDispatcher iletimi #2'de kopuk (mServedView=null = view input'a bağlanmıyor).
3. **YAPILACAK İLK TEST (ADB stabilken)**: WhatsApp DIŞI EditText'te (Settings arama / dialer) tap focus veriyor mu → WhatsApp-özel mi #2-input mu KESİN ayırır. Bu session'da ADB asılması yüzünden yapılamadı.
4. **Alternatif**: #2 için weston yerine #1 ile TAM aynı session başlatma (weston arg+env+socket+waydroid session sırası birebir). #1 zaten kanıt: bu host'ta focus mümkün.

## ★KRİTİK ENGEL: ADB KARARSIZLIĞI★
#2'de SSH-üzeri-adb komut zincirleri (özellikle `input tap`+`uiautomator dump` art arda) SÜREKLİ ASILIYOR (SSH timeout). Çözüm: her şeyi **remote host'ta tek script** yaz+çalıştır (SSH round-trip yok). `screencap`+`pull`+`scp`+Read(png) ile GÖRSEL doğrulama en güvenilir. `exec-out uiautomator dump /dev/tty` çalışıyor (shell cat STALE). Test aracı: `FLEET_TEST_JOB` env + `/root/runreg.sh` (register) + `/root/runotp.sh <KOD>` (OTP 2. pass) setsid ile başlat, `/root/reg.log` izle.

## SSH
key `/tmp/sshkey/k` (Windows `C:\Users\furka\.ssh\scaleway_fleet`, chmod 600). Prod network/config yazma = `dangerouslyDisableSandbox:true`. Login: admin@fleet.local / mQlglvNVJjnSsVSjIg6ay5kr, api key 07995643...
