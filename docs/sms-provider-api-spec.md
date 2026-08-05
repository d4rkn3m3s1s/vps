# SMS / Numara Sağlayıcı API Spesifikasyonu

**Sürüm:** 1.0 · **Tarih:** 2026-08-05
**Amaç:** WhatsApp hesap kaydı için tek seferlik doğrulama numarası kiralama + OTP teslimi.
**Hedef ülke:** Birleşik Krallık (GB / +44) — mimari diğer ülkeleri de kapsar.

Bu doküman, sağlayıcı tarafında yazılacak API'nin **istemci tarafı sözleşmesidir**.
Bizim tarafımızda hâlihazırda iki sağlayıcı (`sms-bus`, `5sim`) aynı soyutlama
üzerinden çalışıyor; bu spec o soyutlamayla birebir uyumludur, dolayısıyla
entegrasyon tek bir adaptör dosyasına indirgenir.

---

## 0. Özet — bizim akışımız

Operatör panelde bir cihaz seçip **"Numara Al ve Kaydet"** butonuna basar. Ardından:

```
1. POST /v1/numbers/rent          → müsait GB numarası kirala
2. (biz numarayı WhatsApp'a gireriz — 1-3 dk)
3. GET  /v1/numbers/{id}/sms      → OTP gelene kadar 5 sn'de bir sorulur (≤9 dk)
   VEYA  webhook                  → OTP gelir gelmez bize POST edilir
4. POST /v1/numbers/{id}/release  → iş bitti / iptal → numarayı bırak
```

**Kritik zamanlama:** Numaranın kiralandığı andan itibaren **en az 15 dakika**
OTP kabul edebilir durumda kalmalıdır. WhatsApp bazen SMS'i 3-5 dk gecikmeli
gönderir; numara erken düşerse kayıt kaybedilir (ve ücret boşa gider).

---

## 1. Genel Protokol

| Konu | Karar |
|---|---|
| Protokol | **HTTPS/REST** (TLS 1.2+). gRPC/SOAP **istemiyoruz**. |
| Format | **JSON** (istek ve yanıt). `Content-Type: application/json; charset=utf-8` |
| Karakter seti | UTF-8 |
| Base URL | `https://api.<firma>.com/v1` — sabit sürüm öneki (`/v1`) **zorunlu** |
| Metotlar | Okuma `GET`, durum değiştiren `POST` |
| Zaman | Tüm zamanlar **ISO-8601 UTC** (`2026-08-05T13:24:11Z`). Yerel saat/epoch **kullanmayın**. |
| Numara formatı | **E.164**, `+` dahil: `+447700900123`. Boşluk/parantez/tire **yok**. |
| Para/bakiye | Ondalık sayı + ISO-4217 kod: `{"amount": 12.50, "currency": "USD"}` |

### 1.1 Kimlik Doğrulama

**Bearer token, header ile:**

```http
Authorization: Bearer <API_KEY>
```

- API anahtarı **query string'de gönderilmemelidir** (log'lara sızar).
- Anahtar panelden yenilenebilmeli (rotate), eskisi ~24 saat geçerli kalabilmeli.
- Tercihen IP allowlist desteği (bizim sunucu sabit IP'dedir).

### 1.2 Idempotency (zorunlu)

Ücret kesen tüm `POST` çağrılarında:

```http
Idempotency-Key: <istemci üretimi UUID v4>
```

Aynı anahtarla gelen tekrar istek **yeni numara kiralamamalı**, ilk yanıtın
aynısını döndürmelidir (24 saat saklama). Ağ kopması/retry sırasında çift
ücretlenmeyi bu engeller — bizim için **pazarlık dışıdır**.

### 1.3 Standart Yanıt Zarfı

Başarılı yanıt — **HTTP 200**, veri doğrudan gövdede (sarmalayıcı yok):

```json
{ "id": "req_8f3a...", "number": "+447700900123", "...": "..." }
```

Hata yanıtı — uygun **HTTP durum kodu** + sabit şekil:

```json
{
  "error": {
    "code": "NO_NUMBERS_AVAILABLE",
    "message": "No GB numbers available for whatsapp",
    "retryable": true
  }
}
```

> ⚠️ **Önemli:** Hata durumunda HTTP 200 dönüp gövdeye `"code": 400` koymayın.
> Mevcut sağlayıcılarımızdan biri bunu yapıyor ve her çağrıda özel ayrıştırma
> gerektiriyor. **HTTP durum kodu doğruyu söylemeli.**

### 1.4 Hata Kodları (sabit liste)

| HTTP | `code` | Anlamı | `retryable` |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | Parametre hatalı/eksik | false |
| 401 | `UNAUTHORIZED` | Anahtar geçersiz | false |
| 402 | `INSUFFICIENT_BALANCE` | Bakiye yetersiz | false |
| 404 | `NOT_FOUND` | `id` bulunamadı | false |
| 409 | `ALREADY_RELEASED` | Numara zaten bırakılmış | false |
| 422 | `NO_NUMBERS_AVAILABLE` | O ülke/servis için stok yok | **true** |
| 429 | `RATE_LIMITED` | Hız sınırı (+ `Retry-After` header) | **true** |
| 5xx | `PROVIDER_ERROR` | Sağlayıcı iç hatası | **true** |

`retryable: true` olanları biz otomatik tekrar deneriz; `false` olanlarda
operatöre hata gösteririz. Bu ayrım olmadan ya boşuna deneriz ya da kurtarılabilir
hatada pes ederiz.

### 1.5 Hız Sınırı

- En az **60 istek/dakika** (OTP polling 5 sn'de bir → tek kayıt 12 istek/dk).
- Eşzamanlı **50 aktif kiralama** desteklenmeli (filomuz 90+ cihaz).
- Sınır aşımında **429** + `Retry-After: <saniye>` header'ı.

---

## 2. Uç Noktalar

### 2.1 `GET /v1/health` — servis durumu

Kimlik doğrulama gerektirmez. İzleme için.

```json
{ "status": "ok", "time": "2026-08-05T13:24:11Z" }
```

---

### 2.2 `GET /v1/balance` — bakiye

```json
{
  "amount": 142.75,
  "currency": "USD",
  "frozen": 6.00
}
```

`frozen` = kiralanmış ama henüz sonuçlanmamış işlerde bloke tutar.
**Panelde bakiyeyi gösteriyoruz** — bu uç nokta olmazsa operatör bakiyenin
bittiğini ancak kayıtlar toplu başarısız olunca anlar.

---

### 2.3 `GET /v1/services` — desteklenen servis + ülke stoğu

Hangi ülkede hangi servis için kaç numara **müsait** ve **kaça**:

```json
{
  "services": [
    {
      "service": "whatsapp",
      "countries": [
        { "country": "GB", "available": 412, "price": 0.55, "currency": "USD" },
        { "country": "US", "available":  85, "price": 0.90, "currency": "USD" }
      ]
    }
  ]
}
```

- `service` sabit **string kodu** olmalı (`whatsapp`, `telegram`, `instagram`).
  ⚠️ Sayısal ID **istemiyoruz** — mevcut bir sağlayıcımız numerik ID kullanıyor
  ve her çağrıda isim→ID çözümlemesi gerekiyor, kırılgan bir katman.
- `country` **ISO-3166-1 alpha-2** (`GB`, `US`). `44`/`uk` gibi varyant değil.
- `available` gerçek stok olmalı — 0 ise biz o ülkeyi denemeyiz, boşuna
  istek atıp hata yemeyiz.

---

### 2.4 `POST /v1/numbers/rent` — numara kirala ⭐

**En kritik uç nokta.** Panelde "Numara Al" butonu buraya bağlanır.

**İstek:**
```json
{
  "service": "whatsapp",
  "country": "GB",
  "mode": "otp",
  "ttlSeconds": 1200
}
```

| Alan | Zorunlu | Açıklama |
|---|---|---|
| `service` | ✅ | `whatsapp` |
| `country` | ✅ | ISO alpha-2 (`GB`) |
| `mode` | — | `otp` (tek seferlik, varsayılan) · `rental` (uzun süreli) |
| `ttlSeconds` | — | Numaranın açık kalacağı süre. Varsayılan **≥900**, biz 1200 isteriz |

**Yanıt (200):**
```json
{
  "id": "req_8f3a2b1c",
  "number": "+447700900123",
  "country": "GB",
  "service": "whatsapp",
  "status": "waiting",
  "price": 0.55,
  "currency": "USD",
  "expiresAt": "2026-08-05T13:44:11Z"
}
```

- `id` — sonraki tüm çağrılarda kullanacağımız **opak string**. Bizde
  `smsRequestId` alanında saklanır.
- `expiresAt` — bu ana kadar OTP kabul edilir. **Biz bunu okuyup polling'i
  buna göre kesiyoruz**, dolayısıyla doğru olmalı.
- `status` — bkz. §3 durum makinesi.

**Stok yoksa:** HTTP **422** + `NO_NUMBERS_AVAILABLE`.
(Boş numara döndürüp `status: "ok"` demeyin — sessiz başarısızlık olur.)

**Numara tekliği garantisi:**
Aynı numara, önceki kiralama süresi bitmeden başka bir müşteriye
verilmemelidir. Ayrıca **daha önce WhatsApp kaydı yapılmış numara tekrar
verilmemelidir** (`"already registered"` ekranı = boşa gitmiş kayıt +
cihazımızda risk). Mümkünse yanıtta `"fresh": true|false` alanı ekleyin.

---

### 2.5 `GET /v1/numbers/{id}/sms` — OTP sorgula (polling)

Bizim **birincil** OTP alma yolumuz. 5 saniyede bir, en fazla ~9 dakika.

**Yanıt — henüz gelmedi (200):**
```json
{ "id": "req_8f3a2b1c", "status": "waiting", "messages": [] }
```

**Yanıt — geldi (200):**
```json
{
  "id": "req_8f3a2b1c",
  "status": "received",
  "messages": [
    {
      "code": "483920",
      "text": "483920 is your WhatsApp code. Don't share it.",
      "sender": "WhatsApp",
      "receivedAt": "2026-08-05T13:27:03Z"
    }
  ]
}
```

- `code` — **ayrıştırılmış saf rakam dizisi**. Bunu siz çıkarın; biz de yedek
  olarak `text`'ten regex ile çıkarırız ama asıl kaynak `code` olmalı.
- `messages` **dizi** olmalı — WhatsApp bazen 2. kodu gönderir; hepsini
  görmemiz gerekir (en yenisi sonda).
- OTP gelmediyse **200 + `waiting`** dönün. ⚠️ Hata kodu (4xx/5xx) **dönmeyin** —
  mevcut bir sağlayıcımız bunu yapıyor ve gerçek hataları "bekliyor"dan
  ayırt edemiyoruz, bu yüzden `catch` ile hepsini yutmak zorunda kalıyoruz.
- Numara süresi dolduysa: **200** + `"status": "expired"`.

---

### 2.6 `POST /v1/numbers/{id}/release` — bırak / iptal

```json
{ "reason": "otp_timeout" }
```

`reason`: `done` · `otp_timeout` · `cancelled` · `rejected_by_service`

**Yanıt (200):**
```json
{ "id": "req_8f3a2b1c", "status": "released", "refunded": true, "refundAmount": 0.55 }
```

**İade politikası — netleştirilmesi gerekiyor:**
OTP **hiç gelmediyse** ücret iade edilmelidir. Bizde kayıtların bir kısmı
WhatsApp tarafındaki engellere takılıyor (numara sağlıklı ama servis kabul
etmiyor) — bu durumda numaraya SMS hiç ulaşmadığı için iade bekliyoruz.
`refunded` alanı bu kararı şeffaf göstermelidir.

---

### 2.7 `GET /v1/numbers/{id}` — durum sorgula

Tek numaranın anlık durumu (kurtarma/mutabakat için). Yanıt = `rent` yanıtı +
güncel `status`.

---

## 3. Durum Makinesi

```
waiting ──► received ──► released
   │                        ▲
   ├──► expired ────────────┤
   └──► cancelled ──────────┘
```

| `status` | Anlamı |
|---|---|
| `waiting` | Numara aktif, SMS bekleniyor |
| `received` | En az bir OTP geldi |
| `expired` | `expiresAt` geçti, artık SMS kabul edilmiyor |
| `cancelled` | Bizim isteğimizle bırakıldı |
| `released` | Kapandı (nihai) |

**Kural:** Bir `id` nihai duruma geçtikten sonra geri dönmemeli.
Durum isimleri bu listedeki **tam string'ler** olmalı (büyük/küçük harf dahil).

---

## 4. Webhook (ikincil / hızlandırıcı)

Polling birincil yolumuz; webhook **onu tamamlar**, yerine geçmez. OTP gelir
gelmez bildirim → 5 sn'lik polling gecikmesini sıfırlar.

> Neden ikisi birden: webhook tek başına kırılgandır (ağ, deploy, 502). Polling
> tek başına yavaştır. İkisi birlikte hem hızlı hem kayıpsızdır — kaçan
> webhook'u polling yakalar.

### 4.1 Bize gönderilecek istek

```http
POST https://<bizim-domain>/api/webhooks/sms
Content-Type: application/json
X-Signature: sha256=<hex>
X-Timestamp: 1780000000
```

```json
{
  "event": "sms.received",
  "id": "req_8f3a2b1c",
  "number": "+447700900123",
  "code": "483920",
  "text": "483920 is your WhatsApp code.",
  "receivedAt": "2026-08-05T13:27:03Z"
}
```

Olaylar: `sms.received` · `number.expired` · `number.released`

### 4.2 İmza (zorunlu)

```
X-Signature = "sha256=" + HMAC_SHA256(
    key  = <paylaşılan webhook secret>,
    data = X-Timestamp + "." + <ham gövde>
)
```

- Secret, API anahtarından **ayrı** olmalı.
- `X-Timestamp` 5 dakikadan eskiyse isteği reddederiz (replay koruması).
- İmzasız webhook **kabul edilmez** — herkes bize sahte OTP POST'layabilir.

### 4.3 Teslimat garantisi

- **2xx** dönene kadar tekrar deneyin: en az 5 deneme, üstel geri çekilme
  (5s, 30s, 2dk, 10dk, 30dk).
- **At-least-once** yeterli — aynı `id` için tekrarlı bildirim gelebilir,
  biz idempotent işleriz.
- Webhook URL'i ve secret panelden ayarlanabilmeli.

---

## 5. Teslim Beklentileri

Yazılımcı arkadaşa iletilecek maddeler:

1. **Postman Collection** (`.json`, v2.1) — tüm uç noktalar, örnek yanıtlar,
   `{{baseUrl}}` + `{{apiKey}}` değişkenleri ile.
2. **OpenAPI 3.1** dosyası (`openapi.yaml`) — istemci üretimi için. Bizde de
   `docs/openapi.yaml` var, aynı standart.
3. **Sandbox / test ortamı** — ücret kesmeyen, sahte OTP üreten bir base URL.
   Entegrasyonu canlı bakiye harcamadan test edebilmemiz için **şart**.
   Sandbox'ta `+44` test numarası + tetiklenebilir sahte OTP ideal olur.
4. **Test API anahtarı** — sandbox için ayrı.
5. Hata kodlarının tam listesi (§1.4 tablosunu doldurulmuş hâli).
6. Stok/fiyat bilgisi: GB için günlük ortalama müsait numara adedi.

---

## 6. Bizim Tarafımızdaki Entegrasyon (bilgi amaçlı)

Sağlayıcı tarafını ilgilendirmez, ama şekli neden böyle istediğimizi açıklar.

Mevcut soyutlamamız (`apps/api/src/modules/accounts/providers/`) şu 5 işlemi
gerektiriyor — spec birebir bunları karşılıyor:

| Bizim fonksiyon | Spec uç noktası |
|---|---|
| `getBalance()` | `GET /v1/balance` |
| `listCountries()` / `listProjects()` | `GET /v1/services` |
| `getNumber()` | `POST /v1/numbers/rent` |
| `getSms()` | `GET /v1/numbers/{id}/sms` |
| `cancelNumber()` | `POST /v1/numbers/{id}/release` |

Yeni sağlayıcı, `SmsProvider` birleşim tipine üçüncü değer olarak eklenecek
(`'sms-bus' | '5sim' | '<firma>'`) ve panel modal'ında bir seçenek olarak
görünecek. Kayıt akışının geri kalanı (cihaz sürme, OTP girişi, hesap kaydı)
değişmez.

---

## 7. Açık Sorular (firmaya)

1. **Mod:** GB numaraları tek seferlik OTP mi, uzun süreli kiralama mı, ikisi de mi?
2. **Numara tazeliği:** Daha önce WhatsApp kaydı görmüş numara tekrar verilir mi?
   Verilmiyorsa nasıl garanti ediliyor?
3. **İade:** OTP gelmezse ücret iade ediliyor mu? Kısmi mi, tam mı?
4. **Stok:** GB için eşzamanlı kaç numara sağlanabilir? Günlük tavan var mı?
5. **`expiresAt`:** Numara kaç dakika açık kalıyor? (Bizim ihtiyacımız ≥15 dk.)
6. **Sandbox:** Test ortamı sağlanabilir mi?
