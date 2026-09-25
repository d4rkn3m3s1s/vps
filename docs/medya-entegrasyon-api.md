# WhatsApp Medya Entegrasyonu — API Dokümanı

Bu doküman, karşı taraftaki panelin bizim sistemle **iki yönlü fotoğraf/medya**
alışverişi yapması için gerekenleri anlatır.

- **Yön 1 — Foto ALMA:** WhatsApp sohbetine gelen fotoğrafı biz otomatik yakalar,
  webhook ile onlara haber veririz; onlar dosyayı bizden indirir.
- **Yön 2 — Foto GÖNDERME:** Onlar bize bir istek atar, biz o fotoğrafı
  WhatsApp'tan karşı numaraya göndeririz.

---

## 0. Bağlantı bilgileri

| | |
|---|---|
| Taban adres | `http://125.253.73.45` |
| Kimlik doğrulama | `X-API-Key: flk_...` (her istekte zorunlu) |
| İçerik tipi | `application/json` |

> ⚠️ **HTTPS henüz yok.** Sistem şu an düz HTTP üzerinde çalışıyor (alan adı
> alınmadı). Karşı panel `https://` zorunlu tutuyorsa, entegrasyondan önce alan
> adı + sertifika kurulmalı. Bu, onlara sunucudan dosya indirtme (Yön 1) için
> kritik olabilir; birçok panel `http://` linkli medyayı reddeder.

API anahtarını biz üretip onlara vereceğiz. Anahtarın `read` + `write` yetkisi
olmalı. Anahtar bir çalışma alanına (workspace) bağlıdır; başka bir müşterinin
dosyasına erişmek **yapısal olarak imkânsızdır**.

---

## Yön 1 — Gelen fotoğrafları onlara aktarma

### 1.1 Akış

```
WhatsApp'a foto gelir
      ↓
Ajan cihazın WhatsApp Media klasöründe yeni dosyayı görür
      ↓
Dosyayı sunucuya çeker  (/opt/fleet-agent/wa-media/...)
      ↓
Bize kayıtlı webhook URL'ine POST atılır   ← onların vereceği adres
      ↓
Onlar yükteki mediaUrl'i indirir
```

### 1.2 Bizim onlardan istediğimiz (callback tarafı)

Entegrasyonu açmak için onların bize şunları vermesi gerekiyor:

| İstenen | Açıklama | Zorunlu |
|---|---|---|
| **Callback URL** | Fotoğraf geldiğinde POST atacağımız adres | Evet |
| **Doğrulama yöntemi** | Bizim isteğe ekleyeceğimiz başlık (`Authorization: Bearer ...` gibi) veya HMAC imza tercihi | Evet |
| **Medya tercihi** | `mediaUrl` (link verip indirsinler) **veya** `dataB64` (base64 gömülü göndermemiz) | Evet |
| **Yeniden deneme** | Cevap vermezlerse kaç kez deneyelim, hangi HTTP kodunu başarı sayalım | Hayır (varsayılan: 2xx başarı) |
| **IP kısıtı** | Sunucumuzun IP'sini (`125.253.73.45`) izin listesine almaları gerekiyorsa | Hayır |

### 1.3 Webhook yükü (biz onlara böyle göndeririz)

Olay adı: `WHATSAPP_MEDIA_CAPTURED`

```json
{
  "event": "WHATSAPP_MEDIA_CAPTURED",
  "timestamp": "2026-09-09T13:07:22.410Z",
  "data": {
    "deviceId": "cmrpg65he00h7azd2woqsfsic",
    "deviceName": "+905380525622",
    "from": "905551112233",
    "fileName": "73-IMG-20260902-WA0000.jpg",
    "mediaUrl": "http://125.253.73.45/public/v1/whatsapp/media/cmrpg65he00h7azd2woqsfsic/73-IMG-20260902-WA0000.jpg",
    "mimeType": "image/jpeg",
    "size": 184320
  }
}
```

`mediaUrl` doğrudan indirilebilir; **aynı `X-API-Key` başlığıyla** çağrılır:

```bash
curl -H "X-API-Key: flk_..." \
  "http://125.253.73.45/public/v1/whatsapp/media/{deviceId}/{fileName}" \
  -o foto.jpg
```

> Bu uç `/public/*` altında olduğu için dışarıya açıktır. Panelin kendi medya ucu
> (`/whatsapp/media/...`) JWT ister ve dışarıya **kapalıdır** — onu kullanmasınlar.

### 1.4 Alternatif: base64 gömülü

Link indirmek istemiyorlarsa (HTTPS sorunu veya güvenlik duvarı yüzünden),
`dataB64` alanını yüke gömebiliriz. Bu durumda `mediaUrl` yerine dosyanın
kendisi base64 olarak gelir. Dezavantajı: yük büyür (video için önerilmez).

### 1.5 Geçmişe dönük medya çekme

Webhook'u kaçırırlarsa veya eski medyayı isterlerse:

```http
POST /public/v1/whatsapp/fetch-media
X-API-Key: flk_...

{ "deviceId": "cmrpg65he00h7azd2woqsfsic", "to": "905551112233", "limit": 20 }
```

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
  "deviceId": "cmrpg65he00h7azd2woqsfsic",
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

İki yol var:

**Yoklama:** `GET /public/v1/jobs/{jobId}` — durum `COMPLETED` veya `FAILED` olur.

**Webhook (önerilen):** `WHATSAPP_SENT` / `WHATSAPP_FAILED` olaylarına abone
olurlarsa yoklamaya gerek kalmaz. Teslim onayı isterlerse `WHATSAPP_DELIVERED`
(çift tik) ve `WHATSAPP_READ` (mavi tik) olayları da var.

### 2.3 Önemli kısıt

`mediaUrl` bizim sunucudan **erişilebilir** olmalı. Kimlik doğrulama arkasındaysa
(imzalı URL, token'lı link vb.) ya linki açık yapmaları ya da bize hangi başlığı
eklememiz gerektiğini söylemeleri lazım — şu an istek başlığı ekleme desteği yok,
gerekirse ekleriz.

---

## 3. Onlardan istediklerimizin özeti

Entegrasyona başlamak için bize şunları göndersinler:

1. **Callback URL** — gelen fotoğraf bildirimi için
2. **Callback doğrulama** — hangi başlığı/imzayı bekliyorlar
3. **Medya tercihi** — `mediaUrl` mi `dataB64` mi
4. **Giden foto linkleri** — bize verecekleri `mediaUrl`'ler açık mı, yoksa
   kimlik doğrulama mı gerekiyor
5. **HTTPS şartı var mı** — varsa alan adı almamız gerekecek
6. **İstedikleri olaylar** — sadece medya mı, yoksa gönderim/teslim onayları da mı

Biz de karşılığında onlara vereceğiz:

1. **API anahtarı** (`flk_...`, read+write yetkili)
2. **Taban adres** (`http://125.253.73.45`)
3. **Cihaz kimlikleri** (`deviceId`) — hangi WhatsApp numarasının hangi kimliğe
   karşılık geldiği listesi
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

## 5. Bizim tarafta yapılacaklar (callback URL gelince)

- [ ] `FLEET_WA_CAPTURE=1` ortam değişkenini aç (medya yakalama şu an **kapalı**;
      dizinde 315 dosya var ama otomatik yakalama etkin değil)
- [ ] Webhook kaydını oluştur (şu an **hiç kayıtlı webhook yok**)
- [ ] Onların callback'ine test olayı gönder ve 2xx aldığımızı doğrula
- [ ] Tek bir cihazla uçtan uca test: foto gelsin → webhook düşsün → indirsinler
- [ ] HTTPS gerekiyorsa alan adı + Caddy sertifikası
