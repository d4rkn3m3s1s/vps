# Tek-Tık Cihaz Reçetesi — Tam Referans

phoenixNAP (ARM bare-metal, GPU'suz Waydroid) üzerinde **tek tıkla WhatsApp-hazır
cloud-phone** kuran provision reçetesinin en ince detayına kadar açıklaması.
Panelden `POST /provision/create {hostId, name}` → ~90 saniyede root'lu, gerçek
dokunmalı, kalıcı-ADB'li, tutarlı-kimlikli cihaz.

> **Tek en önemli kısıt (ölçüldü):** ARM Waydroid'de **GPU yok** → her cihaz
> software-rendering (weston) yapıyor. **Aynı anda 2-3 cihazı art arda boot
> etmek host'u boğar** → `boot_completed 300s'de gelmez` → provision FAILED.
> **Cihazları art arda DEĞİL, biri ONLINE olduktan sonra diğerini kur** (kademeli).
> Tek cihaz kurulumu her zaman kusursuz; darboğaz eşzamanlı boot.

Kaynak dosya: `deploy/kvm-host/agent/agent.mjs` → `provisionDevice(job)`.
Bundled dosyalar: `deploy/apks/` (APK+vtouch, Git LFS), `deploy/magisk/` (root, Git LFS).

---

## Mimari (özet)

Panel → API `POST /provision/create` → `Job` satırı (JobType `PROVISION_DEVICE`) →
host agent `/agent/jobs/next` ile çeker → `provisionDevice()` çalışır → adım adım
`reportProgress` ile panele ilerleme → `done` %100.

Her instance izole: kendi LXC container'ı (`/var/lib/waydroid.<inst>/`), kendi
subnet (`192.168.<subnetId>.0/24`, subnetId = md5(name)%16+241), kendi
`/data` host-mount'u (`/root/.local/share/waydroid.<inst>/data`).

Cihaz-içi komut iki yolla çalışır — **hangisinin kullanılacağı KRİTİK**:
- **`lxcAttach(instance, argv, ms)`** = `lxc-attach -P <lxcp> -n waydroid -- argv`.
  Root, dump-bağımsız. AMA **Binder caller-identity KAYBEDER** → `getCallingPackage()`
  == null → `settings put`/`am`/`ime` NPE ile sessizce başarısız. `pm install`,
  `su`, `mknod`, `getprop`, `ps` için KULLAN.
- **`adb(serial, ['shell', ...])`** = ADB üzerinden. Binder identity TAŞIR →
  `settings`/`ime`/`wm`/`am` için ŞART. Ama fresh ARM Waydroid'de `screencap`/bazı
  shell'ler takılır. a11y adımı bunu kullanır.

---

## 10 Adım (agent.mjs `provisionDevice`)

### 1) infra (%8) — `applyRoot` + `applyIntegritySpoof`
- **Instance dizinlerini oluştur**, subnet ata, base image'ı klonla (overlay).
- **`applyRoot(instance)`** — Magisk'i host-tarafından enjekte eder (headless'te
  Magisk'in su-onay handshake'i UI olmadan yanıtlanamaz, o yüzden boot-init şart):
  - `deploy/magisk/su` (317KB) → `overlay/system/bin/su` + `overlay/system/xbin/su`
    (OverlayFS ile boot'ta `/system/bin/su` görünür).
  - `deploy/magisk/magisk-init.tar.gz` → `overlay/system/etc/init/` — içinde
    `bootanim.rc` (boot'ta `on post-fs-data` ile magisk-init'i sürer) +
    `magisk/{magisk64,magiskinit,magiskpolicy}`.
  - `deploy/magisk/magisk-dir.tar.gz` + `magisk.db` → `<data>/adb/` (su policy DB —
    shell(2000)+root(0) uid'e su izni, UI-bypass).
  - `FLEET_MAGISK_DIR` env (varsayılan `/opt/fleet-agent/magisk`) kaynak dizin.
- **`applyIntegritySpoof(instance, fp)`** — ROOT'SUZ integrity spoof (WhatsApp
  "Login not available for security reasons" banını çözer; cihaz "WayDroid
  arm64/test-keys" görünüyordu). Boot ÖNCESİ `waydroid_base.prop` + `waydroid.prop`'a
  yazar (Waydroid init `ro.*` okur, resetprop=root GEREKMEZ):
  - `ro.product.{model,brand,manufacturer,device,name}` — DEVICE_PROFILES tablosundan,
    model'e TUTARLI (SM-G991B → samsung/o1seea/o1s + fingerprint samsung/.../G991B...).
  - `ro.build.fingerprint` — **gerçek build fingerprint formatı** (`/.+:.+\/.+:.+\//`),
    aksi halde profile'ın fp'si. ★`fp.buildNumber` ("SAMSUNG.14.640105") build
    fingerprint DEĞİL — yazma (geçersiz=ban).
  - `ro.boot.verifiedbootstate=green`, `ro.boot.flash.locked=1`, `ro.debuggable=0`.
  - **★`ro.adb.secure=0`** — ADB bir daha "unauthorized" olmaz (Scaleway'de de böyle).
- **DEVICE_PROFILES**: 11 model havuzu (SM-S918B, SM-A546B, SM-G991B, Pixel 8 Pro,
  Pixel 7, Redmi Note 12, 2210132G, CPH2449, CPH2451, V2230, moto g84). Her tek-tık
  cihaz FARKLI model → WhatsApp fleet'i BAĞLAYAMAZ (fingerprint linkability yok).

### 2) boot (%18) — açılış + **hwcomposer half-boot heal**
- `wd-run.sh` fire-and-forget (weston+container+session).
- **ADB ön-yetkilendirme (`authorizeAdb`)**: `/data/.../adb_keys`'e agent'ın GERÇEK
  key'ini (`/root/.android/adbkey.pub`) enjekte, adbd restart. Cihaz "unauthorized"
  demeyi bırakana kadar retry (~90s). `ro.adb.secure=0` bunu kalıcı yapar.
- `waitBoot(serial, 300000)` — `sys.boot_completed=1` bekle (300s: yoğun host'ta ilk
  boot 3-5dk sürebilir; DHCP lease mid-wait yeniden çözülür).
- **★hwcomposer half-boot tespiti + 1 kez reboot**: `boot_completed=1` YETMEZ. ARM
  Waydroid'de GPU yok → ~3 boot'tan 1'inde `hwcomposer.waydroid.so`'nun wayland
  thread'i `abort()` eder (crash log KANIT) → system_server düşer → settings/package
  servisleri HİÇ publish etmez → sonraki tüm adımlar sessizce başarısız, cihaz bozuk
  ship olur. Çözüm: `service check package`=found bekle (≤80s); gelmezse **1 kez**
  reboot (wd-stop→wd-run→waitBoot→route yeniden). Boot adımında (ağır adımlardan
  ÖNCE) → temiz boot garantisi + job timeout aşılmaz.

### 3) root (%35) — Magisk APK + su doğrulama
- PM-ready probe (küçük adbkeyboard install, 24×5s retry).
- Gerçek Magisk APK (`deploy/apks/magisk.apk`, ~12.7MB) kur, manager launch (trust).
- `su -c id`=uid=0 best-effort doğrula (headless'te fail ederse provision düşmez).

### 4) screen (%47) — çözünürlük
- ADB shell `wm size 1080x2400` + `wm density 421` (Waydroid boot 1080x2368@180
  gelir, WhatsApp/otomasyon 1080x2400@421 bekler).

### 5) vtouch (%58) — gerçek dokunma + kimlik
- **Neden**: WhatsApp (ve sertleştirilmiş app'ler) synthetic `input tap`'i REDDEDER.
  Companion menü item'ı ("Register new account") sadece GERÇEK dokunmayla basılır.
- vtouch (uinput binary, `deploy/apks/vtouch`) + `wa-bringup.sh` host-mount ile
  `/data/local/tmp`'ye kopyalanır.
- lxc-attach su -c ile çalıştırılır. **★KRİTİK PATH FIX**: `/system/bin/sh -c`
  Android PATH'ini INHERIT ETMEZ → çıplak `su` "not found". `export PATH=/system/bin:
  /system/xbin:$PATH; /system/bin/su -c "..."` ŞART.
- **★uinput node**: fresh boot'ta `/dev/uinput` YOK → vtouch "not in sysfs". wa-bringup'tan
  ÖNCE `mknod /dev/uinput c 10 223; chmod 666 /dev/uinput`.
- `wa-bringup.sh` yapar: uinput vtouch node oluştur (`/dev/input/eventN`), FIFO kur
  (world-writable 666), integrity resetprop uygula (root varsa), InputReader'ın
  vtouch'ı gördüğünü doğrula.

### 6) route (%68) — ağ
- Android netstack fwmark tablolarını her boot temizler → `addInstanceRoutes`
  (main/local_network/eth0 tablolarına default gw + subnet route).

### 7) proxy (%76) — sadece istenirse
- Ülke-eşleşmiş residential exit: `wd-proxy.sh <inst> <country> <user> <pass> <host>
  <port>` → redsocks + iptables. ★Numara-ülkesi=proxy-ülkesi ŞART (WhatsApp "Login
  not available" verir). thordata AL çalışıyor.

### 8) apks (%84) — uygulama kurulumu
- PM-ready probe (boot adımında framework zaten geldi, sadece install-kabul doğrula).
- Kur: WhatsApp (`whatsapp.apk`, ~137MB), fleet-a11y (`fleet-a11y.apk`).
  ADBKeyboard PM-probe'da kuruldu. GApps/Play Services system.img içinde gömülü.
- **host-mount install**: APK'yı `<data>/local/tmp`'ye cp, sonra lxc-attach
  `export PATH=/system/bin; pm install -r -g /data/local/tmp/FILE`. ADB push 137MB'ı
  boğar; host-mount hızlı.
- **★"Success" çıktısına GÜVEN**: eski kod `pm path` ile yeniden probe ediyordu ama
  container freeze'de boş dönüyordu → aynı APK 3-10× kuruluyordu (6dk). `pm install`
  "Success" yazıyorsa KURULMUŞTUR (süre 6dk→~1.5dk).
- **★container freeze**: Waydroid `suspend_action=freeze` idle container'ı dondurur →
  `pm install` yarıda kalır. Background `lxc-unfreeze` LOOP (2s) ile thaw tut.

### 9) a11y (%92) — erişilebilirlik + klavye
- **★ADB shell ŞART** (lxc-attach Binder identity kaybeder → settings NPE):
  `settings put secure enabled_accessibility_services com.fleet.a11y/...FleetA11yService`,
  `settings put secure accessibility_enabled 1`, `ime enable/set adbkeyboard`,
  `wm size/density`, GMS PersistentDirectBoot disable.
- **★system_server bekle**: yavaş boot'ta boot_completed=1 gelse de servisler geç
  publish → `settings put` "Can't find service" THROW → provision FAILED. FIX:
  a11y'den önce `service check settings`=found poll (≤60s) + son verify read `.catch`
  (FATAL DEĞİL — cihaz zaten kullanılabilir, otomasyon tap-fallback yapar).

### 10) persist (%97) — doğrulama + vtouch re-assert
- boot + root (su -c id) doğrula.
- **★vtouch'ı EN SON yeniden kur**: a11y'nin `wm size/density`'si SurfaceFlinger'ı
  resetler → vtouch input node düşer. persist'te lxc-attach ile (kanıtlı yol; ADB
  su -c Magisk onayında hang olabilir) yeniden bring-up. `/dev/uinput` reset sonrası
  gittiği için önce mknod. **★Background thaw loop (3s)** ile sar (frozen container'da
  wa-bringup sessizce no-op olur). **★`/system/bin/su` mutlak path** (yine PATH sorunu).
- `checks{boot, root, vtouch, proxy}` döndür → panelde gösterilir.

---

## Çözülen Kök Nedenler (2026-07-14/15 — hepsi agent.mjs)

| # | Sorun | Çözüm |
|---|-------|-------|
| 1 | SurfaceFlinger/boot (Scaleway userdata phoenixNAP'te boot etmez) | phoenixNAP-native LITE + bundled APK |
| 2 | ADB unauthorized | `authorizeAdb` (doğru key `/root/.android/adbkey.pub`) + **`ro.adb.secure=0`** (kalıcı) |
| 3 | cloneApk srcSerial yok | `installBundledApkTo` (host-mount + lxc-attach) |
| 4 | ADB shell hang | `pm install`/probe için lxc-attach |
| 5 | PackageManager erken | gerçek install-probe |
| 6 | idle-freeze | background `lxc-unfreeze` loop |
| 7 | `sh -c` PATH yok (pm) | `export PATH=/system/bin` |
| 8 | settings put NPE | a11y için ADB shell (Binder identity) |
| 9 | "FAIL: Success" 3-10× reinstall | `pm install` "Success" çıktısına güven |
| 10 | Login not available (integrity) | root'suz spoof (waydroid_base.prop, DEVICE_PROFILES) |
| 11 | Fleet-linkable (aynı spoof) | model başına TUTARLI, cihaz başına FARKLI kimlik |
| 12 | ROOT yok (companion synthetic-tap reddi) | `applyRoot` (su+magisk.db+init overlay, bootanim.rc) |
| 13 | vtouch "not in sysfs" | wa-bringup'tan önce `mknod /dev/uinput c 10 223` |
| 14 | vtouch a11y'de ölüyor | persist'te EN SON yeniden bring-up |
| 15 | frozen container bring-up'ı boğuyor | persist vtouch'ı thaw-loop ile sar |
| 16 | **★`su: not found`** (elle çalışıp provision'da çalışmama muamması) | 3 yerde `/system/bin/su` + `export PATH` |
| 17 | a11y "Can't find service" provision'ı düşürüyordu | `service check` bekle + fatal-değil |
| 18 | hwcomposer half-boot (APK=0, servis yok) | boot adımında tespit + 1 kez erken reboot |
| 19 | **eth0 IPv4 almıyor** (IPv6-only → ADB bağlanamaz → boot 300s timeout) | boot'ta eth0 IPv4 bind bekle (~90s) + gerekirse DHCP client kick |
| 20 | **stale subnet-map** (`mi5 2` ama bridge yok → yanlış subnet → IPv4 yok) | infra'da aynı-isim instance'ın bridge+lease+map satırını temizle → wd-provision bridge'i sıfırdan kurar |

**★En gizli kök (16)**: `su: not found`. Elle `lxc-attach -- su -c id` çalışıyordu
(doğrudan çağrı) ama agent'ın `lxc-attach -- /system/bin/sh -c "su -c ..."`'ında sh
Android PATH'ini almadığı için `su` bulunamıyordu. Debug log (`/tmp/vtouch-debug.log`'a
vtOut yazdırma) ile teşhis edildi.

---

## Kapasite (ölçüldü — [[phoenixnap-KAPASITE-OLCUM]])
- RAM ~1.5GB/instance (250GB host → teorik 150 sığar).
- FROZEN=%0 CPU → **100+ idle** cihaz tutulabilir.
- AKTİF (ekran/otomasyon): **40-60** (GPU yok, software render).
- **Darboğaz = eşzamanlı boot** → kademeli, max 3-5 aynı anda boot. Art arda hızlı
  provision host'u boğar (weston birikir, load fırlar, boot 300s'yi aşar).

## Operasyon Notları
- **SSH**: `ssh -i ~/.ssh/phoenixnap_y ubuntu@125.253.73.45`. ★KARARSIZ (uzun komut
  connection reset) → kısa komut veya script upload.
- **Agent restart takılırsa** ("deactivating"): `sudo systemctl kill -s SIGKILL
  fleet-agent; sleep 3; sudo systemctl reset-failed fleet-agent; sudo systemctl start
  fleet-agent`. Provision başlatmadan ÖNCE agent'ın `active` olduğundan emin ol
  (yoksa job PENDING'de 6dk sonra ölür).
- **Instance temizleme**: `wd-stop.sh <i>` + `lxc-stop -k` + `umount -R rootfs` +
  `rm -rf /var/lib/waydroid.<i> /root/.local/share/waydroid.<i> /run/xdg-<i>`.
  Sonra artık `weston`/`wd-run` process'lerini `pkill -9`.
- **Job timeout**: PENDING 6dk, RUNNING 15dk (`apps/api/.../jobs.service.ts`).
- **Login**: `POST /auth/login {email:admin@fleet.local, password:$ADMIN_PASSWORD}`
  → token **`data.accessToken`** içinde. HOST id `cmrjldxje000oazryfdeo5d48`.
- **Deploy**: `scp agent.mjs → /tmp; sudo cp → /opt/agent.mjs; node --check;
  systemctl restart fleet-agent`. API: `scp src → /opt/fleet/apps/api; npx tsc; restart`.
- **★Host aşırı yükü PG/API'yi düşürür**: art arda çok provision/temizlik host yükünü
  fırlatır (load 5+) → Docker port-forward hıçkırır → API `Can't reach 127.0.0.1:5432`
  ile crash-loop'a girer (`restart counter at N`, port 4000 kapalı, health=000).
  ÇÖZÜM: `docker restart fleet-postgres fleet-redis; systemctl reset-failed fleet-api;
  systemctl start fleet-api`. PG container zaten Up ama docker-proxy bağlantısı tazelenir.
- **Ağ tamamen bozulursa** (bridge yok, subnet-map kirli): `rm -f
  /var/lib/waydroid-subnets.map /var/lib/misc/dnsmasq.waydroid-*.leases`; tüm
  `waydroid-*`/`veth*` link'leri sil; instance'ları rm -rf. Sonra taze provision
  bridge'i + map'i sıfırdan kurar (infra adımı artık bunu otomatik yapar).
