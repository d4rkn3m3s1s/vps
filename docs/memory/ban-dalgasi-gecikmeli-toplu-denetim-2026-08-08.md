---
name: ban-dalgasi-gecikmeli-toplu-denetim-2026-08-08
description: "🔴★★★ BAN DALGASI = WhatsApp'ın GECİKMELİ TOPLU DENETİMİ. 4 Ağu partisi %39 yandı, 5 Ağu %5 (8 KAT fark); 24 hesap AYNI GÜN toplu banlandı, hepsi ~70 saat yaşadı. ⚠️3 hipotezim de ölçümle ÇÜRÜDÜ (proxy/hacim/numara bloğu). ★ÇÖZÜM kodda DEĞİL: kayıtları GÜNLERE YAY. ★Ayrıca 'sağlık izleyici durdu' YANLIŞ ALARM (eşik 20→35dk)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-08T02:39:20.113Z
---

# Ban dalgası — WhatsApp'ın gecikmeli toplu denetimi

## Belirti
7 Ağu 17:00'de tek saatte **11 BANNED + 6 RESTRICTED**. Panelde ban dalgası alarmı.

## ★★★ BELİRLEYİCİ ÖLÇÜM — kayıt gününe göre yanma
| Kayıt günü | Toplam | Aktif | Yandı | Oran |
|---|---|---|---|---|
| **4 Ağu** | 77 | 18 | **30** | **%39** |
| 5 Ağu | 55 | 13 | 3 | **%5** |

**8 KAT fark.** Ve **24 hesap AYNI GÜN (7 Ağu) toplu banlandı** — hepsi 4 Ağu kaydı,
hepsi **~70 saat** yaşamış.

## ⚠️ ÜÇ HİPOTEZİM DE ÖLÇÜMLE ÇÜRÜDÜ
1. **"Proxy kesintisi"** → ban saatlerinde health-watch: *"133 sağlıklı, 0 çıkış-ölü"*.
   Proxy SAĞLIKLIYDI. (Trafik bakiyesi ayrı bir konuydu, zamanlaması örtüşmedi.)
2. **"Yoğun gönderim"** → banlanan hesaplar son 24 saatte **1-2 mesaj** atmış.
   Günlük hacim: 4 Ağu **11**/cihaz vs 5 Ağu **10**/cihaz — AYNI.
3. **"Kötü numara bloğu"** → AYNI bloklar iki günde ÇOK farklı sonuç:
   - `+90534`: 4 Ağu **%43** yandı · 5 Ağu **%0**
   - `+90535`: 4 Ağu **%57** yandı · 5 Ağu **%0**
   Ayrıca cihaz yeniden kullanımı da sebep değil (4 Ağu 1.60 hesap/cihaz,
   5 Ağu 3.24 — yani AZ kullanılan gün DAHA ÇOK yandı).

## GERÇEK ÖRÜNTÜ
WhatsApp **kayıt anındaki ortak imzayı** sonradan yakalayıp **partiyi birlikte**
kapatıyor. Hesaplar ~70 saat (≈3 gün) yaşayıp toplu ölüyor.

4 Ağu, hafızadaki **"77 denemede 46 ACTIVE (%60) REKOR"** günüydü — yani tek günde
yoğun kayıt. 5 Ağu partisi daha az ve dağınık olduğu için %5'te kaldı.

## ★ ÇÖZÜM KODDA DEĞİL — OPERASYONEL
**Kayıtları günlere YAY.** Tek günde 70+ kayıt yapmak, 3 gün sonra o partinin
toplu yanmasına yol açıyor. Sistemde düzeltilecek bir hata YOK.

⚠️ Bu, [[canli-izleme-8bug-sticky-2026-07-22]]'deki "BAN KÖK#2/3" ile aynı aile ama
farklı katman: orada sessid/Business geçmişi, burada **kayıt yoğunluğu**.

## 🟡 Aynı turda: "Sağlık izleyici durdu" YANLIŞ ALARM (düzeltildi)
Alarm geldi ama ÖLÇÜM izleyicinin ÇALIŞTIĞINI gösterdi: `lastHealthWatchAt` = 0 dk
önce, timer active, son tur 51 sn önce.

**Kök neden:** heartbeat script'in EN SONUNDA gönderiliyor → turun kendisi uzarsa
ping de gecikiyor. Timer 7 dakikada bir → **20 dk eşiği yalnızca ~2 tur payı**.
**KANIT:** 200 tur tarandı, turlar düzenli; TEK 21 dakikalık boşluk (08-08 00:29) —
operatör 22 cihaz silerken script yavaşlamış, eşiği **1 dakika** aşmış.

**FIX:** eşik **20 → 35 dk** (~5 tur payı). Gerçek çöküşü hâlâ yakalar (izleyici
ölürse ping TAMAMEN durur). Commit `a98bfc8`.

## ⚠️⚠️ İKİ GÜNDE ÜÇ YANLIŞ ALARM
1. **Ban dalgası** — eski hesapların keşfi "yeni dalga" sanılıyordu (5 Ağu, düzeltildi:
   yalnızca son 24 saatte OLUŞTURULMUŞ hesaplar sayılıyor)
2. **CPU doygunluk** — load'a bakıyordu, gerçek CPU değil (5 Ağu, düzeltildi)
3. **Sağlık izleyici durdu** — eşik çok dar (8 Ağu, düzeltildi)

★ Bu alarmlar kural tanımlı olmasa bile Telegram'a düşüyor; yanlış ateşlemeleri
GERÇEK arızaları gölgeliyor. **Alarm gelince önce ÖLÇ, sonra hüküm ver.**

## Kapatılan diğer konu
**"133 → 111 cihaz düşüşü"** = operatör 22 cihazı ELLE SİLDİ. Sistem arızası DEĞİL.
(`adb-reap: bayat uç düşürüldü … host'ta instance yok` satırları bunun sonucu.)

İlgili: [[chat-not-opened-no-profile-zamanlama-2026-08-07]] ·
[[cpu-alarm-load-yaniltici-2026-08-05]] · [[canli-izleme-8bug-sticky-2026-07-22]]

---

## 🔄 10 AĞU EKİ — geniş tarama (kod + canlı + veri)

**Bulunan 3 SESSİZ BUG (commit `37974e7`, deploy edildi):**
1. **Telegram 429 kısır döngüsü** — 30 dk'da 23 kez `retry after 5`. Hata `return`
   ediliyordu, dış döngü 5sn sonra tekrar deniyordu → bekleme HİÇ uygulanmıyordu.
   FIX: `retry after <n>` ayrıştırılıp o kadar bekleniyor. **Sonuç: 10 dk'da 0 hata.**
2. **`INVALID_RECIPIENT` deseni kaçırıyordu** — gerçek metin `isn't on WhatsApp`,
   desen `not on whatsapp` arıyordu (araya "isn't" giriyor). Numara WhatsApp'ta
   olmadığı hâlde belirsiz CHAT_NOT_OPENED dönüyordu.
   ★Bu bug ancak 7 Ağu'daki "Searching…" düzeltmesi sayesinde GÖRÜNÜR oldu.
3. **"Disappearing messages" ekranı** compose kutusunu örtüyordu (2 günde 14 vaka) →
   `dismissBlockingDialogs` kapsamına eklendi.

**DB'de düzeltilenler (kod değişikliği yok):**
- 10 cihaz bayat **`.eu`** proxy kaydına bağlıydı → `.pr`'ye taşındı
  (28 Tem: `.eu` %15 502 verir + ülkeyi bozar)
- `Provision AL` kaydı yanlış portta (9999) → **5555**'e hizalandı
- **Mükerrer ACTIVE hesap** (`+355689496180`, iki kayıt) → öksüz olan FAILED yapıldı;
  cihazdaki `registration_jid` ile doğrulandı

**Ölçülüp KAPATILAN (sorun değil):**
- `proxyId=NULL` 14 cihaz → **14'ünde de gerçek config VAR**, TR'den çıkıyorlar.
  Yalnızca DB alanı eksik (eski cihazlar), ban riski YOK, `proxyWarning` damgası 0.
- Güvenlik: ufw `deny(incoming)`, redsocks portları yalnız `192.168.0.0/16`'ya açık.
- Boş `catch` 0 · öksüz kayıt 0 · takılı job 0 · mükerrer IP 0 · korumasız ACTIVE 0
  · webhook hatası 0 · zombie 1 · agent fd 26 · DB 1 GB · loglar 18M/2.1M

## ★★ ÖLÇÜM TUZAĞI — ADB çıktısında `\r`
"Cihazların hepsi aynı IP'den mi çıkıyor?" sorusunu ölçerken ilk denemelerim
**yanlışlıkla "çıkış yok"** gösterdi. Sebep: `adb shell` çıktısı `\r` ile geliyor,
`grep -oE '[0-9.]+$'` eşleşmiyordu. **`tr -d "\r"` ŞART.**

**DOĞRU SONUÇ: 10 cihaz → 10 BENZERSİZ çıkış IP'si (%100).**
Bloklar dağınık: 95.5.x · 88.250.x · 88.230.x · 85.107.x · 85.105.x
⚠️ `49.51.189.254` = thordata'nın GİRİŞ kapısı (herkes aynı, NORMAL); çıkış IP'si
her cihazda FARKLI (sticky `sessid-mi<N>` sayesinde).
