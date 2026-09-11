---
name: cihaz-dusme-6-kok-otonom-kurtarma-2026-08-17
description: "Cihazlar surekli dusuyordu/kalkmiyordu — 8 KOK bulundu (en buyugu systemctl start NO-OP + saglam cihazin ZOMBIE sanilmasi). Filo 89->110/110 tam, churn durdu. systemd gozcu eklendi"
metadata: 
  node_type: memory
  type: project
  originSessionId: a9614e2b-33cb-436b-bb65-298d256a8fb6
  modified: 2026-08-17T23:46:19.678Z
---

# 2026-08-17 gece — CIHAZ DUSME KRIZI: 8 KOK, hepsi canli olcumle

**SONUC: filo 110/110 TAM (adb=container=DB), 5+ dk sifir dusme, D-state 0, load 4.**

## ★★★KOK 1 — `systemctl start` NO-OP (en buyuk kok)
Container olunce systemd birimi **`active (exited)`** kaliyor (`RemainAfterExit=yes`).
→ `Restart=on-failure` **HIC tetiklenmiyor** (birim "failed" degil)
→ `systemctl start` **HICBIR SEY YAPMIYOR** (birim zaten active)
★KANIT: 20 kapali cihaza `start` → container **94'te KALDI**; ayni cihazlara
`restart` → **118'e CIKTI**. mi100/mi102/mi105 bu yuzden **4+ SAAT** olu kalmisti.
**FIX:** kurtarmada `start` → **`restart`**.

## ★★★KOK 2 — SAGLAM cihaz "ZOMBIE" sanilip yeniden baslatiliyordu
health-watch'in TEK canlilik olcutu `timeout 12 adb shell 'echo ok'`. 150 cihazlik
turda ADB sunucusu doyunca **timeout** → saglam cihaz "erisilemez" → zombie → restart
→ 2-3 dk boot → panelde "**dustu**" → tekrar → CHURN.
★KANIT: mi308/mi300/mi185 zombie ilan edildigi ANDA: ping OK, port 5555 ACIK,
`sys.boot_completed=1`, `adb shell echo ok` → **"ok"**. Yani TAMAMEN SAGLAMDILAR.
⚠️Ayni tuzak daha once BATCH=25 denemesinde 8 cihaz dusurmustu.
**FIX:** zombie ilanindan ONCE **ADB'den BAGIMSIZ teyit**: TCP 5555 acik mi +
`boot_completed=1` mi → ikisi de olumluysa restart YOK, sadece ADB ucu tazelenir.

## ★★★KOK 3 — BOOT-GRACE COKMUSTU → sonsuz restart dongusu
Grace `pgrep -f "wd-run.sh $inst"` sürecine dayaniyordu; ama o an wd-run **yoktu**
→ `wr_pid` bos → grace blogu **TAMAMEN atlaniyor** → **boot eden** cihaz zombie
ilan edilip yeniden baslatiliyor → boot bir daha basliyor → sonsuz dongu.
★KANIT: mudahalesiz 4 dk izlemede adb **140 → 133 DUSTU**; log'da o an boot eden
mi300/mi306/mi308 zombie ilan edilmisti.
**FIX:** `/run/wd-boot-<inst>` **BOOT DAMGASI** (wd-run basinda yazar, surece bagli
DEGIL) + lxc-start yasi + wd-run sureci → **en tazesi**; grace 150→**300 sn**.

## ★★★KOK 4 — IKI health-watch AYNI ANDA (kullanicinin sezdigi "cakisma")
Tur 7 dk'dan uzun suruyor ama timer 7 dk'da bir tetikliyor; betikte **kilit YOKTU**.
★KANIT: ayni an `pid=534571` (31 dk) + `pid=2102361` (0 dk). Ikisi ayni cihazda
yarisiyor: biri restart ediyor, oteki ADB bulamayip "zombie" deyip tekrar baslatiyor.
**FIX:** `flock` tek-ornek kilidi. ⚠️**KENDI TUZAGIM:** arka plan cocuklari FD 9'u
MIRAS alip kilidi olu birakti → TUM turlar atlandi. Cozum: spawn'larda **`9>&-`**.

## ★★★KOK 5 — LEASE YOLU YANLIS (tek kelime) → hep `.112`'ye dusuyordu
`adb_addr_for` yedek adimi `/var/lib/misc/waydroid-<inst>.leases` okuyordu;
GERCEK dosya **`/var/lib/misc/dnsmasq.waydroid-<inst>.leases`** (`dnsmasq.` oneki EKSIK).
→ adim daima bos → **`.112` fallback** → yanlis adrese baglan → "reconnect basarisiz"
→ ZOMBIE → sonsuz dongu.
★KANIT: `adb connect 192.168.34.112:5555` calisiyordu, cihazin gercek IP'si **.137**'ydi.
**FIX:** yol duzeltildi + **tohum satiri elenir** (sabit MAC `00:16:3e:f9:d3:03`).

## ★★KOK 6 — `.112` VARSAYIMI boot'u olduruyordu (wd-run)
`IP="$_NPFX.112"` SABIT varsayim; DHCP baska adres veriyor → **son 2 saatte 665
DHCPACK'in HEPSI `.112` DISI** → yanlis IP'ye route → `NET_READY ok=0 tries=14`
→ boot yarim → `Terminated`. Lease **tohumlamasi** da ise yaramiyordu cunku tohum
SABIT MAC ile yaziliyor, **fingerprint her cihaza RASTGELE MAC** veriyor.
**FIX:** gercek IP (eth0 → lease → fallback), tohumlama kaldirildi.

## ★★KOK 7 — `load` freni sistem BOSKEN kurtarmayi durduruyordu
`load ≥ cores*0.9 (72)` gorunce erteliyordu; o an **D-state=0, CPU %88 BOSTA, 119GB bos**.
**FIX:** olcut **D-state (`procs_blocked`)**. (Ayni ders wd-boot-gate'te 14 Agu'da
ogrenilmisti, health-watch'ta atlanmis.)

## ★★KOK 8 — "host-wrapper da yok" dalinda HICBIR SEY YAPILMIYORDU
Container tamamen olunce (lxc/bridge/dnsmasq YOK) health-watch sadece **log+bildirim**
yaziyordu. **FIX:** o dalda **otonom `restart`** (D-state kapisi + boot grace +
ardisik-basarisizlik freni ile).

---

## 🆕 SYSTEMD GOZCU (en kalici katman)
`wd-run` sonundaki **`sleep infinity`** yerine **gozcu dongusu**: her 30 sn
`pgrep waydroid.<inst>/lxc`; 2 ardisik kacirma (60 sn) → **`exit 1`**.
→ systemd **FAILED** gorur → `Restart=on-failure` (RestartSec=10) → cihaz ~70 sn'de
**health-watch'a HIC gerek kalmadan** otomatik kalkar.
★CANLI KANIT: container elle oldurudu →
`23:26:45 Failed with result 'exit-code'` → `23:26:55 Scheduled restart job` → NRestarts=1.
⚠️**KAPSAM:** yalnizca **yeniden baslatilan** cihazlarda etkin (olcum: 1/110).
Diger 109 eski `sleep infinity` ile calisiyor → health-watch (7dk) koruyor.
Tam kapsam icin **kademeli yeniden baslatma** gerekir.

## /durum — OTONOM KURTARMA OLCUMU (kullanici istegi)
`/var/lib/wd-health/recovery.log` (`<epoch> <inst> <sn> <yontem>`) + `down-<inst>` damgalari.
Panelde: ortalama/medyan/en kotu kalkis suresi, kurtarma sayisi (reconnect/restart/kendi),
**su an dusuk cihazlar + kac dk'dir dusuk**. Canli ornek: `⏱ mi308: 8497sn sonra geri geldi`.

## ⚠️KENDI HATALARIM (tekrar etmesin)
1. Kurtarma betiginde **veth'leri ELLE sildim** (`ip link delete`) → 5 cihazin
   **katman-2'si bozuldu** (ARP INCOMPLETE, container kendi gateway'ine
   "Network is unreachable"). ★veth'e **ASLA dokunma**; `systemctl stop` + `lxc-stop`
   yeter (kanit: veth silmeden temiz restart → mi300 aninda ping OK).
2. Ekledigim `flock` **olu kilit** birakti (FD mirasi) → tum turlar atlandi → `9>&-`.
3. wd-run canlilik testini `ss ... dst <subnet>/24` ile yazdim → **yanlis pozitif**
   (bayat baglanti sayiyordu) → olu cihaz "calisiyor" sanilip atlandi. Gercek IP+port'a cevrildi.

## OLCUM NOTLARI
- Tur suresi: **85 dk → ~3 dk** (`TAMAM: 110 saglikli, 0 erisilemez`)
- `wd-run` sayisi **firtina DEGIL**: her acik cihaz icin 1 tane normaldir (`sleep infinity`/gozcu)
- SSH'ta `pkill/kill` ile health-watch oldururken **kendi oturumu dusurebilir** (exit 255)
- Heredoc SSH uzerinden **bozuluyor** → python/bash yamalarini **dosya olarak scp** et

Ilgili: [[nokta112-varsayimi-saglam-cihazlari-olduruyordu-2026-08-13]] ·
[[proc-taramasi-systemd-kilidi-2026-08-14]] · [[cpu-alarm-load-yaniltici-2026-08-05]] ·
[[iyilestirmeler-2026-08-15]] · [[wa-gecikme-mesgul-cihaz-ve-bilgi-karti-2026-08-17]]

---

## 🔴 EK: ÖLÜ KİLİT İKİNCİ KEZ VURDU (2026-08-18 00:34) — ve kalıcı çözümü
Eklediğim `flock`, `9>&-` yamasına RAĞMEN yine ölü kaldı: **40+ dakika HİÇ tur
çalışmadı**, panel "Sağlık izleyici durdu" alarmı verdi, otonom kurtarma tamamen durdu.
★KANIT: `süreç: 0` iken her tur `⏭ önceki tur HALA çalışıyor` diyordu (`fuser` de
kilitte canlı süreç göstermiyordu = ölü kilit).
**KALICI FIX:** kilit alınamazsa PES ETME, **gerçeği ölç** — `pgrep -f wd-health-watch.sh`
ile başka tur GERÇEKTEN yaşıyor mu? Yaşıyorsa atla; **yoksa kilidi sil ve DEVAM ET**.
(Aynı yaklaşım `wd-run.sh`'te zaten vardı: "kilide DEĞİL, gerçekten çalışıp
çalışmadığına bak".) → Artık kendini iyileştiriyor.

## 🆕 ELLE WA KISIT KALDIRMA + YENİDEN TARAMA (canlı: 23 hesap toparlandı)
**Boşluk:** agent'ın 20 dk'lık sağlık taraması YALNIZCA kötü durumları bildiriyordu
(`state !== BANNED/RESTRICTED/LOGGED_OUT` → `continue`). Cihaz SAĞLIKLI çıkınca hiçbir
şey bildirilmiyor, damga HİÇ kalkmıyordu. `WHATSAPP_ACCOUNT_HEALTH` job'ı bitince
`ACTIVE` ise `recoverAccountHealth` çağıran mekanizma **zaten vardı** ama o job'ı
**kimse oluşturmuyordu**.
- `POST /whatsapp/health/set` — operatör beyanı (monotonik kuralı + BANNED istisnasını
  bilerek deler → **AUDIT'e yazılır**)
- `POST /whatsapp/health/rescan` — kısıtlı cihazlara health job'ı açar
- Agent artık `ACTIVE` de bildiriyor (+ zod şemasına `ACCOUNT_ACTIVE`)
- Panel: cihaz detayında **"WA kısıtını kaldır"** (önce elle ACTIVE, HEMEN ARDINDAN
  yeniden taratır → yanılırsan sistem damgayı geri koyar) · `/profiles` toplu **"WA Sağlık Tara"**
- ⚠️`BANNED` otomatik iyileşmede **kapsam dışı** (yanlış-pozitif "aktif" gerçek banı gizlemesin)
★SONUÇ: 75 cihaz tarandı → **ACTIVE 30→53, RESTRICTED 71→48**

## 🆕 /canli — CANLI OPERASYON EKRANI
Her HTTP isteği (panel/agent/dış API) + iş akışı anlık. **DB'ye YAZILMAZ** — sabit
boyutlu **bellek halka tamponu** (1000) + mevcut `/ws/devices` kanalına `ops.request`
olayı. Gerekçe: agent saniyede bir yokluyor; o hacim DB'yi şişirirdi (bu projede büyük
tablo API'yi zaten çökertmişti). Gövde/kimlik başlıkları HİÇ saklanmaz.
⚠️**TUZAK:** Express router'a girerken `req.path`'i **KIRPAR**
(`/agent/jobs/next-batch` → `/jobs/next-batch`). Sınıflandırmayı `res.on('finish')`
içinde yapınca TÜM agent trafiği "bilinmiyor" çıktı (83 istek `/agent/...` iken sayaç 0).
→ Yolu **istek BAŞINDA**, `originalUrl`'den yakala.

## ⚠️ PANEL SAYAÇ TUZAĞI
`HATA` kartı yalnızca `ERROR` sayıyordu; panelde **"Durduruldu" = OFFLINE** ve hiçbir
karta girmiyordu → filo 110→89 düştüğünde kartlar hâlâ "HATA 0" gösteriyordu.
Artık `HATA = ERROR + OFFLINE`, **ama** `metadata.provisionStatus === 'PROVISIONING'`
olanlar **İŞLEMDE**'ye alınıp HATA'dan elenir (kurulum sırasında satır OFFLINE olduğu
için yeni açılan cihaz anında "HATA 1" sayılmıştı).

## ⚠️ CSS/TASARIM TUZAKLARI (panelde iki kez ısırdı)
1. **Uydurma sınıf adı**: `status-dot-online/-error/-warn` yazdım — projede gerçek adlar
   **`tone-ok` / `tone-warn` / `tone-bad`** (globals.css). CSS'te karşılığı olmayan sınıf
   **sessizce** renksiz çizilir; nokta görünmez, satır hizası bozulur.
   ★Yeni sınıf yazmadan önce `grep -c` ile GERÇEKTEN var mı bak.
2. **Kolon genişliği `table-layout: fixed` ŞART**: otomatik yerleşimde hücreye
   `max-width:0` verince tarayıcı DİĞER kolonları harf genişliğine sıkıştırır →
   başlıklar **dikey harflere çöker** (S/A/A/T alt alta).
3. Toplu işlem kapsayıcısı `.action-buttons` (`.bulk-row` diye bir şey YOK).

## 📱 MOBİL (site geneli)
- `@media (hover: none)`: dokunmatikte hover YOK → "takılı hover" ve yalnızca hover'da
  beliren kontroller **erişilemez** kalıyordu
- **iOS**: 16px altı input yazısı sayfayı ZORLA yakınlaştırır → tüm form alanları 16px
- Dokunma hedefi **44px** (Apple/Google alt sınırı)
- `/profiles`: sayaçlar 2'li ızgara · toplu işlem + etiket filtresi **yatay kaydırma**

## ✅ DURUM (gün sonu)
Filo **110/110**, D-state 0, tur ~3 dk. **5 commit push edildi** (`dd19d7d`).
⚠️Sunucudaki `wd-health-watch.sh` / `wd-run.sh` / `durum-uret.sh` repoda **BAYATTI**,
commit öncesi sunucudan çekilip senkronlandı — doğrudan sunucuda düzenleme yapınca
**repoya geri almayı unutma**.

## ▶️ SIRADA (yarın)
1. **systemd gözcü kapsamı 1/110** — kademeli restart ile hepsine yayılmalı
   (o zamana kadar health-watch 7 dk'lık turla koruyor)
2. `WHATSAPP_SEND` **15.7 sn** — `send tap + verify` 12-15 sn (kart fix'i sonrası tekrar ölç)
3. `CONNECTION_FAILED` otomatik retry (2 saatte 31 SENT / 4 hata; cihazlar ölçümde sağlıklı)
4. 2 sn'lik inbox tur aralığı **job-yoğun pencerede** doğrulanmalı (BATCH dersi)
5. `/canli` İşler paneli: açılışta son N işi doldurma (şu an yalnızca sayfa açıkken akan işler)

---

## 🔴 2026-08-18 — GÖZCÜNÜN İKİ KUSURU + KİLİDİN ÜÇÜNCÜ KEZ VURMASI

### ★★★KUSUR A — gözcüyü KENDİ erken-çıkışım öldürüyordu
`wd-run` "container zaten çalışıyor → `exit 0`" diyordu. `Type=simple` olduğu için
systemd, **gözcü döngüsünü çalıştıran ESKİ süreci** bununla değiştirip anında
sonlandırıyordu → servis **`active/exited`**, ortada gözcü KALMIYOR.
★KANIT (log sırası): `... + sleep 30` → `systemd: Started` → `wd-run: GERCEKTEN
calisiyor — bu cagri ATLANDI`. Sonra container ölünce kimse fark etmedi
(mi14/mi277/mi290 böyle düştü; üçünde de `WATCHDOG_START` vardı ama servis `exited`).
**FIX:** çıkma — container'ı yeniden KURMADAN **gözetimi devral** (`wd_watchdog_loop`).
⚠️bash'te `goto` YOK → gözcü **fonksiyona** çevrildi, iki yerden çağrılıyor.

### ★★★KUSUR B — gözcü ZOMBIE'yi göremiyordu
Tek ölçüt `pgrep waydroid.<inst>/lxc`. Zombie'de **süreç yaşar, Android ölür**
(mi277/mi290: lxc=VAR, ping=yok, port=kapalı) → pgrep başarılı → gözcü hiçbir şey yapmaz.
**FIX:** sürece EK olarak ADB portu (5555) yoklanır.
⚠️**EŞİK GENİŞ: 6×30sn = 3 DAKİKA** — "sağlam cihazı zombie sanmak" filoyu 140→133
düşürmüştü; anlık ADB doygunluğu tetiklememeli. IP bilinmiyorsa **karar verilmez**.

### ★★★ÖLÜ-KİLİT KORUMASI HİÇ ÇALIŞMIYORDU (3. kez ısırdı)
`_alive=$(pgrep -f 'wd-health-watch\.sh' | grep -v "^$$$")`
→ **`$( )` betiğin KOPYASINI fork'lar**; komut satırı aynı olduğu için pgrep onu BULUR,
ama pid'i `$$`'tan farklıdır → eleme tutmaz → koruma **ASLA** devreye girmez.
★KANIT: 55 dk hiç tur yok; log'da her tur "önceki tur HALA çalışıyor (pid=…)" ve
**pid HER TURDA DEĞİŞİYOR** (278691→496556→710008→…), "OLU KILIT temizlendi" = 0.
**FIX:** pid'i **YAŞINA** göre ele (`ps -o etimes=`): kendi fork'u 0-1 sn, gerçek tur
en az 7 dk. Eşik 20 sn. `$BASHPID` de elenir.
★DERS: `pgrep -f <kendi betiğin>` **kendini ve fork'larını da bulur** — pid karşılaştırması
yetmez, YAŞ/PPID ile ele.

### 📊 GÖZCÜ KAPSAMI (2026-08-18 12:41)
`active/running` (gözcü VAR) **85** · `active/exited` (GÖZETİMSİZ) **17** · diğer **26**.
Gözetimsizleri kapsama almak `systemctl restart` gerektirir (container bounce eder).

## ▶️ BEKLEYEN İŞLER (öncelik sırasıyla)
1. **Gözcü kapsamını yay** — 17 `active/exited` cihaz kademeli restart ile
   (⚠️WA kayıtları sürerken YAPMA; kullanıcı "bitti" diyince)
2. **`WHATSAPP_SEND` 15.7 sn** — kart fix'i sonrası tekrar ölç; `send tap + verify` 12-15 sn
3. **`CONNECTION_FAILED` otomatik retry** (2 saatte 31 SENT / 4 hata; cihazlar sağlıklı)
4. **2 sn'lik inbox tur aralığı** job-yoğun pencerede doğrulanmalı (BATCH dersi)
5. **`/canli` İşler paneli** — açılışta son N iş dolumu (şu an yalnızca akan işler)

## ⚠️ ÇALIŞMA KURALI (kullanıcıdan)
**WA kayıtları sürerken deploy/restart YAPMA.** Cihaz bounce eden her işlem kaydı bozar.
Betik dosyası düzeltmek (servis/cihaz restart'ı olmadan) güvenlidir.

---

## 🟢 2026-08-18 öğleden sonra — İSİM HAVUZU TAVANI KALDIRILDI (filo 128 → 151)

**BELİRTİ:** panel "Tek Tıkla Cihaz Oluştur" → **`No free instance slot on this host`**.

**KÖK:** `provision.service.ts:nextInstanceName` havuzu `mi2..mi399` (398 ad) ile sınırlıydı
ve **silinen cihazların adları `RetiredInstance`'ta KALICI rezerve** kalıyor.
★ÖLÇÜM: **127 canlı + 271 emekli = 398** → havuz TAM DOLU.
Oysa **gerçek kaynaklar bomboştu**: subnet 143/492 · **114 GB boş RAM** · 3227 GB disk.

⚠️**EMEKLİ ADLARI GERİ ALMAK YANLIŞ** (bilinçli koruma): silinen adı yeniden kullanmak,
eski cihazın izlerini (bayat ADB ucu / DHCP lease / ARP kaydı) yeni cihaza bulaştırıp
kurulumu öldürüyordu → [[bayat-adb-ucu-kurulum-oldurur-2026-07-28]].
**FIX:** havuz `NAME_POOL_MAX = 4000` (ad üretmek bedelsiz). Deploy: tsc + build + API restart.
★SONUÇ: kurulumlar açıldı, filo **128 → 151** (sıradaki ad `mi400`).

### ⚠️ GERÇEK TAVANLAR (kodda da not düşüldü — bu döngü SADECE boş AD bulur)
| Sınır | Değer | Şu an |
|---|---|---|
| **RAM (ilk duvar)** | ~233 cihaz | 151 → ~80 pay |
| subnet | 492 | 143 |
| isim havuzu | 4000 | 398 |

## 🔎 İZLEYİCİ (salt-okur, sunucuda bağımsız)
`systemd-run --unit=fleet-izle /bin/bash /tmp/izle.sh` — SSH kopmasından etkilenmez.
Alarm eşikleri: cihaz **4+ düşerse** · **D-state > 40** (load YANILTICI, ona bakma) ·
sağlık izleyici **25+ dk sessiz**. Log: `journalctl -u fleet-izle`.
⚠️DERS: `nohup ... &` SSH üzerinden **güvenilmez** (log dosyası hiç oluşmadı, süreç
sayımı da kendi komut satırını sayıp yanılttı) → uzun süreli iş için **`systemd-run`** kullan.

## ▶️ KALAN İŞLER (2026-08-18 sonu itibarıyla)
1. **Gözcü kapsamı** — 17 cihaz `active/exited` (gözetimsiz). Yeni kurulan 23 cihaz zaten
   yeni kodla açıldı; önce YENİDEN ÖLÇ, kalanları kademeli restart ile kapsama al.
   ⚠️WA kaydı/kurulum sürerken YAPMA.
2. **`WHATSAPP_SEND` 15.7 sn** — "Disappearing messages" kart fix'i sonrası ÖLÇÜLMEDİ.
   En yavaş adımdı `chat opened=false` 27-29sn; kalan `send tap + verify` 12-15 sn. Ölçüm RİSKSİZ.
3. **`CONNECTION_FAILED` otomatik retry** — ~%11 (2 saatte 31 SENT / 4 hata); cihazlar
   ölçümde sağlıklıydı (TR proxy ✓ soket ✓) = geçici kopma. Kod + API restart.
4. **2 sn'lik inbox tur aralığı** — job-yoğun pencerede doğrula (BATCH dersi). Ölçüm RİSKSİZ.
5. **`/canli` İşler paneli** — açılışta son N iş dolumu (şu an yalnızca akan işler).
6. **COMMIT EDİLMEMİŞ**: gözcünün iki kusuru (`wd-run.sh`) · ölü-kilit 3. düzeltmesi
   (`wd-health-watch.sh`) · isim havuzu tavanı (`provision.service.ts`).
   ⚠️Sunucuda düzenlenen betikleri commit ÖNCESİ repoya çekmeyi UNUTMA.

---

## 🟢 2026-08-18 akşam — MEDYA İZNİ + KUYRUK DÜZELTMELERİ (3 commit push)

### ★★★MEDYA OTOMATİK İNDİRME — ROOT YOLU ÇALIŞMIYOR (kesin kanıt)
**Ölçüm:** 150 cihazın **145'inde kapalı** (5 açık · 49 `roaming=0` · **96 anahtar HİÇ YOK**).
- Root ile prefs'e `15` yazıldı → XML sağlam, sahiplik korundu (`10127`), ama
  **WhatsApp açılınca `0`'a GERİ DÖNDÜRDÜ**.
- **UI ile** ayarlanan aynı değer → WA yeniden açıldıktan **sonra da 15 kaldı**.
⚠️Yani `wa-medya-ethernet...` notundaki *"düzgün XML ile root kalıcıdır"* iddiası
**bu anahtar için GEÇERSİZ**; `wa-medya-otomatik-indirme` notundaki *"tek yol UI"* doğru.

**ÇALIŞAN REÇETE** (`deploy/kvm-host/scripts/medya-ac-filo.sh`):
1. `am start -n com.whatsapp/.settings.SettingsDataUsageActivity` (aktivite adı sürümler arası **sabit**)
2. ★**AŞAĞI KAYDIR** — "When roaming" ilk ekranda **görünmüyor** (önceki kodun kaçırdığı adım)
3. satıra dokun → 4 kutulu diyalog (Photos/Audio/Videos/Documents)
4. **sadece işaretsiz** kutulara dokun (işaretliye dokunmak KAPATIR)
5. OK → `force-stop` (prefs FLUSH) → maskeyi oku/doğrula → ★**WhatsApp'ı GERİ BAŞLAT**

### ⚠️ İKİ TUZAK (kendi hatalarım, tekrar etmesin)
1. **`force-stop` sonrası WA kapalı bırakılırsa cihaza MESAJ ULAŞMAZ** (sunucuda
   kuyruklanır) → filo çapında gelen-mesaj gecikmesi. Canlı: **27 cihazda** WA kapalı
   kalmıştı; `wa-baslat.sh` ile toplu düzeltildi. Betik artık her cihazda geri açıyor.
2. **`monkey -p com.whatsapp` bu cihazlarda WA'yı BAŞLATMIYOR** (sessizce döner, süreç
   oluşmaz). Çalışan tek yol: `am start -n com.whatsapp/com.whatsapp.home.ui.HomeActivity`.
3. **İç içe tırnak Android kabuğunda bozuluyor**: `grep -o '..." value="..."'` dosya adı
   döndürüyordu → betik her cihazı "BAŞARISIZ" sandı (oysa değeri yazmıştı).
   → cihazda **yalın grep**, ayrıştırmayı **Linux tarafında** yap.

### 🔧 KUYRUK DÜZELTMELERİ
- **`CONNECTION_FAILED` → otomatik retry**: agent "tekrar denenebilir" diyordu ama kimse
  denemiyordu. Ölçüm: 2 saatte 31 SENT / 4 hata (~%11), cihazlar sağlıklıydı (TR proxy ✓
  soket ✓) = geçici kopma. Reaper-retry deseninin aynısı: `sendAttempt`, 2 tekrar,
  **yayınlar hariç**. ⚠️`return` güvenli — ortak yayınlar (webhook/WS/bildirim) o bloktan ÖNCE.
- **Okuma işi kuyruk sınırı** (asıl kapasite kaybı): `WHATSAPP_RECEIPTS` vb. bilerek
  EXCLUSIVE değil ama **sınırsız kuyruklanabiliyordu**. Canlı: tek cihaza (+905300251841)
  24 saatte **956 iş**; sondakiler **~15 dk** bekleyip zaman aşımına uğradı (154 FAILED,
  hepsi *"kuyrukta beklerken hiç çalıştırılmadı"*) ≈ **38 saat cihaz-zamanı**.
  FIX: `QUEUE_CAPPED_READ_TYPES` + `MAX_PENDING_READ=3` → sınır aşılınca yeni satır
  açılmaz, **mevcut bekleyen iş döndürülür** (okumada güvenli: aynı veri, aynı cevap).
- **`/canli` İşler paneli**: açılışta son 40 iş REST ile doldurulur (önce boş kalıyordu).

### 📊 ÖLÇÜMLER
- **`WHATSAPP_SEND`: 15,7 → 17,7 sn** — kart fix'i `CHAT_NOT_OPENED` hatasını çözdü ama
  **süreyi düşürmedi**. Kalan yavaşlık `send tap + verify` (12-15 sn).
- **Tur süresi hâlâ hızlı**: 151 cihaz / **0,59 sn** (dün 0,69). Gecikme turda DEĞİL.
- ⚠️Gelen mesaj gecikmesi 150-600 sn'ye çıkmıştı — muhtemel sebep **kapalı kalan
  WhatsApp'lar** (yukarıdaki tuzak). Medya işi bitince **yeniden ölçülmeli**.

### ⏳ HÂLÂ BEKLEYEN
1. **Gözcü kapsamı** — 17 cihaz `active/exited` (gözetimsiz), kademeli restart gerek
2. **Gecikme yeniden ölçümü** (medya işi bitince)
3. **`WHATSAPP_SEND` 17,7 sn** — `send tap + verify` adımı
4. Yeni kod yolları (`CONNECTION_FAILED` retry, kuyruk sınırı) **henüz trafikle
   tetiklenmedi** — gerçek gönderim olunca doğrula

**Commit'ler:** `35ade9d` (isim havuzu) · `50bcbe3` (gözcü+kilit) · `d7dce6c` (medya) ·
`20f3489` (kuyruk+retry+/canli). Hepsi push edildi.
