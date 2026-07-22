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
| **Yazma / cihaz sürme** (POST): send, broadcast, profile, block, blocklist, mynumber, send-media, delete-message, clear-chat, receipts, media, calls, search, unread, contacts, group-members, chat-summary, account-health, etiket oluştur/ata, sohbet durumu | `write` **veya** `admin` |

Yetersiz kapsamda `403 INSUFFICIENT_SCOPE` döner.

### Yanıt zarfı

Tüm başarılı yanıtlar `{ "data": ... }` zarfıyla döner. Hatalar
`{ "error": "<KOD>", "message": "<açıklama>" }` biçimindedir.

---

## 2. Asenkron iş (job) modeli

> **Önemli:** Cihaz süren işlerin (send, send-media, delete-message, clear-chat,
> block, profile, blocklist, mynumber, ve root-DB okuma uçları: receipts, media,
> calls, search, unread, contacts, group-members, chat-summary, account-health)
> hepsi **asenkron** çalışır. Root-DB okuma uçları ekran gezmediği için çok daha
> hızlıdır (~1–2 sn) — bunları `GET /v1/jobs/:jobId/wait` ile tek istekte bekleyin.

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

## 3.1. Root-DB okuma uçları (ekran gezinmeden — sıfır ban riski)

> Aşağıdaki uçlar cihazdaki WhatsApp'ın **kendi veritabanını** (msgstore.db / wa.db)
> host-agent aracılığıyla **doğrudan** okur — hiçbir ekran gezme/dokunma yapmaz.
> Bu yüzden **çok hızlıdır (~1–2 sn)** ve **ban riski taşımaz** (WhatsApp
> otomasyon olarak algılayamaz). Hepsi asenkrondur: anında `jobId` döner,
> sonucu `GET /v1/jobs/:jobId` (veya `.../wait`) ile okuyun. **write kapsamı
> gerekir.** Cihaz root'lu değilse iş sonucu `{ "status": "NO_ROOT", ... }` döner.

### POST /v1/whatsapp/receipts

Bir sohbetteki **giden** mesajların tik durumunu (gönderildi/iletildi/okundu) tek
tek, zaman damgalarıyla verir. Thread'in kaba `status` alanından çok daha
ayrıntılıdır — hangi mesajın tam olarak okunduğunu gösterir.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `to` | string | ✔ | Kişi numarası (E.164) |
| `limit` | integer | – | Kayıt sayısı (1–100, varsayılan 20) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/receipts \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "to": "90XXXXXXXXXX", "limit": 20 }'
```

İş sonucu (örnek): `{ "status": "OK", "count": 2, "receipts": [ { "ts": 1721640000000, "status": "READ", "text": "Merhaba" } ] }`
(`status`: `SENT` ✓ · `DELIVERED` ✓✓ · `READ` mavi ✓✓ · `PENDING`)

---

### POST /v1/whatsapp/media

Bir sohbetteki (veya `to` verilmezse tüm cihazdaki) medya envanterini
(görsel/video/belge/ses) `message_media`'dan okur: dosya adı/tür/boyut + cihazdaki
yol. Ekran gezmesi yok, saf DB okuma.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `to` | string | – | Kişi numarası (yoksa tüm cihaz) |
| `limit` | integer | – | Kayıt sayısı (1–200, varsayılan 50) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/media \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "to": "90XXXXXXXXXX" }'
```

İş sonucu (örnek): `{ "status": "OK", "count": 1, "media": [ { "ts": …, "fromMe": false, "mime": "image/jpeg", "name": "IMG.jpg", "size": 84213, "caption": "", "path": "/storage/…" } ] }`

---

### POST /v1/whatsapp/calls

Hesabın WhatsApp arama geçmişini (sesli/görüntülü, gelen/giden/cevapsız)
`call_log`'dan okur.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `limit` | integer | – | Kayıt sayısı (1–200, varsayılan 50) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/calls \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "limit": 50 }'
```

İş sonucu (örnek): `{ "status": "OK", "count": 1, "calls": [ { "ts": …, "fromMe": true, "video": false, "durationSec": 42, "result": 5 } ] }`

---

### POST /v1/whatsapp/search

Hesabın **tüm** mesajlarında sunucu-taraflı metin araması yapar (`message` tablosu).
Eşleşen mesajları, hangi sohbette olduklarını ve tarihini döndürür.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `query` | string | ✔ | Aranacak metin (1–100 krktr) |
| `limit` | integer | – | Kayıt sayısı (1–200, varsayılan 50) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/search \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "query": "sipariş" }'
```

İş sonucu (örnek): `{ "status": "OK", "count": 2, "results": [ { "ts": …, "fromMe": false, "peer": "+90…", "text": "sipariş no 123" } ] }`

---

### POST /v1/whatsapp/unread

Cihazdaki toplam okunmamış mesaj sayısını + okunmamış sohbet sayısını
(`chat.unseen_message_count`) verir. Cihazın **kendi gerçeği** — bizim yakaladığımız
aynadan bağımsız (pipeline dışı okumaları da yansıtır).

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/unread \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3..." }'
```

İş sonucu (örnek): `{ "status": "OK", "totalUnread": 7, "unreadChats": 3 }`

---

### POST /v1/whatsapp/contacts

Hesabın **tüm rehberini** (bildiği WhatsApp kişileri: numara + görünen ad)
`wa.db`'den okur.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `limit` | integer | – | Kayıt sayısı (1–500, varsayılan 200) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/contacts \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "limit": 200 }'
```

İş sonucu (örnek): `{ "status": "OK", "count": 2, "contacts": [ { "number": "+90…", "name": "Ahmet" } ] }`

---

### POST /v1/whatsapp/group-members

Bir grup sohbetinin üyelerini (konu adı **veya** grup jid numarasıyla) verir:
her üyenin numarası + yönetici (admin) bayrağı. `msgstore.db`'den okunur.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `group` | string | ✔ | Grup konusu (adı) veya grup jid numarası (1–120 krktr) |
| `limit` | integer | – | Üye sayısı (1–1000, varsayılan 500) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/group-members \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "group": "Ekip Sohbeti" }'
```

İş sonucu (örnek): `{ "status": "OK", "count": 2, "members": [ { "number": "+90…", "admin": true } ] }`

---

### POST /v1/whatsapp/chat-summary

Bir sohbetin **toplu istatistiği**: toplam / gelen / giden mesaj sayısı, medya
sayısı, ilk & son mesaj zaman damgaları. Ucuz analitik, sıfır ekran gezme.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |
| `to` | string | ✔ | Kişi numarası (E.164) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/chat-summary \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "to": "90XXXXXXXXXX" }'
```

İş sonucu (örnek): `{ "status": "OK", "total": 240, "inbound": 130, "outbound": 110, "media": 18, "firstTs": …, "lastTs": … }`

---

### POST /v1/whatsapp/account-health

Cihazdaki **oturum açık hesabın** kendi durumu: kayıtlı numara, WhatsApp sürümü,
kayıtlı-mı bayrağı. Doğrudan cihazdan (ekran gezme yok) okunur, gerçek hesabı
yansıtır. Botların hâlâ oturumda ve doğru numaraya kayıtlı olduğunu doğrulamak için.

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Hedef cihaz |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/account-health \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3..." }'
```

İş sonucu (örnek): `{ "status": "OK", "number": "+90…", "waVersion": "2.24.x", "registered": true }`

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

### POST /v1/devices/provision — Tek tıkla cihaz oluştur

Sıfırdan izole bir bulut telefon kurar (Waydroid instance: boot → root → benzersiz
kimlik → proxy → uygulamalar → WhatsApp-hazır). Panelin **"Tek Tıkla Cihaz Oluştur"**
akışının API karşılığı. **write kapsamı gerekir.** Ağır işlem → sıkı hız sınırlı.

Asenkron: hemen `deviceId` + `jobId` döner; cihaz online olana kadar (~2-5 dk)
`GET /v1/devices` ile durumunu izleyin (`status` `PROVISIONING` → `ONLINE`).

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `name` | string | – | Cihaz adı (boş → otomatik "Cihaz miN") |
| `countryCode` | string(2) | – | Parmak izi ülkesi (ISO-2, örn. `US`) |
| `deviceModel` | string | – | Katalog modeli (örn. `Samsung Galaxy S21`) |
| `androidVersion` | string | – | Android sürümü (örn. `13`) |
| `proxyCountry` | string(2) | – | Ülke-eşleşmeli residential proxy (WhatsApp için numara-ülkesi = çıkış-IP ülkesi ŞART) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/devices/provision \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "name": "Bot-01", "countryCode": "US", "proxyCountry": "US" }'
```

```json
{ "data": { "deviceId": "cmr9...", "jobId": "cmr9...", "instance": "mi8", "status": "PROVISIONING" } }
```

---

### GET /v1/devices/provision/:jobId/status — Kurulum ilerlemesi (adım adım)

`:jobId` = provision yanıtındaki `jobId`. Panelin canlı kurulum modalıyla **aynı** veriyi
döndürür: `phase`, `percent`, mevcut adım ve tüm adım günlüğü. Birkaç saniyede bir yoklayın.

`phase`: `provisioning` (kuruluyor) → `ready` (WhatsApp-hazır) veya `failed`.

```bash
curl "https://<sunucu-adresi>/public/v1/devices/provision/cmr9.../status" \
  -H "x-api-key: flk_..."
```

```json
{
  "data": {
    "jobId": "cmr9...",
    "deviceId": "cmr9...",
    "status": "RUNNING",
    "phase": "provisioning",
    "percent": 86,
    "lastProgress": { "step": "apks", "percent": 86, "status": "RUNNING", "note": "Uygulamalar kuruluyor" },
    "steps": [ { "key": "boot", "label": "Cihaz açılışı bekleniyor", "percent": 22 }, "…" ],
    "log": [ { "ts": "…", "step": "boot", "percent": 22, "status": "RUNNING" }, "…" ]
  }
}
```

---

### POST /v1/whatsapp/register — Tek tıkla WhatsApp otonom kayıt

Bir cihazda **kendi numaranızla** otonom WhatsApp kaydı başlatır. Ajan izinleri verir,
EULA'yı geçer, numarayı girer ve **SMS kodu ekranında durur** (`status` = `AWAITING_OTP`).
Kodu alınca `/register/:id/otp` ile gönderin; ajan kodu girip profili tamamlar.
**write kapsamı gerekir.** Ağır işlem → sıkı hız sınırlı.

Numaranın ülkesine göre uygun bir residential proxy otomatik atanır (varsa).

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `deviceId` | string | ✔ | Kaydın yapılacağı cihaz (çevrimiçi + aracısı canlı olmalı) |
| `phoneNumber` | string | ✔ | Ülke kodu dahil numara (örn. `+15551234567`) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/register \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId": "cmr3...", "phoneNumber": "+15551234567" }'
```

```json
{
  "data": {
    "accountId": "cmr9...",
    "deviceId": "cmr3...",
    "phoneNumber": "+15551234567",
    "status": "REGISTERING",
    "proxyAssigned": { "country": "US" }
  }
}
```

> **Not:** Cihaz durdurulmuşsa veya aracısı/ADB bağlantısı kopuksa istek **anında**
> `409 DEVICE_OFFLINE` / `409 AGENT_UNREACHABLE` döner (iş sonsuza kadar beklemez).
> Aynı cihazda zaten bir ağır iş sürüyorsa `409 DEVICE_BUSY` döner.

---

### POST /v1/whatsapp/register/:id/otp — SMS kodunu gönder

`:id` = kayıt yanıtındaki `accountId`. Kodu ajana iletir; ajan girip profili tamamlar.
Hesap `ACTIVE` (başarılı) veya `FAILED` olur. **write kapsamı gerekir.**

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `otpCode` | string(4-8) | ✔ | SMS ile gelen doğrulama kodu |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/register/cmr9.../otp \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "otpCode": "123456" }'
```

```json
{ "data": { "id": "cmr9...", "status": "REGISTERING", "phoneNumber": "+15551234567" } }
```

---

### POST /v1/whatsapp/register/:id/verify-method — Doğrulama yöntemi seç

`:id` = kayıt yanıtındaki `accountId`. WhatsApp bazen numaradan sonra **"Choose how
to verify"** (doğrulama yöntemini seç) ekranında durur; bu durumda hesap
`status = AWAITING_OTP` + `phase = method_select` olur. Bu uç ile yöntemi seçersiniz;
ajan seçimi uygular ve kod ekranına ilerler. **write kapsamı gerekir.**

| Alan | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `method` | `sms` \| `voice` \| `missed_call` | ✔ | Doğrulama yöntemi (SMS / sesli arama / cevapsız çağrı) |

```bash
curl -X POST https://<sunucu-adresi>/public/v1/whatsapp/register/cmr9.../verify-method \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "method": "sms" }'
```

```json
{ "data": { "id": "cmr9...", "status": "AWAITING_OTP", "phoneNumber": "+15551234567" } }
```

---

### GET /v1/whatsapp/register/:id/status — Kayıt ilerlemesi

`:id` = `accountId`. Canlı adım-adım ilerleme (mevcut adım, yüzde, tüm adım günlüğü) —
panelin canlı modalıyla **aynı** veri. Birkaç saniyede bir yoklayın. Okuma — her anahtar erişir.

`phase` (basit durum makinesi): `starting` → `waiting_phone` (numara giriliyor) →
`waiting_sms` (SMS kodu bekleniyor) → `opened` (hesap açıldı), veya `failed`.

```bash
curl "https://<sunucu-adresi>/public/v1/whatsapp/register/cmr9.../status" \
  -H "x-api-key: flk_..."
```

```json
{
  "data": {
    "accountId": "cmr9...",
    "deviceId": "cmr3...",
    "status": "AWAITING_OTP",
    "phase": "waiting_sms",
    "percent": 85,
    "steps": [ { "key": "number", "label": "Numara giriliyor", "percent": 62 }, "…" ],
    "lastProgress": { "step": "otp_wait", "percent": 85, "status": "RUNNING", "note": "📲 SMS kodu bekleniyor" },
    "log": [ { "ts": "…", "step": "eula", "percent": 35, "status": "RUNNING", "note": "EULA geçiliyor" }, "…" ]
  }
}
```

---

### GET /v1/jobs/:jobId — İş durumu (sonuç okuma)

Cihaz süren yazma uçlarının (send, broadcast, profile, block, blocklist, mynumber,
send-media, delete-message, clear-chat) döndürdüğü `jobId`'nin durumunu ve sonucunu
okur. Bu uç, asenkron bir işin bitip bitmediğini ve (bittiyse) sonucunu öğrenmenin
**evrensel** yoludur. Okuma — **her geçerli anahtar erişir** (write gerekmez).
İş yalnızca çağıranın çalışma alanına aitse döner; yabancı bir `jobId` → `404 JOB_NOT_FOUND`.

```bash
curl "https://<sunucu-adresi>/public/v1/jobs/cmr9dd..." \
  -H "x-api-key: flk_..."
```

```json
{
  "data": {
    "id": "cmr9dd...",
    "type": "WHATSAPP_MYNUMBER",
    "status": "COMPLETED",
    "result": { "status": "OK", "number": "+90 XXX XXX XX XX" },
    "error": null,
    "createdAt": "2026-07-17T09:00:00.000Z",
    "updatedAt": "2026-07-17T09:00:18.000Z"
  }
}
```

`status` akışı: `PENDING` → `RUNNING` → `COMPLETED` (veya `FAILED`). İş `COMPLETED`
olduğunda sonuç `result` alanında durur; `FAILED` ise sebep `error` alanındadır.
`result` içeriği iş türüne göre değişir; örnekler:

| İş türü (`type`) | `result` (COMPLETED) |
|---|---|
| `WHATSAPP_MYNUMBER` | `{ "status": "OK", "number": "+90 …" }` |
| `WHATSAPP_BLOCKLIST` | `{ "status": "OK", "count": 1, "blocked": ["+90 …"] }` |
| `WHATSAPP_DELETE_MSG` | `{ "status": "DELETED", "scope": "everyone" }` |
| `WHATSAPP_RECEIPTS` | `{ "status": "OK", "count": 2, "receipts": [ { "ts": …, "status": "READ", "text": "…" } ] }` |
| `WHATSAPP_MEDIA` | `{ "status": "OK", "count": 1, "media": [ { "ts": …, "mime": "image/jpeg", "name": "…", "size": …, "path": "…" } ] }` |
| `WHATSAPP_CALLS` | `{ "status": "OK", "count": 1, "calls": [ { "ts": …, "fromMe": true, "video": false, "durationSec": 42 } ] }` |
| `WHATSAPP_SEARCH` | `{ "status": "OK", "count": 2, "results": [ { "ts": …, "peer": "+90…", "text": "…" } ] }` |
| `WHATSAPP_UNREAD` | `{ "status": "OK", "totalUnread": 7, "unreadChats": 3 }` |
| `WHATSAPP_CONTACTS` | `{ "status": "OK", "count": 2, "contacts": [ { "number": "+90…", "name": "…" } ] }` |
| `WHATSAPP_GROUP_MEMBERS` | `{ "status": "OK", "count": 2, "members": [ { "number": "+90…", "admin": true } ] }` |
| `WHATSAPP_CHAT_SUMMARY` | `{ "status": "OK", "total": 240, "inbound": 130, "outbound": 110, "media": 18 }` |
| `WHATSAPP_ACCOUNT_HEALTH` | `{ "status": "OK", "number": "+90…", "waVersion": "2.24.x", "registered": true }` |

> Cihaz root'lu değilse root-DB okuma işleri `{ "status": "NO_ROOT", "note": "…" }`
> ile döner (hata değil — o cihazda o okuma yapılamıyor demektir).

> **Yoklama (polling):** `jobId`'yi alın, birkaç saniyede bir `GET /v1/jobs/:jobId`
> çağırın; `status` `COMPLETED`/`FAILED` olana kadar bekleyin. Alternatif olarak
> webhook (`WHATSAPP_SENT` / `WHATSAPP_FAILED`) veya Telegram/Slack bildirimiyle de
> sonucu öğrenebilirsiniz (yukarıdaki §2'ye bakın). **Daha basiti:** aşağıdaki
> long-poll ucu ile tek istekte sonucu bekleyin — yoklama döngüsü kurmanıza gerek
> kalmaz.

---

### GET /v1/jobs/:jobId/wait — İş bitene kadar bekle (long-poll)

`GET /v1/jobs/:jobId` gibidir; **ama** iş bitene (`COMPLETED`/`FAILED`/`CANCELLED`)
**veya** `?timeout` saniye dolana kadar **sunucu tarafında bekler** ve sonucu
öyle döner. Böylece yoklama döngüsü yerine **tek istekte** sonucu alırsınız —
gönderdiğiniz işin sonucunu hazır olur olmaz alırsınız, boşa dönen istek olmaz.
Okuma — **her geçerli anahtar erişir** (write gerekmez).

| Parametre | Tip | Zorunlu | Açıklama |
|---|---|---|---|
| `timeout` | integer | – | Kaç saniye beklensin (1–60, varsayılan 30) |

- İş süre dolmadan biterse: `GET /v1/jobs/:jobId` ile **aynı** gövde döner.
- Süre dolarsa (iş hâlâ PENDING/RUNNING): mevcut durum döner **ve** `timedOut: true`
  işaretlenir — çağrıyı yineleyerek beklemeye devam edebilirsiniz.

```bash
# İşi gönder, jobId'yi al, sonra tek istekte bitmesini bekle:
JOB=$(curl -s -X POST https://<host>/public/v1/whatsapp/unread \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId":"cmr3..." }' | jq -r .data.jobId)

curl -s "https://<host>/public/v1/jobs/$JOB/wait?timeout=30" -H "x-api-key: flk_..."
```

```json
{
  "data": {
    "id": "cmr9dd...",
    "type": "WHATSAPP_UNREAD",
    "status": "COMPLETED",
    "result": { "status": "OK", "totalUnread": 7, "unreadChats": 3 },
    "error": null,
    "createdAt": "2026-07-22T09:00:00.000Z",
    "updatedAt": "2026-07-22T09:00:02.000Z"
  }
}
```

---

## 6. Uçtan uca akış — iki API örneği (durum makinesi)

Panelde adım adım gördüğünüz akışın **birebir API karşılığı**. Her aşamada `phase`
alanını yoklayın; panel de aynı veriyi WebSocket ile canlı gösterir.

### Örnek 1 — Tek tıkla cihaz kurulumu (API)

```
POST /v1/devices/provision                → { jobId, status: PROVISIONING }   (slot artık "meşgul")
  ↓  poll GET /v1/devices/provision/:jobId/status
phase: provisioning   (boot → root → APK yükleme → proxy …)   percent artar
  ↓
phase: ready          (WhatsApp-hazır)   ← kurulum başarılı
  (veya phase: failed → lastProgress.note sebebi verir)
```

```bash
# 1) Kurulumu başlat
JOB=$(curl -s -X POST https://<host>/public/v1/devices/provision \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "name":"Bot-01", "countryCode":"US", "proxyCountry":"US" }' | jq -r .data.jobId)

# 2) "ready" olana kadar yokla (aynı cihaza ikinci kurulum GİTMEZ — meşgul/kilitli)
while true; do
  P=$(curl -s "https://<host>/public/v1/devices/provision/$JOB/status" -H "x-api-key: flk_..." | jq -r .data.phase)
  echo "kurulum: $P"; [ "$P" = "ready" ] || [ "$P" = "failed" ] && break; sleep 5
done
```

### Örnek 2 — WhatsApp otonom kayıt (API)

```
POST /v1/whatsapp/register  { deviceId, phoneNumber }   → { accountId, status: REGISTERING }
  ↓  poll GET /v1/whatsapp/register/:accountId/status
phase: starting        (izinler → EULA → menü)
phase: waiting_phone   (numara + ülke kodu otomatik yazılıyor → İleri)
phase: waiting_sms     (SMS doğrulama ekranı)   ← burada kodu gönder
  ↓  POST /v1/whatsapp/register/:accountId/otp  { otpCode }
phase: opened          (hesap açıldı — success)
  (veya phase: failed → lastProgress.note sebebi)
```

```bash
# 1) Kaydı başlat (kendi numaranla). deviceId = kurulan cihaz.
ACC=$(curl -s -X POST https://<host>/public/v1/whatsapp/register \
  -H "x-api-key: flk_..." -H "content-type: application/json" \
  -d '{ "deviceId":"cmr3...", "phoneNumber":"+15551234567" }' | jq -r .data.accountId)

# 2) waiting_sms olana kadar yokla
while true; do
  P=$(curl -s "https://<host>/public/v1/whatsapp/register/$ACC/status" -H "x-api-key: flk_..." | jq -r .data.phase)
  echo "kayıt: $P"; [ "$P" = "waiting_sms" ] || [ "$P" = "opened" ] || [ "$P" = "failed" ] && break; sleep 4
done

# 3) SMS kodunu gönder
curl -s -X POST "https://<host>/public/v1/whatsapp/register/$ACC/otp" \
  -H "x-api-key: flk_..." -H "content-type: application/json" -d '{ "otpCode":"123456" }'

# 4) opened olana kadar yokla → hesap açıldı. Sonra profil foto/isim güncellenebilir
#    (POST /v1/whatsapp/profile ... — mevcut endpoint'ler).
while true; do
  P=$(curl -s "https://<host>/public/v1/whatsapp/register/$ACC/status" -H "x-api-key: flk_..." | jq -r .data.phase)
  echo "kayıt: $P"; [ "$P" = "opened" ] || [ "$P" = "failed" ] && break; sleep 4
done
```

**Faz karşılıkları (panel ↔ API):**

| Panel (canlı modal) | API `phase` | API `status` |
|---|---|---|
| Kuruluyor (boot/APK…) | `provisioning` | `RUNNING` |
| Kurulum bitti | `ready` | `COMPLETED` |
| Numara giriliyor | `waiting_phone` | `REGISTERING` |
| SMS kodu bekleniyor | `waiting_sms` | `AWAITING_OTP` |
| Hesap açıldı | `opened` | `ACTIVE` |
| Hata | `failed`/`failed` | `FAILED` |

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
    "deviceName": "Cloud Phone 01",
    "from": "90XXXXXXXXXX",
    "text": "gelen mesaj metni",
    "ts": "2026-07-05T14:09:23.445Z"
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

### Teslimat başlıkları ve imza doğrulama

Her webhook `POST` isteği şu başlıklarla gönderilir:

| Başlık | Açıklama |
|---|---|
| `X-Fleet-Event` | Olay tipi (`WHATSAPP_MESSAGE`, `WHATSAPP_SENT`, `WHATSAPP_FAILED`) |
| `X-Fleet-Delivery` | Bu teslimatın benzersiz kimliği (tekilleştirme / izleme için) |
| `X-Fleet-Signature` | HMAC-SHA256 imzası (**yalnızca** webhook'un bir gizli anahtarı — secret — varsa gönderilir) |

**İmza doğrulama:** `X-Fleet-Signature`, ham istek gövdesinin (raw body) webhook
secret'ıyla hesaplanan HMAC-SHA256 özetidir (hex olarak). İsteğin gerçekten sizin
sunucunuzdan geldiğini doğrulamak için, aldığınız ham gövdeyi kendi secret'ınızla
aynı şekilde imzalayıp karşılaştırın:

```js
const crypto = require('crypto');
const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.header('X-Fleet-Signature')));
```

---

## 5. Hata kodları

| HTTP | Kod | Anlamı |
|---|---|---|
| `400` | `INVALID_RECIPIENT` | Geçersiz/eksik telefon numarası |
| `400` | `INVALID_NUMBER` | Kayıt için geçersiz telefon numarası (ülke kodu dahil olmalı) |
| `400` | `MISSING_TARGET` | `profile`/`block`: `to` **ve** `from` ikisi de eksik (en az biri gerekli) |
| `400` | `NOT_AWAITING_OTP` | `/otp` veya `/verify-method`: hesap o an OTP / yöntem-seçimi aşamasında değil |
| `400` | `INVALID_OTP` | Gönderilen koddan geçerli rakam çıkmıyor |
| `400` | (zod doğrulama) | Eksik/hatalı alan (örn. `message` boş) |
| `401` | `UNAUTHORIZED` | `x-api-key` başlığı yok veya geçersiz |
| `403` | `WORKSPACE_REQUIRED` | Anahtar bir çalışma alanına bağlı değil (servis anahtarı kabul edilmez) |
| `403` | `INSUFFICIENT_SCOPE` | Yazma işlemi için `write`/`admin` kapsamı yok |
| `404` | `DEVICE_NOT_FOUND` | Cihaz bulunamadı (veya başka bir çalışma alanına ait) |
| `404` | `ACCOUNT_NOT_FOUND` | Kayıt hesabı (`accountId`) bulunamadı (veya başka bir çalışma alanına ait) |
| `404` | `JOB_NOT_FOUND` | İş (`jobId`) bulunamadı (veya başka bir çalışma alanına ait) |
| `409` | `DEVICE_OFFLINE` | Cihaz durdurulmuş — önce uyandırın |
| `409` | `AGENT_UNREACHABLE` | Cihazın sunucu aracısı/ADB'si yanıt vermiyor (iş gönderilemez) |
| `409` | `DEVICE_BUSY` | Cihazda zaten bir ağır iş sürüyor — bitince tekrar deneyin |
| `409` | `OTP_ALREADY_SUBMITTED` | `/otp`: kod zaten gönderilmiş, hesap hâlihazırda işleniyor (çift-gönderim) |
| `409` | `NO_ONLINE_HOST` | Kurulum için çevrimiçi KVM sunucusu yok |
| `429` | `RATE_LIMITED` | Hız sınırı aşıldı (aşağıya bakın) |

Hata gövdesi:

```json
{ "error": "WORKSPACE_REQUIRED", "message": "Bu uç nokta çalışma alanına bağlı bir API anahtarı gerektirir (servis anahtarı kabul edilmez)" }
```

### Hız sınırları (rate limit)

Sınırlar uç türüne göre farklıdır — tek bir "IP başına" sınır **yoktur**:

| Uç grubu | Sınır | Anahtar (bucket) |
|---|---|---|
| Yazma POST'ları (send, broadcast, profile, block, blocklist, mynumber, send-media, delete-message, clear-chat, receipts, media, calls, search, unread, contacts, group-members, chat-summary, account-health, `/register/:id/otp`, `/register/:id/verify-method`) | **~120 istek/dakika** | IP başına |
| Ağır işlemler: `POST /v1/devices/provision`, `POST /v1/whatsapp/register` | **~20 istek/dakika** | **API anahtarı başına** |
| GET okuma uçları (devices, messages, conversations, thread, stats, labels, provision-status, register-status, jobs, jobs/:id/wait) + etiket/durum POST'ları (`/labels`, `/conversations/labels`, `/conversations/state`) | **Sınırsız** | — |

Sınıra takılan istekler `429 RATE_LIMITED` döner. Her yanıtta `RateLimit-Limit`,
`RateLimit-Remaining` ve `RateLimit-Reset` başlıkları ile kalan kotanızı görebilirsiniz.
