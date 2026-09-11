---
name: log-retention-durum-sayfasi-2026-08-17
description: "Log şişmesi (13GB→607MB) çözüldü + giriş-izi/kriz-log AYRIMLI retention (giriş saatlik, kriz 3 gün) + /durum sayfası yanıltıcı load yerine gerçek yük gösteriyor."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-17T00:41:20.190Z
---

# Log retention ayrımı + /durum sayfası geliştirme (2026-08-17)

## Log şişmesi çözüldü (13 GB → 607 MB)
Eski logrotate `weekly + rotate 4` (4 HAFTA saklama) idi → `syslog.1` tek başına 4.9 GB,
`/var/log` toplam ~13 GB. Kök: Waydroid container'larının **AppArmor audit** (%30) +
kernel gürültüsü (33.6M satır). journald da sınırsızdı (3.8 GB).

## ★★★GİRİŞ-İZİ vs KRİZ-LOG AYRIMI (kullanıcı istegi)
Kullanıcı: "giriş IP izleri saatte bir silinsin AMA kriz/hata logları (teşhis) dursun."
Dosya analizi ile ayrıldı:
- **auth.log** = sadece giriş (sshd/sudo, IP VAR, teşhis değeri YOK) → **SAATLİK sil**
- **DB AuditLog** = panel/site giriş IP'leri → **SAATLİK sil** (`FLEET_RETAIN_AUDIT_DAYS=1`)
- **fleet-agent.log** = kriz teşhisi (ZOMBIE/error/cihaz-düşme, IP YOK) → **3 GÜN tut** 🛡️
- **syslog/kern/journal** = karışık (hem IP hem kriz) → **3 gün tut** (kriz için)

Mekanizma: `/etc/cron.hourly/logrotate-fleet` her saat :17'de → auth.log döndür +
AuditLog'da 1 saatten eski giriş sil. journal/agent'a DOKUNMAZ (kriz korunur).
journald: `SystemMaxUse=800M, MaxRetentionSec=3day` (/etc/systemd/journald.conf.d/).
logrotate: `su root adm` ŞART (/var/log izinleri gevşek, yoksa hiç dönmez).

## ⚠️ YAŞANAN HATA (ders)
İlk agresif temizlikte `journalctl --vacuum-time=1d` + journal DOSYALARINI elle silmek
BUGÜNKÜ kriz loglarını da aldı (8-cihaz-düşme, agent SIGKILL, API 500, canary hepsi gitti).
Test edildi: saatlik tetikleyici artık kriz loglarına dokunmuyor (simüle kriz kaydı
tetikleyici sonrası DURDU). ★DERS: journal budama giriş-izi temizligi için KULLANILMAZ —
içinde kriz teşhisi var. Sadece auth.log + AuditLog hedeflenir.

## Kasma sorusu — YOK
logrotate/journal budama arka planda ms'lik I/O; panele/API'ye/siteye dokunmaz.
`copytruncate` agent/redsocks log yazmayı kesmeden devam ettirir. Servis restart YOK.

## /durum sayfası (durum-uret.sh) geliştirildi
LOAD YANILTICIYDI (canlı: load 11.6 iken CPU %93 BOŞTA — Waydroid'de her cihaz yüzlerce
UYUYAN thread tutar, anlık uyanmaları load'u şişirir ama CPU kullanmaz; 80 çekirdek).
Eklenenler:
- **En üstte genel sağlık özeti**: tek bakışta ✅SAĞLIKLI / ⚠DİKKAT / 🔴TEHLİKE.
  Karar **D-state**'e göre (asıl kilit sinyali), ham load'a DEĞİL.
- **3 ayrı kart**: "D-state ★asıl sinyal" · "Gerçek yük %X bosta (doluluk ~%Y)" ·
  "Ham load (yanıltıcı: Waydroid uyuyan thread'leri şişirir)".
- Gerçek yük = `100*load/nproc` (awk). idle/D-state renkli.
Servis: `wd-durum` (systemd), sayfa http://125.253.73.45/durum (10 sn yenilenir).

★Sağlık kararı KURALI: load DEĞİL → procs_blocked(D-state)>5 · systemd yanıt>3000ms ·
iowait yüksek. Bunlar temizse sistem sağlıklı (Waydroid'de load hep 8-12 görünür).

İlgili: [[proc-taramasi-systemd-kilidi-2026-08-14]] · [[cpu-alarm-load-yaniltici-2026-08-05]] · [[kurtarma-sistemi-ssh-siz-2026-08-14]]
