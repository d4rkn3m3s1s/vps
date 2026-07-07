# WhatsApp Public API

Harici entegrasyonlar için WhatsApp otomasyon uçları. Bu API `flk_` ön ekli bir
**API anahtarı** ile korunur — **JWT gerekmez**. Anahtar, bir çalışma alanına
(workspace) bağlıdır ve panel üzerinden `Admin › API Anahtarları` bölümünden
üretilir.

---

## 1. Giriş

### Base URL

```
https://<sunucu-adresi>/public/v1
```

Örnekler bu dokümanda `https://<sunucu-adresi>` yer tutucusuyla yazılmıştır;
kendi kurulumunuzun adresiyle değiştirin.

### Kimlik doğrulama

Her isteğe `x-api-key` başlığını ekleyin:

```
x-api-key: flk_xxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Anahtar **bir çalışma alanına bağlı** olmalıdır. Çalışma alanına bağlı olmayan
  (servis/bootstrap) anahtarlar reddedilir → `403 WORKSPACE_REQUIRED`. Bu, farklı
  kiracıların (tenant) verilerine erişimi engelleyen temel güvenlik kontrolüdür.
- Anahtar yalnızca kendi çalışma alanının cihaz ve sohbetlerini görür/yönetir.

### Kapsam (scope): read / write

Anahtarlar `read`, `write` veya `admin` kapsamına sahip olabilir.

| İşlem türü | Gereken kapsam |
|---|---|
| **Okuma** (GET): cihazlar, mesajlar, sohbetler, istatistik, etiketler | Herhangi bir geçerli anahtar |
| **Yazma / cihaz sürme** (POST): send, broadcast, profile, block, blocklist, mynumber, send-media, delete-message, clear-chat, etiket oluştur/ata, sohbet durumu | `write` **veya** `admin` |

Yetersiz kapsamda `403 INSUFFICIENT_SCOPE` döner.

### Yanıt zarfı

Tüm başarılı yanıtlar `{ "data": ... }` zarfıyla döner. Hatalar
`{ "error": "<KOD>", "message": "<açıklama>" }` biçimindedir.

---

## 2. Asenkron iş (job) modeli

> **Önemli:** Cihaz süren işlerin (send, send-media, delete-message, clear-chat,
> block, profile, blocklist, mynumber) hepsi **asenkron** çalışır.

1. İstek anında bir **iş (job)** oluşturur ve `{ "jobId": "...", "status": "PENDING" }`
   döner.
2. Sunucudaki host-agent, işi cihaz üzerinde WhatsApp otomasyonuyla çalıştırır.
   Bu genelde **~10–40 saniye** sürer (uygulama açma, ekran gezinme, dokunma).
3. İş bitince sonucu üç yoldan öğrenebilirsiniz:
   - **Webhook** — `WHATSAPP_MESSAGE` / `WHATSAPP_SENT` / `WHATSAPP_FAILED`
     (aşağıya bakın).
   - **Telegram / Slack / Discord bildirimi** — çalışma alanında bir bildirim
     kanalı tanımlıysa, iş sonucu (örn. "🗑️ Mesaj silindi", "📱 Kendi numaran:
     +90…") otomatik olarak kanala düşer.
   - **Okuma uçları** — sonuç sohbete işlenen işler için
     `GET /v1/whatsapp/conversations` veya `GET /v1/whatsapp/messages`.

Cihazdaki işler **cihaz başına sırayla** çalışır; aynı cihaza aynı anda birden
fazla iş gönderseniz bile üst üste binmez, sırayla ve güvenle işlenir.

---

## 3. Endpoint referansı

### GET /v1/devices

Çalışma alanının cihazlarını listeler (WhatsApp işlemleri için hedef `deviceId`
seçmek üzere).

```bash
curl https://<sunucu-adresi>/public/v1/devices \
  -H "x-api-key: flk_..."
```

```json
{ "data": [
  { "id": "cmr3r9l8s00dwj5rsh1zi8wml", "name": "Cloud Phone 01", "status": "ONLINE" }
] }
```

---

### GET /v1/whatsapp/messages

Cihazda saklanan mesaj geçmişi (agent'ın yakaladığı gelenler + gönderdiğiniz
gidenler). Mesaj gövdeleri çözülmüş (decrypted) olarak döner.

| Parametre | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `limit` | integer | – | Maks. kayıt (1–500) |
| `direction` | `IN` \| `OUT` | – | Yalnızca gelen ya da giden |

```bash
curl "https://<sunucu-adresi>/public/v1/whatsapp/messages?deviceId=cmr3r9l8s00dwj5rsh1zi8wml&limit=20&direction=IN" \
  -H "x-api-key: flk_..."
```

```json
{ "data": { "messages": [
  {
    "id": "cmr7...",
    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",
    "direction": "IN",
    "peer": "905551112233",
    "body": "gelen mesaj metni",
    "waTimestamp": "2026-07-05T14:09:23.445Z",
    "createdAt": "2026-07-05T14:09:24.001Z"
  }
] } }
```

---

### GET /v1/whatsapp/conversations

WhatsApp Web tarzı sohbet listesi: her kişi (peer) için son mesaj önizlemesi +
okunmamış sayısı.

| Parametre | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `filter` | `all` \| `unread` \| `favorite` \| `archived` | – | Akıllı filtre |
| `labelId` | string | – | Etikete göre süz |
| `search` | string | – | İsim/numara araması (maks. 120 krktr) |
| `limit` | integer | – | Sayfa boyutu (1–100) |
| `cursor` | string | – | Sonraki sayfa imleci (`nextCursor`) |

```bash
curl "https://<sunucu-adresi>/public/v1/whatsapp/conversations?deviceId=cmr3...&filter=unread&limit=50" \
  -H "x-api-key: flk_..."
```

```json
{ "data": {
  "conversations": [
    {
      "peer": "905551112233",
      "displayName": "Ahmet",
      "lastMessageBody": "Merhaba",
      "lastDirection": "IN",
      "lastStatus": "READ",
      "lastMessageAt": "2026-07-05T14:09:23.445Z",
      "unreadCount": 2,
      "favorite": false,
      "archived": false,
      "pinned": true,
      "labelIds": ["cml_musteri"]
    }
  ],
  "nextCursor": "cmr7..."
} }
```

---

### GET /v1/whatsapp/thread

Tek bir sohbetin mesaj geçmişi (eskiden yeniye, yukarı kaydırma sayfalaması).

| Parametre | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `peer` | string | ✔ | Kişi (numara veya isim tabanlı peer) |
| `limit` | integer | – | Kayıt sayısı (1–200) |
| `before` | string | – | Daha eski mesajlar için imleç (`nextBefore`) |

```bash
curl "https://<sunucu-adresi>/public/v1/whatsapp/thread?deviceId=cmr3...&peer=905551112233&limit=50" \
  -H "x-api-key: flk_..."
```

```json
{ "data": {
  "messages": [
    {
      "id": "cmr7...",
      "direction": "OUT",
      "peer": "905551112233",
      "body": "Merhaba, nasılsınız?",
      "status": "READ",
      "failReason": null,
      "waTimestamp": "2026-07-05T14:00:00.000Z",
      "createdAt": "2026-07-05T14:00:01.000Z"
    }
  ],
  "nextBefore": "cmr6..."
} }
```

`status` akışı: `QUEUED` → `SENT` → `DELIVERED` → `READ`, ya da `FAILED` (bu
durumda `failReason` doludur).

---

### GET /v1/whatsapp/stats

Mesajlaşma sayıları + yanıt süresi (SLA).

| Parametre | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | – | Tek cihaza sınırla (yoksa tüm çalışma alanı) |
| `sinceHours` | integer | – | Son N saat (1–720) |

```bash
curl "https://<sunucu-adresi>/public/v1/whatsapp/stats?deviceId=cmr3...&sinceHours=24" \
  -H "x-api-key: flk_..."
```

```json
{ "data": {
  "inbound": 128,
  "outbound": 210,
  "failed": 3,
  "openThreads": 12,
  "avgResponseMinutes": 7
} }
```

---

### GET /v1/whatsapp/labels

Çalışma alanının sohbet kategorileri (etiketleri).

```bash
curl "https://<sunucu-adresi>/public/v1/whatsapp/labels" \
  -H "x-api-key: flk_..."
```

```json
{ "data": { "labels": [
  { "id": "cml_musteri", "name": "Müşteri", "color": "green" }
] } }
```

---

### POST /v1/whatsapp/labels

Yeni kategori (etiket) oluşturur. **write kapsamı gerekir.**

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `name` | string | ✔ | Etiket adı (1–40 krktr) |
| `color` | string | – | Renk anahtarı (örn. `green`, `blue`, `slate`) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/labels \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "name": "Müşteri", "color": "green" }'
```

```json
{ "data": { "id": "cml_musteri", "name": "Müşteri", "color": "green" } }
```

---

### POST /v1/whatsapp/send

Seçili cihazdan bir WhatsApp mesajı gönderir (alıcı rehberde kayıtlı olmasa da
çalışır). **write kapsamı gerekir.** Anında `jobId` döner; mesaj birkaç saniye
içinde cihazda gönderilir.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Gönderen cihaz |
| `to` | string | ✔ | Alıcı numarası (E.164, örn. `90XXXXXXXXXX`) |
| `message` | string | ✔ | Mesaj metni (1–4096 krktr) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/send \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "to": "90XXXXXXXXXX", "message": "Merhaba!" }'
```

```json
{ "data": { "jobId": "cmr6fu2wk001o7mr4c0p6py3u", "status": "PENDING" } }
```

---

### POST /v1/whatsapp/broadcast

Bir mesajı birden çok kişiye (veya bir etiketteki tüm sohbetlere) **jitter'lı**
(aralıklı) olarak gönderir. **write kapsamı gerekir.**

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Gönderen cihaz |
| `message` | string | ✔ | Mesaj metni (1–4096 krktr) |
| `peers` | string[] | ⚠ | Alıcı numaraları (maks. 1000) |
| `labelId` | string | ⚠ | Etiketteki tüm sohbetlere gönder |

⚠ `peers` **veya** `labelId` en az biri gerekli.

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/broadcast \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "message": "Kampanya!", "peers": ["90XXXXXXXXXX","90YYYYYYYYYY"] }'
```

```json
{ "data": { "broadcastId": "cmrb...", "queued": 2 } }
```

---

### POST /v1/whatsapp/profile

Bir kişinin WhatsApp profilini cihazdan çeker: profil fotoğrafı (avatar) +
görünen ad/durum. **write kapsamı gerekir.** Cihazda çalışan bir iş başlatır
(~15sn); anında `jobId` döner. Sonuç (avatar + profil) ilgili sohbete işlenir —
sohbet listesinden veya panelden görüntüleyin.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `to` | string | ⚠ | Kişi numarası (E.164) |
| `from` | string | ⚠ | Kişi adı (rehberdeki isim) |

⚠ `to` **veya** `from` en az biri gerekli.

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/profile \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "to": "90XXXXXXXXXX" }'
```

```json
{ "data": { "jobId": "cmr8xz...", "status": "PENDING" } }
```

---

### POST /v1/whatsapp/block

Bir kişiyi cihazda engeller veya engelini kaldırır. **write kapsamı gerekir.**
`block` varsayılanı `true` (engelle).

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `to` | string | ⚠ | Kişi numarası (E.164) |
| `from` | string | ⚠ | Kişi adı |
| `block` | boolean | – | `true` engelle (varsayılan), `false` engeli kaldır |

⚠ `to` **veya** `from` en az biri gerekli.

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/block \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "to": "90XXXXXXXXXX", "block": true }'
```

```json
{ "data": { "jobId": "cmr8yb...", "status": "PENDING" } }
```

---

### POST /v1/whatsapp/blocklist

Cihazdaki engellenen hesaplar listesini okur (Ayarlar › Gizlilik › Engellenenler).
**write kapsamı gerekir.** Sonuç iş sonucuna (job result) düşer.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/blocklist \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3..." }'
```

```json
{ "data": { "jobId": "cmr8zc...", "status": "PENDING" } }
```

İş tamamlandığında sonucu (örnek): `{ "status": "OK", "count": 1, "blocked": ["+90 XXX XXX XX XX"] }`

---

### POST /v1/whatsapp/mynumber

Cihazdaki hesabın **kendi** WhatsApp numarasını okur (Ayarlar › profil satırı).
**write kapsamı gerekir.** Numara iş sonucuna düşer; ayrıca bildirim kanalına
(Telegram vb.) yansır.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/mynumber \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3..." }'
```

```json
{ "data": { "jobId": "cmr9dd...", "status": "PENDING" } }
```

İş sonucu (örnek): `{ "status": "OK", "number": "+90 XXX XXX XX XX" }`

---

### POST /v1/whatsapp/send-media

Bir kişiye görsel/belge gönderir. Medya bir URL'den indirilip cihaza yüklenir ve
WhatsApp galeri/belge akışıyla gönderilir. **write kapsamı gerekir.**

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Gönderen cihaz |
| `to` | string | ✔ | Alıcı numarası (E.164) |
| `mediaUrl` | string (URL) | ✔ | İndirilecek medya URL'si (maks. 2048 krktr) |
| `caption` | string | – | Medya açıklaması (maks. 1024 krktr) |
| `kind` | `image` \| `document` | – | Medya türü (varsayılan `image`) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/send-media \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "to": "90XXXXXXXXXX", "mediaUrl": "https://example.com/foto.jpg", "caption": "Ürün görseli" }'
```

```json
{ "data": { "jobId": "cmr9aa...", "status": "PENDING" } }
```

---

### POST /v1/whatsapp/delete-message

Bir sohbetteki mesajı siler. **write kapsamı gerekir.** `scope` **varsayılanı
`everyone`** (herkesten sil).

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `to` | string | ✔ | Kişi numarası (E.164) |
| `scope` | `me` \| `everyone` | – | `everyone` = herkesten sil (**varsayılan**), `me` = benden sil |
| `matchText` | string | – | Belirli bir mesajı hedeflemek için metin (yoksa son giden mesaj) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/delete-message \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "to": "90XXXXXXXXXX", "scope": "everyone" }'
```

```json
{ "data": { "jobId": "cmr9bb...", "status": "PENDING" } }
```

İş sonucu (örnek): `{ "status": "DELETED", "scope": "everyone" }`. Herkesten sil
seçeneği (2 saatlik pencere geçmişse) yoksa benden silmeye düşer ve sonuçta
`everyoneUnavailable: true` işaretlenir.

---

### POST /v1/whatsapp/clear-chat

Bir sohbetin yerel geçmişini tamamen temizler (Sohbet ⋮ › Sohbeti temizle).
Karşı taraftan silmez. **write kapsamı gerekir.**

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `to` | string | ✔ | Kişi numarası (E.164) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/clear-chat \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "to": "90XXXXXXXXXX" }'
```

```json
{ "data": { "jobId": "cmr9cc...", "status": "PENDING" } }
```

---

### POST /v1/whatsapp/conversations/labels

Bir sohbete kategori (etiket) atar. **write kapsamı gerekir.**

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `peer` | string | ✔ | Kişi (peer) |
| `labelIds` | string[] | ✔ | Atanacak etiket kimlikleri (maks. 20) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/conversations/labels \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "peer": "90XXXXXXXXXX", "labelIds": ["cml_musteri"] }'
```

```json
{ "data": { "ok": true } }
```

---

### POST /v1/whatsapp/conversations/state

Bir sohbeti favori / arşiv / sabit yapar. **write kapsamı gerekir.**

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `peer` | string | ✔ | Kişi (peer) |
| `favorite` | boolean | – | Favori işaretle/kaldır |
| `archived` | boolean | – | Arşivle/çıkar |
| `pinned` | boolean | – | Sabitle/kaldır |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/conversations/state \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "peer": "90XXXXXXXXXX", "pinned": true }'
```

```json
{ "data": { "ok": true } }
```

---

## 4. Webhook'lar

Panelden `Webhooks` bölümünde bir URL'ye şu olaylara abone olabilirsiniz. Her
olay `POST` ile gönderilir.

| Olay | Ne zaman |
|---|---|
| `WHATSAPP_MESSAGE` | Yeni **gelen** mesaj yakalandığında |
| `WHATSAPP_SENT` | **Giden** mesaj cihazda gönderildiğinde |
| `WHATSAPP_FAILED` | Giden mesaj gönderilemediğinde (`failReason` ile) |

**WHATSAPP_MESSAGE** örneği:

```http
POST https://sizin-sunucunuz.com/webhook
content-type: application/json

{
  "event": "WHATSAPP_MESSAGE",
  "data": {
    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",
    "direction": "IN",
    "peer": "90XXXXXXXXXX",
    "body": "gelen mesaj metni",
    "waTimestamp": "2026-07-05T14:09:23.445Z"
  }
}
```

**WHATSAPP_SENT / WHATSAPP_FAILED** örneği:

```json
{
  "event": "WHATSAPP_SENT",
  "data": {
    "deviceId": "cmr3r9l8s00dwj5rsh1zi8wml",
    "to": "90XXXXXXXXXX",
    "status": "SENT",
    "ts": "2026-07-05T14:10:00.000Z"
  }
}
```

`WHATSAPP_FAILED` olayında ek olarak `failReason` alanı bulunur.

---

## 5. Hata kodları

| HTTP | Kod | Anlamı |
|---|---|---|
| `400` | `INVALID_RECIPIENT` | Geçersiz/eksik telefon numarası |
| `400` | (zod doğrulama) | Eksik/hatalı alan (örn. `message` boş) |
| `401` | — | `x-api-key` başlığı yok veya geçersiz |
| `403` | `WORKSPACE_REQUIRED` | Anahtar bir çalışma alanına bağlı değil (servis anahtarı kabul edilmez) |
| `403` | `INSUFFICIENT_SCOPE` | Yazma işlemi için `write`/`admin` kapsamı yok |
| `429` | — | Hız sınırı aşıldı (IP başına ~120 istek/dakika; cihaz süren uçlar ek sınırlı) |

Hata gövdesi:

```json
{ "error": "WORKSPACE_REQUIRED", "message": "Bu uç nokta çalışma alanına bağlı bir API anahtarı gerektirir (servis anahtarı kabul edilmez)" }
```
