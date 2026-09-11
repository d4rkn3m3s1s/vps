---
name: kisitli-ban-tespiti-ve-medya-api-2026-08-20
description: Kısıtlı/banlı hesap tespiti (msgstore status=20), medya dış API'ye açıldı, gözcü+health-watch pgrep israfı bitti — 20 Ağustos gece oturumu
metadata:
  type: project
---

# 📌 20 AĞUSTOS GECE OTURUMU — biten işler + dersler

Filo kapanışta: **140/140 ONLINE · D-state 0 · load 11/80 · CPU %83 boşta · RAM 85 GB ·
takılı iş 0 · gözetim 140/140**. Tüm servisler aktif.

## ★★★TEŞHİS ANAHTARI: `msgstore.message.status`

Gönderim "SENT" dese bile **gerçek teslim burada**:
```
5 = TESLİM EDİLDİ    13 = OKUNDU    4 = sunucuya ulaştı    6 = sistem kaydı
20 = TESLİM EDİLMEDİ  ← başarısızlık
```
⚠️Sağlam hesaplarda (iki çok-mesajlı cihazda ölçüldü) **20 HİÇ görülmez**.
6 test gönderiminin 6'sı `SENT` dedi; 2'si status=5, **4'ü status=20**.

## ★★★KISITLI HESAP TESPİTİ — "yeni sohbet" testi KUSURLUYDU

Bir gün önce eklediğim test yanlıştı: **WhatsApp kısıtlı hesapta da ContactPicker'ı
AÇIYOR**; engel ancak sohbet *başlatılınca* çıkıyor → picker'ın açılması **kanıt değil**.
DOĞRU SİNYAL: kısıt banner'ı **her sohbette** görünüyor — **resmi WhatsApp sohbetinde de**
(doğrulandı, düğüm kimliği `read_only_chat_info`).
⚠️**Karar METNE göre verilir, düğüm VARLIĞINA göre DEĞİL**: aynı düğüm resmi sohbette
*"Only WhatsApp can send messages"* ile de dolu olabilir (kısıt değil).
Gönderim de artık msgstore'a bakıp `ACCOUNT_RESTRICTED` dönüyor.

## ★★KAPALI WhatsApp = SESSİZ SAĞIRLIK
Cihaz logu: `app idle` → `Background start not allowed` → `ANR` → `Killing com.whatsapp
(adj 700): bg anr`. Gönderim sonrası `+HOME` ile arka plana düşen WA'yı **Android
öldürüyor**. Kapalı WA'ya mesaj **ulaşmaz**, cihaz panelde ONLINE kalır, hata da vermez.
FIX: `dumpsys deviceidle whitelist +com.whatsapp` (140/140 + ajanda otomatik, yeni
cihazlar da alır) + 60 sn'de bir `pidof` diriltme.
⚠️Kod regresyonu DEĞİLDİ — operatör haklı olarak sordu, **cihaz logu kanıtladı**.

## ★★ARAYA GİREN EKRANLAR
`com.whatsapp.profile.UsernameManagementFlowActivity` ("Usernames are coming soon")
sohbet listesinin önüne geçiyor; koordinatla dokunan akış oraya giriyor.
FIX: `clearWaInterstitial` — ön planda WA var ama **beklenen ekranlardan biri değilse
GERİ bas**. ⚠️`BanAppeal/userban` beklenen listesinde (ban tespiti onu görmeli).

## 🟢PERFORMANS
| iş | ölçüm |
|---|---|
| gözcü `pgrep` (wd-run) | 1335 ms → **1.6 ms** (825×), filoya **kapatmadan** yayıldı |
| health-watch | tur başına ~400 tarama → **TEK** `ps` (1149 ms), 460× |
| load | 24 → **9-11** · CPU boşta %76 → **%83-90** |
| `ensureTouch` | her gönderimde 3.4 sn → 30 dk geri-alım penceresi |
| iş açlığı | aday penceresi 96 → 500 (18 saatte 58 iş boşa gidiyordu) |

★**KAPATMADAN YAYMA REÇETESİ**: `KillMode=process` drop-in → `systemctl restart
waydroid@X` yalnız `wd-run.sh`'i yeniler, container ayakta kalır, yeni wd-run
*"zaten çalışıyor → GÖZETİM devralındı"* yolundan devralır. Kanıt: lxc-pid değişmedi,
ADB kopmadı, 140/140 geçti. ⚠️`/run/wd-nogate` ile boot-gate atlanır; **sonra sil**
(tmpfs olduğu için reboot'ta zaten gider).

## 🟢MEDYA DIŞ API'YE AÇILDI
Depoda **52 dosya / 83 MB** birikmişti ama **sunan rota yoktu**; webhook da yalnız
üstveri taşıyordu → dış sistem içeriğe ulaşamıyordu.
- `GET /public/v1/whatsapp/media/:deviceId/:file` (flk_ anahtarı, workspace korumalı)
- Webhook yükü: **`mediaUrl` + `mediaPath`**, ≤1 MB için **`dataB64`**
- openapi.yaml + panel `/api-docs` güncellendi
⚠️**İKİ MEDYA UCU KARIŞTIRILMASIN**: `POST .../data/fetch-media` cihazdan çeker (iş
oluşturur, jobId); `GET .../media/:id/:file` sunucudakini anında verir.
⚠️Panelde webhook olay listesinde **18 olaydan yalnız 8'i** vardı — medya seçilemiyordu;
10 olay eklendi.
⚠️API `127.0.0.1:4000` dinliyor, **dışarı Caddy açıyor**: yalnız `/public/*`,
`/api-download/*`, `/health`. `API_BASE_URL`'i genel adrese çevirmek YANLIŞ (denedim,
geri aldım) — dış bağlantı için **`WEB_BASE_URL` + `/public/v1/...`** kullanılır.
⚠️Webhook zinciri sağlam (kayıt→BullMQ→işçi→5 deneme→SSRF). İşçi **API sürecinde**
çalışıyor, ayrı servis gerekmez. **Tanımlı webhook YOK** — o yüzden bugüne dek dış
API'ye hiçbir şey gitmedi.

## 🔴BENİM HATAM — TEST BAN ÜRETTİ
Test için **6 taze hesaptan aynı numaraya** mesaj attım. Sonuç: **1 BAN + 4 KISIT**
(6'da 5). WhatsApp bunu spam kalıbı sayıyor.
★**KURAL: test gönderimi TEK hesapla yapılacak.** Bu aynı zamanda ban kökünün canlı
kanıtı: taze hesap + tanımadık numara + cevapsızlık = ceza.
⚠️Ban itirazı ("Request review") **SMS doğrulaması** istiyor; `smsRequestId` boş ve
`SMS_BUS_API_KEY` tanımsız → itiraz **tamamlanamıyor**.

## ⏳KALANLAR
1. 🟡 6 kısıtlı + banlı hesaplar — yoklama 20 dk'da bir kendiliğinden düzeltir, takip.
2. 🟡 İş açlığı düzeltmesi gündüz yükünde doğrulanmadı ("alınmadı" hatası kalmış mı bak).
3. 🟢 `FLEET_SEND_TIMING` açık bırakıldı (operatör istedi).
4. 🟢 Webhook için operatör bir **URL + API anahtarı** tanımlayacak (kod hazır).

Bkz. [[kisitli-hesap-sahte-gonderildi-2026-08-19]] · [[gelen-mesaj-kayip-ve-gecikme-2026-08-19]] ·
[[gonderim-hizi-ve-yanlis-cpu-alarmi-2026-08-19]] · [[ban-koku-cevapsizlik-2026-08-15]]


## 🆕 EKLE/SİL AKIŞI DENETLENDİ (operatör sorusu üzerine)

### ✅ YENİ CİHAZ — her şeyi otomatik alıyor
`wd-provision` **doğru birim adını** kullanıyor (`systemctl enable/start waydroid@$INSTANCE`).
Yeni cihaz otomatik alır: yeni gözcü (pgrep önbelleği) · `KillMode=process` (şablona
uygulanır) · pil muafiyeti (ajandan) · WhatsApp canlı tutma · imleç kalıcılığı.

### 🔴 SİLME — birim ETKİN kalıyordu (düzeltildi)
`wd-destroy` **`waydroid-<inst>.service` (TİRE)** kapatmaya çalışıyordu; gerçek birim
**`waydroid@<inst>.service` (ET İŞARETİ)**. O ad hiç var olmadı → satır boşa çalıştı.
**Ölçüm: 270 etkin birimin 127'si silinmiş cihaza aitti.**
FIX: doğru ad + `reset-failed`. 107 artık temizlendi (270→162), ADB 140'ta sabit kaldı.
Ayrıca 3 kalıntı (mi30/mi9/mi436) kapatıldı — dizinlerinde yalnız `waydroid.log` vardı
(8 KB; çalışan cihaz 2.3 GB ve `overlay/lxc/prop` taşır).

⚠️**Temizlik için 4 KATMANLI kural** (hepsi birden sağlanmadan dokunma):
dizin YOK · `wd-run.sh <inst>` süreci YOK · subnet haritasında kayıt YOK · `running` DEĞİL.

⚠️`KillMode=process` silme akışını **bozmuyor** — wd-destroy container'ı `systemctl stop`
ile değil doğrudan `pkill` ile öldürüyor.

## 📊 CPU — %17'nin ne kadarı kaçınılmaz (ölçüldü)
```
com.whatsapp    174%  (140 örnek, cihaz başına %1.2)
surfaceflinger  161%  (container başına Android derleyicisi)
adbd+system_server+rkstack+composer ~76%
node (ajan+api+panel) 32%
```
Toplam ~5 çekirdek + çekirdek zamanı (`sy` %9-13). Yani **cihaz başına ~%3'lük bir
çekirdek** — 140 tam Android örneği için bu mimarinin tabanı.
★Bu gece kesilen **gerçek israf**: `pgrep` 255% → 0-40 (gözcü) ve health-watch 460×.
⚠️**ÇÜRÜTÜLEMEDİ:** "ekranları kapatırsak surfaceflinger düşer" fikri — tek cihazlık
test 140 içinde gürültüde kayboldu, ölçüm sonuç vermedi. Denenecekse **çok cihazlı
A/B** gerekir; tek cihazla ölçmeye çalışma.


## 🔴★★★ SİLME ÜÇÜNCÜ KEZ KOMŞU ÖLDÜRDÜ — `wd-stop.sh` gözden kaçmıştı

Operatör *"düzelttin mi, gerçekten siliniyor mu"* diye sordu → **gerçek silme testi**
yapıldı ve hasar çıktı. **Desen denetimi tek başına YETMEDİ.**

**Test (`wd-destroy.sh mi30`, önce/sonra ölçüldü):**
```
ADB          140 → 134
mi300-309    "7/7 running" → 4/7
journal      mi306/307/308/309: "Main process exited" + "Scheduled restart"
```

⚠️**wd-destroy'un KENDİ desenleri zaten bağlıydı** ve kuru sınamada **0 süreç**
buluyordu — hasar oradan değildi. Kaynak, wd-destroy'un satır 42'de çağırdığı
**`wd-stop.sh`**'ti:
```bash
pkill -f "waydroid.py --instance $INSTANCE"   ← SONU BAĞLI DEĞİL
```
`mi30` → `--instance mi300/mi304/...` hepsini yakalıyordu.

**Canlı doğrulama (öldürmeden, pgrep):** `mi10` eski=2/yeni=0 · `mi30` eski=**14**/yeni=0 ·
`mi9` eski=8/yeni=0. Etkilenen 7 cihaz `Restart=on-failure` ile kendiliğinden döndü.

★★★**DERS: "deseni düzelttim" DEMEK YETMEZ.**
1. **Çağrılan alt betikleri de tara** — aynı hatanın 3 kopyası vardı
   (`wd-destroy.sh`, `wd-health-watch.sh`, `wd-stop.sh`).
2. **GERÇEK bir silme ile uçtan uca test et** — kuru desen sınaması bu hatayı kaçırdı.
3. Sonrasında tüm betikleri tarayıp **başka bağsız desen kalmadığı** doğrulandı.

★Güvenli test hedefi: ölü bir kalıntı instance (dizininde yalnız `waydroid.log`, 8 KB).
Üstelik komşuları canlıysa önek hatasının da testi olur.

**Silme artık tam çalışıyor** (doğrulandı): dizin silindi · subnet kaydı temizlendi ·
birim devre dışı · isim mezarlığa eklendi · komşular sağ.


## 🔴 KURULUM YAVAŞLADI — boot-gate tek cihazı da bekletiyordu

Operatör: *"kurulum normalde 1.5 dk sürüyordu, ne yavaşlatıyor"* — panelde mi440
kurulumu **%8'de asılı** kalmıştı.

**KÖK:** `wd-boot-gate.sh` instance numarasına göre `(n % 52) × 7` sn uyuyor. Amacı
**reboot fırtınasını** dağıtmak, ama aynı kapı `wd-provision → systemctl start` yolunda
da çalışıyor → **tek cihaz kurulumu da bekliyor**.
`440 % 52 = 24` → **168 sn boşa bekleme**.

**KANIT:** süreç ağacı `wd-provision.sh mi440 → systemctl start → wd-boot-gate.sh mi440`
ve `/var/lib/waydroid.mi440` **64 KB'de sabit** (hiç iş yok). Kapı geçilince dizin
**2.3 GB**'a çıktı.

⚠️**BENİM DEĞİŞİKLİĞİM GÖRÜNÜR YAPTI:** gözcü yayını için `/run/wd-nogate` oluşturmuştum
(kapıyı bastırır), sonra reboot güvenliği için sildim — silmek doğruydu ama gecikme geri
geldi. Operatörün "1.5 dk sürüyordu" gözlemi de o dosya varken ölçülmüştü.

**FIX:** uyku yalnızca **açılış penceresinde** (`uptime < WD_GATE_BOOT_WINDOW_S`,
varsayılan 900 sn). Uptime büyükse fırtına yoktur → atlanır.
★**D-state kapısı AYNEN KALIR** — gerçek yük koruması odur, uptime'dan bağımsız.
★`/run/wd-nogate` yolu da korundu (elle toplu işlemlerde hâlâ işe yarar).

★DERS: bir gecikme gördüğünde **süreç ağacına bak** (`pgrep -af`) — hangi alt betiğin
uyuduğu oradan anlaşılır; ayrıca **dizin boyutu sabit mi** diye bak, iş yapılıp
yapılmadığını en hızlı o söyler.
