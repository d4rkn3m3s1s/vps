---
name: waydroid-3rd-mi3-setup-2026-07-07
description: "★★★#3 (mi3) Waydroid 3. instance kurulumu 2026-07-07★★★ İZOLE ALTYAPI %100 KURULDU (binder-mi3/dbus/lxc, #2 klon userdata 2.1G, waydroid-mi3 bridge 192.168.255.113, GApps+WhatsApp+a11y+vtouch dosyaları hazır, boot ediyor). TEK ENGEL: Magisk ROOT — db policy 2000|2 ALLOW olmasına ve #2 ile BİREBİR klon olmasına rağmen magiskd su'yu reddediyor: app'e soruyor, app 'Shell was denied Superuser rights' default-deny veriyor. Kök: magiskd manager-trust handshake klon-runtime'ı taşımıyor (#2 magiskd 6saat uptime handshake yapmış, #3 taze yapmamış). Kanıtlı çözüm: canlı-ekran manuel Grant. SSH/systemd start tuzakları da dökümanlı"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3e712161-87b7-48dd-8ccc-ee55d73375ad
---

★2026-07-07 — Kullanıcı "yeni Waydroid aç, çalışan WhatsApp'lar (#1/#2) gibi root+vtouch+prop+proxy+a11y+WhatsApp kur" dedi. #3 = **mi3** instance. İlgili master reçete: [[waydroid-2nd-whatsapp-MASTER-detay-2026-07-06]]. #2 kurulum: [[waydroid-second-instance-scaleway]].

═══════════════════════════════════════════════════
# #3 (mi3) MİMARİ — KURULDU
═══════════════════════════════════════════════════
- **Instance adı `mi3`** → net-head.sh md5("mi3") → subnet **192.168.255.x**. Cihaz DHCP'den **192.168.255.113:5555** aldı (.112 değil). Bridge `waydroid-mi3` @ 192.168.255.1, MAC 00:16:3e:f9:d3:04.
- **İzole binder**: `/dev/binder-mi3` `/dev/vndbinder-mi3` `/dev/hwbinder-mi3` (binderfs-mi3, major 236 minor 28-30).
- **Dosyalar** (hepsi `/opt/`, wd2-* tabanından work→mi3 sed ile üretildi):
  - `/opt/wd3-up.sh` — izole altyapı kurulum (lxc layout clone from waydroid.work + retarget, images copy, binderfs, bridge+dnsmasq). İdempotent.
  - `/opt/wd3-run.sh` — boot orkestrasyon (weston wayland-mi3 + wd3-binder + container + session + wa-bringup).
  - `/opt/wd3-binder.sh` — binder-mi3 nodes.
  - `/etc/systemd/system/waydroid-mi3.service` — **StartLimitIntervalSec=0** (start-limit KAPALI, aşağıda neden).
  - `/usr/share/dbus-1/system.d/id.waydro.Container.mi3.conf` — D-Bus own izni (ŞART, yoksa "not allowed to own service").
  - `/var/lib/waydroid.mi3/` — lxc/config(retargeted), images(system+vendor.img kopya), waydroid.cfg(binder-mi3), **waydroid.prop**(host_data_path=/root/.local/share-mi3/waydroid/data DÜZELT), **waydroid_base.prop**(work'ten kopya, nobootanimation içerir).
  - userdata: `/root/.local/share-mi3/waydroid/data` = #2'nin 2.1G klonu (cp -a, ubuntu:ubuntu korunur). WhatsApp+GApps+wa-bringup+vtouch data HAZIR geldi, a11y APK /data/app'te YOKtu (boot sonrası #2'den kurulacak).
- Boot: `boot_completed=1` ~30-40sn. İnternet klonla ZATEN çalıştı (Active default network:100, ping OK) — ama ADB kararsız + her boot route gerekebilir (adım 3).

═══════════════════════════════════════════════════
# ★★★ROOT ÇÖZÜLDÜ 2026-07-07 — SEBEP: BOZUK MAGISK APK (handshake DEĞİL)★★★
═══════════════════════════════════════════════════
★★KULLANICI HAKLIYDI: "root apk'sı bozuk doğru kurmamışsın". Aşağıdaki "magiskd RAM handshake" teorisi YANLIŞTI.★★
**GERÇEK KÖK SEBEP**: #3'e kurulu "Magisk" APK bir **STUB'tı** (29 KB, versionName=`1.0`, versionCode=1, primaryCpuAbi=**null** — native lib yok). Gerçek Magisk 12.7 MB, `0fe46c5a-delta` v26301 arm64-v8a. magiskd stub'ı manager olarak tanımadı (`pkg: cannot find`) → tüm su isteklerini reddetti.
**ÇÖZÜM (KANITLI, uygulandı)**:
```
D2=192.168.248.112:5555; D3=192.168.255.113:5555; LXCP=/var/lib/waydroid.mi3/lxc
# 1) #2'nin GERÇEK 12.7MB Magisk APK'sini cek
APK2=$(adb -s $D2 shell "pm path io.github.huskydg.magisk" | sed s/package:// | tr -d '\r')
adb -s $D2 pull "$APK2" /tmp/magisk-real.apk
# 2) #3 bozuk stub kaldir + gercek APK push
adb -s $D3 uninstall io.github.huskydg.magisk
adb -s $D3 push /tmp/magisk-real.apk /data/local/tmp/magisk-real.apk
# 3) ★CONTAINER-ICI pm install (ADB kararsiz → 'Broken pipe' verir; lxc-attach STABIL)
lxc-attach -P $LXCP -n waydroid -- /system/bin/sh -c "pm install -r -g /data/local/tmp/magisk-real.apk"   # → Success
# 4) app ac (manager pkg cache yenilensin) + test
lxc-attach -P $LXCP -n waydroid -- /system/bin/sh -c "am start -n io.github.huskydg.magisk/.ui.MainActivity; sleep 3"
lxc-attach -P $LXCP -n waydroid -- /system/bin/sh -c "su -c id"   # → uid=0(root) ★ROOT ÇALIŞIYOR
```
**DERS (her yeni cihaz için)**: klon userdata gerçek Magisk APK'sını /data/app'te TAŞIMAYABİLİR (path hash'i cihaza özel + APK optimize sırasında düşer). Kurulumun İLK adımı: #2'den gerçek Magisk APK'yı çekip container-içi pm install ile kur, SONRA su test. `versionName=1.0`/`29KB`/`primaryCpuAbi=null` görürsen = BOZUK STUB, yeniden kur.
**★pm install ADB'de 'Broken pipe' → container-içi lxc-attach pm install kullan (ADB-bağımsız, stabil).**

═══════════════════════════════════════════════════
# ~~ESKİ YANLIŞ TEŞHİS: magiskd handshake~~ (yukarıdaki APK çözümü GEÇERLİ)
═══════════════════════════════════════════════════
**BELİRTİ**: `adb shell "su -c id"` BOŞ döner. magisk log: `su: request rejected (2000)`. App toast: **"Shell was denied Superuser rights"**.
**db DOĞRU**: `magisk.db` policies = `2000|2|0` + `0|2|0` (ALLOW), settings `denylist|0` — **#2 ile BİREBİR AYNI** (sqlite3 .dump karşılaştırıldı). Host'tan `sqlite3 /root/.local/share-mi3/waydroid/data/adb/magisk.db` ile okunur/yazılır (★Android içi sqlite3 `Aborted core dumped`/SIGABRT verir, HOST sqlite3 kullan).
**KÖK SEBEP (kanıtlı)**: magiskd, db policy'yi DOĞRUDAN uygulamıyor; su isteğini **Magisk Manager app'e soruyor** (`io.github.huskydg.magisk`), app **default-deny** veriyor. magisk log: `pkg: cannot find io.github.huskydg.magisk for user=[0]` — magiskd app'i "trusted manager" olarak tanımıyor.
- **su_request FIFO teşhisi**: `/proc/$(pidof magiskd)/fd/` → **#2'de 0** (temiz, policy doğrudan uygulanıyor), **#3'te birikiyor** (`_su_request_XXXX`, app'e gidiyor timeout→reject).
- **magiskd uptime farkı KİLİT**: #2 magiskd ELAPSED ~6saat (handshake YAPMIŞ, 2000'ı granted-cache'ine almış), #3 taze ~15dk (handshake YAPMAMIŞ). Aynı binary (0fe46c5a-delta:MAGISK:R 26301), aynı db, aynı app uid 10125.
**#2 NEDEN ÇALIŞIYOR**: #2 magiskd'si uzun çalışırken/ilk kurulumda bir noktada app-manager ile trust-handshake yaptı → `2000`'ı runtime granted-cache'e aldı → app'e sormadan grant. Bu **runtime state klon userdata ile TAŞINMAZ**.

## DENENEN OTONOM YOLLAR (HEPSİ BAŞARISIZ — app default-deny duvarı):
1. Host sqlite3 ile db policy `2000|2` yaz + temiz restart → magiskd yine reddetti.
2. `until` alanı, sulist mode (TEHLİKELİ, geri alındı — sulist sadece app'lere root verir, shell'e değil).
3. Magisk manager APK reinstall (ADB push /data/local/tmp + pm install -r -g; ★host cp SELinux-context bozuk, pm açamıyor → ADB push ŞART) → su_request geçici 0 oldu ama boot sonrası tekrar reddetti.
4. `pm uninstall` manager (policy-only umuduyla) → magiskd `cannot find manager` + YİNE reddetti (huskydg delta: manager YOKken de grant vermiyor).
5. App foreground + ekran wake + SuRequestActivity direct-call → dialog HİÇ açılmıyor, app sessizce default-deny.

## ★KANITLI ÇÖZÜM (henüz uygulanmadı): CANLI EKRAN manuel Grant
Site canlı ekranında (http://51.158.107.121) #3'ü aç → Magisk app > Superuser ayarı 'Automatic Response'u **Prompt/Grant** yap VEYA su isteğinde çıkan dialog'a **Grant** bas. Sonra magiskd `2000`'ı kalıcı granted-cache'e alır → otonom devam. (Memory'de #2 için "canlı-ekran KANITLI çalışıyor" notu — [[waydroid-2nd-whatsapp-KAYIT-BASARILI-2026-07-06]]).
## Alternatif: #2 magiskd runtime granted-state'ini bir şekilde #3'e taşımak (magiskd'nin granted-uid cache'i disk'te değil RAM'de → zor).

═══════════════════════════════════════════════════
# ★SSH / SYSTEMD START TUZAKLARI (çok zaman kaybettirdi)★
═══════════════════════════════════════════════════
- **Sunucu SSH `systemctl start` bloklamasını taşıyamıyor** → `exit 255` (SSH kopar) VEYA komut journal'a hiç düşmez. `systemctl start waydroid-mi3` (blocking, RemainAfterExit=yes script uzun boot-wait loop'u bekler) SSH'ı bloke eder.
- **★ÇALIŞAN START PATTERN**: `ssh ... '(setsid systemctl start waydroid-mi3.service >/tmp/mi3s.out 2>&1 </dev/null &); sleep 1; echo DISPATCHED'` — setsid + </dev/null + & ile tam detached, SSH hemen döner. VEYA `systemctl start >/tmp/out 2>&1 &`.
- **StartLimitBurst=5/10s TUZAK**: ard arda start/stop start-limit'i tetikler, systemd start'ı SESSIZCE reddeder (journal'a bile yazmaz). Çözüm: unit'e `StartLimitIntervalSec=0` + her denemede `systemctl reset-failed`.
- **Temiz STOP**: `systemctl stop waydroid-mi3` + `lxc-stop -P /var/lib/waydroid.mi3/lxc -n waydroid -k` (session/container daemon persist eder, RemainAfterExit). ★#2'yi (çalışan cihaz) stop etmeyi Claude auto-mode classifier REDDEDER (workload koruması) — #2'ye dokunma.
- **umount hatası** (`Command failed: umount .../rootfs/vendor`): stop sonrası lingering mount → `umount -l` ile temizle.
- **Boot izleme**: bg Bash `for i; do lxc-attach getprop sys.boot_completed; done` + boot=1'de exit. ★start bg-task ile monitor bg-task ARALARINDA YARIŞ olur (monitor i=1'de container-not-yet-RUNNING görüp "COKTU" der) → monitor'de önce RUNNING'i bekle.
- **ADB kararsız** (#2'den miras): `device offline`/`not found`/`No route to host`. Kurtarma: route ekle (adım3) + `adb kill-server; adb start-server; adb connect 192.168.255.113:5555`.

═══════════════════════════════════════════════════
# ★EKRAN BOYUTU FARKI (2026-07-07 kullanıcı yakaladı — reçete koordinatları için ŞART)★
═══════════════════════════════════════════════════
- #3 (mi3) BOOT'ta `wm size 1080x2368 @ density 180` geldi (override YOK). #2 (work) ise `Override 1080x2400 @ density 421`.
- ★TÜM master reçete koordinatları (Next=540,2169, registration_phone merkez 644,695, OTP tap 360,585, vtouch tap'ler…) **1080x2400 @ 421** içindir → #3'te override UYGULANMAZSA taplar YANLIŞ yere gider.
- **DÜZELTME (root GEREKMEZ, wm yeter)**: `adb shell "wm size 1080x2400; wm density 421"` → #3 artık #2 ile birebir aynı, reçete koordinatları aynen geçerli. (Uygulandı 2026-07-07, WhatsApp numara ekranı override sonrası korundu.)
- Bu adımı wa-bringup/wd3-run'a ekle ki her boot otomatik olsun.

═══════════════════════════════════════════════════
# ★PROXY DURUMU (2026-07-07 — Albania numara +355682342382 için KURULDU)★
═══════════════════════════════════════════════════
- Numara **+355682342382 (Albania)**. redsocks zaten cc-AL (Albania) ayarlı (#2'den kalma) — ülke UYUYOR, değiştirilmedi.
- #3 subnet **192.168.255.0/24** için iptables PREROUTING REDIRECT kuralları EKLENDİ (RETURN'ler + REDIRECT 12345). #2'nin 248 kuralları duruyor.
- Doğrulandı: #3 çıkış IP **109.234.233.66** (Albania residential, Scaleway 51.158 DEĞİL), `https://v.whatsapp.net/`=404 (erişiyor). Proxy HAZIR.
- Cihaz **panele eklendi** (canlı ekran Grant için): DB Device id `cmf83ad341a58dda1f8829`, name "Waydroid #3 (mi3)", host Scaleway ARM PAR1 (cmr3o4l24...), ws cmqlrdynh..., ONLINE.

═══════════════════════════════════════════════════
# SONRAKİ ADIMLAR (root çözülünce)
═══════════════════════════════════════════════════
0. ★EKRAN OVERRIDE uygula (yukarıda) — reçete koordinatları için ŞART. (2026-07-07 yapıldı.)
1. Root aç (canlı ekran Grant).
2. `su -c "sh /data/adb/wa-bringup.sh"` → spoof (★#1/#2 AYNI SM-G991B spoof veriyor — #3'e BENZERSIZ kimlik ver: farklı model/IMEI/android_id, WhatsApp 3 cihazı ilişkilendirmesin) + vtouch.
3. GMS crash servisi disable + a11y enable + ADBKeyboard (master reçete adım 4,6).
4. Numara ülkesine göre redsocks+thordata cc-XX proxy (#3 subnet 192.168.255.0/24 için iptables), sonra WhatsApp temiz kayıt (master reçete adım 7,8). Kullanıcı "numara hazır" dedi.
