---
name: phoenixnap-systemimg-bozuk-onarim-2026-07-14
description: ★★★KÖK NEDEN: phoenixNAP paylaşımlı system.img BOZUK (input/am/uiautomator/monkey ELF çöpüyle ezilmiş, Scaleway'de aynı image SAĞLAM) → tüm cihaz otomasyonu çalışmıyordu. Scaleway'in sağlam system.img'ı ile değiştirilerek ONARILDI 2026-07-14. + APK host-mount kurulum tekniği + agent orphan-process temizliği.★★★
metadata:
  node_type: memory
  type: project
  originSessionId: 0ce97b6f-23a2-4491-9478-d5dc4d5cc569
---

**★★★ phoenixNAP bozuk system.img ONARIMI + APK host-mount + agent temizliği (2026-07-14) ★★★**

WhatsApp test ederken keşfedildi. İlgili: [[phoenixnap-fleet-GOC-TAMAM-2026-07-13]] (göç sırasında image bozuldu), [[vision-instagram-envstrip-2026-07-14]], [[phoenixnap-PANEL-PROVISION-CALISIYOR-2026-07-13]].

## 🔴 KÖK NEDEN: system.img /system/bin script'leri BOZUK
phoenixNAP'te panelden kurulan TÜM cihazlarda (mi5/mi6/mi7 + .4.112) `input`, `am`, `uiautomator`, `monkey`, `ime`, `svc`, `dumpsys`, `content` komutları ÇÖP çıktı veriyordu ("syntax error: unexpected ')'", "inaccessible or not found", APK res/animator xml parçaları). SAĞLAM olanlar: `wm`, `settings`, `pm` (#!/system/bin/sh + cmd wrapper). 
- Teşhis: `toybox xxd /system/bin/input` → ELF opcode çöpü (`8ff5ff90...`) OLMASI gereken `#!/system/bin/sh\ncmd input "$@"` (32 byte text) yerine. **Boyutlar Scaleway ile AYNI (tesadüf)** ama içerik ELF çöpü.
- `getprop`/`ps`/`screencap` (native binary) ÇALIŞIYOR; script-wrapper'lar bozuk. system_server/zygote AYAKTA. `cmd input tap` DOĞRUDAN çalışıyor (servis sağlam, sadece wrapper bozuk).
- Kaynak: paylaşımlı `/var/lib/waydroid/images/system.img` (1.98GB, tüm instance RO mount+overlay). **Scaleway'de AYNI image SAĞLAM** (WA kayıt orada çalışıyor). phoenixNAP'e göç sırasında image kısmi/bozuk kopyalanmış.

## ✅ ONARIM (kalıcı, tüm instance düzeldi)
1. Scaleway (.252.57 çalışan cihaz) system.img sağlamlığı loop-mount ile doğrulandı (input=`#!/`)
2. Scaleway `/var/lib/waydroid/images/system.img` → local → phoenixNAP (1.98GB, ~3.5dk her hop, -C sıkıştırma)
3. Tüm instance durdur: `wd-stop.sh` her inst + `pkill lxc-start/container start/session start` + `umount -l` her rootfs → 0 mount
4. Bozuk `system.img` → `system.img.corrupt-bak` yedek, sağlamı yerine `cp`
5. mi7 `wd-run.sh` boot → **input tap ✅, uiautomator dump DUMP_OK ✅, am start ✅, WhatsApp açıldı+dump okundu**
★Loop-mount cache tuzağı: mount'luyken `cp`+ilk loop-mount SAĞLAM gösterdi ama orijinal RO-mount BOZUK — cache yanılsaması, ayrı mount point ile kesin doğrula.

## ✅ APK HOST-MOUNT KURULUM (ADB push 143MB'ı boğuyor)
ADB `push` 143MB WhatsApp'ta "failed to read copy response"+device offline (ARM Waydroid adbd sync boğulması). Parça-parça push da fail. Cihaz-içi curl BOZUK (`cmd: Can't find service`). ÇÖZÜM:
- Cihaz `/data/local/tmp` = host `/root/.local/share/waydroid.INST/data/local/tmp` (DOĞRUDAN erişilebilir!). APK'yı `sudo cp`+chmod 666+chown 2000:2000 → cihaz anında görür → cihaz-içi `pm install -r -g` = Success.
- Küçük APK (a11y 16KB, adbkeyboard 18KB) `adb push`+`pm install` çalışır; sadece BÜYÜK dosya host-mount gerektirir.
- APK KAYNAĞI: Scaleway çalışan cihazdan `pm path com.X`+`adb pull /data/app/.../base.apk`. WhatsApp=143MB v2.26.25.81, com.fleet.a11y, com.android.adbkeyboard.

## ✅ AGENT KARARSIZLIK TEMİZLİĞİ (benim müdahalelerim bozdu)
`adb kill-server`+`pkill -f node` müdahalelerim orphan agent process'leri üretti → çakışan ADB → agent "shutting down" loop. `metrics cat /proc/meminfo failed protocol fault` orphan çakışmasından (tek agent'ta zararsız uyarı). 
- ÇÖZÜM: orphan'ları PID ile `kill -9` (pkill -f pattern SSH'ı da kesiyor!) → tek systemd agent → active, NRestarts=0, host ONLINE, heartbeat taze, provision RUNNING çekiliyor.
- ★pkill -f "node" TEHLİKELİ: SSH komut satırı "node" içerir→kendini öldürür→SSH kopar. PID hedefle.

## DURUM (2026-07-14 sonu)
system.img onarıldı, agent kararlı, ONLINE. Temiz provision mi10 RUNNING (infra). SONRAKİ: mi10 boot→APK kur(host-mount)→panel tek-tık WA. KULLANICI VERMELİ: telefon numarası + çalışan proxy (thordata Albania 141.98.142.61:5555 ARTIK ÇALIŞMIYOR). SSH: phoenixnap_y ubuntu@125.253.73.45, scaleway_fleet root@51.158.107.121.
