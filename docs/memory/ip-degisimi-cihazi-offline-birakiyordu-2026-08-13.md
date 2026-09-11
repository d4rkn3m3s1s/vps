---
name: ip-degisimi-cihazi-offline-birakiyordu-2026-08-13
description: "🔴★★★ IP DEĞİŞİMİ cihazı SONSUZA KADAR 'OFFLINE' bırakıyordu: API `ipAddress:adbPort` serial eşleşmesine bakıyor ama instance yeniden başlayınca YENİ subnet alıyor ve bunu API'ye KİMSE bildirmiyordu (`ipAddress` agent kodunda hiç geçmiyordu). ★FIX: heartbeat'e instanceSerials. ★Canlı kanıt: IP bilerek bozuldu → 90 sn'de kendiliğinden tazelendi."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-13T03:10:19.886Z
---

# IP değişimi cihazı sonsuza kadar "OFFLINE" bırakıyordu

## Belirti
Operatör: *"TOPLAM 155 / ÇEVRİMİÇİ 154 — bir cihaz neden düştü?"*
**Cihaz düşmemişti.** mi81 (+905343666957): `adb=device`, `boot=1`, TR proxy
çalışıyor (çıkış 78.191.46.242). Panel yanlış gösteriyordu.

## ★★★ KÖK NEDEN
API bir cihazın ONLINE olup olmadığına **`${ipAddress}:${adbPort}` serial'i
erişilebilir listede var mı** diye bakıyor (`agent.service.ts`, heartbeat).
Bir instance yeniden başlatıldığında `net-head` **YENİ subnet/IP** verebiliyor ve
bunu API'ye **kimse bildirmiyordu** — `ipAddress` kelimesi agent kodunda **hiç
geçmiyordu**. Sonuç: DB'deki IP bayat → serial ASLA eşleşmez → cihaz çalıştığı
halde **sonsuza kadar OFFLINE**.

## ZİNCİR (mi81, canlı)
```
02:18:04  dns-heal: "GERCEK DHCP lease YOK" -> wd-run yeniden başlattı
          192.168.57.112  ->  192.168.169.72   (net-head yeni subnet verdi)
02:27:46  adb-reconnect: mi81 geri bağlandı ✓  (12 Ağu fix'i çalıştı)
02:37:13  redsocks yeniden başlatıldı ✓
          ...ama DB hâlâ .57.112 diyordu -> panel OFFLINE
```
★ Yani ÜÇ ayrı kurtarma katmanı doğru çalıştı; eksik olan tek şey **DB'nin
haberdar edilmesiydi**.

## FIX
- **agent**: heartbeat'e `instanceSerials` (instance → gerçek serial) eklendi.
  Yalnızca **ADB'de GERÇEKTEN görünen** uçlar bildirilir — bayat bir tahmin
  DB'ye yazılmaz.
- **API**: bayat kayıtları ONLINE/OFFLINE kararından **ÖNCE** tazeler (cihaz aynı
  turda ONLINE'a döner). Satır-içi de günceller (`r.ipAddress = ip`).
- **zod**: ad `[A-Za-z0-9_-]{1,64}` + değer `ip:port` doğrulanır — değer doğrudan
  `Device.ipAddress`'e yazıldığı için şart.

## ★★ KANIT (uçtan uca, canlı)
```
mi81'in IP'si BİLEREK 192.168.222.222 yapıldı
90 sn sonra → 192.168.169.72 | ONLINE      ← kendiliğinden tazelendi ✅
API logu: "device IP tazelendi (instance yeniden başlatılınca değişmişti)"
```
Birim test 7/7 (bayat tazelendi · güncel olana DOKUNULMADI · agent bildirmediğine
DOKUNULMADI · boş harita güvenli · IP'siz cihaz dolduruldu).
Filo taraması: **155 cihazın 155'i güncel** — mi81 tek vakaydı.

## ⚠️ TEŞHİS DERSİ
"Cihaz düştü" denince önce **cihaza bak**, panele değil. Üç ölçüm yeter:
`wd-run` süreci · container eth0 IP'si · o IP'de `adb get-state`. Üçü de sağlamsa
sorun **kayıt katmanındadır** (DB/panel), cihazda değil. Aynı ders 13 Ağu'da
".112 varsayımı"nda da geçerliydi.

İlgili: [[nokta112-varsayimi-saglam-cihazlari-olduruyordu-2026-08-13]] ·
[[adb-reap-kayit-oldururken-numara-yakiyordu-2026-08-13]] · [[subnet-tavani-238den-492ye-2026-08-13]]
