---
name: adb-reap-kayit-oldururken-numara-yakiyordu-2026-08-13
description: "🔴★★★ adb-reap CANLI KAYDI ÖLDÜRÜYOR ve NUMARA YAKIYOR: OTP ekranına ULAŞILMIŞKEN ADB ucunu düşürüyor → curFocus '' döner → 24 tur boşa → yanlış OTP_SCREEN_NOT_REACHED. ★Koruma listesi (net-head.sh × 123 instance) ~10,8 DK sürüyor, yeni cihaz hep listede YOK. ★busyDevices reap'e HİÇ bağlı değil. ★5 OFFLINE cihazın saatleri reap saatleriyle BİREBİR örtüşüyor."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-12T22:09:12.847Z
---

# adb-reap canlı kaydı öldürüyor — "cihaz durdu" + "numara boşa gitti" TEK KÖK

## Belirti (operatörün iki ayrı şikâyeti, aynı sebep)
1. "Aktif çalışan bazı cihazlar kayıttan sonra direkt durdu"
2. "Bazıları kayıt esnasında numaralar boşa gitti" — panel:
   `❌ Doğrulama ekranına ulaşılamadı — numara gönderimi başarısız olabilir`
   **ama operatörün ekran görüntüsünde cihaz DOĞRU ekranda:**
   `"Verifying your number — Waiting to automatically detect 6-digit code sent by SMS"`

## ★★★ KESİN KANIT (mi249, +905317467445, 12 Ağu)
```
21:52:10  [wa 119] verify: reached OTP screen (round 0)     ← OTP GERÇEKTEN oradaydı
21:52:15  adb-reap: bayat uc dusuruldu 192.168.152.119:5555 ← ADB'yi KESTİ
          (state=offline, host'ta instance yok)
21:52:30  [wa 119] phase 'verify' 31.1s → otp_not_reached   ← 18 sn boşa, yanlış hüküm
```
Agent OTP ekranını **gördü ve logladı**, sonra kendi temizlik görevi ADB'yi kopardı.

## KÖK NEDEN — üç kusur üst üste
**1. Koruma listesi 10,8 DAKİKA gecikmeli üretiliyor**
`adbRecoveryTick` → her instance için `net-head.sh` çalıştırıp `liveSubnets` kuruyor:
```
ÖLÇÜM: net-head.sh = 5,26 sn/instance × 123 instance = 647 sn (10,8 dk), SIRALI
```
`reapStaleAdbEndpoints(live)` bu liste bitmeden/bayatken çağrılıyor. **Yeni kurulan
cihaz en yüksek numaralı = listenin EN SONUNDA** → sistematik olarak hep yeni
cihazlar kurban oluyor. (net-head.sh boş dönmüyor — 25/25 dolu; sorun HIZ.)

**2. `busyDevices` reap'e HİÇ bağlı değil**
`busyDevices` her job'da doluyor (`agent.mjs:12002` add / `12077` delete) ama
`reapStaleAdbEndpoints` içinde **0 referans** var. `provisioningInstances` yalnızca
KURULUMU korur, KAYDI korumaz → kayıt en savunmasız iş türü.

**3. `curFocus` "ekran boş" ile "cihaz erişilemiyor"u AYIRT ETMİYOR**
```js
const w = await adbT(serial, ['shell','dumpsys','window'], 5000).catch(() => '');
```
ADB kopunca `''` döner, `onOtp()` false olur, 24×750ms turun HEPSİ boşa döner ve
agent "WhatsApp SMS göndermedi" diye **yanlış terminal hüküm** verir → numara yanar.
★ Bu, `screenTexts`/dump'a bakmanın neden kritik olduğunun bir örneği daha.

## ★★ KAPSAM — 5 OFFLINE cihazın hepsi bu (saatler BİREBİR örtüşüyor)
```
21:13:44 reap .149.232  ↔ mi246 OFFLINE 21:13
21:16:44 reap .142.145  ↔ mi242 OFFLINE 21:16  (hesap ACTIVE 21:13'te olmuştu)
21:20:15 reap .145.229  ↔ mi248 OFFLINE 21:20  (hesap ACTIVE 21:18'de olmuştu)
21:46:17 reap .147.102  ↔ mi247 OFFLINE 21:46
21:52:15 reap .152.119  ↔ mi249 = operatörün canlı kaydı
```
Beşi de CANLI instance'dı; hiçbiri "host'ta instance yok" değildi (log yalan söylüyor).

## ⚠️ ÇÜRÜTÜLEN HİPOTEZLER (önce bunlar sanıldı)
- "Kaynak sınırı / OOM" → **HAYIR**: RAM 140/250 GB, D-Bus 43/1024, OOM yok
- "Container çöktü" → **HAYIR**: mi249 `ct.log`'da 21:43→22:02 arası TEK restart yok,
  `NRestarts=0`. Cihaz o sırada AYAKTAYDI.
- "`pm clear` hatada WA'yı siliyor" → **HAYIR**: `pm clear` yalnızca İLK kayıtta
  (`!otpCode && !verifyMethod`), devam job'unda açıkça yasaklanmış (yorumla birlikte).
- "Yanlış OTP kaydı öldürüyor" → **HAYIR**: 29 Tem'de düzeltilmiş, OTP_WAIT'te kalıyor.
- "onOtp deseni yetersiz" → **HAYIR**: desen 3 yoldan eşleşir (aktivite + "Verifying
  your number" + "digit code"); ekran metni HEPSİNE uyuyordu. Sorun ADB'nin olmaması.

## ÖNERİLEN FIX (henüz UYGULANMADI — operatör "deploy yapma" dedi)
1. `reapStaleAdbEndpoints`'e `busyDevices` + `provisioningInstances` guard'ı ekle
   (iş yapan cihazın ucuna ASLA dokunma) — en ucuz ve en kesin koruma.
2. `liveSubnets`'i `net-head.sh` yerine ucuz kaynaktan üret (harita + canlı bridge
   taraması, `ip -o -4 addr`) → 647 sn yerine ~1 sn. Aynı fonksiyon
   [[subnet-cakismasi-kurulum-olduruyordu-2026-08-12]]'de zaten yazıldı.
3. `curFocus`/`screenTextRich` ADB kopukluğunu ayırt etsin: boş dönerse bir kez
   `ensureConnected()` + yeniden dene; hâlâ boşsa `ADB_LOST` diye AYRI durum döndür —
   **numarayı yakan terminal hüküm verme**, kaydı `resumable` bırak.

## ⚠️ ÖLÇÜM TUZAĞI
`adb-reap` logu "host'ta instance yok" YAZIYOR ama bu bir VARSAYIM (liste bayat);
gerçekte instance vardı. Log metnine güvenip "silinmiş cihaz kalıntısı" sanma.

İlgili: [[RESUME-kaldigimiz-yer-2026-08-12]] · [[bayat-adb-ucu-kurulum-oldurur-2026-07-28]] ·
[[subnet-cakismasi-kurulum-olduruyordu-2026-08-12]] · [[chat-not-opened-no-profile-zamanlama-2026-08-07]]
