---
name: dashboard-redirect-localhost3000-fix-2026-07-24
description: "★http://125.253.73.45/profiles → ERR_CONNECTION_RESET. KÖK: dashboard middleware oturumsuz ziyaretçiyi /welcome'a `NextResponse.redirect(new URL('/welcome', request.url))` ile atıyordu; ters-proxy(Caddy→127.0.0.1:3000) arkasında request.url İÇ dinleme adresini(http://localhost:3000) taşır(Host başlığından bağımsız)→Location MUTLAK `localhost:3000` çıkar→tarayıcı operatörün KENDİ localhost'una gider(reset). FIX(2 katman): (1)middleware externalUrl() yardımcısı — X-Forwarded-Host ?? Host başlığından dış-host kur, `url.port=''` ile eski :3000'i TEMİZLE(portsuz fwdHost'ta port korunmasın). (2)Caddyfile dashboard reverse_proxy'ye `header_up X-Forwarded-Host {host}`+`X-Forwarded-Proto {scheme}`. SONUÇ: Location `http://125.253.73.45/welcome`(port-80). ★DERS:Next redirect'te `new URL(path, request.url)` proxy-arkasında İÇ-adres üretir→dış-host'u Host başlığından kur+portu temizle. /welcome-redirect'in KENDİSİ normal(oturumsuz)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-24T01:16:10.363Z
---

# ★ DASHBOARD /profiles → ERR_CONNECTION_RESET (localhost:3000 redirect) — 2026-07-24

Kullanıcı: "http://125.253.73.45/profiles yüklenmiyor, /welcome'a yönlendirdi,
bu siteye ulaşılamıyor ERR_CONNECTION_RESET". Telegram komut-suite deploy'undan
SONRA fark edildi (ama sebep o değil — mevcut bir proxy-farkındalık bug'ıydı).

## KÖK NEDEN (2 iç içe)
1. **`/welcome`'a redirect NORMAL**: `apps/dashboard/src/middleware.ts` oturumsuz
   (veya süresi-dolmuş cookie) ziyaretçiyi `/welcome`'a atar (satır 42-46). Doğru.
2. **★GERÇEK BUG — `localhost:3000` MUTLAK URL**: `NextResponse.redirect(new URL('/welcome',
   request.url))`. Ters-proxy arkasında (Caddy `:80` → `reverse_proxy 127.0.0.1:3000`)
   Next'in `request.url`'ü İÇ dinleme adresini taşır = `http://localhost:3000/...`,
   Host başlığından BAĞIMSIZ. Kanıt: `curl -H "Host: 125.253.73.45" 127.0.0.1:3000/profiles`
   → `Location: http://localhost:3000/welcome`. Tarayıcı bu MUTLAK Location'ı takip edince
   operatörün KENDİ makinesindeki localhost:3000'e gider → orada sunucu yok → RESET.

## FIX (2 katman, savunma-derinliği)
- **middleware.ts `externalUrl(request, path)` yardımcısı**:
  ```
  const url = new URL(request.url);
  const fwdHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (fwdHost) { url.port = ''; url.host = fwdHost; }   // ★url.port='' ŞART
  const fwdProto = request.headers.get('x-forwarded-proto'); if (fwdProto) url.protocol = `${fwdProto}:`;
  url.pathname = path; url.search = '';
  ```
  Her iki redirect (`/profiles` login-sonrası + `/welcome` oturumsuz) bunu kullanır.
  ⚠️`url.port=''` KRİTİK: fwdHost portsuz("125.253.73.45") gelince `url.host=fwdHost`
  Edge-URL'de eski :3000 portunu KORUYABİLİR→Location `:3000`(kapalı port)→yine RESET.
  Önce port'u sıfırla. (Yerel node URL spec'i temizler ama açık yaz=garanti.)
- **Caddyfile** (`/etc/caddy/Caddyfile`) dashboard reverse_proxy'ye:
  `header_up X-Forwarded-Host {host}` + `header_up X-Forwarded-Proto {scheme}`.
  (Caddy default X-Forwarded-Host GÖNDERMEZ — sadece For/Proto; açıkça eklendi.)

## DOĞRULAMA (uçtan uca, Host: 125.253.73.45)
- /welcome=200, /login=200, /profiles=307→takip→`http://125.253.73.45/welcome`=200.
- Location artık PORTSUZ dış-host (önce `localhost:3000`, sonra `125.253.73.45:3000`, en son `125.253.73.45`).
- Title "VPS Fleet · Bulut Telefon Platformu" geliyor.

## DEPLOY NOTLARI
- Dashboard dosyaları root'a ait olabilir → scp `Permission denied`. Çözüm: `/tmp`'e
  scp + `sudo cp /tmp/x /opt/fleet/...`. Build öncesi `.next` chown ubuntu şart.
- `fleet-dashboard.service`(fleet-web DEĞİL) 3000'de next-server. Build: `npm run build`
  (Middleware Edge-bundle'a derlenir), restart `sudo systemctl restart fleet-dashboard`.
- Caddy: `caddy validate` → `systemctl reload caddy`. Caddyfile.bak-<ts> alındı.

## ★DERS
Next.js middleware/route'ta redirect kurarken `new URL(path, request.url)` ters-proxy
arkasında İÇ dinleme adresi (localhost:3000) üretir. Dış-host'u DAİMA `X-Forwarded-Host`
?? `Host` başlığından kur, ve `url.port=''` ile iç portu temizle. Detay
[[firewall-ipv6-regresyon-test-2026-07-24]] (o da proxy/bind IPv4-IPv6 konusu).
