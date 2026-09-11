---
name: waydroid-2nd-vtouch-fixed-2026-07-06
description: "★2026-07-06★ #2 Waydroid vtouch 'doğru çalışmıyor' KÖK SEBEP+ÇÖZÜM: (1) #1 bootanimation takılıp SF %320 spin→load 16→sistem boğuluyordu; setprop service.bootanim.exit 1 + debug.sf.nobootanimation 1 + SF kill → load 2. (2) #2 restart sonrası container ağı KOPUK (local_network/eth0 route tabloları BOŞ→ping unreachable); route ekle. (3) vtouch STALE-DEVICE bug: 2 vtouch device (event1 eski/event2 canlı) ama node eski event1'e bağlı→taplar kayboluyor; en YENİ vtouch device'ı node'a bağla → uçtan uca tap ÇALIŞTI (Android System dialog OK'lendi, SS kanıt)"
metadata: 
  node_type: memory
  type: project
  originSessionId: eda346d7-6ef0-4c85-8a15-892a25cf03ee
---

★2026-07-06 — Kullanıcı "temiz restart + waydroid vinput doğru çalışmıyor" dedi. #2'de vtouch ÇÖZÜLDÜ, uçtan uca kanıtlandı. İlgili: [[waydroid-whatsapp-RESUME-2026-07-06]] [[waydroid-second-instance-scaleway]] [[waydroid-uinput-real-touch-SOLVED]] [[wsl-redroid-netstack-route-fix]].

## ★3 KATMANLI SORUN + ÇÖZÜM★

### 1. #1 bootanimation → SurfaceFlinger spin → sistem boğulması (vtouch'ın DOLAYLI sebebi)
- Belirti: `load average 16.5` (4 çekirdek!), `%Cpu 0.9 id`, ADB her komutta takılıyor.
- Kök: `lxc.payload.waydroid-1` içindeki **surfaceflinger pid 60705 = %320 CPU, 1845dk (30h) birikmiş**. Sebep: **bootanimation** takılmış (boot_completed=1 olsa da ölmüyor), SF'i sonsuz vsync loop'ta döndürüyor (headless-weston Waydroid bug).
- ÇÖZÜM: `adb shell setprop service.bootanim.exit 1; setprop debug.sf.nobootanimation 1` + `pkill -9 -f bootanimation` + host'tan `kill -9 <SF_pid>` (init taze SF başlatır). **%pcpu YANILTICI (ömür-ortalaması); gerçeği `top -b -n2 -d2` delta ile ölç** — kill sonrası SF %0, load 16→2 düştü, %Cpu idle %82.
- KALICI: her iki instance'ın `/var/lib/waydroid[.work]/waydroid_base.prop`'una `persist.sys.debug.sf.nobootanimation=1` + `ro.boot.bootanim=0` eklendi (sonraki boot'ta etki eder).

### 2. #2 restart sonrası container AĞI KOPUK (ping "No route to host")
- Belirti: restart+boot OK (boot_completed=1, model SM-G991B spoof OK) AMA host→#2 `No route to host`, ARP FAILED, adb `device offline`.
- Kök: container içinde eth0 UP + IP var (192.168.248.112) AMA **`ip route show table local_network` ve `table eth0` BOŞ** → `ip route get 192.168.248.1` = "Network unreachable". Android netstack fwmark policy kurallarını (16000 fwmark 0x10064 lookup eth0 vb.) koyuyor ama tablolara route YAZMIYOR (ConnectivityService eth0'ı connected işaretlemiyor). [[wsl-redroid-netstack-route-fix]]'in Waydroid versiyonu.
- ÇÖZÜM (lxc-attach ile — container adı **`waydroid`** DEĞİL waydroid-work, path `-P /var/lib/waydroid.work/lxc`):
  ```
  for T in eth0 local_network; do
    ip route add 192.168.248.0/24 dev eth0 proto static scope link src 192.168.248.112 table $T
    ip route add default via 192.168.248.1 dev eth0 table $T
  done
  ```
  → ping 0% loss, adb connect device. (Not: bu route'lar da volatile olabilir, restart'ta tekrar gerekir.)

### 3. ★ASIL SORUN: vtouch STALE-DEVICE bug★
- Belirti: FIFO'ya `echo "540 1200" > /data/local/tmp/vt.fifo` yazınca `getevent /dev/input/event1` **0 event** yakalıyor (taplar kayboluyor).
- Kök sebep: **İKİ vtouch device var** — `event1 dev=13:65` (ESKİ/stale) + `event2 dev=13:66` (CANLI proses yeni yarattı). Ama `/dev/input/`'te node SADECE event1'e (eski) bağlı; InputReader event1'i dinliyor, canlı vtouch prosesi event2'ye yazıyor → uyumsuz. wa-bringup.sh'in bug'ı: sysfs taramasında **ilk** bulduğu vtouch'ı (eski event1) node yapıyor, en yeniyi değil.
- ÇÖZÜM: en YENİ vtouch device'ı node'a bağla: `EV=$(for e in /sys/class/input/event*; do [ "$(cat $e/device/name)" = vtouch ] && echo $e; done | sort -V | tail -1)`; tüm eski vtouch node'larını `rm -f` + sadece bu için `mknod -m 666 /dev/input/eventN c MAJ MIN; chown root:input`. Betik: scratchpad `vtouch-fix.sh` (host `/tmp/vtouch-fix.sh`, #2 `/data/local/tmp/vtouch-fix.sh`).
- ★KANITLANDI: fix sonrası InputReader "vtouch TOUCH|TOUCH_MT Path:/dev/input/event2" gördü; getevent 12 event (X=0x21c=540, Y=0x4b0=1200, BTN_TOUCH down/up); **UÇTAN UCA: home ekranındaki "Android System internal problem" dialog'una vtouch tap (886,1349) → dialog KAPANDI (SS öncesi/sonrası kanıt)**.

## vtouch KULLANIMI (agent.mjs zaten böyle yapıyor)
- vtouch aracı `/data/adb/vtouch` veya `/data/local/tmp/vtouch`, **`vtouch hold` modunda FIFO'dan "X Y" satırı okur** (argümanla tek-tık DEĞİL — argümansız çağırmak "Permission denied"/usage verir, YANLIŞ yol).
- Kurulum: `wa-bringup.sh` (`/data/adb/wa-bringup.sh`): spoof (resetprop S21) + `mknod FIFO p` + `tail -f $FIFO | vtouch hold &` + event node. Root gerekli (`su -c`, Magisk çalışıyor uid=0 doğrulandı). `/dev/uinput` 666 olmalı (`su -c chmod 666`).
- TAP: `su -c "echo 'X Y' > /data/local/tmp/vt.fifo"`. Koordinat = gerçek 1080x2400 space (SS'te displayed×1.20).

## ORTAM (bu session doğrulandı)
- SSH: `ssh -i /tmp/sshkey/k root@51.158.107.121` (Windows key `C:\Users\furka\.ssh\scaleway_fleet`→cp `/tmp/sshkey/k` chmod 600).
- #1=192.168.240.112:5555 (SM-G991B, WhatsApp KAYITLI HomeActivity — referans), #2=192.168.248.112:5555 (work, otonom hedef).
- #2 ADB KARARSIZ: her komut sonrası offline/kesme eğilimi → tek-tek kısa komutlar, `adb kill-server;start-server`, `adb connect`, screencap `screencap -p /data/local/tmp/scr.png`+`pull` (exec-out büyük veri takılıyor).
- fleet-agent WhatsApp flow için durduruldu (`systemctl kill fleet-agent`+`reset-failed`); iş bitince `systemctl start fleet-agent`. Servisler: waydroid-work.service active.

## ★SONRAKİ ADIM (WhatsApp otonom kayıt — vtouch artık HAZIR)★
Artık vtouch çalıştığına göre eski a11y-bind takıntısına GEREK YOK. Yol: WhatsApp'ı number ekranına getir (vtouch tap ile dialoglar) → EditText'e focus (vtouch tap number field) → ADBKeyboard broadcast (ADB_INPUT_TEXT) ile cc 355 + phone 683195565 → Next tap → OTP. Numara +355 683195565 (Albania). GMS/Vending kurulu ([[waydroid-2nd-whatsapp-SOLVED-gms]]). Not: home'da "Android System internal problem" dialog'u çıkıyor (spoof integrity uyarısı, zararsız, vtouch ile OK'lenebilir).
