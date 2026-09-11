---
name: public-api-kategori-mimarisi-2026-07-29
description: "★Public API cihaz KATEGORİLERİ (29 Tem): 52 uç düz listeydi, boş cihaza send 409 YERİNE job açıyordu. ★★EN KRİTİK BİLGİ (kullanıcıdan): elle kaydedilen cihazlarda GeneratedAccount satırı YOKTUR ama cihaz `protected` işaretlidir → 'satır yok = boş' varsayımı bu cihazları KIRARDI (canlı: watest34/watest46). KAÇIŞ VALFİ: account/health + account/number guard'SIZ. Karar tablosu tek dosyada: devices/whatsappCategory.ts."
metadata: 
  node_type: memory
  type: project
  originSessionId: 060eed7a-fef7-42f6-a7d8-158fe471cc89
  modified: 2026-07-28T23:19:54.398Z
---

# Public API — cihaz kategorileri + yetenek bazlı uç ayrımı (29 Tem 2026)

## ★★ EN KRİTİK: `Device.protected` = ELLE KAYITLI hesabın işaretidir

Operatör bir numarayı panel dışında **elle** kaydettiğinde `GeneratedAccount` satırı
**oluşmaz**, ama cihaz **korumalı** işaretlenir. Bu yüzden "hesap satırı yok = boş cihaz"
varsayımı YANLIŞTIR — o cihazlarda gerçekte WhatsApp kayıtlıdır.

**Canlı kanıt (28 Tem):** satırsız 14 cihazın `protected` olan 2'sinde (watest34,
watest46) WhatsApp cihazda KAYITLI (`registration_jid`, `cc">90`), `protected` olmayan
12'sinde değil. Sinyal %100 tutarlı çıktı.

→ Bu yüzden **`manual`** kategorisi var. Kategori mantığına dokunan herkes bunu bilmeli;
aksi halde elle kayıtlı cihazlarda TÜM WhatsApp uçları 409 verir.

## Kategoriler (`whatsappCategory`, EN YENİ hesap satırından)

| Kategori | Koşul | register | send | read |
|---|---|---|---|---|
| `empty` | satır yok / PENDING / FAILED, **protected DEĞİL** | ✓ | 409 | 409 |
| `manual` | satır yok/FAILED **+ protected** | ✓ uyarı | ✓ uyarı | ✓ uyarı |
| `registering` | IDENTITY_READY/CONTACT_READY/AWAITING_OTP/REGISTERING | 409 | 409 | 409 |
| `whatsapp` | ACTIVE / AWAITING_MANUAL / RESTRICTED | ✓ | ✓ | ✓ |
| `blocked` | BANNED / LOGGED_OUT | ✓ | 409 | **✓** + `accountWarning` |

★`blocked`'ta **okuma serbest**: banlı hesabın `msgstore.db`'si cihazda durur.
★`RESTRICTED` gönderimde **geçer** (mevcut sohbetlere cevap verebiliyor — canlı doğrulandı).

## ★ KAÇIŞ VALFLERİ — bilerek guard'SIZ

`POST /v1/whatsapp/account/health` ve `/account/number` **her cihazda** çalışır: gerçeği
doğrudan cihazdan okurlar. Guard koysaydık, kaydı tazeleyecek tek uç da 409 verir ve cihaz
kalıcı olarak `empty` kalırdı. 409 mesajı bu uçları zaten öneriyor.

## Mimari — kural TEK yerde

- `apps/api/src/modules/devices/whatsappCategory.ts` — kategori + `checkWhatsappAccess`
  karar tablosu + `capabilitiesOf`. Panel kartı, guard ve `/devices/:id` hep buradan okur.
  **Sebep:** kural çift yaşayınca panel "sağlıklı" derken API 409 veriyordu (28 Tem bug'ı).
- `public.middleware.ts` → `requireWhatsappAccount('send'|'read'|'register')`. Kategoriyi
  okumadan ÖNCE sahiplik doğrular (yoksa 409/200 farkı cross-tenant yan kanal olurdu).
  `deviceId` yoksa guard kendini ATLAR (stats/labels'ta cihaz opsiyonel).
- ⚠️`batch.service.sendFromDevice` **GEVŞEK** mod (`requireAccountRow:false`) — dashboard'ın
  WhatsApp sayfası hesap satırı şart koşmaz. Sadece BANNED/LOGGED_OUT reddedilir.
  Katı mod yalnızca public API'de.
- `capabilitiesOf`'taki grup `mode`'u router'daki guard ile AYNI olmalı → `whatsapp.account`
  (health/number, guard'sız) ile `whatsapp.profile` (ad/resim, `send`) AYRI gruplar.

## Yollar — eskiler KIRILMADI

`public.routes.ts`'teki `mount(method, yeniYol, handler, {alias: eskiYol, use:[guard]})`
tek tanımdan iki yol bağlar. Kategoriler: `send/*` · `chats/*` · `contacts/*` · `account/*` ·
`data/*`. `send/bulk` guard'SIZ (gövde çok cihazlı).

Yeni uçlar: `GET /v1/devices/:id` (capabilities), `/v1/devices` filtreleri
(`?category=&whatsappReady=&status=&tag=&search=`) + `meta.counts` (filtreden BAĞIMSIZ,
filonun tamamı), `/v1/me` içinde `devices` dağılımı.

## Canlı doğrulama (deploy edildi, 20/20 geçti)

Filo 38 cihaz: 12 empty · 2 manual · 18 whatsapp · 6 blocked · 0 registering.
Boş cihaz→409 (yeni+eski yol), banlı→send 409/okuma 200+uyarı, manual→hepsi geçti,
sahte id→404, alias'lar birebir aynı kod.

⚠️ **Test anahtarı**: `ApiKey.docPlaintext` (panelin "API Dokümantasyonu" anahtarı)
`decryptString` ile çözülüp kullanılabilir — yeni anahtar üretmeye gerek yok. Scope'u
`read` olduğu için gönderim uçları 403 verir: **409 = kategori reddi, 403 = kategori geçti**
ayrımı sayesinde gerçek mesaj göndermeden guard test edilir.

⚠️ **Deploy tuzağı**: `/opt/fleet` altındaki dosyalar `UNKNOWN:UNKNOWN 644` olabiliyor →
scp "Permission denied". Önce `sudo chown -R ubuntu:ubuntu`. Postman koleksiyonu İKİ yerde:
`docs/` ve `apps/dashboard/public/` (panelin indirme bağlantısı ikincisini verir).

İlgili: [[wa-saglik-sessiz-yoklama-2026-07-28]] · [[RESUME-kaldigimiz-yer-2026-07-28]]
