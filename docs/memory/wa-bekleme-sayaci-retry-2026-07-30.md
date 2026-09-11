---
name: wa-bekleme-sayaci-retry-2026-07-30
description: "★★(30 Tem) WhatsApp bekletme cezası: 45 dk'lık stale-reaper 1 SAATLİK cezanın ORTASINDA kaydı FAILED çekiyordu → operatör aynı numarayla devam edemiyor, SIFIRDAN kayıt açıyordu = aynı numaranın 2. denemesi = ban sürücüsü. FIX: bekletme notu taşıyan AWAITING_OTP için ayrı 90 dk pencere + modalda geri sayan sayaç + 'Sıfırla ve Tekrar Dene' (AYNI hesap satırı, yeni sessid)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 060eed7a-fef7-42f6-a7d8-158fe471cc89
  modified: 2026-07-29T23:16:32.863Z
---

# ★★ Bekletme cezası kaydı öldürüyordu + geri sayan sayaç + retry

## Kök neden (ölçülmüş)
WhatsApp "wait 31 minutes" / 1 saat bekletme dediğinde hesap `AWAITING_OTP`'de
bekler. Ama `index.ts`'teki transient-state reaper **45 dakikada** (`FLEET_GA_STALE_MIN`)
o satırı `FAILED` yapıyordu. Sonuç: ceza bitince operatörün elinde kayıt YOK →
sıfırdan yeni kayıt → **aynı numaranın ikinci denemesi**. Canlı veride 28 numara
çok-denemeli (biri 7 kez) → asıl ban sürücüsü buydu.

## Çözüm 1 — reaper penceresi ayrıldı
`error` alanı bekletme işareti taşıyorsa (`WhatsApp bekletme|bekletiyor|[BEKLE]`)
ve durum `AWAITING_OTP` ise **ayrı ve geniş pencere**: `FLEET_WA_WAIT_GRACE_MIN`
(varsayılan **90 dk** > 60 dk ceza). Normal takılmalar 45 dk'da temizlenmeye devam.

Doğrulama (6 senaryo): 1 saat cezası / OTP cezası / COK_DENEME → **KORUNUR**;
normal SMS bekleme / hatasız / REGISTERING takılması → **FAILED**.

## Çözüm 2 — geri sayan sayaç
- Agent `onRateLimit` artık `{ note, waitSeconds, waitLabel }` döndürüyor
  (süre okunamazsa **3600 varsayılır** — 0 dönmek "süre doldu" yalanı olurdu).
- `waitUntil = job.finishedAt + waitSeconds`.
  ⚠️ **"şimdi + waitSeconds" YANLIŞ olurdu**: her poll sayacı baştan başlatır,
  geri sayım asla ilerlemez.
- Modal 15 sn'de bir `/status` tazeler — **ceza modal AÇIKKEN oluşuyor**, tek
  seferlik okuma onu hiç görmüyordu. Günlük/son-durum yalnızca ilk yüklemede
  yazılır ki yoklama canlı WS akışını EZMESİN.
- Bekleme sürerken **"Kaydı İptal Et" GİZLENİR** (operatör kararı: o kayıt iptal olmasın).

## Çözüm 3 — "🔄 Sıfırla ve Tekrar Dene"
`POST /accounts/whatsapp/register/:id/retry` (+ public `/v1` karşılığı).
**AYNI `GeneratedAccount` satırını yeniden kullanır** (yeni satır AÇMAZ) — bütün
mesele bu. Sırayla: çıkış IP'sini döndür (yeni sessid) → `REGISTER_WHATSAPP`
yeniden gönder (ajan kayıt başında `pm clear com.whatsapp` yapıyor, ayrı silme işi
gereksiz).

Retler: `NUMBER_BANNED` ([YASAKLI] işareti), `WAIT_IN_PROGRESS` (ceza sürüyor),
`ALREADY_ACTIVE` (canlı hesabı silerdi), `ACCOUNT_NOT_FOUND` (yabancı workspace).
Dördü de canlı doğrulandı.

⚠️ **retry ucuna `register` guard'ı KOYULMAZ**: o guard `category==='registering'`
cihazda 409 verir, oysa retry tam olarak takılı bir kaydı kurtarıyor (hesap
AWAITING_OTP → kategori registering) → guard kendi amacını bloke ederdi.

## Yeni alanlar (modal + public API + Telegram aynı kaynaktan)
`waitUntil` · `retryAfterSeconds` · `action` (tek cümle "ne yapmalı") ·
`wallKind` (BAN|APK|COK_DENEME|RED) · `otpRejected` · `resumable` · `timings`.
`getStatus` job result'ını **artık HER DURUMDA** okuyor (eskiden yalnızca
AWAITING_OTP → başarısız kayıtlarda süre/aksiyon hiç görünmüyordu).

`timings` canlı veriyle doğrulandı: `{eula:816, start:8507, verify:20417}` (ms).
Adım listesinde karşılığı olmayan fazlar (ör. `downgrade` 38 sn) ayrı satırda.

## Telegram
`/kayit` artık sabit yönlendirme metni değil: yarım kalan kayıtlar + kalan
bekletme süreleri + aksiyon cümlesi.

## Filo (30 Tem 00:15)
34 cihaz (dün 36, önceki gün 38 — zamanla siliniyor), 34/34 ADB, takılı ekran 0.
**Kayıt için müsait yalnızca 1 cihaz** (`mi10`, AL) — diğerleri aktif hesaplı veya
korumalı. 33 korumalı cihazın 19'u aktif hesaplı; 14'ünün hesabı ölü/kısıtlı:
6 FAILED (retry hedefi) · 3 BANNED (retry reddeder) · 3 RESTRICTED · 2 LOGGED_OUT.

İlgili: [[proxy-env-api-surecine-aktarilmiyordu-2026-07-30]] ·
[[bildirim-kaliciligi-ekran-kurtarma-2026-07-29]]
