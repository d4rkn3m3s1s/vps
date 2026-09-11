---
name: proxy-env-api-surecine-aktarilmiyordu-2026-07-30
description: "★★★KÖK NEDEN (30 Tem): FLEET_PROXY_* env değişkenleri host'ta /etc/fleet-proxy.env'de VARDI ama API sürecine HİÇ aktarılmıyordu → 29 Tem'de yazılan TR→mobile seçimi (proxyCredsFor) API tarafında TAMAMEN devre dışıydı. Kayıtlar sessizce DB fallback yolundan gidiyordu; o satırlar doğru olduğu için sorun AYLARDIR görünmez kaldı. systemd EnvironmentFile ile düzeltildi."
metadata: 
  node_type: memory
  type: project
  originSessionId: 060eed7a-fef7-42f6-a7d8-158fe471cc89
  modified: 2026-07-29T23:15:51.964Z
---

# ★★★ FLEET_PROXY_* env API'ye hiç ulaşmıyordu

## Belirti YOKTU — bu yüzden tehlikeli
Filo 34/34 sağlıklıydı, TR cihazlar TR IP alıyordu. Hiçbir alarm yoktu.

## Gerçek
`proxyCredsFor(cc)` (apps/api/src/modules/accounts/proxy-accounts.ts) **her zaman
`null` dönüyordu** — çünkü `FLEET_PROXY_HOST/USER/PASS` ve `FLEET_PROXY_MOBILE_*`
API sürecinde TANIMSIZDI. Kanıt:

```
proxyCredsFor(TR) : NULL       FLEET_PROXY_HOST        (BOS)
proxyCredsFor(AL) : NULL       FLEET_PROXY_MOBILE_USER (BOS)
```

Yani 29 Temmuz'da "TR'nin residential havuzu 502 → TR mobile'a taşındı" diye yazılan
**ülke→hesap seçimi mantığı API tarafında hiç çalışmıyordu**. Kayıtlar
`autoAttachCountryProxy`'nin **fallback** dalından gidiyordu (DB'deki `Proxy`
satırından `findFirst`). O satırlar doğru olduğu için (TR→9999 mobile, AL→5555
residential) sonuç doğru çıkıyor, hata görünmez kalıyordu.

## Neden önemli
1. **Sessiz kırılganlık**: DB'deki proxy satırı silinir/FAILED olursa ülke-eşleşmesi
   sessizce kaybolur → datacenter IP → "Login not available" → ban.
2. **sessid gömülemiyordu**: fallback yol kullanıcı adına `-sessid-` eklemiyor, yani
   "IP döndür" özelliği hiç çalışmıyordu (retry akışının TEK işi bu).

## Düzeltme (iki katman)
**Sunucu** — systemd drop-in, YALNIZCA proxy anahtarları:
```bash
sudo grep -E "^FLEET_PROXY_" /etc/fleet-proxy.env > /etc/fleet-api-proxy.env
sudo chmod 600 /etc/fleet-api-proxy.env
# /etc/systemd/system/fleet-api.service.d/proxy-env.conf
[Service]
EnvironmentFile=/etc/fleet-api-proxy.env
```
⚠️ **`/etc/fleet-proxy.env`'i OLDUĞU GİBİ vermeyin**: içinde `FLEET_API_KEY`,
`FLEET_HOST_KEY`, `FLEET_ADB` gibi HOST-AJANINA ait anahtarlar var. systemd
`EnvironmentFile` dotenv'den **ÖNCE** yüklenir ve dotenv var olan değişkeni **EZMEZ**
→ host anahtarları API'nin kendi `.env` değerlerini sessizce ezerdi.

**Kod** — `rotateExitIp` artık env YOKSA da DB satırından sessid kurabiliyor
(kullanıcı adındaki eski `-country-`/`-sessid-` ekleri temizlenir; üstüne ikinci
sessid eklemek thordata login'ini bozar).

## Doğrulama
```
proxyCredsFor(TR) : VAR (mobile port 9999)
proxyCredsFor(AL) : VAR (port 5555)
sessid  : GOMULDU (mi5trr6p8on1)   sesstime: VAR
instance KORUNDU: mi5
```

## DERS
Bir "düzeltmenin canlıda çalıştığını" doğrularken **sonucun doğru olması yetmez** —
düzeltmenin kendi kod yolunun çalıştığını da doğrula. Burada doğru sonuç, düzeltmenin
değil tamamen başka bir yolun (DB fallback) eseriydi.

İlgili: [[api-restart-agent-stream-proxy-tasima-2026-07-29]] (TR→mobile kararının
alındığı oturum) · [[wa-bekleme-sayaci-retry-2026-07-30]]
