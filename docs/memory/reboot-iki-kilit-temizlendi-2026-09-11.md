---
name: reboot-iki-kilit-temizlendi-2026-09-11
description: 11 Eyl reboot — tracefs (96) + path_mount (4) kilitleri temizlendi, kurulum 130->105sn, load 138->8, kernel 138->139. REBOOT TETIKLEME TUZAGI ve mi367/mi77 ayni IP bulgusu.
metadata:
  type: project
---

# 11 Eylul 2026 — REBOOT: iki kilit sinifi temizlendi

## IKINCI KILIT SINIFI kesfedildi (tracefs'e ek)
3 Eyl tracefs kilidinin yaninda **path_mount** ailesi olusmustu: `PrivateTmp`/`ProtectSystem`
kullanan systemd servisleri sandbox kurarken hostun 912 mount'unu kopyalayip
`/run/systemd/mount-rootfs/var/lib/waydroid.mi385/rootfs/vendor/waydroid.prop` uzerinde
KALICI D-state'e giriyordu. Kurbanlar: logrotate (4 Eyl'den), man-db (4 Eyl), fstrim (7 Eyl),
systemd-timedated (11 Eyl). SONUC: **7 timer'in NEXT'i hesaplanmiyordu**, logrotate 1 hafta
calismadi (/var/log 4,1 GB), `timedatectl` yanit vermiyordu.
★TESHIS: `systemctl list-jobs` -> "start running" takili job'lar + `/proc/<pid>/stack` = `path_mount`.
★`procs_blocked=0` bunlari GOSTERMEZ (iowait degil, duz kesintisiz bekleme) — alarm gormez.

## ★★★REBOOT TETIKLEME TUZAGI (bir daha yasama)
`nohup bash -c 'sleep 2; systemctl reboot' &` SSH oturumu kapaninca **OLDU — reboot HIC
tetiklenmedi** (journal'da tek reboot satiri yok, uptime degismedi). Bosuna 20 dk beklendi.
★DOGRU YOL: `shutdown -r +1 "mesaj"` — init tarafindan zamanlanir, `/run/systemd/shutdown/schedule`
dosyasiyla DOGRULANIR, SSH kapanmasindan ETKILENMEZ. Iptal: `shutdown -c`.
⚠️Kapanis ~20 dk surdu (143 konteyner + takili job'lar); ping bile kesildi. Operator panelden
reboot atarak sikismis kapanisi kesti. Kapanista `fleet-agent` "failed" gorunur (redsocks/sleep
cocuklari kalir) — NORMAL, `systemctl start` ile geri gelir.

## SONUC (olculdu)
| | once | sonra |
|---|---|---|
| tracefs kilidi | 96 | **0** |
| path_mount asili | 4 | **0** |
| load | 138 | **8** |
| bos RAM | 77 GB | **115 GB** |
| swap | %100 | **bos** |
| failed birim | 2 | **0** |
| kurulum suresi | 130sn | **105sn** |
| kernel | 6.8.0-138 | **6.8.0-139** |
| binderfs mount | 153 | 143 (10 yetim temizlendi) |

Acilis: `wd-boot-gate` 143 birimi ~19 dk'ya yaydi, load max 127 (3 Eyl'de 2586 idi), D-state hic
olusmadi, failed 0. Gozcu taze tur: **143 saglikli, 0 erisilemez, 0 cikis-olu**. Canary GECTI.
143/143 cihazda WhatsApp ayakta, sizinti 0.
★Guard reboot'ta ise yaradi: 143/143 `mount tracefs` kapali -> kilit GERI GELMEDI (kernel 139'da da).

## ACIK BULGU
**mi367 + mi77 AYNI cikis IP'si** (88.229.17.71). 4 ayri olcumde (cihazdan + upstream'den) ayni.
Conf'lar DOGRU: `sessid-mi367TR` / `sessid-mi77TR`, ikisinde de `sesstime-30`. Yani hata bizde
degil, **thordata havuzu ayni cikisi veriyor**. Ban riski: iki hesap ayni IP'den gorunuyor.
★CARE: sessid'e rastgele son ek ekleyip redsocks'u yeniden baslatmak (NAT'a dokunmadan).

Ilgili: [[tracefs-kilidi-kurulum-yavaslamasi-2026-09-04]] · [[eventfs-deadlock-ve-host-donmasi-2026-09-03]]

## 11 Eyl ek islemler (reboot sonrasi)
✅**APT PENCERESI KAPATILDI** (operator karari: sistem yeni toparlandi, libc6 guncellemesi 2. reboot
gerektirebilirdi). `systemctl mask apt-daily.timer apt-daily-upgrade.timer` (=> /dev/null symlink,
reboot'ta da kalici) + `/etc/apt/apt.conf.d/20auto-upgrades` icindeki iki `APT::Periodic` degeri
`"1"` -> `"0"` (yedek: `20auto-upgrades.bak-20260911`). 56 guncelleme bekliyor (libc6 dahil).
★GERI ACMA: `systemctl unmask apt-daily.timer apt-daily-upgrade.timer && systemctl start ...`
+ 20auto-upgrades degerlerini "1" yap. Guncellemeyi ELLE ve IZLERKEN yap.
⚠️`pgrep -f 'apt|dpkg'` YANILTIR: dnsmasq cmdline'inda `.dpkg-dist` gecer, ayrica
`unattended-upgrade-shutdown --wait-for-signal` surekli ayakta durur (yalniz kapanista is yapar).
GERCEK olcum: `fuser /var/lib/dpkg/lock-frontend` (0 surec = calisan guncelleme yok).

✅**mi367/mi77 AYNI IP COZULDU**: sessid'e rastgele son ek eklendi
(`sessid-mi367TR` -> `sessid-mi367TRxutp`), yalniz o instance'in redsocks'u yeniden baslatildi
(kill + `setsid redsocks -c <conf>`; NAT'a/`local_port`a DOKUNULMADI, port 12522 ayni kaldi).
SONUC: mi367 -> 81.213.76.72, mi77 -> 37.155.5.180 (AYRI), cihaz saglikli, filo 143/143 failed 0.
Yedek: `/etc/redsocks-inst-mi367.conf.bak-20260911-sessid`.
★DERS: ayni cikis IP'si conf hatasi DEGIL, saglayici havuzu ayni cikisi verebiliyor —
sessid'i degistirmek havuzdan yeni oturum aldirir.

## 11 Eyl — BES IYILESTIRME (reboot sonrasi, hepsi deploy edildi ve dogrulandi)
1. ✅**Gozcuye HOST KILITLENME DENETIMI**: (a) 10dk+ "running" systemd job, (b) yigininda
   mount/super_lock gecen D-state surec, (c) NEXT'siz timer sayisi -> esik asilirsa
   `HOST_STUCK_JOB` alarmi. ★`kind` API'de SERBEST regex (BUYUK_SNAKE) — enum/migration
   GEREKMEZ (agent.controller.ts:136). ★Olu-timer esigi 4->7: **6 olu timer NORMALdir**
   (apport-autoreport, snapd.snap-repair, ua-timer + gozcunun kendi turu).
2. ✅**EULA dongu kirici** (agent.mjs): reaper force-stop ettigi cihaza `_waEulaMuted`
   damgasi birakir, `canli-tutma` 6 saat (FLEET_WA_EULA_MUTE_MS) o cihazi ATLAR.
   Kok: reaper kapatiyor -> 3dk sonra canli-tutma aciyor -> 8dk sonra reaper kapatiyor.
3. ✅**Alarm sogumasi** (alerts.service.ts): `lastFiredAt` zaten YAZILIYORDU ama HICBIR
   YERDE OKUNMUYORDU. Ayni kural 30dk icinde tekrar atesleyemez (FLEET_ALERT_COOLDOWN_MS).
   HOST_OFFLINE + FLEET_MASS_OFFLINE sogutulmaz. Migration YOK (mevcut alan okundu).
4. ✅**6 betik + 25 systemd birimi repoya alindi** (versiyonsuz uretim kodu idi).
   ⚠️`waydroid@.service` sunucuda repodan ILERIYDI -> repo kopyasi SILINDI, canli surum
   `systemd/waydroid@.service` oldu. Sirli drop-in (proxy.conf/proxy-env.conf) ALINMADI.
5. ✅**Haftalik yapilandirma yedegi** (fleet-config-backup.sh + timer, Pazar 03:10).
   Ilk deneme 1.4 GB -> wa-media/apks/apk/magisk haric tutuldu -> **652 KB**, izin 600.
   ⚠️tar satirinda ters bolu YOK (bu kabuk tirnakli heredoc'ta ters boluyu yiyor).

⚠️**APT PENCERESI KAPALI**: apt-daily + apt-daily-upgrade MASKELI, APT::Periodic 0/0.
56 guncelleme (libc6 dahil) bekliyor — ELLE ve IZLERKEN yapilmali, sonrasi reboot isteyebilir.
★`pgrep -f 'apt|dpkg'` YANILTIR (dnsmasq cmdline'inda `.dpkg-dist` var) -> gercek olcum
`fuser /var/lib/dpkg/lock-frontend`.
✅**Canary bildirimi ZATEN CALISIYOR** — onerdigim "canary alarmi ekle" maddesi GECERSIZDI:
AlertEvent'te 1 Eyl, 4 Eyl (x2), 25-26 Agu kayitlari var ("🚨 CANARY BASARISIZ").
Sistem dogru davranmis, biz gormemisiz.
