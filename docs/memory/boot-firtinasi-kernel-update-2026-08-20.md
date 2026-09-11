---
name: boot-firtinasi-kernel-update-2026-08-20
description: "Otomatik çekirdek güncellemesi reboot'u boot fırtınası yarattı, filo 4.5 saat kilitlendi — kurtarma reçetesi ve kalıcı düzeltme"
metadata: 
  node_type: memory
  type: project
  originSessionId: a9614e2b-33cb-436b-bb65-298d256a8fb6
  modified: 2026-08-20T17:44:39.213Z
---

# 🔴★★★ ÇEKİRDEK GÜNCELLEMESİ → BOOT FIRTINASI → 4.5 SAAT KİLİT

## Ne oldu
Sunucu 09:49'da yeniden başladı ve `6.8.0-137` → `6.8.0-138` çekirdeğiyle geldi.
⚠️**Sebep başta `unattended-upgrades` sanıldı — YANLIŞTI, aşağıdaki DÜZELTME'ye bak.**
Açılışta **etkin olan 168 birimin hepsi aynı anda** kalkmaya çalıştı ve filo kilitlendi:

```
ADB 89'da TAKILDI, 4.5 saat İLERLEMEDİ (sonra 82'ye düştü)
load 1113  ·  CPU %73 BOŞTA  ·  RAM 158 GB boş  ·  disk %4  ·  D-state 0
```

★**KAYNAK SORUNU DEĞİLDİ.** `systemd-executor` **D durumunda** kilitlenmişti →
systemd **yeni süreç başlatamıyordu**. Bu yüzden `systemd-run` da işe yaramadı,
birimler `start-pre`'de asılı kaldı. **SSH portu 22 öldü.**

★★★**ACİL PORT 2222 HAYAT KURTARDI** — gece kurulan SSH'sız kurtarma sistemi
sayesinde müdahale edilebildi. `/durum` HTTP ucu da çalışmaya devam etti ve
SSH koptuğunda **tek güvenilir ölçüm kanalı** oldu.

## ★KURTARMA REÇETESİ (tekrar lazım olursa)
1. **Filoyu ÇALIŞAN kümeye kırp**: açılış symlink'lerini `rm` ile kaldır
   (`/etc/systemd/system/multi-user.target.wants/waydroid@*.service`) — **systemd
   kilitliyken bile çalışır**, systemctl gerekmez. Listeyi kaydet (geri alınabilir).
2. **Reboot** → kırpılmış filo TEMİZ açıldı: load 96, adb 80/82, start-pre 0.
3. **Kırpılanları DALGALAR halinde geri aç** (12'lik, load/D-state eşikli).
4. **DB ile hizala**: DB'de olmayan instance'ları kapat.

**SONUÇ: adb 82 → 141/141, load 1113 → 95, DB ONLINE 141 (offline yok).**

## ★★★KALICI DÜZELTME — yayılım artık FİLO BÜYÜKLÜĞÜNE göre
Kapı **sabit** 52 dilim × 7 sn (0-357 sn) ile yayıyordu. 168 cihazda dilim başına
~3.2 cihaz düşer; Android boot'u 2-4 dk sürdüğü için **aynı anda ~35 cihaz** boot
ediyordu → tıkanma.
FIX: `DILIM = etkin birim sayısı`, aralık 8 sn (alt sınır 52).
163 cihaz → yayılım ~21 dk, aynı anda ~22 cihaz. **Filo büyüdükçe otomatik uzar.**
★D-state kapısı ve uptime penceresi aynen korundu.

## ⚠️ KURTARMADA YAPTIĞIM 3 HATA (hepsi düzeltildi)
1. **Kırpma yanlış listeyle çalıştı**: `/tmp/bagli.txt`e yazamadı (izin) ve sessizce
   **2 saat önceki** dosyayı okudu → 27 ÇALIŞAN cihaz da kırpıldı. Fark edilip geri
   alındı (55→82). ★**Yazma başarısızlığını kontrol et**, `wc -l` eski dosyayı okur.
2. **`systemctl start` BLOKLAR**: birimin `ExecStartPre`'i (boot-gate) uyurken geri
   dönmez. Betik TEK cihazda asılı kaldı, sıra hiç ilerlemedi (adb 83 sabit, load 7).
   FIX: **`--no-block`** + listeyi önce diziye oku (`while read` stdin tuzağı).
3. **Lease ayrıştırmasında `.112` tuzağı**: lease dosyasında **iki satır** var —
   gerçek cihaz ve ağ geçidi (`MAC 00:16:3e:f9:d3:03`, hep `.112`). `tail -1` hep
   ağ geçidini okur. **MAC'i dışlamayı unutma** — 28 sağlam cihazı "bağlı değil"
   sandım. Mevcut betikler bunu zaten dışlıyor.

## 🆕 Öğrenilenler
- **DB ile instance'ları hizala**: 162 dizin varken DB'de 141 kayıt vardı; fazladan
  25 kalıntı instance churn yaratıyordu. Kapatılınca **adb 118 → 137** fırladı.
- health-watch olay boyunca doğru çalıştı ("boot sürüyor → zombie-restart ATLANDI",
  "kendiliğinden geri geldi") — otonom kurtarma katmanı sağlam.
- 🔴★★★**DÜZELTME (20 Ağu akşam denetimi): reboot'u `unattended-upgrades` YAPMADI.**
  Kanıtlar: `50unattended-upgrades` içinde `Automatic-Reboot` satırlarının **DÖRDÜ DE YORUMLU** (`//`);
  o sabah 06:32-06:34'teki apt işlemleri yalnız `bind9`/`libheif`/`libcurl` idi (**çekirdek YOK**);
  09:49 civarında syslog'da kapanma/panic izi YOK; crash dosyaları 14 Ağu'dan. Çekirdek -138 zaten
  19 Ağu'da kurulmuştu, reboot onu sadece **etkin** hale getirdi.
  → Reboot **sağlayıcı tarafından** (phoenixNAP host/donanım/güç) geldi; içeriden engellenemez.
  ★**SONUÇ**: korunma "reboot'u önlemek" değil, **otomatik boot toparlamayı sağlam tutmak**.
  Bu yüzden `wd-boot-toparla.service` etkinleştirildi — bkz. [[durum-sayfasi-yanlis-veriler-ve-silme-kokleri-2026-08-20]].
  ⚠️**Ders**: "şu sebep oldu" demeden ÖNCE o ayarın gerçekten AÇIK olduğunu doğrula.

Bkz. [[kurtarma-sistemi-ssh-siz-2026-08-14]] · [[cihaz-dusme-6-kok-otonom-kurtarma-2026-08-17]] ·
[[proc-taramasi-systemd-kilidi-2026-08-14]] · [[nokta112-varsayimi-saglam-cihazlari-olduruyordu-2026-08-13]]
