# WhatsApp Medya Entegrasyonu — API Dokümanı

Bu doküman, karşı taraftaki panelin bizim sistemle **iki yönlü fotoğraf/medya**
alışverişi yapması için gerekenleri anlatır.

- **Yön 1 — Foto ALMA:** WhatsApp sohbetine gelen fotoğrafı biz otomatik yakalar,
  webhook ile onlara haber veririz; onlar dosyayı bizden indirir.
- **Yön 2 — Foto GÖNDERME:** Onlar bize bir istek atar, biz o fotoğrafı
  WhatsApp'tan karşı numaraya göndeririz.

Son güncelleme: 10 Ekim 2026 — tüm alan adları ve davranışlar canlı sistemde
uçtan uca test edilerek doğrulandı (bkz. bölüm 6).

---

## 0. Bağlantı bilgileri

| | |
|---|---|
| Taban adres | `http://125.253.73.45` |
| Kimlik doğrulama | `X-API-Key: flk_...` (her istekte zorunlu) |
| İçerik tipi | `application/json` |

> ⚠️ **HTTPS henüz yok.** Sistem şu an düz HTTP üzerinde çalışıyor (alan adı
> alınmadı). Karşı panel `https://` zorunlu tutuyorsa, entegrasyondan önce alan
> adı + sertifika kurulmalı. Birçok panel `http://` linkli medyayı reddeder.

API anahtarını biz üretip onlara veririz. Anahtar `read` + `write` yetkili ve bir
çalışma alanına (workspace) **bağlı** olmalıdır. Çalışma alanına bağlı olmayan
servis anahtarları medya uçlarında `403 WORKSPACE_REQUIRED` ile reddedilir.
Başka bir müşterinin cihazına/dosyasına erişmek yapısal olarak imkânsızdır
(denenirse `404` döner).

---

## Yön 1 — Gelen fotoğrafları onlara aktarma

### 1.1 Akış

```
WhatsApp'a foto gelir
      ↓
Ajan cihazın WhatsApp veritabanında yeni medya mesajını görür
      ↓
Dosyayı sunucuya çeker ve saklar  (/opt/fleet-agent/wa-media/...)
      ↓
Kayıtlı webhook URL'ine POST atılır   ← onların vereceği adres
      ↓
Onlar yükteki mediaUrl'i indirir (ya da küçük dosyada dataB64'ü kullanır)
```

### 1.2 Bizim onlardan istediğimiz (callback tarafı)

| İstenen | Açıklama | Zorunlu |
|---|---|---|
| **Callback URL** | Fotoğraf geldiğinde POST atacağımız adres | Evet |
| **İmza sırrı (secret)** | İsteklerimizi imzalamak için paylaşılan gizli metin. Biz de üretip verebiliriz. | Önerilir |
| **IP kısıtı** | Sunucumuzun IP'sini (`125.253.73.45`) izin listesine almaları gerekiyorsa | Hayır |

**Kimlik doğrulama — yalnız HMAC imza desteklenir.** Her isteğe şu başlıkları ekleriz:

| Başlık | İçerik |
|---|---|
| `X-Fleet-Signature` | `HMAC-SHA256(secret, ham_istek_gövdesi)` — küçük harf hex. Yalnız secret tanımlıysa eklenir. |
| `X-Fleet-Event` | Olay adı (ör. `WHATSAPP_MEDIA_CAPTURED`) |
| `X-Fleet-Delivery` | Teslimatın benzersiz kimliği (tekrar gelirse yinelemeyi ayıklamak için) |

İmzayı doğrulamak için: gelen **ham gövdeyi** (JSON'a çevirmeden önce) aynı
secret ile HMAC-SHA256'dan geçirip `X-Fleet-Signature` ile karşılaştırsınlar.

> `Authorization: Bearer ...` gibi **özel bir başlık ekleme desteği yoktur.**
> Karşı taraf bunu şart koşarsa bizim tarafta küçük bir geliştirme gerekir.

**Yeniden deneme:** HTTP `2xx` başarı sayılır. Başarısız teslimat **5 kez**
denenir (yaklaşık 0 sn, 10 sn, 40 sn, 90 sn, 160 sn sonra). Sürekli başarısız
olan webhook kaydı otomatik olarak devre dışı kalır; yönetici yeniden açar.

**Abonelik:** Her webhook kaydı tek bir olaya ya da `ALL` (tüm olaylar) seçeneğine
abone olur.

### 1.3 Webhook yükü (biz onlara böyle göndeririz)

Olay adı: `WHATSAPP_MEDIA_CAPTURED`

```json
{
  "event": "WHATSAPP_MEDIA_CAPTURED",
  "firedAt": "2026-10-10T11:19:41.410Z",
  "data": {
    "deviceId": "cmsyrat2f0hvlazml0ep2xfry",
    "deviceName": "+905359848023",
    "msgId": 1365,
    "kind": "image",
    "from": "+905312166050",
    "fileName": "1365-IMG-20261010-WA0000.jpg",
    "size": 14846,
    "viewOnce": false,
    "received": true,
    "mediaPath": "/public/v1/whatsapp/media/cmsyrat2f0hvlazml0ep2xfry/1365-IMG-20261010-WA0000.jpg",
    "mediaUrl": "http://125.253.73.45/public/v1/whatsapp/media/cmsyrat2f0hvlazml0ep2xfry/1365-IMG-20261010-WA0000.jpg",
    "dataB64": "/9j/4AAQSkZJRgABAQ..."
  }
}
```

| Alan | Açıklama |
|---|---|
| `firedAt` | Olayın üretildiği an (ISO 8601, UTC) |
| `deviceId` / `deviceName` | Medyanın geldiği bizim WhatsApp hesabımız |
| `msgId` | WhatsApp içindeki mesaj kimliği (aynı medya iki kez gelirse ayıklamak için) |
| `kind` | `image` · `video` · `audio` · `document` · `view_once` (tek gösterimlik) |
| `from` | Gönderen numara — **başında `+` ile**, ülke kodlu (`+905312166050`) |
| `fileName` | Mesaj kimliğiyle başlayan dosya adı |
| `size` | Bayt cinsinden boyut |
| `viewOnce` | Tek gösterimlik medya ise `true` (karşı taraf silse de kalıcı kopya alınır) |
| `mediaUrl` | İndirme linki — her boyutta çalışır |
| `dataB64` | Dosyanın base64 hali — yalnız **1 MB ve altı** dosyalarda otomatik eklenir |
| `dataB64Skipped` | Dosya 1 MB'tan büyükse `dataB64: null` olur ve bu alan açıklama taşır |

> `mimeType` alanı **yoktur**; dosya türü `kind` ve `fileName` uzantısından anlaşılır.

`mediaUrl` aynı `X-API-Key` başlığıyla indirilir:

```bash
curl -H "X-API-Key: flk_..." \
  "http://125.253.73.45/public/v1/whatsapp/media/{deviceId}/{fileName}" \
  -o foto.jpg
```

| Durum | Sonuç |
|---|---|
| Anahtar yok / yanlış | `401` |
| Çalışma alanına bağlı olmayan anahtar | `403 WORKSPACE_REQUIRED` |
| Başka müşterinin ya da var olmayan cihaz | `404` |
| Dosya adında `..` gibi yol kaçışı | reddedilir |

> Bu uç `/public/*` altında olduğu için dışarıya açıktır. Panelin kendi medya ucu
> (`/whatsapp/media/...`) JWT ister ve dışarıya **kapalıdır** — onu kullanmasınlar.

### 1.4 Link mi base64 mü?

İkisi de her olayda hazırdır; seçim onların:

- **Küçük dosyalar (≤ 1 MB, çoğu fotoğraf):** `dataB64` doğrudan kullanılabilir,
  ayrıca indirme gerekmez.
- **Büyük dosyalar (video vb.):** `dataB64` boş gelir, `mediaUrl`'den indirilir.

1 MB sınırı bizim tarafta ayarlanabilir.

### 1.5 Geçmişe dönük medya çekme

Webhook'u kaçırırlarsa veya eski medyayı isterlerse:

```http
POST /public/v1/whatsapp/fetch-media
X-API-Key: flk_...
Content-Type: application/json

{ "deviceId": "cmsyrat2f0hvlazml0ep2xfry", "to": "905551112233", "limit": 20 }
```

| Alan | Zorunlu | Not |
|---|---|---|
| `deviceId` | Evet | |
| `to` | Hayır | Belirli bir sohbetle sınırlamak için |
| `limit` | Hayır | En fazla 200 |

Bu **asenkron** çalışır, cevap olarak `jobId` döner. Sonucu almak için:

```http
GET /public/v1/jobs/{jobId}
```

> Henüz cihaza indirilmemiş medya `pending: true` ile döner (WhatsApp'ın kendisi
> indirmemişse bizde de yoktur).

---

## Yön 2 — Onların foto göndertmesi

### 2.1 Uç

```http
POST /public/v1/whatsapp/send/media
X-API-Key: flk_...
Content-Type: application/json

{
  "deviceId": "cmsyqngai0dlvazml1ayode7l",
  "to": "905551112233",
  "mediaUrl": "https://onların-sunucusu.com/dosya/foto.jpg",
  "caption": "Sipariş görseliniz",
  "kind": "image"
}
```

| Alan | Tip | Zorunlu | Not |
|---|---|---|---|
| `deviceId` | string | Evet | Hangi WhatsApp hesabından gönderilecek |
| `to` | string | Evet | Alıcı numarası, ülke kodlu, en az 5 hane (`905551112233`) |
| `mediaUrl` | string (URL) | Evet | **Bizim indirebileceğimiz** açık link, en fazla 2048 karakter |
| `caption` | string | Hayır | En fazla 1024 karakter |
| `kind` | `image` \| `document` | Hayır | Belirtilmezse otomatik algılanır |

Cevap:

```json
{ "data": { "jobId": "cmt...", "status": "PENDING" } }
```

### 2.2 Sonucu takip

**Yoklama:** `GET /public/v1/jobs/{jobId}` — durum `COMPLETED` veya `FAILED` olur.

**Webhook (önerilen):** `WHATSAPP_SENT` / `WHATSAPP_FAILED` olaylarına abone
olurlarsa yoklamaya gerek kalmaz. Teslim onayı için `WHATSAPP_DELIVERED`
(çift tik) ve `WHATSAPP_READ` (mavi tik) olayları da vardır.

### 2.3 Önemli kısıt — `mediaUrl` gerçekten açılabilmeli

Dosyayı istek geldikten birkaç saniye sonra **bizim sunucumuz indirir.** Bu yüzden link:

- herkese açık olmalı (giriş/oturum gerektirmemeli),
- en az birkaç dakika geçerli kalmalı,
- doğrudan dosyayı döndürmeli (HTML sayfası değil).

Link `404` ya da başka bir hata dönerse gönderim `FAILED` olur ve hata mesajında
indirilemeyen link yazar. İstek başlığı ekleyerek (imzalı/token'lı) indirme şu an
desteklenmiyor; gerekirse ekleriz.

---

## 3. Onlardan istediklerimizin özeti

1. **Callback URL** — gelen fotoğraf bildirimi için
2. **İmza sırrı** — ya onlar versin ya biz üretelim (HMAC-SHA256)
3. **Giden foto linkleri** — `mediaUrl`'lerin herkese açık ve en az birkaç dakika geçerli olduğu
4. **HTTPS şartı var mı** — varsa alan adı almamız gerekecek
5. **İstedikleri olaylar** — yalnız medya mı, yoksa gönderim/teslim onayları da mı

Biz de karşılığında veririz:

1. **API anahtarı** (`flk_...`, read+write yetkili, çalışma alanına bağlı)
2. **Taban adres** (`http://125.253.73.45`)
3. **Cihaz kimlikleri** (`deviceId`) — hangi WhatsApp numarasının hangi kimliğe karşılık geldiği
4. Bu doküman

---

## 4. Hızlı test komutları

```bash
# Kimlik doğrulama çalışıyor mu
curl -H "X-API-Key: flk_..." http://125.253.73.45/public/v1/me

# Cihaz listesi (deviceId'leri buradan alırlar)
curl -H "X-API-Key: flk_..." http://125.253.73.45/public/v1/devices

# Foto gönder
curl -X POST http://125.253.73.45/public/v1/whatsapp/send/media \
  -H "X-API-Key: flk_..." -H "Content-Type: application/json" \
  -d '{"deviceId":"...","to":"905551112233","mediaUrl":"https://.../foto.jpg","kind":"image"}'
```

---

## 5. Bizim tarafta durum ve yapılacaklar

- [x] Gelen medya yakalama **çalışıyor** — sunucuda 875+ dosya, günde ~50 yeni medya
- [x] Medya indirme ucu çalışıyor ve korumalı (401 / 403 / 404 testleri geçti)
- [x] Medya gönderme uçtan uca çalışıyor
- [x] Karşı taraf için API anahtarı verilmiş ve kullanılıyor
- [ ] **Webhook kaydı yok** — callback URL gelince oluşturulacak
- [ ] Callback'e test olayı gönderip `2xx` alındığı doğrulanacak
- [ ] HTTPS gerekiyorsa alan adı + Caddy sertifikası
- [ ] Eski dosya-tarayıcı yakalama (`FLEET_WA_CAPTURE`) **kapalı kalmalı** — aynı
      olay adıyla daha eksik bir yük gönderir (link ve gönderen yok)

---

## 6. Doğrulama sonuçları (10 Ekim 2026)

Canlı sistemde, kendi iki hesabımız arasında yapılan uçtan uca test:

| Adım | Sonuç |
|---|---|
| Foto gönderme (Yön 2), geçerli bir `mediaUrl` ile | ✅ `SENT`, 31 sn |
| Alıcı cihazda medyanın yakalanması (Yön 1) | ✅ geçerli JPEG olarak saklandı, gelen mesaj kaydedildi |
| `mediaUrl` ile indirme (çalışma alanına bağlı anahtar) | ✅ `200`, dosya depodakiyle birebir aynı |
| Anahtarsız / yanlış anahtar | ✅ `401` |
| Servis anahtarı | ✅ `403 WORKSPACE_REQUIRED` |
| Başka cihaz kimliği | ✅ `404` |
| Yol kaçışı denemesi | ✅ reddedildi |

**Karşı tarafa bildirilmesi gereken sorun:** 7–10 Ekim arasında gelen **11 medya
gönderim isteğinin 11'i de** başarısız oldu. Hepsinde verilen link
(`https://takip.me/api/wa-media/....jpg`) `404` döndü. Aynı linkler hem bizim
sunucudan hem dışarıdan denendiğinde de `404` veriyor; indirme istekten yalnız
**2 saniye** sonra yapıldığı için süre dolması da söz konusu değil. Yani linkler
oluşturuldukları anda çalışmıyor — **sorun karşı tarafın link üretiminde.**
Bizim taraf aynı uçla geçerli bir linki sorunsuz gönderiyor.
