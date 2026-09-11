---
name: durum-sayfasi-yanlis-veriler-ve-silme-kokleri-2026-08-20
description: "/durum sayfasının 4 verisi yanlıştı (payda, mezar taşı, sızıntı ölçümü, tarayıcı önbelleği) + wd-destroy'un disable satırı HİÇ çalışmıyordu (4. kopya) + ajan dns-heal silinmiş cihazı diriltiyordu"
metadata: 
  node_type: memory
  type: project
  originSessionId: a9614e2b-33cb-436b-bb65-298d256a8fb6
  modified: 2026-08-20T17:19:05.047Z
---

**20 Ağustos 2026 akşam oturumu.** Filo 141 → (2 cihaz silindi) → **139/139/139 tam hizalı**
(DB = systemd enabled = running = adb = all_inst.txt), 0 hatalı birim.

## 🔴★★★ SİLME: `disable` satırı HİÇ ÇALIŞMIYORDU — aynı ailenin **4. kopyası**

`wd-destroy.sh`'ta disable bloğunun **tamamı** şunun içindeydi:

```bash
UNIT="/etc/systemd/system/waydroid-$INSTANCE.service"   # TİRE
if [ -f "$UNIT" ]; then
  systemctl disable --now "waydroid@$INSTANCE.service"  # doğru ad, ama...
fi
```

Bu filo **şablon birim** kullanıyor; gerçek etkinleştirme
`/etc/systemd/system/multi-user.target.wants/waydroid@<inst>.service` **symlink'i**.
Tire'li dosya **hiç var olmadı** → koşul daima yanlış → `disable` bir kez bile çalışmadı.

★**DERS**: 20 Ağu'de bu satırın *adı* düzeltilmişti (commit b1577a7) ama ad,
**çalışmayan bir bloğun içindeydi** → düzeltme etkisizdi. **Sadece satırı düzeltme;
o satıra GERÇEKTEN varılıyor mu kanıtla.** FIX: disable artık koşulsuz.

**Kanıt**: mi434 + mi440 silindi (DB kaydı gitti, veri ağacı 8 KB'ye düştü) ama
birimleri ETKİN kaldı → reboot'ta var olmayan cihazları başlatmaya çalışırdı.

## 🔴 İKİNCİ DİRİLTİCİ: ajanın `dnsSelfHealTick`'i

Silinen mi434/mi440 için **16:53 ve 17:03'te çalıştı** ("GERCEK DHCP lease YOK") ve
`wd-run.sh` ile diriltmeye uğraştı. FIX: canlı instance'ın `lxc` dizini VARDIR;
silinmişte yalnız `waydroid.log` kalır → `if (!existsSync('/var/lib/waydroid.<i>/lxc')) continue`.

## 🔴★★★ /durum SAYFASI — 4 VERİSİ YANLIŞTI

| Veri | Kök | Fix |
|---|---|---|
| **141/158** turuncu "bazı cihazlar düşük" | `all_inst.txt` ham `/var/lib/waydroid.*` **dizinlerini** sayıyordu; cihaz silinince dizin KALIYOR (17 artık) | liste artık **enabled birim ∪ ayakta konteyner** |
| **"Şu an düşük: 15"** | `down-*` damgaları silmede HİÇ temizlenmiyordu; 15'inin de hepsi silinmiş cihazdı (9'unun dizini bile yok, 40-67 saatlik) | 3 kapı: sayfada filtre + gözcüde süpürge (32 damga sildi) + `wd-destroy`'da temizlik |
| **"Proxy sızıntısı 0" YEŞİL ama HİÇBİR ŞEY ÖLÇMÜYOR** | `DC_IP` tek `curl` ile ölçülüyordu; reboot fırtınasında düştü ve **kalıcı BOŞ** kaldı → `grep -c "^$"` | 3 kaynak + 30 dk'da yeniden ölçüm + ölçülemezse `0` değil **`?` turuncu** |
| Tarayıcıda **bayat sayfa** | Caddy yalnız ETag/Last-Modified yolluyordu | `Cache-Control: no-store` + `Pragma: no-cache` |

★**DERS**: "0" ile "ölçemedim" AYNI ŞEY DEĞİL. Ölçüm yokken yeşil göstermek yanlış
güven verir — 14 Ağu'de 47 cihaz sızıntılıydı ve panelde görünmemişti.

## 🟢 mi277 + mi290: "çıkış ölü" sanılan şey **yarım açılmış konteynerdi**

Saatlerce 10 dk'da bir sessid döndürüldü, hiç düzelmedi. Kök proxy DEĞİLDİ:
`sys.boot_completed=0` — Android açılmayı bitirmemişti. **adbd erken kalktığı için
adb "device" der**; DHCP tamamlanmaz → `.112` statik yedeğinde kalır → netd resolver
YOK → isim çözülmez → çıkış yok. Host'tan proxy testi ÇALIŞIYORDU (TR IP döndü) —
sorun cihazın kendisindeydi. Yeniden başlatınca ~50 sn'de `boot=1` + gerçek DHCP + TR çıkış.

FIX (gözcü): çıkış yoksa **önce `boot_completed`** (lxc-attach ile, ADRESTEN BAĞIMSIZ —
bayat adb ucundan etkilenmez), yarım açılmışsa konteyneri yeniden başlat. 2 ölçüm
(yanlış pozitif elemek için) + 1 saat soğuma + **silinmiş cihazı diriltmeme koruması**.

⚠️`net.dns1` **158 cihazın hepsinde BOŞ** — modern Android'de netd kullanılır, o prop
doldurulmaz. **DNS göstergesi olarak KULLANMA**; gerçek sinyal çıkış IP'sidir.

## Sayfaya eklenen ölçümler
Sunucu ayakta süresi (beklenmedik reboot görünsün) · disk · artık dizin (sayıma girmez) ·
**çıkışı yok** · **yarım açılmış cihaz ADLARI** (mi277/mi290 saatlerce hiçbir yerde görünmedi).

## Kesinti artığı (yanlış alarm sanılmasın)
10:09-12:44 arası 5 başarısız gönderim ve 6.5 saatlik 1 gelen mesaj **kilitlenme
penceresinden**; mesaj kaybolmadı, imleç kalıcılığı kurtardı. `lxc-net.service` hatası
**zararsız**: Waydroid kendi 141 köprüsünü kullanır, `lxcbr0` yok.

## Değişen dosyalar
`wd-health-watch.sh` · `rescue/wd-inst-liste.sh` · `rescue/durum-uret.sh` ·
`rescue/wd-izle.sh` · `waydroid/wd-destroy.sh` · `agent/agent.mjs` ·
`/etc/caddy/Caddyfile` (sunucu-only, repo'da yok)

⚠️**DEPLOY**: çalışan bash betiğini **yerinde yazma** (`install`/`cp` üzerine) — `.new` +
`mv` (atomik rename) yap, sonra servisi restart et. Ajan hedefi **`/opt/agent.mjs`**.
İlgili: [[cihaz-dusme-6-kok-otonom-kurtarma-2026-08-17]] · [[kisitli-ban-tespiti-ve-medya-api-2026-08-20]] · [[boot-firtinasi-kernel-update-2026-08-20]]

---

## 🔴★★★ REBOOT KENDİ KENDİNE TOPARLAMA — asıl eksik buydu (20 Ağu akşam)

**`wd-boot-toparla.service` DISABLED'dı ve HİÇ çalışmamıştı.** 09:49 reboot'unda filonun
82/141'de kalıp **4.5 saat elle kurtarma** gerektirmesinin sebebi tam olarak bu.
Etkinleştirmeden önce içinde **4 kusur** çıktı:

1. ★★★`dst(){ ps -eo stat | grep -c "^D"; }` — 14 Ağu'de sistemi 3 kez kilitleyen
   **yasaklı `/proc` taraması**, üstelik **boot anında**. → `/proc/stat procs_blocked`.
   (14 Ağu turu zaten `D=154` satırında kesilmişti — kendi taraması yüzünden.)
2. ★★★`systemctl start wd-kademeli` — **öyle bir birim YOK** (`not-found`). Hata
   `2>/dev/null` ile yutuluyor, ardındaki `is-active` döngüsü anında `break` ediyordu →
   "açılmayanları tetikle" adımı **hiç çalışmadı**. → betik doğrudan çağrılıyor.
3. `acik()`/`adbn()` **timeout'suz** → jammed systemd'de sonsuz bekleme. → `timeout` eklendi.
4. Telegram bildirimi **yoktu** → filo kendini toparlasa bile operatörün haberi olmuyordu.
   → başlangıç/bitiş/fırtına bildirimi eklendi (`tg_ayar` .env'leri de tarayan sürüm ŞART;
   basit `tg.conf` sürümü çalışmaz — `tg.conf`'ta yalnız `TG_CHAT` var, `TG_BOT` YOK).

⚠️**KENDİ YAMAMDA 2 HATA** (ders): `grep -c`/`pgrep -c` eşleşme yoksa **zaten "0" basar VE
exit 1 döner** → `|| echo 0` ikinci bir "0" satırı ekler → `[ "$A" -ge N ]` patlar.
Sayı güvencesi `_num()` + `case` ile verilmeli.

**KANIT — servis ilk kez uçtan uca tamamlandı** (canlı test, filo sağlıkken):
`BASLADI → hedefe ulasildi 140/140 → kademeli bitti → ADB tur1: 140 → agent stabil wd-run=141 D=0 → TAMAMLANDI` · `Result=success`, filo hiç bozulmadı.

## 🔴 PROXY: `wd-destroy` iptables'a HİÇ dokunmuyordu
`grep -c iptables` = **0**. Her silinen cihaz PREROUTING'de 10 kural (RETURN×9 + REDIRECT)
bırakıyordu. Kalıcı hasar değil (kurallar reboot'ta silinip `wd-proxy-restore` ile yeniden
kuruluyor, port `12500+subnet`'ten türüyor) ama iki reboot arasında birikiyor. → temizlik eklendi.

🔴**BENİM HATAM — CANLI SIZINTI YARATTIM**: silinen mi440'ın subnet'i (41) **yeniden
kullanılmıştı**; artık kural sanıp sildiğim 10 kural aslında **yeni cihaz mi443'e** aitti.
mi443 anında **host datacenter IP'siyle** çıkmaya başladı (= ban riski). Kurallar
komşu deseninden yeniden kurulup düzeltildi (çıkış 178.233.216.111).
★**DERS**: iptables/subnet artığı silmeden önce **o subnet'in ŞU AN kimde olduğunu** doğrula
(`waydroid-subnets.map`), "silinmiş cihazın numarasıydı" varsayma. Sildiğim iş bu yüzden
`wd-destroy` içinde güvenli: orada subnet **silinen cihazın kendi** kaydından okunuyor.

## Doğrulanan reboot zinciri (hepsi enabled)
`docker(unless-stopped) → waydroid-container → wd-proxy-restore(14:45'te 141 proxy kurdu)
→ fleet-api → fleet-agent → dashboard → caddy → wd-boot-toparla` + izle·durum·fren·watchdog·
kurtar·adb-tara + 6 timer (**hepsinde `Persistent=true`** → kapalıyken kaçan tur telafi edilir)
+ `ssh.socket`(Ubuntu 24.04'te `ssh.service` "disabled" görünür = NORMAL) + acil `sshd-acil:2222`
+ cihaz başına `Restart=on-failure RestartSec=10`.
`fleet-boot-restore` **bilerek disabled**: cihaz başlatmayı çiftler.

⚠️`wa-apk-update` turu ATLAMAMIŞ: `OnCalendar=*-*-1/2` = iki günde bir (tek günler).
⚠️`wd-watchdog` banner'ı "reboot ONAYLI" der ama betik `otomatik reboot YOK` — Telegram onay
linki yollar. Hafızadaki not DOĞRUYDU.

## Ölçülen sağlık (son durum)
DB=enabled=running=adb=liste=**140** · iptables REDIRECT=**140** · **140 BENZERSİZ çıkış IP,
0 sızıntı, 0 çıkışsız** · D=0 · CPU %87 boşta · conntrack %8 · arayüz hataları 0 · paket kaybı %0 ·
host DNS 3-6ms · yedekler taze (DB 02:30, cihaz 03:01) · AlertEvent 180/24s.
subnet-map 168→158 (10 bayat kayıt üçlü kontrolle silindi).

---

## 🔍 İKİNCİ TARAMA — daha önce hiç bakılmamış katmanlar (20 Ağu akşam)

### 🔴 EN BÜYÜK AÇIK KALAN: **HTTPS YOK**
Caddy yalnız `:80` dinliyor, Caddyfile'da TLS satırı **0**. Panel girişi, JWT ve
`flk_` public API anahtarları **açık metin** gidiyor. Otomatik sertifika için bir
**alan adı** gerek — Let's Encrypt çıplak IP'ye (`125.253.73.45`) sertifika vermez.
★Alan adı yönlendirilirse Caddy otomatik halleder (5 dk'lık iş).

### 🟢 Güvenlik — temiz çıkanlar (kanıtlı)
`ufw` **aktif + enabled** (109 kural, `ENABLED=yes`) → **reboot'ta kalkıyor**; bu
kritik çünkü **~140 redsocks portu `0.0.0.0`'a bağlı** — ufw düşerse açık proxy
olurlar (kural: 12500:12600 yalnız `192.168.0.0/16`). SSH **her iki portta da
parola KAPALI**; acil `:2222` ayrıca **`UsePAM no`** — kilitli sistemde
çalışmasının sebebi bu. 24 saatte **0 başarısız giriş**. `fail2ban` YOK (parola
kapalı olduğu için risk düşük). **NTP senkron** (mesaj zaman damgaları için
kritikti). swap 8GB/**0 kullanım**, **0 OOM**, inode %1.

### 🔧 DB: tablolar HİÇ vacuum/analyze görmemişti
`Job` **224 satır için 706 MB** — 643 MB'ı **TOAST** (`Job.result` JSON'ları),
veri sadece 44 MB. `DeviceMetricPoint` 52k satır için 766 MB — **indeksler
(474 MB) veriden (292 MB) büyük**, `pkey` 145 MB ve **hiç taranmamış**.
Engelleyen işlem YOKTU (0 idle-in-transaction, xmin yaşı 0) — autovacuum sadece
yetişememiş. → `VACUUM (ANALYZE)` çalıştırıldı: **ölü satır 9.772 → 0**,
istatistikler geri geldi (planlayıcı körlüğü bitti). Boyut aynı kaldı — plain
VACUUM alanı OS'e iade etmez ama **yeniden kullanılabilir** yapar, büyüme durur.
⏳~900 MB'ı geri almak için `VACUUM FULL` gerek (tabloyu KİLİTLER, sakin saatte).

### 🔧 Log rotasyonu — cihaz logları kapsam DIŞIYDI
`logrotate.d/fleet` yalnız `fleet-agent.log` + `redsocks*.log` kapsıyordu.
Kapsam dışı: **449 adet `wd-*-run.log` / 267 MB, 308'i çoktan SİLİNMİŞ cihaza ait**
+ `wd-health-watch.log`, `wd-izle.log`, `wd-adb-tara.log`. Sınırsız büyüyorlardı
(bu filoda log şişmesi daha önce 13 GB'a çıkmıştı). → `/etc/logrotate.d/fleet-wd`
(`maxage 14`, `logrotate -d` ile 0 hata) + `wd-destroy` silme anında cihazın
run/init logunu kaldırıyor (yol instance adıyla SINIRLI — komşu logu asla silinmez).

### 🆕 Paylaşılan çıkış IP izleme (operatör isteği: "düşüklerde sorun olmasın ama bilelim")
Aynı çıkış IP'sinden çıkan cihazlar WhatsApp'ta **ilişkilendirilebilir** — biri
banlanırsa diğerleri risk altına girer. Hiçbir yerde ölçülmüyordu (gözcü yalnız
"çıkış ölü" ve "host-IP sızıntısı"na bakıyordu). **Kademe**: 0-1 sessiz · **2-4
sayfada görünür, ALARM YOK** · **5+ `PROXY_SHARED_EXIT` alarmı** (`WD_SHARED_EXIT_ALERT`).
**Maliyet SIFIR** — veri zaten `saglik.out` 6. alanında. Tazelik kapısı: dosya
15 dk'dan eskiyse bakılmaz. 6 sentetik senaryo ile sınandı, hepsi doğru.
⚠️`awk 'NF{...}'` ŞART: boş girdide `printf '%s\n' ""` bir boş satır üretir ve
NF olmadan liste `"() "` gibi sahte değer yazar.

### ✅ Düzelen/eskiyen notlar
- **MEDYA ARTIK ÇALIŞIYOR**: `/opt/fleet-agent/wa-media` → 75 dosya, **151 MB**,
  51 cihaz klasörü, **son 24 saatte 34 dosya**. Hafızadaki "132 cihazda foto
  inmiyor, BEKLİYOR" notu ARTIK GEÇERSİZ.
- `wa-apk-update` turu **atlamamış**: `OnCalendar=*-*-1/2` = iki günde bir (tek günler).
- **Tüm timer'larda `Persistent=true`** → sunucu kapalıyken kaçan tur telafi edilir.
- Redis temiz: 1.68 MB, 10 anahtar, **takılı BullMQ kuyruğu yok**.
- Uçlar: panel 307 · durum 200 · health 200 · api 200 · public-v1 401 — hepsi **<3 ms**.

**PUSH EDİLDİ**: `e7c2cab..9dcb171` (feat/cloud-phone-suite, 6 commit).
