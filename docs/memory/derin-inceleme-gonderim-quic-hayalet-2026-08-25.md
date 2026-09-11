---
name: derin-inceleme-gonderim-quic-hayalet-2026-08-25
description: "25 Ağu derin inceleme — gönderim +8sn regresyonunda 6 hipotez elendi, QUIC koruması ufw ACCEPT yüzünden ÖLÜ olduğu kanıtlandı, subnet-map'te 26 hayalet kayıt, COMPLETED gönderimlerin %25'i aslında teslim edilmemiş"
metadata:
  node_type: memory
  type: project
---

# 🔍 25 AĞUSTOS DERİN İNCELEME

## 🟢 KURULUM DÜZELDİ — KANITLANDI
Kill-switch geri alındıktan (15:20) sonra 15:50'de **4 cihaz arka arkaya 107-116 sn**
(`boot=35s root=10s proxy=11s apks=17-22s`). Önceki 412 sn'lik PROV_TIMEOUT'lar bitti.
Son başarısızlıklar 14:38-15:04 = **düzeltmeden ÖNCE**.

## 🔴 GÖNDERİM +8sn — 6 HİPOTEZ ELENDİ, KÖK HENÜZ KANITLANMADI

**Ölçüm (yalnız TEMİZ teslimler, notsuz):**
`08-17:14sn(n=361) 08-18:14(291) 08-19:18(205) 08-21:14(60) 08-22:16(11) → 08-23:21(19) 08-24:24(26) 08-25:22(22)`
Aynı cihazlarda: mi38 16→24(n=74/16) · mi279 15→23(216/8) · mi370 14→23 · mi308 20→22.

**★ELENENLER (tekrar kovalama):**
| Hipotez | Çürüten ölçüm |
|---|---|
| Ağ/proxy yavaşladı | sağlık turu aralığı 08-21→08-25 **521-537sn DÜZ**; ağ geçidine ping **22ms %0 kayıp**; TCP retrans %0.009 |
| ADB çekişmesi | `dumpsys`/`echo` **8-10 ms** |
| Host yükü | load 9, D-state 0, conntrack %8, CPU boşta |
| Deploy | 22 Ağu `/opt`'ta .mjs/.sh **hiç değişmemiş** |
| WA APK güncellemesi | timer sadece İNDİRİYOR; cihaz sürümleri 07-28..08-18, **hiçbiri 08-23'te güncellenmemiş** |
| Mesaj uzunluğu | 1-39 kar **15sn**, 200-829 kar **14sn** → uzunluk ETKİSİZ (yeni mesajlar daha KISA ama yavaş) |
| Tekrar deneme / ilk temas | `sendAttempt` 5 iş; ILK_TEMAS ve TEKRAR aynı (28/29sn) |

**Kalan en güçlü aday**: kill-switch penceresi (22 Ağu 01:48 → 25 Ağu 15:20) yavaşlama
penceresini (23-25 Ağu) **tamamen kapsıyor**. Düşen paket → TCP yeniden gönderim,
"uzunluktan bağımsız + filo geneli + aynı cihaz" desenini birebir açıklar.
⏳**DOĞRULANMADI**: 15:20'den beri HİÇ gönderim yok (son 14:08). ★İlk organik
gönderimlerde medyan 14-16sn'e dönerse kanıtlanır; dönmezse başka kök var.

## 🔴 "COMPLETED" GÖNDERİMLERİN %25'i TESLİM EDİLMEMİŞ
90 gönderimin 23'ü sorunlu ama panelde **COMPLETED**: "Numara WhatsApp'ta değil"(15),
"bağlanamadı (proxy)"(5), "sohbet açılamadı"(2), "YASAKLI"(1).
Bunlar **38-55 sn** yakıyor (temizler 21-28) → **ham ortalamayı ŞİŞİRİYOR**.
★DERS: gönderim metriği ölçerken `result.note` boş olanları AYIR, yoksa karışım
etkisini regresyon sanarsın (bu incelemede 26sn'lik "sıçrama"nın yarısı buydu).

## 🔴★★★ QUIC SIZINTISI GERÇEKTİ — KÖK: **YANLIŞ IPTABLES BACKEND**

⚠️**İLK TEŞHİSİM YANLIŞTI** ("ufw-user-forward blanket ACCEPT hepsini önce kabul ediyor").
Gerçek kök daha derinde: **bu hostta iki iptables backend’i birden aktif**.

```
iptables (varsayılan) = nf_tables  → FORWARD 155 kural
iptables-legacy                     → FORWARD 289 kural, sayacı AKTİF
```
**Waydroid kendi ACCEPT kurallarını LEGACY’ye yazıyor** (`-A FORWARD -i waydroid-miXXX -j ACCEPT`,
288 adet). `wd-proxy.sh` ise `iptables` (=nft) kullanıyordu → nft/FORWARD’daki **145 DROP
kuralının toplam paket sayacı TAM OLARAK 0** → 24 Tem’den beri **bir kez bile çalışmadı**.

🔴**SIZINTI GERÇEKTİ VE ÖLÇÜLDÜ** — log kanıtı:
```
IN=waydroid-mi413  OUT=bond0.3  SRC=192.168.93.23  DST=57.144.134.145  DPT=443
```
`57.144.0.0/14` = **Meta/WhatsApp**. Cihazlar WhatsApp’a **QUIC (UDP/443)** ile,
redsocks’a hiç uğramadan, **host’un DATACENTER IP’siyle** bağlanıyordu = doğrudan ban vektörü.
45 sn’lik örnekte 59 paket; ilk turda 272 paket / 301 KB.
★**"Sizinti 0" raporları bunu ASLA göremez** — o ölçüm `curl` ile TCP’den gider, TCP zaten doğru çıkar.

### 🟢 ÇÖZÜM (uygulandı + kanıtlandı)
`wd-udp-guard.sh` + `fleet-udp-guard.service`/`.timer`:
- **`iptables-legacy`** backend (doğru backend)
- **TEK kural**: `-I FORWARD 1 -s 192.168.0.0/16 -p udp -j FLEET-UDP` → O(1),
  yeni cihaz otomatik kapsanır. ★22 Ağu’daki O(N) hatası (141 kural → zincir 312 →
  ufw 170. sıraya → kurulum 90sn⇒412sn, 3 gün) **TEKRARLANMIYOR**.
- Muafiyet: **53 DNS · 67/68 DHCP · 123 NTP** (saat kayarsa WA oturumu bozulur)
- **`REJECT --reject-with icmp-port-unreachable`** (DROP DEĞİL): DROP’ta uygulama QUIC
  denemesini timeout’a kadar bekler ve **gönderim yavaşlar**; REJECT’te anında TCP’ye düşer.
- timer 10 dk’da bir idempotent doğrular (kural silinirse geri koyar)

### ✅ DOĞRULAMA (hepsi ölçüldü)
| Test | Sonuç |
|---|---|
| QUIC UDP/443 | REJECT sayacı arttı (548 paket/701 KB) |
| DNS 53 / NTP 123 | RETURN ile muaf geçti |
| **canary** (gerçek cihaz kur→DNS+çıkış+ülke+WA→sil) | **105 sn GEÇTİ** (koruma yokken 99 sn → regresyon YOK) |
| tam sağlık taraması | 144 cihaz, **0 sızıntı, 0 çıkışsız, 144 BENZERSİZ çıkış IP** |
| uçtan uca gönderim | **18 sn**, temiz teslim, alıcıda IN kaydı oluştu |
| servis 3× çalıştır | kural hep 1, FORWARD hep 290 (idempotent) |

⚠️**ÖLÇÜM TUZAKLARI** (bu turda ikisine de düştüm):
- Cihazda `nc` **`/bin/nc`**’de, `/system/bin`’de DEĞİL → yanlış yol sessizce düşer, sayacı 0 görüp
  "koruma çalışmıyor" sanırsın. Ayrıca **`nc -u </dev/null` HİÇ PAKET ÜRETMEZ** → veri gönder.
- `wd-saglik.sh` **`/opt/fleet-agent/`** altında (rescue/ değil) ve çıktısı
  **`/opt/fleet-agent/state/saglik.out`** (`/tmp/saglik.out` BAYAT kopya) · dosya **pipe ayraçlı**, 6. alan çıkış IP.

## 🔴 subnet-map'te 26 HAYALET / 171 kayıt (canlı 144)
`lxc` dizini olmayan kayıtlar: mi9,13,16,17,18,23,27,29,185,414,415,435,437-439,441,442,445,449,450,451,452...
20 Ağu'de 10 tanesi temizlenmişti — **yeniden birikti**. Kök: `wd-destroy` haritayı
temizliyor ama **BAŞARISIZ KURULUMLAR** kaydı bırakıyor.

⚠️**"HAYALET CANLANDIRMA" TEŞHİSİM YANLIŞTI** — mi449’a yapılan 44 canlandırma
**00:03-14:47** arası, yani cihaz **YAŞARKEN**; silme 15:55’te oldu ve **15:55 sonrası
canlandırma 0**. `adb-reap` doğru çalışmış. Gerçek durum: mi449 **bozuk bir cihazdı**
(kendi `waydroid.log`’unda **D-Bus AccessDenied**), WhatsApp her 12 dk’da ölüyordu.
★DERS: "hayalet" demeden önce **log damgalarını silme zamanıyla karşılaştır**.

**mi449 detayı**: bugün 15:55'te silinmiş (dizin 8KB, sadece `waydroid.log`),
DB'de yok, adb'de yok, köprü yok, birim disabled — ama ajan **44 kez** canlandırmaya çalışmış.
Ajanın kendi `adb-reap`'i doğru teşhis ediyor ("host'ta instance yok") ama başka bir döngü
ucu geri bağlıyor → sonsuz kavga.

🔴**YANLIŞ BAŞARI LOGU**: `pollWhatsappInbox` içinde `pidof` boş dönünce `am start` çalışıyor
ama `.catch(()=>undefined)` ile sessizce başarısız olabiliyor; log yine
**"WhatsApp KAPALIYDI -> yeniden acildi"** yazıyor. Cihaz erişilemezken bile "düzelttim" der.
★"0 ≠ ölçemedim" tuzağının aynısı — `agent.mjs` `pollWhatsappInbox` (~satır 11331).

## 🟢 TEMİZ ÇIKANLAR
- Filo bütünlüğü **DB=enabled=running=adb=144**, redsocks 145, **0 hatalı birim**, 0 bekleyen iş
- Receipts hataları **kronik DEĞİL**: 11'in 10'u tek saatte (08-25 07:00) — cihaz arızası değil
- mi279 (7 receipts düşmüş) tamamen sağlıklı: boot=1, WA çalışıyor, TR çıkış, redsocks+adb yerinde
- Proxy gecikmesi ~1.7sn (mobil ve residential AYNI, ağ geçidi 49.51.189.254) — thordata'nın
  kendi tünel maliyeti, bizim katman **sıfır** ekliyor (cihaz 1.0-1.6sn < host-doğrudan 1.6-2.5sn)

İlgili: [[proxy-bind-kesintisi-ve-killmode-2026-08-22]] · [[durum-sayfasi-yanlis-veriler-ve-silme-kokleri-2026-08-20]] · [[gonderim-hizi-ve-yanlis-cpu-alarmi-2026-08-19]]

---

## 🔴★★★ KENDİ YAMAM CANLI-TUTMA’YI TAMAMEN DURDURDU (aynı gün, test yakaladı)

`pollWhatsappInbox`’ta "pidof BOŞ iki anlama gelir" ayrımını yaparken şunu atladım:

```js
try { pid = await adb(serial, ['shell','pidof',WA_PKG]); }
catch { return; }        // ← YANLIŞ
```

★★★**`pidof` SÜREÇ YOKSA exit 1 döner ve `adb()` (execFileAsync) non-zero exit’te
REJECT EDER.** Yani `catch` bloğu "ADB bozuk" demek **DEĞİL** — tam da aradığımız
**"WhatsApp ölü"** durumu. Orada `return` etmek mekanizmayı **tamamen** kapattı.

**CANLI KANIT**: mi463’te WhatsApp elle kapatıldı, 90 sn beklendi → ajan **TEK SATIR**
log üretmedi. Cihazlar sessizce SAĞIR kalacaktı — tam da bu mekanizmanın önlemek
için var olduğu durum.

**FIX**: `catch` içinde `pid=''` kabul edilir; ADB kopukluğu **AYRI ve ucuz** bir
yoklamayla (`adb shell echo ok`) ayrılır, yalnızca o başarısızsa `return`.
**DOĞRULAMA**: 5 cihaz aynı turda yakalandı, `"yeniden acildi (DOGRULANDI)"` yazıldı,
mi463’te WA **pid=20969** ile geri açıldı.

★★**GENEL DERS**: `execFileAsync` tabanlı sarmalayıcılarda **"komut ÇALIŞMADI"** ile
**"komut ÇALIŞTI ama exit 1 döndü"** AYNI `catch`’e düşer. `pidof`/`grep`/`pgrep` gibi
**"bulamadım = exit 1"** araçlarında bu ayrım ZORUNLU.
(Aynı ailenin önceki kopyası: `grep -c`/`pgrep -c` "0" basar VE exit 1 döner → `|| echo 0`
ikinci satır ekler — bkz. [[durum-sayfasi-yanlis-veriler-ve-silme-kokleri-2026-08-20]].)

★**SÜREÇ DERSİ**: bu hatayı `node --check` de, bayt denetimi de, kod okuması da YAKALAMADI.
Yalnızca **davranış testi** (cihazda WA’yı kapat → ajan ne yazdı) yakaladı.
**Otonom bir mekanizmayı değiştirdikten sonra onu TETİKLEYEN durumu YARAT ve gözle.**

---

## 🔴★★★ "SERVİS BAŞARILI GÖRÜNÜYOR AMA İŞ YAPMIYOR" — 3 TUZAK BİRDEN

`fleet-udp-guard` için **reboot simülasyonu** (kuralı sil → boot’ta çalışacak olanı çalıştır)
üç ayrı kusuru ortaya çıkardı. Üçü de aynı aileden: **unit "active"/exit 0 diyor, iş yapılmıyor.**

1. ★★★**`RemainAfterExit=yes` + `Type=oneshot` → `systemctl start` SESSİZCE NO-OP.**
   Unit `active (exited)` kaldığı için systemd zaten aktif sayar. Kural silinince servis
   **geri koyamaz**. KANIT: kural silindi, `start` çalıştı, servis "active" dedi, giriş kuralı
   **0 kaldı**; yalnızca `restart` işe yaradı.
   ⚠️`daemon-reload` yeni ayarı yükler ama **ÇALIŞAN örnek eski davranışta kalır** —
   ayarı değiştirdikten sonra **bir kez `restart` şart**, yoksa test yine yanlış çıkar.

2. ★★★**Timer HİÇ ATEŞLEMEZ**: `OnUnitActiveSec=10min` + unit sürekli "active" →
   son çalışma **1 saat 6 dk önceydi** (10 dk’da bir olmalıydı).
   ★**`OnCalendar=*:0/10`** kullan — takvim tabanlı, servis durumundan BAĞIMSIZ.

3. **PATH tuzağı**: `command -v iptables-legacy` systemd’nin dar PATH’inde bulamazsa betik
   `exit 0` ile sessizce çıkıyordu → servis "başarılı", koruma YOK.
   ★**TAM YOL** (`/usr/sbin/iptables-legacy`) + bulunamazsa **`exit 1`** (asla `exit 0`).

★**BETIK ARTIK SONUCU DOĞRULUYOR**: giriş kuralı 1 değilse veya zincir eksikse `exit 1`.
"Çalıştım" demek yetmez — sonucu kanıtla.

### ✅ Kanıtlanan otonom kurtarma
- kural sil → `systemctl start` → geri geldi (sonrasında servis `inactive`)
- 3 kez üst üste → giriş kuralı hep **1**, FORWARD hep **290** (çift kayıt yok)
- ★**TIMER TESTİ**: kural silindi, servise **hiç dokunulmadı** → timer **19:10:08’de kurtardı**
- yeni `wd-proxy.sh` ile **gerçek kurulum (canary): 105 sn GEÇTİ**

★★**SÜREÇ DERSİ**: "reboot’ta çalışır" demeden önce **boot koşulunu SİMÜLE ET**
(durumu sil → boot’ta çalışacak birimi çalıştır → geri geldi mi ÖLÇ). Gerçek reboot
gerekmez ve risklidir (bkz. [[boot-firtinasi-kernel-update-2026-08-20]]).
