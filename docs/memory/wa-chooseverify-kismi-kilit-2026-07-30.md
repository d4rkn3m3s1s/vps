---
name: wa-chooseverify-kismi-kilit-2026-07-30
description: "WhatsApp \"Choose how to verify\" sayfasındaki tek satırın kilidi TÜM kaydı durduruyordu + OTP ekranı çizildikten SONRA gelen gecikmeli hata diyaloğu hiç görülmüyordu (4 kök)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 060eed7a-fef7-42f6-a7d8-158fe471cc89
  modified: 2026-07-30T05:02:30.615Z
---

WhatsApp kayıt state machine'inde **4 ayrı kök** aynı belirtiyi üretiyordu: "panel OTP
kutusu açıyor ama kod hiç gelmiyor" / "diğer doğrulama seçenekleri çıkmalıydı çıkmadı".
Hepsi `deploy/kvm-host/agent/agent.mjs` verify döngüsünde.

## ★★★1. ChooseVerify KISMİ kilit — tek satır TÜM kaydı öldürüyordu

Canlı kanıt (+905340420653, mi34, 04:49 — ekran görüntüsü):
```
Choose how to verify
  ◉ Missed call    Auto-verify on +90 534 042 06 53   ← KULLANILABİLİR
  ○ Receive SMS    Try again in 24 hours              ← kilitli (soluk)
  ○ Voice call     Get code at +90 534 042 06 53      ← KULLANILABİLİR
```
`onRateLimit` "Try again in 24 hours"u görüp `break` etti → kayıt "24 saat bekle" diye
durduruldu. **24 saat SADECE SMS içindi**; cevapsız/sesli arama o anda hazırdı.

Sıra kritikti: `onRateLimit` satır ~3337, `onChooseVerify` ~3592 → akış hiç oraya varmıyordu.

**FIX:** rate-limit bulununca sayfa açık mı diye bakılır; `listVerifyOptions()` ile
KULLANILABİLİR seçenek varsa `rateLimitInfo = null` → akış sürer. Terminal ancak
*hiçbir* seçenek açık değilse.

## ★★2. 60-KARAKTER TAŞMASI — açık seçenek kilitli sanılıyordu

`listVerifyOptions` + `pickVerifyMethod` etiketten sonra **60 karakter** okuyordu; bu
pencere **bir sonraki seçeneğe taşıyor**. "Other device / Confirm on your other phone"
(28 krk) + satır sonu → alttaki "Receive SMS / Try again in 24 hours"a uzanıyor →
AÇIK seçenek `locked` sayılıyor, `applyVerifyMethod` `null` dönüyordu.
**FIX:** ortak `optionRow(sheet, re)` — etiketten sonraki İLK anlamlı SATIR (taşma yok).

## ★★★3. GECİKMELİ diyalog — `onOtp` break edince kimse bakmıyordu

WhatsApp SMS'e basınca **önce** OTP ekranını çizer ("Verifying your number" + 6 hane),
hata diyaloğunu **2-4 sn sonra üstüne** açar. `onOtp` true → `break` → diyalog
kontrolleri (döngü içinde) HİÇ çalışmadı → `OTP_WAIT` yazıldı.
⚠️ **Metinle sıkılaştırmak YETMEZ:** diyalog açıkken "Verifying your number" ARKADA
DURUYOR. **ZAMAN** gerekiyordu → `break`'ten önce ~6 sn teyit turu
(`OTP_SETTLE_ROUNDS`×`OTP_SETTLE_STEP_MS`, env ile ayarlanır): rate → `break`, sms → `continue`.

## ★★4. OTP-park noktasında `onRateLimit` kontrolü HİÇ YOKTU

~3773'te `onSmsSendFailed` vardı ama rate-limit yoktu. Rate-limit ekranı
`onSmsSendFailed`'a bilerek düşmüyor (`onSmsRateLimited` dışlıyor) → diyalog
**sessizce geçilip** `OTP_WAIT` yazılıyordu. FIX: `onSmsSendFailed`'DAN ÖNCE
`onRateLimit` → `RATE_LIMITED` + `waitSeconds`/`resumable`/`action`.

## Desen boşlukları (aynı turda)

- `wait\s+\d+` aranıyordu ama ekranda **"try again in 1 hour"** yazıyor — "wait" kelimesi
  HİÇ YOK → rate-limit kaçırılıyordu. `try again in\s+\d+` + TR `\d+\s+(dakika|saat)\s+(sonra|bekle)`
  eklendi (süre çıkarımı da).
- `callOffered` sadece "Request a call" arıyordu; ekrandaki düğme **"Try another way"** →
  eklendi (aynı yöntem sayfasına götürüyor).

## ★CEZA KATLANMASI — asıl ban sürücüsü

+905340420653 geçmişi: 8 deneme, 14 dakikada 3 tanesi → ceza **1 saat → 24 saat**.
Operatör kararı: **UYAR, ENGELLEME**. `FLEET_WA_RETRY_WARN_MIN` (varsayılan 15) penceresinde
aynı numaranın denemeleri sayılır; `startOperatorRegister` → `recentAttempt`,
`retryWhatsappRegister` → `recentAttemptWarning`; panel sarı uyarı kutusu gösterir.

## Dersler

- **Ekranın bir satırındaki kısıt TÜM ekranın kısıtı değildir.** Seçenek listelerinde
  satır-bazlı oku; sayfa geneline regex atma.
- **Metin penceresi karakterle değil SATIRLA sınırlandırılır** — karakter penceresi
  sessizce komşu satıra taşar ve yanlış-pozitif üretir.
- **Bir ekran "göründü" demek "kalıcı" demek değildir.** WhatsApp diyalogları OTP
  ekranının üstüne gecikmeli açılıyor; park etmeden önce teyit turu şart.
- Sunucuda panel servisi **`fleet-dashboard`** (`fleet-web` DEĞİL).

Doğrulama: 19/19 kısmi-kilit · 18/18 gecikmeli-diyalog · 33/33 sıra/kapsam (gerçek dosya
üzerinde) · api+dashboard `tsc --noEmit` temiz · filo 40/40 ADB online.
İlgili: [[wa-bekleme-sayaci-retry-2026-07-30]] · [[account-restricted-otomatik-tespit-2026-07-23]]
