---
name: yayin-fps-model-havuzu-2026-07-30
description: "★★(30 Tem gece) Canlı yayın 5 fps'e SIKIŞMIŞTI: ham screencap 185ms (10.4MB/kare) → tek döngüde tavan 5.4 fps. FIX: 2 paralel şerit → 8.9 fps. ★★captureFrame'de TIMEOUT YOKTU → wa-b0uq'da sonsuz sessiz takılma. ★★Model havuzu 11 idi (kimlik alanları 40/40 benzersiz ama model zayıf halka) → 40 model/12 üretici. Waydroid'de screenrecord ÇALIŞMIYOR."
metadata: 
  node_type: memory
  type: project
  originSessionId: 060eed7a-fef7-42f6-a7d8-158fe471cc89
  modified: 2026-07-30T02:22:34.103Z
---

# ★ Yayın fps + captureFrame timeout + model havuzu

## 1) Yayın 5 fps'e sıkışmıştı — kök neden ADB transferi
Operatör "yayın geliyor ama fps çok düşük 5 fps" dedi. Ölçüm:

```
ham `adb exec-out screencap`  : 185 ms  (10.368.016 bayt = 10.4 MB ham piksel)
`screencap -p` (PNG)          : 435 ms  (559.897 bayt)
```

Tek döngüde teorik tavan **5.4 fps** — gördüğü tam olarak buydu. Sunucu boştu
(yük 2.9 / 80 çekirdek), yani CPU değil **ADB transfer beklemesi**.

**Kanıt (paralel kazanç):** 4 kare ardışık 709 ms, 2 paralel ile 422 ms → 5.6 → 9.4 fps.
Süre üst üste binebiliyor.

**FIX:** yakalama döngüsü N paralel şerit — `FLEET_STREAM_LANES` (varsayılan **2**).
Canlı: **222 kare / 25 sn = 8.9 fps** (önce 114 = 4.6 fps).
⚠️ Şerit sayısı ölçülü (2): fazlası aynı ADB taşıyıcısında iş (job) çağrılarını
açlığa düşürür — "adb kararsızlığı"nın kökü.

⚠️ **Waydroid'de `screenrecord` ÇALIŞMIYOR** — donanım kodlayıcı yok, 5 sn'lik
deneme **73 bayt** üretti. Panelde WebCodecs/`VideoDecoder` kodu HAZIR
(`LiveScreen.tsx`) ve agent'ta `FLEET_STREAM_H264_RAW` yolu var, ama bu ortamda
kullanılamaz. H.264'ü bir daha denemeye gerek yok.

## 2) captureFrame'de TIMEOUT YOKTU → sessiz sonsuz takılma
`wa-b0uq`/mi46'da ham `screencap` **sonsuza kadar** takılıyor (25 sn'de 0 bayt),
ama **AYNI cihazda `screencap -p` sorunsuz 554 KB** döndürüyor. Timeout olmadığı
için döngü orada asılı kalıyor: **ne kare ne hata** → panel sonsuza kadar
"Bağlanıyor…". FIX: iki çağrıya da 8 sn sınır (`FLEET_STREAM_CAPTURE_TIMEOUT_MS`)
+ JPEG yolu takılırsa **aynı kare içinde** PNG yoluna düşüş.

Hata logu da tek-seferlikti (`loggedErr`) → sürekli başarısız bir yayın sessiz
görünüyordu. Artık periyodik (1., 50., 100. hata).

`busyDevices` beklemesi de sınırsızdı → `BUSY_WAIT_MAX_MS` (20 sn) eklendi.
⚠️ Paralel şeritler sayacı PAYLAŞIR → geçen süre **saat ile** ölçülür; şerit başına
+200 ms toplamak N şeritte eşiği N kat hızlı tetikler ve gerçek işi bayat kilit sanar.

## 3) Model havuzu ZAYIF HALKAYDI (11 → 40)
Kimlik üreteci **40/40 tam benzersiz** veriyor: imei, androidId, macAddress,
serialNo, buildNumber. Ama **model havuzu 11'di** → 34 cihazda ~5 cihaz aynı modeli
paylaşıyordu. "Aynı model + aynı çözünürlük + aynı DPI" bir uygulamaya "aynı
fabrikadan" sinyali verir.

**40 model / 12 üretici** (Samsung, Google, Xiaomi, OnePlus, OPPO, vivo, motorola,
realme, HONOR, TECNO, Infinix, ZTE). Hepsi gerçek model kodu + tutarlı çözünürlük/DPI
— ⚠️ uydurma kombinasyon (ör. Pixel'de 720p) **tek başına** bir parmak izi olur.

**MAC havuzu:** 10 OUI × 3 rastgele oktet = **167.772.160**. Çakışma: 34 cihazda
%0.0003, 1000 cihazda %0.3, 10.000'de %26. Yani binlerce cihaza kadar rahat.

## 4) Yeni cihaz zinciri UÇTAN UCA doğrulandı (canlı mi13 kurulumu)
```
✓ mi13 -> e8:50:8b:9b:a7:27          (wd-provision.sh otomatik)
config: lxc.net.0.hwaddr = e8:50:8b:9b:a7:27
lease : e8:50:8b:9b:a7:27 192.168.9.112 SM-G991B    ← yeni MAC + DOĞRU .112
cihazda: MAC aynı, model SM-G991B, kendi android_id, internet 200, TR çıkış
```
Üçü birden doğru. `set` komutuna da çakışma kontrolü eklendi — **yeni cihaz yolu
`set` kullanıyor**, yani en riskli yol korumasızdı (`fix-all`'da vardı).

## 5) Kurulum formu (operatör istekleri)
- **Adet −/+ butonu**: ham `type=number`da "1" silinemiyordu (`|| '1'` boş girdiyi
  anında 1'e çevirip imleci sonda bırakıyor) → "2" yazınca **"12"** oluyordu.
- **Ülke seçim listesi, TR varsayılan** (önce US). Elle kod yazmak geçersiz kod →
  proxy eşleşmez → datacenter IP → ban riski.
- **İsim boşsa RASTGELE**: `provision.service.ts` tek-cihaz yolu `Cihaz ${instance}`
  koyuyordu → filoda **altyapı adı sızdıran** "Cihaz mi13" isimleri. Batch yolu zaten
  `uniqueRandomName` kullanıyordu — **iki yol ayrışmıştı**. Doğrulama: 8/8 benzersiz.

## 6) Çerez maxAge > token ömrü tuzağı
`fleet_session` 2sa+5dk, JWT 2sa → aradaki 5 dakikada çerez "var" ama JWT ölü:
middleware 401 döner, panel oturumu açık sanar, istekler **sessizce** başarısız olur
(WS dahil). maxAge artık token ömrünün ALTINDA (2sa−5dk).

## 7) dnsmasq eksikliği = DNS yok
2 cihaz (mi40, mi45) internete çıkamıyordu. KÖK: **dnsmasq süreçleri hiç
çalışmıyordu** — 34'ün 32'sinde var, tam o ikisinde yok. Belirti: IP ile HTTP
**403 döner** (ağ+proxy sağlam) ama isim çözemez. `wd-run.sh` ile yeniden başlatınca
düzeldi. ⚠️ Teşhis kısayolu: `ps -eo args | grep "^dnsmasq" | grep -c waydroid-mi`
sayısı cihaz sayısına eşit olmalı.

Filo (30 Tem 02:20): 35/35 ADB online, DB 35 ONLINE, 35 benzersiz MAC, 35 dnsmasq.

İlgili: [[proxy-env-api-surecine-aktarilmiyordu-2026-07-30]] ·
[[wa-bekleme-sayaci-retry-2026-07-30]]
