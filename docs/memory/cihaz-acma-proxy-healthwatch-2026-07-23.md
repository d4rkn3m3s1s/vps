---
name: cihaz-acma-proxy-healthwatch-2026-07-23
description: Duran cihazları doğru açma prosedürü + proxy-restore + health-watch oto-iyileşme düzeltmeleri (duplicate-guard/boot-grace/dead-redsocks). "Cihaz durdu/düştü" olduğunda başvur.
metadata:
  type: project
---

# CİHAZ AÇMA + PROXY + HEALTH-WATCH — 2026-07-23

phoenix'te (125.253.73.45) duran 14 cihaz açılırken kritik dersler + kalıcı düzeltmeler. İlişkili: [[host-phoenix-erisim]] [[RESUME-kaldigimiz-yer-2026-07-23-wa-rootonly]] [[proxy-mimari-cok-port-2hesap-2026-07-21]] [[adb-reconnect-error-heal-2026-07-20]].

## ⚠️ DURAN CİHAZ AÇMA — DOĞRU PROSEDÜR (yanlış yapınca 14 cihaz düşürdüm)

**KÖK SORUN:** `wd-batch` ile cihaz açarken agent'ın `wd-health-watch`'u (7dk timer) aynı instance'ları İKİNCİ kez başlatır → **duplicate wd-run** → aynı binder/DBus runtime'ında çakışma → İKİSİ DE bozulur (33 wd-run oldu, 14 cihaz düştü).

**DOĞRU SIRA:**
1. **ÖNCE health-watch'u durdur:** `sudo systemctl stop wd-health-watch.timer wd-health-watch.service` (duplicate döngüsünü kırar). ARTIK bu şart DEĞİL — script düzeltildi (aşağıda), ama toplu açmada yine de güvenli.
2. **Duplicate temizle** (varsa): her instance için EN ESKİ wd-run'ı bırak, fazlaları öldür (dedup.sh mantığı: `pgrep -f "wd-run.sh $inst\$" | sort -n | tail -n+2 | xargs kill -9`).
3. **Recovery (zombie reçetesi, tek tek, load-korumalı):** her instance için: `pkill -9 -f "wd-run.sh $inst\$"` + `pkill wayland-$inst xdg-$inst waydroid..--instance $inst lxc-start..waydroid.$inst dnsmasq..waydroid-$inst` + `lxc-stop -n waydroid -P /var/lib/waydroid.$inst/lxc -k` + `rm -rf /run/xdg-$inst /run/wd-$inst /run/waydroid-$inst-lxc` + `setsid bash /opt/fleet-agent/waydroid/wd-run.sh $inst &`. Script: /tmp/recover.sh (load<nproc*0.9 bekle).
4. **Boot ~90sn**, sonra `adb connect $ip:5555` ŞART (boot etse de otomatik bağlanmaz — KANITLANDI).
5. **health-watch geri aç:** `sudo systemctl start wd-health-watch.timer`.

**KRİTİK UYARILAR:**
- **`pkill`/`systemctl kill` bu host'ta SSH oturumunu BLOKLUYOR** → script dosyası yaz, scp+`sudo bash` ile çalıştır. Ayrıca `pkill -f /opt/agent.mjs` fleet-agent'ı `failed`'a düşürür (agent graceful-drain ~90sn, systemd stop-timeout aşar) → düzeltme: `sudo systemctl reset-failed fleet-agent; sudo systemctl start fleet-agent`.
- **IP eşlemesi:** subnet map (`/var/lib/waydroid-subnets.map`: `mi5 2` → IP `192.168.2.112`). BOOT_DONE log'u `subnet=N` yazar = doğru IP. DB'deki IP bazen yanlış olabilir ama %92 doğruydu — DB IP'sini DEĞİŞTİRME (çakışma riski), doğru INSTANCE'ı aç.
- adb 26 vs DB 23 farkı normal — agent heartbeat senkronlar. Sahipsiz IP'ler (.8/.9/.12) = kayıtsız ekstra instance.

## PROXY — DURUM + DÜZELTME

**Genel:** 25/25 datacenter sızıntısı YOK, ülke-eşleşme TAM (TR num→TR IP: TurkNet/Superonline/TürkTelekom/VFNET; AL num→AL IP: Vodafone/ONE/Nisatel Albania).
**Test:** `adb -s $ip shell su -c "curl -s --max-time 10 https://api.ipify.org"` → IP; ülke `curl ip-api.com/line/$IP?fields=countryCode,isp` (HOST'tan, cihazda rate-limit olur).

**mi9 sorunu (dead-redsocks):** recovery/reboot sonrası redsocks config+process KAYBOLUR. iptables trafiği `12500+subnetId` portuna yönlendirir ama dinleyen yok → tüm HTTP kara deliğe gider (ping çalışır, curl boş). **Tespit:** `ss -tlnp | grep 125XX` (subnet portu) dinlemiyorsa + ping canlıysa → redsocks ölü.
**Düzeltme:** `sudo systemctl restart wd-proxy-restore.service` (cihaz ONLINE İKEN çalıştır — DB'den ülke+kimlik okuyup redsocks'u yeniden kurar). `wd-proxy.sh <inst> <CC> <user> <pass> <host> <port>` 6 arg + credential ister, ELLE çağırma; proxy-restore kullan.

## HEALTH-WATCH OTO-İYİLEŞME — 3 KALICI DÜZELTME (2026-07-23)

`/opt/fleet-agent/wd-health-watch.sh` (repo'da YOK, sadece canlı + `.audit-host-snapshot/`). Her 7dk otomatik. Eklenen düzeltmeler (yedek: `.bak.HHMM`):
1. **BOOT-GRACE:** wd-run son `WD_BOOT_GRACE_S=150`sn içinde başlamışsa (mtime `/proc/$pid`) zombie-restart ATLA — boot eden cihazı zombie sanıp duplicate yaratmayı önler.
2. **DUPLICATE-GUARD:** zombie-restart öncesi `pkill -9 -f "wd-run.sh $inst\$"` — eski+yeni wd-run çakışmasını (bu oturumun ana bug'ı) önler.
3. **ADB-CONNECT:** ilk erişim kontrolü öncesi `adb connect $addr` — boot etmiş ama bağlanmamış cihazı gereksiz restart etmeyi önler.
4. **DEAD-REDSOCKS:** çıkış-IP alınamıyorsa + redsocks portu (`12500+subnet`) dinlemiyorsa + ping canlıysa → proxy yeniden uygula (mi9 senaryosu).

**Test kanıtı:** düzeltilmiş script elle çalıştı → `23 sağlıklı, 0 reconnect, 0 duplicate`. Eskiden online cihazları bile zombie sanıp bozabiliyordu.

## API/DEPLOY SAĞLAM (bu oturum boyunca): test job "Selim +905391147788" + mesaj `905464022835→SENT` ile kanıtlandı. WA ban taraması: "banned" kelime-sayimi YANILTICI (support_banned_phone_number normal); GERÇEK ban = `account_switching_banned_account_lid` DOLU. 15 kayıtlı cihaz hepsi sağlıklı (gerçek ban yok).

## AÇIK İŞ: host scriptleri (wd-*.sh) repo'da versiyonlanmıyor — sadece canlı + snapshot. İstenirse repo'ya eklenebilir.
