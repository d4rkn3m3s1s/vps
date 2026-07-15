# Root (Magisk) enjeksiyon dosyaları

Waydroid cloud-phone'u **root'suz host tarafından** rootlamak için gereken Magisk
dosyaları (Git LFS). Bir çalışan Scaleway cihazından çıkarıldı. Provision'ın
`applyRoot()` adımı bunları instance'a enjekte eder; boot'ta `bootanim.rc` Magisk'i
başlatır ve `su -c …` UI onayı olmadan çalışır (headless'te su-handshake yanıtlanamaz).

Bu, **gerçek dokunma (vtouch/uinput, root ister)** için gerekli — WhatsApp'ın
companion menü item'ları synthetic tap'i reddedip yalnızca gerçek dokunmayı kabul
eder.

| Dosya | Nereye | Ne |
|-------|--------|-----|
| `su` | `overlay/system/bin/su` + `xbin` | Magisk su binary (OverlayFS ile `/system/bin/su` olur) |
| `magisk-init.tar.gz` | `overlay/system/etc/init/` | `bootanim.rc` (boot-time magisk init) + `magisk/{magisk64,magiskinit,magiskpolicy}` |
| `magisk.db` | `<data>/adb/magisk.db` | su policy DB (shell/root'a izin) |
| `magisk-dir.tar.gz` | `<data>/adb/magisk` | magiskd runtime binaries |

`FLEET_MAGISK_DIR` env (varsayılan `/opt/fleet-agent/magisk`) agent'ın bunları
okuduğu yeri belirler. Deploy'da bu dizine kopyalanmalı.

Kaynak: Scaleway çalışan cihaz `/system/bin/su` + `/data/adb/magisk*` + work
overlay `system/etc/init/`.
