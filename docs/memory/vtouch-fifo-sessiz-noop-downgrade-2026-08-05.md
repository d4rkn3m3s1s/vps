---
name: vtouch-fifo-sessiz-noop-downgrade-2026-08-05
description: "🔴★★★ vtouch FIFO yolu SESSİZ NO-OP: `echo x y > /data/local/tmp/vt.fifo` exit 0 döner ama HİÇBİR ŞEY OLMAZ; `su -c \"/data/local/tmp/vtouch tap X Y\"` ÇALIŞIR. Kod FIFO'ya yazıp `return true` dediği için tapReal'in sentetik fallback'i BİLE devreye girmiyordu → HER gerçek-dokunma sessizce ölüydü. Business DOWNGRADE_STUCK'ın kökü buydu. ★A/B ölçümü aynı cihaz+aynı koordinatta yapıldı"
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-05T18:00:12.517Z
---

# vtouch FIFO SESSİZ NO-OP → Business downgrade 5 tur takılıyordu

## ★★★ A/B ÖLÇÜMÜ (mi113, DowngradeFriction ekranı, koordinat 540,2064)
```
su -c "/data/local/tmp/vtouch tap 540 2064"   → "tap sent" · ekran DEĞİŞTİ  ✓
echo 540 2064 > /data/local/tmp/vt.fifo       → exit 0    · HİÇBİR ŞEY OLMADI ✗
```
FIFO **var ve yazılabilir** (`prw-rw-rw- root root /data/local/tmp/vt.fifo`),
`echo` **hata da vermiyor**. Bu yüzden `vtapReal` `return true` deyip başarılı
sanıyordu → `tapReal`'in sentetik fallback'i **BİLE** devreye girmiyordu.
**Sonuç: agent'ın HER "gerçek dokunma"sı sessiz no-op'tu.**

FIX: FIFO yazımından SONRA binary de doğrudan çağrılıyor
(`adbSu(serial, '/data/local/tmp/vtouch tap X Y')`). Binary yoksa/su reddederse
sessizce geçilir — hiçbir şeyi bozmaz, FIFO'nun yutulduğu cihazlarda KURTARIR.

## Business downgrade TAM REÇETESİ (canlıda adım adım kanıtlandı)
| # | Yöntem | Sonuç |
|---|---|---|
| 1 | `input tap 540 2064` (SENTETİK) | ❌ ekran DEĞİŞMEZ — eski kodun tek yaptığı buydu |
| 2 | **vtouch** tap 540 2064 ("USE +90…") | ✅ onay diyaloğu AÇILIR |
| 3 | `h.seen('Deactivate and switch')` | ❌ düğmeler dump'ta YOK → tespit edilemez |
| 4 | **vtouch** tap 691 1409 ("Deactivate and switch") | ✅ downgrade AŞILIR |

- Diyalog tespiti **dump'tan DEĞİL `screenText`'ten** yapılmalı (başlık görünüyor:
  "Are you sure you want to deactivate your Business account?").
- Onay düğmesi oranı: **(0.640·W, 0.587·H)** — 1080×2400'de (691,1409).
- "USE +" düğmesi: `com.whatsapp:id/primary_button`, bounds `[63,2001][1017,2127]`,
  merkez (540,2064) — `clickable=true` ama sentetik tap GEÇMEZ.

## ⚠️ Yol boyunca ÇÜRÜYEN 3 hipotez (ölçüm hepsini reddetti)
1. *"Onay diyaloğu açılıyor ama dump'ta görünmüyor"* → canlı dump'ta o ekranda
   SADECE 2 düğme vardı (primary+secondary) → diyalog **hiç açılmamıştı**.
2. *"Diyalog hiç açılmıyor"* → ss ile açıldığı GÖRÜLDÜ (vtouch'tan sonra).
   ★DERS: dump'ın görmediği şey ekranda OLABİLİR — ss ile doğrula.
3. *"vtouch ölçek hatası var"* (phys 2368 vs override 2400) → `getevent -pl`
   ölçüldü: `ABS_MT_POSITION_Y max = 2400` = override ile AYNI → ölçek DOĞRU.

## Teşhis komutları
```bash
adb -s $D shell "su -c \"getevent -pl\"" | grep -A25 vtouch | grep ABS_MT_POSITION  # ölçek
adb -s $D shell "ls -la /data/local/tmp/vtouch /data/local/tmp/vt.fifo"             # binary+fifo
adb -s $D shell "ps -A | grep vtouch"                                              # daemon
```
⚠️ `h.tapNode`/`h.tapXY` (waHelpers, ~1935) vtouch kullanır; ~1752'deki İKİNCİ
`tapNode` SENTETİKtir — hangi helper'dan geldiğine dikkat.

İlgili: [[waydroid-uinput-real-touch]] · [[downgrade-spin-rapor-sisirme-2026-08-04]] ·
[[wa-otonom-fixler-downgrade-2026-07-17]]
