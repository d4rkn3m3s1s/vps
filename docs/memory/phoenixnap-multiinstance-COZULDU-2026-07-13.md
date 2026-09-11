---
name: phoenixnap-multiinstance-cozuldu-2026-07-13
description: "★★★phoenixNAP'te MULTI-INSTANCE Waydroid ÇÖZÜLDÜ 2026-07-13 — 2. izole instance (p1) boot etti, subnet .241.x izole. Setsid+doğru sıra reçetesi. Kök neden: systemd-run namespace + dizin çakışması + session start eksikti.★★★"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0ce97b6f-23a2-4491-9478-d5dc4d5cc569
---

**★★★ phoenixNAP multi-instance Waydroid ÇÖZÜLDÜ (2026-07-13) — 2. izole instance p1 boot etti ★★★**

Kullanici "multi-instance debug et çöz" dedi. ÇÖZÜLDÜ. İlgili: [[phoenixnap-fleet-GOC-TAMAM-2026-07-13]], [[phoenixnap-waydroid-KANITLANDI-2026-07-13]] (tek-instance boot).

## ✅ KANITLANAN: p1 (2. instance) BOOT ETTİ
- boot_completed=1, Android 13, izole IP **192.168.241.112** (default=.240.x, p1=.241.x → subnet izolasyonu CALISIYOR).
- 2 instance kaynak: load 10 (boot spike), RAM 9.6GB/250GB. Bol yer.

## ★KÖK NEDENLER (3 tuzak, hepsi çözüldü)
1. **systemd-run NAMESPACE izolasyonu**: `systemd-run` ile başlatılan daemon'lar PrivateTmp/izole namespace kullanıyor → `/run/xdg-p1` dizinini GÖREMİYOR (`Failed to bind socket: No such file or directory`). ÇÖZÜM: daemon'ları **`setsid`** ile başlat (namespace izolasyonu yok, socket paylaşımı korunur).
2. **XDG_RUNTIME_DIR DİZİN ÇAKIŞMASI**: iki farklı eski script farklı dizin kullandı (`/run/wd-p1` vs `/run/xdg-p1`) → weston bir dizinde socket açtı, container start başka dizinde aradı → uyumsuzluk. ÇÖZÜM: TUTARLI tek dizin `/run/xdg-$INST`. Temiz başlangıç: `rm -rf /run/wd-$INST /run/xdg-$INST`.
3. **SESSION START AYRI ADIM**: container daemon bus name'i sunar (BUS_NAME_UP) ama LXC container'ı BAŞLATMAZ → asıl LXC boot'u **`session start`** tetikler. İlk denemelerde session start eksik/yanlış env → State STOPPED kaldı.

## ★ÇALIŞAN REÇETE (setsid, doğru sıra) — /tmp/p1-debug.sh + p1-session.sh
Instance <INST> için (XRD=/run/xdg-<INST>, MI=/opt/waydroid-mi2, LXCP=/var/lib/waydroid.<INST>/lxc):
1. TEMİZLE: `pkill -9 -f wayland-<INST>; pkill -9 -f "instance <INST>"; rm -rf /run/wd-<INST> /run/xdg-<INST>`
2. HAZIRLA: `mkdir -p $XRD/pulse; chmod 700 $XRD; : > $XRD/pulse/native` (★pulse/native BOŞ dosya ŞART).
3. İZOLE BİNDER: `bash /opt/fleet-agent/waydroid/wd-binder.sh <INST>` → binder-<INST>/hwbinder-<INST>/vndbinder-<INST> ayrı binderfs.
4. WESTON: `setsid env XDG_RUNTIME_DIR=$XRD weston --backend=headless --socket=wayland-<INST> --width=1080 --height=2400 &` → $XRD/wayland-<INST> socket bekle.
5. CONTAINER: `setsid env XDG_RUNTIME_DIR=$XRD PYTHONPATH=$MI python3 $MI/waydroid.py --instance <INST> container start &` → bus name `id.waydro.Container.<INST>` bekle (~1sn).
6. SESSION BUS: `setsid dbus-daemon --session --address=unix:path=$XRD/bus --nofork --nopidfile &`.
7. SESSION START: `setsid env XDG_RUNTIME_DIR=$XRD WAYLAND_DISPLAY=wayland-<INST> DBUS_SESSION_BUS_ADDRESS=unix:path=$XRD/bus PYTHONPATH=$MI python3 $MI/waydroid.py --instance <INST> session start &` → LXC RUNNING ~6sn, Android boot_completed ~40sn.
8. init: her instance `waydroid.py --instance <INST> init -f` (imaj indirir; ★-i /var/lib/waydroid/images ile GAPPS PAYLAŞ, yoksa VANILLA iner=WA/IG çalışmaz). net-head.sh <INST> → subnet 241-256.

## ★SSH TUZAĞI (debug'ı yavaşlattı)
`sudo bash -c "nohup ... &"` ve `sudo timeout bash wd-run.sh` bu ortamda SSH stdout'unu KİLİTLİYOR (boş çıktı). ÇÖZÜM: script'i DOSYAYA yaz (`exec > /tmp/x.txt 2>&1`) → `sudo setsid bash /tmp/x.sh < /dev/null > /dev/null 2>&1 &` (arka plan, bloke etmez) → ayrı komutla sonuç dosyasını oku. Inline heredoc + parantez `()` = syntax error, kaçın.

## ★SUBNET ÇAKIŞMASI KÖK FIX (2026-07-13 ek)
- net-head.sh eski md5 formülü `% 16 + 241` = SADECE 16 subnet (241-256) → çakışma kaçınılmaz (test1=252=p2, dev1=249=p3). YENİDEN YAZILDI: sıralı benzersiz atama /var/lib/waydroid-subnets.map (2-239=238 subnet), mkdir-lock atomik, idempotent. ★map chmod 666 (sh sudo'suz çağırıyor).
- ★ASIL TUZAK: `waydroid-net.sh` (data/scripts) KENDİ İÇİNDE md5 subnet hesaplıyordu (satır 34-36) → net-head.sh'i YOKSAYIP eski formülle çakışan subnet → `dnsmasq Address already in use` → container fail. FIX: waydroid-net.sh satır 34-36 md5 bloğunu `SUB_NET=$(sh /opt/fleet-agent/waydroid/net-head.sh "$WAYDROID_INSTANCE")` ile değiştir. Yedek .md5-bak. Sonra config+ağ SENKRON → dev1 subnet 2'de RUNNING boot=1.
- ★KADEMELİ BOOT: /usr/local/bin/wd-batch.sh <max_parallel> <inst...> — aynı anda max N boot + load %70 eşiği guard. 2 cihaz temiz boot etti. Kullanıcı isteği "2-3-4-5 kasmadan" = BU.
- 5 cihaz ayakta (p1/p2/p3/dev1/dev2), subnet 241/252/249/2/3 benzersiz, RAM 16GB/250GB.

## ★★ADB/IP KATMANI ÇÖZÜLDÜ (2026-07-13 ek) — cihazlar tam erişilebilir
- ★YANLIŞ TEŞHİS TUZAĞI: Android `ip -o link` / `ip addr` komutu `-o` flag DESTEKLEMİYOR (toybox) → BOŞ döner → "eth0 yok" sandım. GERÇEK: **`ifconfig eth0` KULLAN** → eth0 VAR + IP ALMIŞ (c2=192.168.3.112). Cihazlar aslında IP alıyordu, komut yanılttı.
- Ağ mimarisi: her instance kendi bridge (waydroid-c1/c2/c3, ayrı 192.168.SUB.1) + dnsmasq (instance-aware, /run/waydroid-INST-lxc). ★eski md5+yeni sıralı subnet KARIŞIMI stale-state yaptı → /tmp/wd-reset.sh: TÜM instance durdur+dnsmasq(240 hariç)+bridge(waydroid0 hariç) sil → temiz başlat. Sonra dnsmasq'lar DOĞRU subnet'te (2.1/3.1/4.1).
- ★ADB AUTH: cihaz boot'ta ADB `unauthorized` → host adb pubkey'i (~/.android/adbkey.pub → /opt/fleet-agent/waydroid/host-adbkey.pub) Android /data/misc/adb/adb_keys'e yaz (chown 1000:2000, chmod 640) + setprop ro.adb.secure 0 + restart adbd → `adb device` authorized. Script: /opt/fleet-agent/waydroid/wd-adb.sh <inst>. wd-run.sh satır 44'ten çağrılıyor (her boot otomatik).
- ★KANIT: c2(192.168.3.112)+c3(192.168.4.112) = `adb device` authorized, shell android=13, screencap 370KB. Panel→agent→cihaz zinciri için HAZIR.
- ★sed ile çok-satırlı ekleme wd-run.sh'i BOZDU (satır sonları kayboldu) → ADB adımını AYRI script (wd-adb.sh) yapıp tek satır çağrı ekle. bash -n syntax kontrol ŞART.

## SONRAKİ (ölçekleme devam)
- p1 çalışıyor. Kademeli 3→5→10: aynı reçete p2/p3... için tekrarla, her kademede load/RAM ölç. init'te `-i /var/lib/waydroid/images` ekle (GAPPS paylaş, disk+süre tasarrufu).
- wd-mi2-boot.sh (/usr/local/bin) setsid script'i var ama session start'ı ayrı yapmak gerekti — script'i 7-adımlı tam sıraya güncelle.
- Prod wd-run.sh phoenixNAP'te takıldı (systemd-run/dizin/foreground) → setsid reçetesi kullan.
