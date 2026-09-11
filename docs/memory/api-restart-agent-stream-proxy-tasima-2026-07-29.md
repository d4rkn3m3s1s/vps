---
name: api-restart-agent-stream-proxy-tasima-2026-07-29
description: "★★API RESTART SONRASI AGENT'I DA RESTART ET (kalıcı fix yapıldı: ping/pong watchdog) — yoksa canlı yayın SESSİZCE ölür. ★★thordata: 'hesap öldü' TEŞHİSİ YANLIŞTI — bozuk olan ÜLKE HAVUZU. residential(5555) country-TR'de 502 verir ama AL/US verir; mobile(9999) TR'yi sorunsuz verir. DOĞRU DAĞILIM: TR→mobile, AL→residential (17/38→38/38). Şifreler: res=<PROXY_PASS>, mob=<PROXY_PASS>."
metadata: 
  node_type: memory
  type: project
  originSessionId: 060eed7a-fef7-42f6-a7d8-158fe471cc89
  modified: 2026-07-29T02:42:18.555Z
---

# 29 Tem 2026 — iki operasyon dersi

## ★★ 1. API restart edince AGENT'I DA RESTART ET

`systemctl restart fleet-api` sonrası agent'ın **stream WS kanalı (`/ws/agent-stream`)
zombie kalır**: soket yarı-açık kalır, `onclose` **hiç tetiklenmez**, dolayısıyla
agent.mjs'teki `setTimeout(connect, 5000)` retry mantığı ÇALIŞMAZ. Canlı yayın
sessizce ölür.

**★TUZAK — sağlıklı görünür:** heartbeat ve job long-poll AYRI HTTP yolundan gider,
onlar hemen toparlanır → `Host.lastSeenAt` günceldir, `systemctl is-active` = active,
filo 38/38 online. Yalnızca stream ölüdür.

**TEŞHİS (en hızlı):** `ls -la /var/log/fleet-agent.log` → **son değişiklik zamanı**
API restart anında donmuşsa agent yaşıyor ama iş görmüyordur. Ayrıca
`grep 'stream channel connected' /var/log/fleet-agent.log | tail` → restart sonrası
kayıt YOKSA kanal kopuk.

**BELİRTİ (panelde):** "Bağlanıyor…" takılır, *"Uzun sürdü — yayın kanalı kopmuş
olabilir"*. API logunda `[stream] viewer accepted` GÖRÜNÜR (panel bağlanıyor) ama
frame gelmez — yani sorun viewer'da değil, agent tarafındadır.

**ANLIK KURTARMA:** `sudo systemctl restart fleet-agent` → `stream channel connected` +
`stream first frame (NNNNN B)` + API'de `Stream agent connected`. ADB uçları etkilenmez.

**✅ KALICI FIX YAPILDI (aynı gün):** agent.mjs `startStreamClient`'a **uygulama
seviyesinde ping/pong + watchdog** eklendi — 30 sn'de bir `agent.ping`, 75 sn pong
gelmezse soketi zorla kapatıp yeniden bağlanır; ayrıca soket CLOSED kalıp retry
kaçarsa watchdog toparlar (`connecting` bayrağı çift soketi engeller). Sunucu tarafı:
`stream.hub.ts` `agent.ping` → `agent.pong` yanıtlar.
**CANLI DOĞRULANDI:** 95 sn boşta soket stabil (gereksiz yeniden bağlanma 0), ve
API restart sonrası agent **6 saniyede kendi kendine** bağlandı — elle restart artık
GEREKMİYOR.

⚠️ `/ws/devices` başarısızlığı AYRI konudur: tokensiz/bayat token = 502 (tasarım
gereği). Tokenlı bağlantı hem API'ye doğrudan hem Caddy üzerinden **101** verir —
altyapı sağlamdır, kullanıcının sayfayı **hard refresh** etmesi yeter.

## 2. thordata iki hesap — ⚠️ İLK TEŞHİS YANLIŞTI, DOĞRUSU AŞAĞIDA

**★★DÜZELTME (aynı gün, kullanıcı kimlik bilgilerini paylaşınca):** "mobile hesap öldü"
teşhisi **YANLIŞTI**. Gerçek: **hesap değil, ÜLKE HAVUZU bozuk.** Doğru tablo:

| Hesap | Port | Şifre | country-TR | country-AL / US | Parametresiz |
|---|---|---|---|---|---|
| `emBoE0o264he` (residential) | 5555 | `<PROXY_PASS>` | ❌ **502** (3/3) | ✅ | ✅ |
| `XRiHAsiywous` (mobile) | 9999 | `<PROXY_PASS>` | ✅ **5/5** | ✅ | ✅ |

502 metni: `Resource IP connection failed. Please try again.`
**`.pr` ve `.eu` endpoint'leri AYNI davranıyor** → endpoint sorunu DEĞİL (28 Tem'in
`.eu→.pr` düzeltmesi yine de geçerli, `.pr`'de kalındı).

⚠️ **28 Tem'de tüm filoyu residential'a taşımak bu yüzden HATAYDI**: 26 TR cihazı, TR
veremeyen hesaba taşındı → ertesi gün WhatsApp erişimi 38/38→17/38 düştü.
**DOĞRU DAĞILIM (29 Tem uygulandı):** TR cihazları → **mobile 9999**, AL cihazları →
**residential 5555**. Sonuç: 17/38 → **38/38**. Yük de iki hesaba bölündüğü için tek-hesap
IP çakışması sorunu da hafifledi.

**DERS:** proxy arızasında önce `-country-XX` parametresini DEĞİŞTİREREK test et —
"hesap ölü" ile "o ülkenin havuzu ölü" bambaşka şeyler ve ikincisi çok daha yaygın.

## ★★★ 2b. `KillMode=control-group` KURTARMALARI SESSİZCE ÖLDÜRÜYORDU (29 Tem)

**En kritik bulgu.** `wd-health-watch.service` bir **oneshot** servis ve systemd
varsayılanı `KillMode=control-group`: servis bitince cgroup'taki **TÜM alt process'ler**
öldürülür. Script kurtarma sırasında `wd-proxy.sh` → `redsocks` başlatıyordu; script
biter bitmez systemd o redsocks'u da öldürüyordu.

**Sonuç:** kurtarma "✓ başarılı" loglanıyor, cihaz KOPUK kalıyordu. Canlı kanıt (mi32):
redsocks logunda tam script bitiminde `redsocks goes down`; port dinlemiyor; elle
çalıştırınca (SSH shell, cgroup dışı) aynı komut sorunsuz.

**FIX:** `/etc/systemd/system/wd-health-watch.service.d/killmode.conf` → `KillMode=process`.
Bu yalnızca yeni eklenen kurtarmayı değil, **zaten var olan "ölü redsocks" kurtarmasını
da** çalışır hâle getirdi — o da aylardır aynı sebepten sessizce başarısız oluyordu.
⚠️ Aynı tuzak, redsocks/daemon başlatan HER oneshot systemd servisi için geçerli.

## 3. Çıkış-ölü kademeli kurtarma (wd-health-watch, 29 Tem)

**Boşluk:** script yalnızca (a) datacenter sızıntısı ve (b) ölü redsocks'u yakalıyordu.
"redsocks ayakta + ağ canlı ama upstream 502" durumunda `? çıkış-IP alınamadı (geçici
olabilir)` deyip GEÇİYORDU. Canlı: 21 cihaz kopukken **"38 sağlıklı"** raporladı.
★Ayrıca sağlık kriteri yanlıştı: çıkış-IP alınabiliyor diye "sağlıklı" sayıyordu — mi32
IP veriyordu ama WhatsApp'a çıkamıyordu.

**Eklendi:** `upstream_ok()` (host'tan ülke+hesap doğrula) · `wa_reachable()` (2 deneme,
2 hedef; tek istek GÜVENİLMEZ — aynı anda google=000 iken whatsapp=200 görüldü) ·
kademeli kurtarma **1) sessid döndür → 2) o ülkeyi VEREN diğer hesaba geç → 3) alarm** ·
filo eşiği (`WD_DEADEXIT_ALERT_MIN`, varsayılan 3) ile TEK özet `PROXY_POOL_DOWN` bildirimi.

⚠️ **`wd-proxy.sh` ARKA ARKAYA İKİ KEZ ÇAĞRILMAZ**: her çağrıda önce mevcut redsocks'u
`pkill` eder (wd-proxy.sh:128); ikinci çağrı birincinin daemon'ını öldürüp yerine
koyamıyor → kalıcı kopukluk. Bu yüzden "başarısızsa tekrar uygula" mantığı KALDIRILDI;
tek uygulama + port doğrulaması, tutmazsa bir sonraki adıma geçilir.

**Test edilirken:** `pkill` mutlaka `sudo` ile (yoksa eski daemon yaşar, arıza hiç
kurulmaz ve test yanlış "başarılı" görünür — bu da yaşandı).

**TAŞIMA (yapıldı):** yedek `/root/redsocks-bak-mobilefix-<ts>`, sonra her
`/etc/redsocks-inst-<inst>.conf` içinde `port 9999→5555` + `XRiHAsiywous→emBoE0o264he`
+ residential parolası; **`country-XX` ve `sessid` AYNEN korunur** (WA ülke-uyumsuzluğu
= ban). Ardından `kill <pid>` + `redsocks -c <conf> &`. Sonuç: 38/38 internet+WA.

⚠️ redsocks systemd ile YÖNETİLMİYOR — her instance ayrı `redsocks -c ...` process'i.
Conf `/etc/` altında (kalıcı) ama process'i elle yeniden başlatmak gerekir.

**★YAN ETKİ — IP çakışması yapısaldır:** 38 cihaz artık TEK hesabın havuzundan
çekiyor → her ölçümde 1-3 çift aynı IP'ye düşüyor. **Sessid rotasyonu kovalamacası
ANLAMSIZ** — her turda farklı çift çakışıyor. Sticky ÇALIŞIYOR (bir cihazda 4/4 aynı
IP) ama %100 değil (başkasında 3/4) ve **yeni session ilk birkaç istekte oturuyor**
(rotasyon sonrası ölçüm yanıltıcı → 2 tur ölç, ilkini at).
**DOĞRU YAKLAŞIM:** kayıt yapmadan HEMEN ÖNCE o cihazın çıkış IP'sini kontrol et,
çakışma varsa sessid döndür. Kalıcı çözüm: mobile hesabı düzelttir (kapasiteyi böler).

## Ölçüm tuzakları (bu oturumda yaşandı)

- Instance dizini `/var/lib/waydroid.mi20` (**NOKTA**), `waydroid-mi20` DEĞİL → yanlış
  "38/38 instance yok" alarmı verdim.
- `http://1.1.1.1` testi tek başına YANILTIR: `tcp=000` çıkan cihazlarda
  `google.com` + `web.whatsapp.com` **200** idi. Sağlık kararını WA/google ile ver.
- `ip-api.com` paralel istekte limitler (38 paralel → 5 cihaz "YOK"). Sıralı +
  `ipinfo.io/ip` daha güvenilir.
- Döngüde `adb` stdin'i yutar → `</dev/null` ŞART (yoksa `while read` erken biter).

İlgili: [[public-api-kategori-mimarisi-2026-07-29]] · [[proxy-eu-pr-endpoint-koku-2026-07-28]] ·
[[proxy-mimari-cok-port-2hesap-2026-07-21]] · [[eth0-heal-otomatik-kurtarma-2026-07-24]]
