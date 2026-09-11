---
name: phoenixnap-waydroid-kanitlandi-2026-07-13
description: "★★★phoenixNAP a1.c5.xlarge (Altra Q80) SATIN ALINDI + Waydroid UÇTAN UCA BOOT ETTİ 2026-07-13 — binder smoke-test geçti, Android çalışıyor. SSH+boot reçetesi+erişim bilgileri. Sunucu kararı KANITLANDI.★★★"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0ce97b6f-23a2-4491-9478-d5dc4d5cc569
---

**★★★ phoenixNAP a1.c5.xlarge SATIN ALINDI + Waydroid CANLI BOOT ETTİ (2026-07-13) — sunucu kararı uçtan uca kanıtlandı ★★★**

Kullanici phoenixNAP a1.c5.xlarge ($1.09/saat) ALDI (kanitlama makinesi). Waydroid UCTAN UCA boot etti. İlgili: [[phoenixnap-arm-skus-2026-07-13]] (SKU degerlendirme), [[arm-baremetal-provider-research-2026-07-09]], [[instagram-otonom-kayit-CANLI-KANIT-2026-07-13]].

## 🔑 ERISIM (SSH)
- **IP: 125.253.73.45** (public assigned; gateway .44, private 10.0.0.11). US Southwest 1 (Phoenix).
- **Kullanici: ubuntu** (root DEGIL — "Please login as ubuntu"), sudo parolasiz OK.
- **SSH key: C:\Users\furka\.ssh\phoenixnap_y** (kullanicinin verdigi webroottr@gmail.com ed25519, sunucuda ekli). Baglan: `ssh -i C:/Users/furka/.ssh/phoenixnap_y -o IdentitiesOnly=yes ubuntu@125.253.73.45`
- (Ayrica olusturdugum phoenixnap_fleet.pub eklenmedi, gerekmedi.)

## ✅ DONANIM (dogrulandi)
Ubuntu **24.04.4 LTS** (noble, reçete 22.04'tu ama 24.04 CALISTI), kernel **6.8.0-134**, aarch64, **PAGE_SIZE=4096**(kritik OK). CPU **ARM Neoverse-N1, 80 cekirdek**(=Altra Q80, prod Scaleway ile AYNI nesil), **op-mode 32-bit+64-bit**(AmpereOne'da olmayan). RAM 250GB+8GB swap. Disk 2×3.5TB NVMe. Ag 2×25Gbps(imaj indirme cok hizli).

## ✅ BINDER SMOKE-TEST GECTI
- ★binder DKMS GEREKMEDI: `linux-modules-extra-6.8.0-134` ZATEN kuruluydu → `binder_linux.ko.zst` hazir. CONFIG_ANDROID_BINDER_IPC=m + BINDERFS=m.
- `sudo modprobe binder_linux devices=binder,hwbinder,vndbinder` OK → `mount -t binder binder /dev/binderfs` OK → node'lar (binder/binder-control/hwbinder/vndbinder) olustu. binder-control=BINDER_CTL ioctl hazir (multi-instance icin).
- Boot-persist: /etc/modules-load.d/binder_linux.conf + /etc/modprobe.d/binder_linux.conf.
- ashmem yok=sorun degil (Waydroid memfd kullanir).

## ✅ WAYDROID KURULDU + BOOT ETTI
- `curl https://repo.waydro.id | sudo bash` + `apt install waydroid lxc redsocks iptables dnsmasq weston dbus-x11`. Waydroid **1.6.2** (prod ile ayni). LXC 5.
- `waydroid init -s GAPPS` → system.img 2.9GB + vendor.img 421MB indi (~1dk, 25Gbps). GApps/GMS KURULU (WA/IG icin sart).
- ★HEADLESS BOOT REÇETESI (DBus/DISPLAY hatasi cozumu) = /usr/local/bin/wd-hl-boot.sh (scratchpad'de wd-hl-boot.sh kopyasi):
  1. XDG_RUNTIME_DIR=/run/wd-headless, WAYLAND_DISPLAY=wayland-hl, DBUS_SESSION_BUS_ADDRESS=unix:path=$XDG/bus
  2. ★KRITIK: `mkdir -p $XDG/pulse; : > $XDG/pulse/native` (BOS pulse socket dosyasi — YOKSA "container failed to start"! LXC config bunu mount ediyor). Bu prod wd-run.sh'in 1. adimi, ATLADIM=hata aldim.
  3. weston --backend=headless --socket=wayland-hl --width=1080 --height=2400 (arka plan, socket bekle). ★weston13 backend=headless (`.so` uzantisiz), root'ta nohup& ile calisir.
  4. dbus-daemon --session --address=$DBUS_SESSION_BUS_ADDRESS (session bus — YOKSA "Unable to autolaunch dbus-daemon without DISPLAY").
  5. `waydroid session start` (ayni env ile) → boot ~48sn → "Android with user 0 is ready".
- CANLI SONUC: Session RUNNING, Container RUNNING, IP 192.168.240.112, Android 13, GMS var, screencap OK(356KB), ekran wm size 1080x2400 (boot default 1080x2368→override sart, prod tuzagi).
- ★ADB `device unauthorized` → `waydroid shell -- <cmd>` KULLAN (root, ADB auth gerektirmez). ADB gerekirse Android adb_keys'e host pubkey yaz.
- ★boot sirasi load 11.63 gecici (CPU-yogun boot, 80 cekirdekte normal, duser). RAM 8GB/250GB.

## SONRAKI ADIMLAR
1. fleet göç (prod /opt/fleet + agent.mjs + wd-*.sh) → bu makineye, DB/Caddy/servisler.
2. Multi-instance (net-head.sh + izole binder/dbus per-instance) → 5/10/20 cihaz kademeli olc (load izle).
3. Proxy (redsocks) + WhatsApp/Instagram kayit recetesi bu makinede tekrarla.
4. Kalici karar: bu makine KANITLANDI ama fiyat/cekirdek LeaseWeb 128C/€403 daha iyi (kalici prod icin). phoenixNAP saatlik=pilot.

## ⚠️ FATURA
$1.09/saat 7/24=~$785/ay. Public IP allocation SILINENE KADAR ucret (kullanilmasa bile). Pilot bitince makineyi+IP'yi SIL.
