---
name: RESUME-kaldigimiz-yer-2026-08-25
description: "25 Agustos oturumu — QUIC proxy-atlama sizintisi kapatildi (kok: yanlis iptables backend), 3 gunluk kurulum kesintisi cozuldu, kendi yamalarimin 2 regresyonu test ile yakalandi; sistem son durumu ve bekleyenler"
metadata:
  node_type: memory
  type: project
---

# 📌 KALDIĞIMIZ YER — 25 Ağustos 2026

## Bu oturumda ne yapıldı

### 1. 🔴 3 GÜNLÜK KURULUM KESİNTİSİ ÇÖZÜLDÜ
22 Ağu'de eklediğim kill-switch, FORWARD'a **cihaz başına** kural koyduğu için zinciri
312 kurala çıkarmış, ufw 170. sıraya düşmüş, DHCP zamanlaması bozulmuş →
**kurulum 90sn → 412sn** ve 3 gün yeni cihaz açılamamış. A/B ile kanıtlandı, **geri alındı**.
★Kullanıcı "süreyi yükseltme, sorunu bul çöz" dedi — doğru karardı, kök gerçekten başkaydı.

### 2. 🔴★★★ GERÇEK SIZINTI BULUNDU VE KAPATILDI
Cihazlar WhatsApp'a **QUIC (UDP/443)** ile, redsocks'a hiç uğramadan, **host'un
DATACENTER IP'siyle** bağlanıyormuş:
```
IN=waydroid-mi413  OUT=bond0.3  SRC=192.168.93.23  DST=57.144.134.145  DPT=443
```
`57.144.0.0/14` = Meta. **Kök: YANLIŞ IPTABLES BACKEND** — Waydroid ACCEPT'leri
`iptables-legacy`'de, koruma `nft`'ye yazılıyordu → 145 DROP kuralının sayacı **0**,
24 Temmuz'dan beri hiç çalışmamış.
→ `FLEET-UDP` zinciri (legacy, **tek kural**, 53/67/68/123 muaf, **REJECT**) +
`fleet-udp-guard.service`/`.timer`. Detay: [[derin-inceleme-gonderim-quic-hayalet-2026-08-25]]

### 3. 🔴 KENDİ YAMALARIMIN 2 REGRESYONU — İKİSİNİ DE TEST YAKALADI
- **canli-tutma tamamen durmuştu**: `pidof` exit 1 → `adb()` reject → `catch{return}`.
  90 sn boyunca ölü WhatsApp'lı cihaz için tek satır log yok. Düzeltildi + kanıtlandı.
- **UDP guard kural silinince geri koyamıyordu**: `RemainAfterExit=yes` → `start` no-op;
  timer `OnUnitActiveSec` ile **1s 6dk hiç ateşlememiş**; betikte PATH tuzağı (`exit 0`).
  Üçü de düzeltildi, timer'ın kurtardığı **canlı ölçüldü** (19:10:08).

### 4. 🟢 Temizlikler
145 ölü nft kuralı · 26 hayalet subnet-map kaydı (171→145) · `wd-proxy.sh` artık ölü
per-cihaz kural üretmiyor · `/durum`'a canary kartı

## ✅ Doğrulama (hepsi ölçüldü, tahmin yok)
| Test | Sonuç |
|---|---|
| **Yeni cihaz kurulumu** (canary ×2, biri yeni `wd-proxy.sh` ile) | **105 sn GEÇTİ** (koruma yokken 99 sn) |
| **Reboot simülasyonu** (durumu sil → boot birimini çalıştır) | kusur bulundu → düzeltildi → geçti |
| **Timer otonom kurtarma** (servise dokunmadan) | **19:10:08'de kurtardı** |
| Sızıntı taraması | 144 cihaz, **0 sızıntı, 0 çıkışsız, 144 benzersiz TR IP** |
| Uçtan uca gönderim | **18 sn**, temiz teslim, alıcıda IN kaydı |
| İdempotentlik | 3× çalıştırma → kural hep 1, FORWARD hep 290 |

## 📊 SİSTEMİN SON DURUMU (25 Ağu 19:34)
```
Filo      : DB=enabled=running=adb=144  (tam hizalı) · redsocks 145
Servisler : 8 kritik servis active+enabled · 0 hatalı birim · 22 timer
Koruma    : FLEET-UDP giriş kuralı 1 · zincir 7 · REJECT 441 paket · NAT REDIRECT 144
Sızıntı   : 0 · çıkışsız 0 · 144 BENZERSİZ TR çıkış IP
İş kuyruğu: 0 bekleyen · son 2 saatte 10 iş, 0 başarısız
Ajan      : active · 0 hata · "DOGRULANDI" logları çalışıyor
Uçlar     : panel 307 · /durum 200 · API 200
Kaynak    : 82 GB boş RAM · disk %5 · load 12.5 · D-state 0
Hesaplar  : ACTIVE 129 · BANNED 65 · RESTRICTED 2 (son 48 saatte SADECE 1 ban)
```
🟢**Ban dalgası sönmüş**: 08-17'de 52 ban → sonra 4,3,1,3,1,1 → son 48 saatte **1**.

## ⏳ BEKLEYENLER (kullanıcı "şimdilik dursun" dedi)
- **10 commit push edilmedi** (dal `feat/cloud-phone-suite`) — son 3'ü bu oturumdan
- 🔴**HTTPS YOK** — Caddy'de 0 TLS satırı; panel/JWT/`flk_` açık metin. **Alan adı gerek**
  (Let's Encrypt çıplak IP'ye sertifika vermez); yönlendirilirse Caddy 5 dk'da halleder
- Log birikimi 912 dosya / 1.1 GB (613'ü silinmiş cihaza ait) — `maxage 14` kendi düşürecek
- DNS sorguları host'un datacenter IP'siyle çözülüyor (Meta göremez ama CDN seçimi etkilenir)
- `Job` tablosu 707 MB, autovacuum eşiğin altında (8.7K/13K) — normal
- 1 hayalet subnet-map kaydı (canary'den), 24 artık veri dizini — zararsız

## ✅ AÇIK SORU KAPANDI (28 Ağu’de doğrulandı)
**Gönderim +8sn regresyonu ÇÖZÜLDÜ.** Temiz teslim medyanları:
```
08-23: 21sn  08-24: 24sn  08-25: 22sn   ← kill-switch dönemi
08-26: 15sn  08-27: 14sn  08-28: 15sn   ← geri alma sonrası
```
★08-27’de **52 gönderim, medyan 14sn** — tek örnek değil, sağlam örneklem.
Taban değere (14-16sn) döndü → **suclu kill-switch’ti**, kanıtlandı.
Ayrıca son 48 saatte **0 ban, 0 kısıtlama**.

## 📁 Değişen dosyalar (repo)
`deploy/kvm-host/agent/agent.mjs` · `waydroid/wd-proxy.sh` · **`waydroid/wd-udp-guard.sh`(yeni)** ·
**`systemd/fleet-udp-guard.service`/`.timer`(yeni)** · `rescue/durum-uret.sh`
Sunucuda: `/opt/agent.mjs`(systemd bunu çalıştırır) · `/opt/fleet-agent/waydroid/` · `/etc/systemd/system/`

İlgili: [[derin-inceleme-gonderim-quic-hayalet-2026-08-25]] ·
[[proxy-bind-kesintisi-ve-killmode-2026-08-22]] · [[durum-sayfasi-yanlis-veriler-ve-silme-kokleri-2026-08-20]]
