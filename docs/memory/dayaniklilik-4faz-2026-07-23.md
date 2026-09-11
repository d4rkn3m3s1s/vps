---
name: dayaniklilik-4faz-2026-07-23
description: Sistemi "taş gibi sağlam" yapan 4-fazlık dayanıklılık çalışması — reboot-persist, mesaj-doğruluğu, hız, izleme. 4 denetim ajanı + tüm fix'ler.
metadata:
  type: project
---

# DAYANIKLILIK — 4 FAZ (2026-07-23)

Kullanıcı "sistem taş gibi sağlam, sürekli çalışan, kendi kendini kurtaran, hızlı+stabil olmalı" dedi. 4 paralel denetim ajanı (self-heal/kod/hız/izleme) kod tabanını taradı → ~26 bulgu → 4 faza bölünüp uygulandı. HEPSİ phoenix'te (125.253.73.45) canlı doğrulandı. İlişkili: [[cihaz-acma-proxy-healthwatch-2026-07-23]] [[RESUME-kaldigimiz-yer-2026-07-23-wa-rootonly]] [[host-phoenix-erisim]].

## COMMIT'LER (branch feat/cloud-phone-suite)
- `c18b5e5` Faz-1 reboot-persist + agent self-heal
- `44b6d63` Faz-2 mesaj-doğruluğu + reaper yarışı
- `c8ab62b` Faz-3 hız (load 56→45)
- `2f9b20b` Faz-4 izleme & erken-uyarı

## FAZ-1: REBOOT-PERSIST + SELF-HEAL (en kritik — reboot'ta sistem çöküyordu)
- **waydroid@.service TEMPLATE** (`deploy/kvm-host/waydroid/waydroid@.service`): her instance systemd-persist. Önceden detached `sleep infinity` idi (systemd DIŞI) → reboot'ta cihazlar gelmiyor + datacenter IP'ye düşüp banlanıyordu. 30/30 enable (`systemctl enable waydroid@miN`). Eski tekil `waydroid-mi5.service` disable edildi.
- wd-proxy-restore.service + wd-health-watch.timer canlıda zaten enabled (ajan repo'da göremedi ama canlıda vardı).
- **adb() timeout+SIGKILL (30s)**: "kendi timeout'u var" yorumu YANLIŞTI, asılınca sonraki job'a paralel ADB (fake-SENT). **signedFetch AbortSignal(35s)**. **reportComplete apiRetry (3x backoff)**: başarılı iş sonucu bir blibinde kaybolmasın.
- **orphan-recovery**: agent startup'ta `POST /agent/jobs/abandon-claimed` — claimed RUNNING job'ları serbest bırakır (retryable→PENDING, stateful→FAILED). İMZA BUG: boş {} body '' olarak imzalanır → body HİÇ gönderme. Canlı: "1 re-queued".
- **agent restart 90sn→15sn**: `TimeoutStopSec=15` (systemd default 90 idi) + drain 30s→8s. `RESTART EDERKEN pkill/systemctl kill KULLANMA` — failed'a düşürür; reset-failed+start.

## FAZ-2: MESAJ-DOĞRULUĞU (silently-wrong)
- **C-2 fake-SENT (EN TEHLİKELİ)**: whatsappSend SENT'i "compose kutusu boşaldı" ile doğruluyordu → yanlış tap/ANR/draft-clear kutuyu mesaj GİTMEDEN boşaltıp yalancı SENT. Fix: kutu boşalınca giden-BALON teyidi iste (grace+null-fallback). Canlı: gerçek gönderim SENT döndü (meşru bloklanmadı).
- **C-3 reaper yarışı**: RUNNING_STALE_SHORT_MS 4dk→6dk. Agent send'i 3x(100s)+backoff≈307s deniyor; 4dk cutoff daha 2/3 denemedeyken FAILED baloncuğu yazıyordu.
- **C-4 grup-üye**: legacy `gjid LIKE '%digits%'` SUBSTRING → tüm gruplar eşleşiyordu (boş gDigits'te `LIKE '%%'`=ALL). Fix: anchored `gjid LIKE 'digits@%'`.
- **C-5 payload arındırma**: createJobRecord JSON round-trip ile undefined temizle (Prisma undefined JSON alanı sessizce düşürüyordu).

## FAZ-3: HIZ — load 56→45 (%18, canlı ölçüm)
- **P-1 Ticker re-entrancy guard** (whatsappInboxTick/mediaCaptureTick): tick bitmeden interval tekrar tetiklenince ATLA (üst üste binen ADB fırtınası = load-100 motoru). reachableSerials 2.5s TTL cache. WA_INBOX_MS 3s→5s.
- **P-2 Global ADB semaforu** `withAdbSlot` (ADB_MAX_INFLIGHT=20): busyDevices sadece per-device idi; host-geneli toplam sınırsızdı → 40-60 komut tek adbd'ye.
- **P-3 Load-aware boot gate**: provision slot beklemesi load≥cores*0.7 ise bekle (sabit 4 load 80'de bile boot başlatıyordu). health-watch zombie-restart load≥cores*0.9 ise ertele. `os.loadavg()` (zero-dep).
- **P-6 Stale-serial purge**: heartbeat'te 5dk'da bir reachable-dışı serial anahtarlarını temizle (subnet değişince eski serial sonsuza kalıyordu).
- **P-4 stream JPEG**: OPSİYONEL (sharp bağımlılığı), atlandı.

## FAZ-4: İZLEME & ERKEN-UYARI (observability)
Yeni 4 AlertTrigger (enum + migration): ACCOUNT_BANNED, HOST_SATURATED, PROXY_UNHEALTHY, FLEET_MASS_OFFLINE.
- **M-1 WA ban→alert (EN KRİTİK)**: setAccountHealth önceden SADECE webhook atıyordu → webhook'suz operatör ban'i öğrenmiyordu. Şimdi ACCOUNT_BANNED evaluate + KOŞULSUZ Telegram/Slack/Discord (ban kural-bağımsız).
- **M-6 proxy-alert ayrımı**: recordHealthAlert kind'a göre: PROXY_LEAK/PROXY_DEAD→PROXY_UNHEALTHY, UNREACHABLE→DEVICE_OFFLINE, AUTO_RECONNECT→bilgi. fixed=false=koşulsuz push.
- **M-2 HOST_SATURATED**: offline-tick'te canlı host load≥cores*0.9 veya disk<15GB → alert.
- **M-4 FLEET_MASS_OFFLINE**: bir turda workspace filosunun ≥%30'u (min 3) düşerse tek burst alert.
- **M-3 dead-man's switch**: health-watch her turda `notify HEALTH_WATCH_HEARTBEAT` → API Host.lastHealthWatchAt stamp; >20dk eskiyse "izleyici durdu" alert. Canlı: null→02:08:32 güncellendi.
- health-alert schema'ya PROXY_DEAD + HEALTH_WATCH_HEARTBEAT eklendi (yoksa 400); instance boş-string→undefined transform.
- **M-5 canlı panel** (`612363b`, YAPILDI): HealthView'a alert banner (son 6h fired-alert, severity-renkli: ban/toplu-düşüş kırmızı, satürasyon/proxy sarı) + "Sunucular" bölümü (gerçek host load1/cores/saturationPct/diskFreeGb/ramFreeGb + monitor-stale rozeti). fleet-health.service'e `hosts[]` (prisma.host, gerçek makine verisi). 15s polling korundu; WS canlı-abonelik opsiyonel bırakıldı. Deploy'da .next chown gerekti. Canlı: phoenixnap-a1c5 load 58.59/80.

## KALAN (opsiyonel, düşük öncelik)
P-4 stream JPEG (sharp kur + FLEET_STREAM_JPEG=1). P-5 API serial→device composite index. WS canlı-abonelik (15s polling yeterli çalışıyor).

## KANITLI SONUÇ: reboot-dayanıklı + hızlı (load-18%) + doğru (fake-SENT/reaper fix) + kendini izleyen (ban/host/proxy/toplu-düşüş alert + dead-man's switch). Alert engine KURAL gerektirir AMA ban + fixed=false proxy KOŞULSUZ bildirim gönderir.
