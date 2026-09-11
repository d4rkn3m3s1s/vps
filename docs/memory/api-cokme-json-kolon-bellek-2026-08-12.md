---
name: api-cokme-json-kolon-bellek-2026-08-12
description: "🔴★★★ PANELİN İKİ SAYFASI API'Yİ ÇÖKERTİYORDU (SIGABRT/134): /analytics/summary 298 MB, /reports/jobs 410 MB JSON'u belleğe çekiyordu. ★Kök: Job.result kolonu satır başına ~10 KB (dump'lar orada) ve İKİSİNDE DE kullanılmıyordu. ★Statik tarama BULAMAZ — çalışma zamanı testi buldu. ★Yanıltıcı yorumlar: 'ek maliyet yok' + 'capped so it can't OOM' (sınır satır SAYISI, sorun BOYUT)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-12T01:57:53.373Z
---

# İki API çökmesi — JSON kolonu belleğe çekiliyordu

## Belirti
`GET /analytics/summary` ve `GET /reports/jobs` çağrıları **API sürecini öldürüyordu**:
`Aborted (core dumped)`, systemd `status=134` (SIGABRT), otomatik restart.
Yani panelin **/analytics sayfasını açan** ya da **"CSV indir" butonuna basan**
herkes tüm API'yi düşürüyordu. Her ikisi de birebir tekrarlandı.

## Kök neden — aynı hata, iki yerde

**1. analytics.service.ts**
```js
prisma.job.findMany({ select: { status, createdAt, type, result } })
// yorum: "`result` bir JSON kolonu, ek sorgu maliyeti yok"
```
**2. reports.service.ts** (daha sinsi — `select` HİÇ yoktu)
```js
prisma.job.findMany({ where, orderBy: {...}, take: 50_000 })
// yorum: "Capped so a huge range can't OOM the process"
```

⚠️ **İki yorum da yanıltıcıydı:**
- "ek maliyet yok" → tablo küçükken doğruydu, artık değil
- "capped so it can't OOM" → sınır **satır SAYISI** (50.000), sorun **satır BOYUTU**

## ★ CANLI ÖLÇÜM (kesin kanıt)
```
14 gün / tüm iş tipleri : 36.245 satır · result 298 MB · tek satır 2,3 MB'a kadar
30 gün / tüm iş tipleri : 45.500 satır · result 410 MB · payload 12 MB · error 114 kB
```
`Job.result` içinde ekran metinleri ve uiautomator dump'ları saklanıyor →
satır başına ~10 KB. Node bunu JS nesnesine çevirince bellek 3-5 katına çıkıyor.

## ★★ EN ÖNEMLİ NOKTA: `result` HİÇBİRİNDE KULLANILMIYORDU
- reports: CSV satırlarında `result` yok → `select` eklemek **davranışı değiştirmez**
- analytics: yalnızca gönderim oranı için okunuyordu → **DB'de sayılabilir**

## FIX
- `reports`: `select` eklendi (id/type/status/payload/emulatorId/createdAt/finishedAt/error)
- `analytics`: `result`+`type` kaldırıldı; gönderim oranı iki `prisma.job.count()`
  ile DB'de sayılıyor (`result.status IN (SENT,OK,DELIVERED)` JSON-path filtresi)
- Projede `$queryRaw` hiç kullanılmıyordu → yeni desen getirmemek için Prisma'nın
  tip güvenli JSON filtresi tercih edildi

## SONUÇ
```
/analytics/summary : çöküyordu → 200 · 336 ms
/reports/jobs      : çöküyordu → 200 · 1.339 ms · 45.500 satır
```

## ★★★ NASIL BULUNDU — statik tarama BULAMAZDI
"Kalan modülleri salt-okunur tara" turunda **5 uç birden 000 döndü** → API'nin
çöktüğü fark edildi → `status=134` ile teşhis edildi. `tsc` temiz, kod "doğru"
görünüyor; bunu ancak **çalışma zamanı testi** gösterir.

⚠️ **TUZAK**: sıralı test yanıltıcıdır. İlk turda `/audit` ve `/fleet-health` de
"çöktü" göründü; **izole** test edilince (API'nin toparlanması beklenerek) ikisi de
SUÇSUZ çıktı — o 000'lar `/reports/jobs` çökmesinin yan etkisiydi.

## KALICI KORUMA
`fleet-smoke.sh`'a iki kontrol eklendi: çağrı **öncesi/sonrası MainPID** karşılaştırılır;
PID değişirse çökme geri gelmiş demektir ve betik HATA verir.

## KAPSAM TARAMASI (aynı desen başka nerede)
`findMany` + JSON kolonu + `take` YOK → 9 nokta. reports'un diğer sorgusu ölçüldü:
2.613 satır / **392 kB** — güvenli (çünkü `type='WHATSAPP_SEND'` filtresi var).
Kalanlar agent-içi veya dar kapsamlı.

★ GENEL KURAL: **JSON kolonu olan tabloda `select` YAZMAK ZORUNLU.** Tablo bugün
küçük olabilir; `Job` 468 MB'a ulaştığında bu satır sessizce bombaya dönüştü.

İlgili: [[RESUME-kaldigimiz-yer-2026-08-12]] · [[subnet-cakismasi-kurulum-olduruyordu-2026-08-12]]
