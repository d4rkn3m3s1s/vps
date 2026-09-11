---
name: proxy-eu-pr-endpoint-koku-2026-07-28
description: "★★thordata YANLIŞ ENDPOINT: sistem `.eu` host'una bağlıydı, RESMİ endpoint `.pr` (panelde de öyle yazıyor). `.eu` tamamen ölü DEĞİL — kısmen çalışır, bu yüzden aylarca fark edilmedi — ama isteklerin ~%15'inde 502 döner: x-thor-error-code Resource_203 'The target URL accessed by the resource IP is incorrect'. ÖLÇÜM (40'ar istek, tek fark host): eu=34/40 (%15 hata), pr=40/40 (%0). Ayrıca `.eu` ÜLKEYİ de bozuyor: AL istenince XK (Kosova) dönüyor. Tek-tık WA kaydında 'Couldn't connect' bundandı (kayıt anında yeni bağlantı %15 ihtimalle 502). ★2. KÖK: sticky sessid ülke değişimini EZİYOR — thordata sticky-IP'yi SADECE sessid'e bağlar, -country-XX canlı session için YOK SAYILIR → aynı cihaza farklı ülke uygulanınca ESKİ ülke IP'si döner (mi35 DE istendi TR çıktı) → WhatsApp'a numara/IP ülke UYUMSUZLUĞU = ban riski. FIX: SESSID=<instance><cc>. 29 ülke canlı doğrulandı. commit 5692e00 + 09939ac"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1000ff11-d330-4e5b-83fc-9bfb7b16dc6c
  modified: 2026-07-27T22:42:58.259Z
---

# ★★ thordata `.eu` → `.pr` + sessid ülke-ezme (2026-07-28)

## KÖK 1 — YANLIŞ ENDPOINT (`.eu` yerine `.pr`)
Sistem `<PROXY_HOST_ID>.eu.thordata.net` (43.157.66.4) kullanıyordu; **resmî endpoint
`<PROXY_HOST_ID>.pr.thordata.net`** (49.51.189.254) — sağlayıcı panelinde de böyle yazıyor.
`.eu` tamamen ölü değil, **kısmen** çalışır (bu yüzden aylarca fark edilmedi) ama:
```
HTTP/1.1 502 Bad Gateway
x-thor-error-code: Resource_203
x-thor-error-msg : The target URL accessed by the resource IP is incorrect.
```
**ÖLÇÜM** (40'ar istek, aynı login/port, tek fark host):
`eu → OK=34 BAD=6 (%15 hata)` · `pr → OK=40 BAD=0 (%0)`
Ayrıca **`.eu` ÜLKEYİ de bozuyor**: `country-AL` istenince **XK (Kosova)** dönüyor.

Etki: tek-tık WhatsApp kaydında *"Couldn't connect"* — kayıt anında yeni bağlantı açılır,
%15 ihtimalle 502'ye denk gelir. Hata **aralıklı** olduğu için route/redsocks sanıldı.
⚠️ Ayırt etme: aralıklı hata = route arızası DEĞİL (route kopuksa **her** istek 000 olur).

**Kalıcı yerler** (hepsi düzeltildi): `/etc/fleet-proxy.env`, API systemd **drop-in**
`fleet-api.service.d/proxy.conf` (★ana unit'te DEĞİL — `systemctl cat` ile bul),
`wd-health-watch.sh` + `wd-proxy-restore.sh` varsayılanları. ⚠️`wd-proxy.sh` host'u
DNS ile IP'ye çevirip conf'a **IP gömer** → env düzeltilmeden conf'lar eski IP'de kalır.

## KÖK 2 — sticky sessid ÜLKE DEĞİŞİMİNİ EZİYOR (sessiz, ban-riskli)
thordata sticky-IP'yi **SADECE sessid'e** bağlar; `-country-XX` etiketi **canlı bir
session için YOK SAYILIR**. sessid yalnız instance adından üretildiği için aynı cihaza
farklı ülke uygulanınca **eski ülkenin IP'si** dönüyordu.
CANLI: mi35'e DE uygulandı → conf `country-DE` **yazıyor** ama cihaz **TR**'den çıkıyordu;
aynı login **taze sessid** ile → DE anında doğru.
→ Sessizce ülke-değişimini bozar VE WhatsApp'a **numara/IP ülke uyumsuzluğu** verir
("Login not available" / ban).
**FIX**: `SESSID=<instance><cc>` (alnum). Sticky (cihaz,ülke) bazında korunur; ülke
değişimi gerçek yeni session başlatır. KANIT: mi35→DE=93.219.14.80 DE ✓, geri TR=
176.41.61.190 ve 4/4 aynı IP (sticky bozulmadı).

## ÇOK-ÜLKE (gömüldü)
`.pr` mobile(9999) ile **29/29 ülke** canlı doğrulandı:
`TR AL DE US GB FR NL IT ES PL RO BG GR RS AT CH SE NO DK FI CZ HU PT IE BE CA AU AE SA`
→ `FLEET_PROXY_MOBILE_COUNTRIES` bu listeye alındı. Mimari zaten çok-ülkeliydi
(`proxy-accounts.ts` → mobile/residential seçimi), eksik olan **tanımlı ülke listesiydi**.
TR (öncelikli): 30/30 istek temiz, sticky 5/5 aynı IP.

⚠️ `FLEET_THORDATA_TOKEN*` sunucuda **hiç tanımlı değil** → bakiye/kota alarmı hiç çalışmamış.

Bağlantılı: [[proxy-mimari-cok-port-2hesap-2026-07-21]] [[proxy-alarm-undici-forward-fix-2026-07-26]]
[[wa-couldnt-connect-proxy-forcestop-2026-07-27]] [[bayat-adb-ucu-kurulum-oldurur-2026-07-28]]
