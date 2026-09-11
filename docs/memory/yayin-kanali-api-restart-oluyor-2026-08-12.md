---
name: yayin-kanali-api-restart-oluyor-2026-08-12
description: "🔴★★★ API RESTART'I CANLI EKRANI ÖLDÜRÜYOR: agent'ın /ws/agent-stream kanalı kopuyor ve KENDİLİĞİNDEN GERİ GELMİYOR (canlı: 22 dk hiç deneme yok). Panel 'Sunucu aracısı çevrimdışı' der. ★ÇÖZÜM: systemctl restart fleet-agent. ⚠️Watchdog eşikleri MAKUL (pong 75s) ama çalışmadı — KÖK NEDEN BULUNMADI. ★Her deploy sonrası fleet-smoke.sh bunu kontrol ediyor."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-12T02:10:31.017Z
---

# API restart'ı yayın kanalını öldürüyor

## Belirti
Panelde canlı ekran açılmıyor:
```
"bağlanıyor..." → "Uzun sürdü — yayın kanalı kopmuş olabilir"
"Sunucu aracısı çevrimdışı görünüyor — yayın başlatılamadı"
```
"Yenile" / "Yayını yenile" hiçbir işe yaramıyor.

## ★ TEŞHİS (hafızadaki kuralın doğrulanması)
Eski kural hâlâ geçerli: **API'de `Stream agent connected` yoksa sorun AGENT'ta.**
```
API restart          : 01:50:38   (deploy)
agent son "connected": 01:40:45   ← restart'tan ÖNCE
01:40 → 02:02 arası  : agent tarafında TEK deneme bile yok (22 dakika)
```
Yani agent, kanalın koptuğunu **hiç fark etmedi**.

⚠️ Not: API tarafında `[stream] viewer accepted` logları VARDI — yani token ve
izleyici tarafı sağlamdı. Yanıltıcı: "viewer accepted" görünce sorun yok sanılır;
asıl bakılacak satır **`Stream agent connected`**.

## ÇÖZÜM (anında)
```bash
sudo systemctl restart fleet-agent      # kanal ~15 sn içinde geri gelir
```
Canlı doğrulama: agent logunda `stream channel connected`, API logunda
`Stream agent connected`.

## ⚠️ KÖK NEDEN HENÜZ BULUNMADI
Watchdog kodu doğru GÖRÜNÜYOR ve eşikler makul:
```
PING_MS = 30s · PONG_TIMEOUT_MS = 75s · CONNECT_TIMEOUT_MS = 20s
onclose  -> scheduleReconnect(5000)
watchdog -> readyState CLOSED ise connect()
```
En geç **75 saniyede** kopmayı algılaması gerekirdi; 22 dakika hiçbir şey olmadı.
Olası yönler (denenmedi): `stopping` bayrağı asılı kalması · `reconnectTimer`
temizlenmemesi · soketin CLOSED'a hiç geçmemesi (yarı-açık TCP) · watchdog
interval'inin durması.
★ 1–4 Ağu'da benzer bir olay olmuştu ("CONNECTING ölü kilit", 2.5 gün) ve
düzeltilmişti — bu ONDAN FARKLI bir yol.

## KALICI KORUMA (kök neden bulunana kadar)
`fleet-smoke.sh` (29. kontrol): agent'ın son `stream channel connected` kaydı
API'nin son başlangıcından ÖNCE ise **HATA** verir ve çözümü yazar.
⚠️ Her deploy API'yi yeniden başlattığı için bu kontrol deploy sonrası ZORUNLU.

## ⚠️⚠️ OPERASYONEL DERS
12 Ağu'da 6+ deploy yapıldı; muhtemelen **her seferinde yayın kanalı ölü kaldı**
ve bu, ancak operatör canlı ekranı açmaya çalışınca fark edildi. API restart eden
her işlemden sonra ya `fleet-smoke.sh` çalıştırılmalı ya da doğrudan
`systemctl restart fleet-agent` yapılmalı.

İlgili: [[RESUME-kaldigimiz-yer-2026-08-12]] · [[yayin-watchdog-connecting-olu-kilit-2026-08-04]]
