---
name: waydroid-second-instance-scaleway
description: "★2026-07-05★ Scaleway ARM host'ta 2. Waydroid instance (multi-instance) — PR #1990 kodu 1.6.2'ye PORT EDİLDİ (/opt/waydroid-mi2), izole binder/network/dbus çalışıyor, #2 Android BOOT ETTİ (boot_completed=1) ama systemd session orkestrasyonu KARARSIZ (activating'de takılıyor); #1 hep güvende kaldı; kalan: session servis stabilizasyonu"
metadata:
  node_type: memory
  type: project
  originSessionId: 68c505aa-6f54-47fc-beb6-9d7679321390
---

★2026-07-05 — Kullanıcı isteği: "coklu cihaz + WhatsApp API için sunucu büyütme; önce bu sunucuda 2. cihaz aç, Waydroid+WhatsApp+spoof, 2 cihaz sorunsuz mu test et". Sunucu ölçek önerisi verildi (aşağıda) ama asıl iş 2. instance kurulumu oldu. İlgili: [[production-deploy-scaleway]] [[prod-deploy-workflow-scaleway]] [[three-redroid-phones]] [[waydroid-uinput-real-touch-SOLVED]].

## ★SUNUCU DURUMU (canlı doğrulandı)★
`scw-crazy-jones` (51.158.107.121) = **ARM64 (aarch64), 4 çekirdek, 15GB RAM (13GB müsait), 91GB disk (73GB boş)**. Waydroid **1.6.2 MAINLINE + GAPPS** (dpkg paketi, git değil). #1 cihaz: spoof **Samsung SM-G991B**, serial `192.168.240.112:5555`, waydroid0 network, `/dev/binder`. ARM olması WhatsApp için AVANTAJ (x86 emülatör bloğu YOK — [[whatsapp-avd-registration]] sorunu burada yok). **2 Android RAM'e rahat sığıyor: 2 boot'ta bile 2GB kullanım / 13GB müsait.**

## ★SUNUCU ÖLÇEK ÖNERİSİ (50+ cihaz, tek makine)★
Scaleway Elastic Metal (bare-metal ŞART — Waydroid custom kernel/binder + nested-virt ister; normal Instance vermez). Güncel fiyatlar (2026-07): **EM-I420E-NVMe €449.99/ay (EPYC 8324P 32c/64t, 256GB)** ana öneri (50 cihaz×2.5GB=125GB, headroom). Daha güvenli: **EM-I520E €569.99 (48c/96t 384GB)**. Bütçe: EM-I215E €329.99 (16c 256GB). ⚠️GERÇEK RİSK donanım değil, Waydroid multi-instance kararlılığı (bu session kanıtladı: boot oluyor ama kırılgan). Önce 10-15 instance test → sonra 50.

## ★2. INSTANCE — YAPILAN (PR #1990 PORT)★
Waydroid 1.6.2'de native `--instance` YOK (dpkg paket, instance.py yok). VineshReddy/multidroid deposu ESKİ (1.5.1, multi-instance YOK — README stok). **Gerçek kaynak: waydroid PR #1990 (taksan, 1.5.4 tabanlı, `git fetch origin pull/1990/head`)**. Karar: PR'ı olduğu gibi koşmak yerine **instance mantığını 1.6.2 kaynağına PORT ettim** (çünkü #1 ile aynı kod tabanı = aynı WhatsApp hardening/stabilite şart; container_manager 114 / lxc 86 satır fark var 1.5.4 ile).

**PORT KONUMU: `/opt/waydroid-mi2`** (`/usr/lib/waydroid` #1 HİÇ dokunulmadı). Kopyalandı + patcher `/opt/apply_port.py` (idempotent string-replace) 9 dosyayı port etti:
- `tools/helpers/instance.py` (YENİ, elle yazıldı — `INSTANCE_NAME` sys.argv'den `parse_known_args` ile çözülür, `arguments("")` ÇAĞIRMAZ→circular import önlendi; get_work_dir/binderfs_dir/inet_name/suffix; default→`waydroid0`, named→`waydroid-<inst>`).
- `tools/helpers/dbus.py` (YENİ — setup_policy, stok `/usr/share/dbus-1/system.d/id.waydro.Container.conf`'tan `id.waydro.Container.work.conf` türetir).
- `arguments.py` (`import tools.config` KALDIRILDI→circular kırıldı; `arguments(version)` param; `-n/--instance`+validate_instance_name).
- `tools/__init__.py`, `helpers/__init__.py`, `drivers.py` (BINDER_DRIVERS `wrap_instance_suffix`→`binder-work`), `ipc.py`, `config/__init__.py` (work=get_work_dir()), `container_manager.py` (net.sh'e `args.instance or ""`), `session_manager.py`, `initializer.py` (dbus.setup_policy), `lxc.py` (config yazma python read+replace: `/var/lib/waydroid`→work_dir, `waydroid0`→inet_name).
- **`data/scripts/waydroid-net.sh` head'i instance-aware yapıldı** (`$2`=instance; boşsa waydroid0/240, doluysa waydroid-<inst>/MD5%16+241). ★KRİTİK: bunu ATLAMAK #1'i BOZDU (net stop "work" argümansız çalışınca waydroid0'ı indirdi). Fix sonrası `start work` waydroid0'a DOKUNMUYOR (kanıtlandı).★

**Port doğrulandı**: `--instance work` → work_dir=/var/lib/waydroid.work, binderfs=/dev/binderfs-work, dbus=id.waydro.Container.work, binder=binder-work. Circular import YOK. tam import OK.

## ★İZOLASYON ALTYAPISI (çalışıyor)★
- **binder-work/vndbinder-work/hwbinder-work**: `/opt/wd2-binder.sh` binderfs-work mount + BINDER_CTL_ADD ioctl (`IOWR(ord('b'),1,264)`=0xc1086201, struct 264 bayt) + /dev symlink. Node oluşturma CANLI kanıtlandı (major=236). config_nodes'ta `/dev/binder-work→dev/binder` bind DOĞRU.
- **network**: net.sh `start work` → waydroid-work bridge + 192.168.248.x subnet (MD5"work"%16+241=248) + ayrı dnsmasq (pid `/run/waydroid-work-lxc`, lease `dnsmasq.waydroid-work.leases`) + NAT. #2 DHCP IP aldı: **192.168.248.112**.
- **dbus**: id.waydro.Container.work policy + bus name kayıtlı (dbus ListNames'te göründü).
- **init**: `--instance work init --images_path` yapıldı ama #1'in GAPPS kopyasını checksum reddedip **VANILLA indirdi** (Play Store YOK; WhatsApp APK ile kurulur). waydroid.work.cfg: binder=binder-work vb.

## ★★#2 TAM ÇALIŞIYOR — İKİ CİHAZ ADB'DEN ERİŞİLEBİLİR (ÇÖZÜLDÜ)★★
`adb devices`: `192.168.240.112:5555 device` (#1 SM-G991B) + `192.168.248.112:5555 device` (#2 WayDroid arm64). İkisi de boot=1, ADB yetkili. **systemd ile KALICI: `waydroid-work.service` active.** 3 kök engel çözüldü:
1. **pulse/native eksik** (lxc-start `Failed to mount /run/xdg-work/pulse/native` — #1'de PulseAudio soketi var, #2'de yok): `/etc/tmpfiles.d/waydroid-work.conf` + `: > native` boş dosya.
2. **session dbus yok** (systemd bağlamında `session start` → `Unable to autolaunch dbus-daemon without $DISPLAY`): wrapper `dbus-daemon --session --address=unix:path=$XDG_RUNTIME_DIR/bus` başlatıp `DBUS_SESSION_BUS_ADDRESS` export eder.
3. **ADB unauthorized/offline**: #2 idle'da `suspend_action=freeze` ile FROZEN oluyor (lxc-unfreeze uyandırır) + `ro.adb.secure=1` idi → `waydroid.work/waydroid.prop`+`waydroid_base.prop`'ta `ro.adb.secure=0`+`ro.secure=0` yapıp TAM RESTART. Sonra ADB `device` (yetkili).

**★MİMARİ ÇÖZÜM: tek wrapper + tek systemd servisi★** (parçalı 3 unit dbus timing'de race yapıyordu). `/opt/wd2-run.sh`: (1) runtime dirs+pulse/native + `/opt/wd2-binder.sh` binder nodes, (2) weston wayland-work (socket bekle), (3) container dbus daemon arka plan (bus name `id.waydro.Container.work` çıkana kadar `dbus-send ListNames` poll), (4) session dbus başlat, (5) `exec session start` (ön planda, unit'i canlı tutar). Unit `/etc/systemd/system/waydroid-work.service` (Type=simple, Restart=on-failure, RemainAfterExit=yes). Eski 3 parçalı unit disable edildi.

## ★KAYNAK ÖLÇÜMÜ (2 cihaz eş zamanlı — ölçek kararı için KRİTİK)★
`free`: 2.6GB kullanım / **12GB müsait** (RAM darboğaz DEĞİL, ~6-8 cihaza yeter). system_server'lar: #1 381MB, #2 302MB. **★LOAD AVERAGE 3.49 (4 çekirdek) — CPU ASIL SINIR★.** 2 cihaz boot+adb yükü 4 çekirdeği neredeyse dolduruyor (uiautomator dump CPU-bound, [[whatsapp-full-suite-hardening]] darboğazı). **Bu 4-çekirdekli makinede 3-4 aktif cihaz TAVAN.** → 50+ için EM-I420E (32 çekirdek) önerisi DOĞRULANDI: RAM değil ÇEKİRDEK belirleyici.

## ★#1 GÜVENLİĞİ (ders)★
#2 denemeleri #1'in ADB/route'unu 2 kez geçici bozdu (paylaşılan adb server + net.sh argümansız çağrısı). HER SEFERİNDE kurtarıldı, #1 Android HİÇ çökmedi. Kurtarma: `/usr/lib/waydroid/data/scripts/waydroid-net.sh stop && start` (waydroid0 geri) + container içi `lxc-attach ... ip addr add 192.168.240.112/24 dev eth0; ip route add default via 192.168.240.1` + `adb kill-server;connect`. Son durum: #1 SM-G991B RUNNING SAĞLAM.

## ★SONRAKİ ADIM (kalan)★
1. **Session servis stabilizasyonu**: container+session systemd unit'lerini düzelt (muhtemelen tek unit'te birleştir, ya da Type=notify/After-Requires dbus timing, ya da session'ı container daemon RUNNING olduktan SONRA başlat). Elle akış çalıştığı için mantık doğru, sadece systemd senkronu lazım.
2. Sonra: **Pixel 7 spoof** (setprop ro.product.model, DEVICE_MODELS'de var) + **uinput/vtouch** (#1 reçetesi [[waydroid-uinput-real-touch-SOLVED]], event1 #1'de aktif) + **WhatsApp APK kur** (VANILLA'da Play yok) + fleet API'ye #2'yi Device olarak ekle (hostId, serial 192.168.248.112:5555).
3. 2 cihaz stabil olunca üst üste WhatsApp job + RAM/CPU ölç → 50+ ölçek kararı.

**SSH**: key Windows `C:\Users\furka\.ssh\scaleway_fleet` → WSL'de `/tmp/sshkey/k` chmod 600 (Windows FS 777 SSH reddeder). Bu session'daki tüm net.sh/lxc yazma komutları `dangerouslyDisableSandbox` gerektirdi (production network writes).
