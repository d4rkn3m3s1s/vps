---
name: panel-yedekleme-canli-metrik-2026-08-04
description: "🟢★★PANELDEN YEDEK AL+İNDİR (yeni Yedekler bölümü) + Canlı Altyapı kartları GERÇEKTEN canlı. ★★★İNDİRME 404 KÖKÜ:Caddy sadece /ws/*,/public/*,/health'i API'ye iletir→/backups/* PANELE gidiyordu→/api-download/backup'a taşındı. ★whileInView+once:true çubuğu ÖLÜ bırakıyordu. ★Kuyruk Verimi HER ZAMAN %0'dı(payda=tüm zamanların iş sayısı)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b35fb77-30e7-48f7-a51f-ef2ea6daeb6b
  modified: 2026-08-04T01:30:37.437Z
---

# Panelden yedekleme + canlı altyapı metrikleri (4 Ağustos 2026)

## 1. Yedekler bölümü (`/backups`)
Operatör: *"sistemde yedek kaydı açıp yedek bitince indirilebilir yap"*.

**API** — `apps/api/src/modules/backups`, hepsi `requireAdmin`
(yedek TÜM kiracıların verisini + şifreli sırları içerir, workspace'e daraltılamaz):
| uç | iş |
|---|---|
| `GET /backups` | liste + disk doluluğu + çalışan yedeğin durumu |
| `GET /backups/status` | canlı ilerleme (panel 1 sn'de bir yoklar) |
| `POST /backups/run` | başlatır (202; ikinci istek **409**) |
| `POST /backups/:file/link` | 10 dk ömürlü **HMAC imzalı** indirme bağlantısı |
| `GET /api-download/backup` | **asıl indirme** (kimlik jetondan) |
| `DELETE /backups/:file` | arşiv + `.sha256` + açık dizin |

### ★★★ İNDİRME 404 VERİYORDU — Caddy yönlendirmesi
İlk sürümde bağlantı `/backups/download` idi. **Caddy YALNIZCA `/ws/*`,
`/public/*` ve `/health`'i API'ye iletiyor**; geri kalan her şey panele gidiyor.
`/backups/*` panele düşüyordu ve orada **aynı adlı sayfa** olduğu için tarayıcı
404 alıyordu. Kod tamamen doğruydu — istek API'ye hiç ulaşmıyordu.

**FIX:** indirme `/api-download/backup`'a taşındı (panelde karşılığı YOK →
çakışma imkânsız) + Caddyfile'a `@dl path /api-download/*` reverse_proxy
(`flush_interval -1`, akış tamponlanmasın).

> **DERS:** yeni bir **tarayıcı** yolu açarken ters vekilin o ön eki API'ye
> iletip iletmediğini **önce kontrol et**. Kod doğru olsa bile istek API'ye
> hiç ulaşmayabilir. `sudo cat /etc/caddy/Caddyfile`.

### Diğer tasarım kararları
- 901 MB dosya **Next.js proxy'sinden GEÇMEZ**: panel imzalı bağlantı alır,
  tarayıcı doğrudan API'den çeker. `createReadStream` + **Range** desteği.
- Jeton **dosya adını da imzalar** → başka ada geçerli jeton üretilemez;
  `timingSafeEqual` + `basename`/dizin kontrolü (yol kaçışı tek katmana bırakılmadı).
- Aynı anda tek yedek; saklama **son 5** (fazlası otomatik silinir).
- `sudo -n` — parola sorulsaydı süreç sessizce asılı kalırdı.

Betik artık repoda: `deploy/scripts/fleet-backup.sh`.

## 2. "Canlı Altyapı" kartları
Operatör: *"bu kısım sürekli anlık mı canlı mı gerçek veri mi"* → **veri gerçek**
(agent ADB ile `/proc` + `df` okur, 30 sn'de bir gönderir; DB'de cihaz başına
FARKLI değerler: cpu 0.5/1.1/2.5). Ama panel görmüyordu, **iki ayrı sebeple**:

1. Ana sayfa `force-dynamic` **sunucu bileşeni** — veriyi yalnızca sayfa
   açılışında çeker. (30 Tem'de 6 görünüm canlıya çevrilmişti, bu atlanmıştı.)
2. `device.updated` **SADECE ONLINE↔OFFLINE** geçişinde yayınlanıyor
   (30 Tem'in bilinçli kararı). CPU/bellek/disk hiçbir olaya düşmüyordu.

**FIX:** metrik yazımından sonra `device.metrics` yayını — cihaz başına değil,
**host başına TEK özet olay** (48 cihaz için 1 mesaj) → 30 Tem'in kararı bozulmadı.
Panelde `useLiveInfraMetrics`: olay + **30 sn yedek zamanlayıcı** (WS koparsa).
Hata hâlinde eski değerler **korunur** — sıfırlamak "cihazlar boşta" gibi yanlış
izlenim verirdi.

### ★ İki sessiz kusur daha
- **`whileInView` + `viewport={{once:true}}`**: çubuk bir kez dolup **bir daha
  asla** güncellenmiyordu. Veri canlı olsa bile kartlar ölü kalırdı → `animate`.
- **"Kuyruk Verimi" HER ZAMAN %0**: yüzde `(aktif+bekleyen) / TÜM ZAMANLARIN iş
  sayısı` idi; payda on binlerce olduğu için sonuç daima 0 — ölçü hiçbir bilgi
  taşımıyordu. Artık "İş Kuyruğu", 20'lik ölçek + mutlak sayılar.

## 404 sayfası (operatör: "404 sayfası da bozuk")
- `.nf-tag` `inline-flex` idi → cümlenin akışını kırıp kelimeleri alt satıra
  tek tek düşürüyordu → `inline` + `white-space:nowrap`.
- `.nf-deco-heart` `bottom:-18px` ile alt paragrafın **üzerine biniyordu** → sağ üst.

## Doğrulama
`POST /backups/run` → 202 · ikinci istek 409 · aşamalar 1/9→9/9 · **42 sn** ·
indirme **dış IP + Caddy üzerinden 206**, gzip sihirli sayısı doğru, sahte jeton
403 · WS'te `device.metrics` → `{"updated":50}` · `/api/infra-metrics` → 200 ·
her iki app `tsc --noEmit` temiz.

## Bağlantılı
[[RESUME-kaldigimiz-yer-2026-08-04]] · [[sunucu-yedekleme-recetesi-2026-08-04]] ·
[[dashboard-canli-liste-aboneliksiz-2026-07-28]]
