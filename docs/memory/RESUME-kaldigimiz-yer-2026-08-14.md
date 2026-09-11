---
name: resume-kaldigimiz-yer-2026-08-14
description: "14 Ağu kapanış: filo 155/156 AYAKTA, 3 kilit çözüldü (kök=/proc taraması), kurtarma sistemi kuruldu. YARIN: TG komutları + panel entegrasyonu, ADB 123→156"
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-14T20:40:19.520Z
---

**14 Ağustos 2026 kapanış.** Zor bir gündü: sistem **3 kez kilitlendi**, 4 power cycle
yapıldı. Ama kök sebep bulundu ve kalıcı çözüldü.

## Günün sonu durumu

| Metrik | Değer |
|---|---|
| Açık cihaz | **155/156** ✅ |
| ADB bağlı | 123 (huni: 152 IP → 142 boot → 123 ADB) |
| D-state | **0** ✅ |
| systemd yanıt | **12-16 ms** ✅ (kilitte ölçülemiyordu) |
| RAM boş | 123 GB |
| Servisler | agent/fren/izle/durum/adb-tara/watchdog/kurtar **hepsi active** |

## ★★★ Günün kökü

Üç kilidin de sebebi: **`ps -eo stat` / `top -bn1` gibi `/proc` TARAYAN komutlar**.
Detay: [[proc-taramasi-systemd-kilidi-2026-08-14]] — bu dosyayı MUTLAKA oku.
İkinci tuzak: kapıdaki **load eşiği** (load 118 iken CPU %60 boşta) → filo 88'de takılıyordu.

## Kurulan kurtarma sistemi

[[kurtarma-sistemi-ssh-siz-2026-08-14]] — `/kurtar` HTTP ucu (token'lı) · port **2222**
acil SSH (`UsePAM no`) · watchdog (Telegram onaylı, **otomatik reboot YOK**) ·
`/durum` canlı sayfa.

## ★★ YARIN İLK İŞ

1. **Telegram komutları** — kullanıcı istedi: "ssh dondu müdahale için slash vs TG'den
   yapalım". API'nin `modules/telegram` bot'una kurtarma komutları eklenecek
   (`/kurtarma_durum`, `/panik`, `/durdur_betikler`). ⚠️ setMyCommands adı
   SADECE `[a-z0-9_]` kabul eder (tire geçersiz).
2. **Panel entegrasyonu** — aynı müdahaleler panelden de yapılabilsin.
3. **ADB 123 → 156** — 20 cihaz boot etmiş ama ADB portu açılmamış. `wd-adb-tara`
   2 dk'da bir deniyor; kök sebep incelenmedi.
4. **Commit + push** — bugünkü tüm betikler sunucuda, repo'ya girmedi. Önceki
   **8 commit hâlâ push edilmedi**.

## ⚠️ Bugün öğrenilen çalışma kuralları

- **Kendi ölçüm komutlarım yükün parçası oluyordu.** Her kontrolde 2-4 `systemctl
  list-units` çağırıyordum; `/proc` tıkalıyken bunlar da sıraya giriyor.
- `Failed to retrieve unit state: Connection timed out` = **UYARI**. Aynı komutu
  tekrar deneme — ikincisi sistemi tamamen kilitler (bugün tam böyle oldu).
- **Toplu `systemctl` YAPMA.** `systemctl start "waydroid@*"` kapalı unit'leri
  kapsamaz ama açık olanlara iş yükler. Tek tek + aralıklı + systemd yanıt kapısı.
- Kilit anında **SSH'ı zorlama** — `/durum` sayfasından veya `/kurtar` ucundan bak.
- Uzun heredoc + iç içe tırnak SSH katmanında **bozuluyor** (bugün 3 kez). Betikleri
  yerel yaz → `scp` → `install`. Bu yöntem güvenilir.

## Bugün düzeltilenler (hepsi canlı doğrulandı)

- `wd-boot-gate` v5b: `procs_blocked` + load kaldırıldı → filo 88 → **156**
- `wd-fren` v4: eşik D≥50 (2 ölçüm), çalışan cihazları **kapatmaz**
- `wd-izle` v4: `/proc` tarayıcı yok, `sd=` (systemd ms) alanı eklendi
- `wd-kademeli` v4: **systemd yanıt kapısı** (5 sn eşiği)
- `wd-boot-toparla`: **disabled** (toplu `systemctl` yapıyordu)
- `usermod -p "*" ubuntu` — acil SSH kapısı için gerekliydi
