---
name: proxy-bind-kesintisi-ve-killmode-2026-08-22
description: redsocks'u köprü IP'sine bağlama denemesi 102 cihazı 50 dk düşürdü — kök KillMode=control-group; ayrıca sızıntı kill-switch, ölü UDP kuralı, sahte "çıkışı yok" alarmı ve 2 proxy hesabı tuzağı
metadata:
  type: project
---

**22 Ağustos 2026 gecesi.** Güvenlik sertleştirmesi yaparken **kesintiye sebep oldum**.
Sonuç: filo 142/142 sağlıklı, 0 sızıntı — ama yol boyunca 5 gerçek kusur ortaya çıktı.

## 🔴★★★ ORTAM TUZAĞI: bu kabukta TERS BÖLÜ İKİLİLERİ YENİYOR
`<<'EOF'` (tırnaklı heredoc) **ve** `printf` — ikisi de `\` → `\` yapıyor.
**Yalnız `base64 -d` sadık yazıyor.** Kanıt testi:
```
A) tirnakli heredoc : sed -e 's/\/\/g'    <- BOZUK
D) base64 ile       : sed -e 's/\/\\/g' <- DOGRU
```
★**Ters bölü içeren kod yazacaksan ya base64 kullan ya da ters bölü GEREKTİRMEYEN
bir yol seç** (ben JSON üretimini Node'a devrederek kökten çözdüm).
⚠️`bash -n` bunu YAKALAMAZ — geçerli bash dizesi, hata ancak `sed` çalışınca çıkar.

## 🔴★★★ TIRNAKSIZ HEREDOC'TA TERS TIRNAK = KOMUT İKAMESİ
Açıklama yorumumu `cat > "$CONF" <<EOF` içine koydum, yorumda `` `local_ip = 0.0.0.0` ``
vardı → bash komut ikamesi çalıştırdı → `local_ip: command not found` + üretilen
redsocks config bozuldu. ★**Üretilen dosyaya yorum yazma; yorumlar heredoc'un DIŞINDA.**

## 🔴★★★ ASIL HASAR: SERVİS DÜŞÜNCE BAŞLATTIĞI DAEMON'LARI ÖLDÜRÜYOR
`wd-proxy-restore` işini **BİTİRDİ** (`TAMAM: 141 proxy geri-uygulandı`) ama **exit 1**
döndü. Varsayılan `KillMode=control-group` → systemd `failed` sayıp cgroup'u temizledi →
az önce başlattığı **141 redsocks'a SIGTERM** (loglarda `redsocks goes down`, çökme değil).
Dinleyen 142→40, **102 cihaz ~50 dk dışarı çıkamadı**. Aynı tuzak 29 Tem'de de yaşandı.
FIX: `KillMode=process` drop-in → `wd-proxy-restore` · `wd-boot-toparla` · `fleet-boot-restore`
(`wd-health-watch`'ta zaten doğruydu). ★**Daemon başlatan HER oneshot servisi denetle.**
⚠️Ayrıca: birim `active(exited)` iken `systemctl start` **NO-OP** — `restart` şart.

## 🔴 SIZINTI PENCERESİ (yapısal, hâlâ kökte var ama artık zararsız)
`wd-proxy.sh` REDIRECT kurallarını **önce silip sonra ekliyor**; o boşlukta trafik host
NAT'ından çıkıyor = **datacenter IP sızıntısı**. Kanıt: yayım sırasında gözcü tur başına
**29-65 "sızıntı-düzeltildi"** saydı, panele "Datacenter IP'ye düşmüştü" bildirimleri düştü.
FIX: boşluktan ÖNCE `-I FORWARD 1 -s <subnet> -p tcp -j DROP` → **fail-closed**
(REDIRECT yoksa paket düşer, sızmaz).
★**ÖLÇEREK doğrulandı, varsayılmadı**: davranış değiştirmeyen boş zincir sayacıyla
mi98'de 2 gerçek HTTPS isteği sonrası sayaç **0** kaldı → meşru TCP FORWARD'a hiç uğramıyor
(PREROUTING REDIRECT yönlendirmeden önce yerele çevirir).

## 🔴★★★ 24 TEM'DEKİ QUIC KORUMASI ÖLÜYDÜ
`-p udp ! --dport 53 -j DROP` kuralı **`-A` ile SONA** ekleniyordu. `ufw-before-forward`
trafiği ACCEPT edip zinciri sonlandırıyor (595K paket; `ufw-after-forward` sayacı **0**) →
kural **hiç görülmüyordu**. Sayacının bugüne kadar 0 olmasının sebebi buydu.
★**ufw'lu bir sistemde FORWARD kuralı EKLEMEK için `-A` değil `-I ... 1` kullan.**

## 🔴 SAHTE "ÇIKIŞI YOK" ALARMI (panel operatörü boşuna korkutuyordu)
`wd-saglik.sh` 142 cihazı `xargs -P 40` ile tarıyor, çıkış testi **tek deneme** (12 sn).
Residential proxy el sıkışması bu yükte 12 sn'yi aşabiliyor → sahte "çıkışı yok".
★**İMZA: panel HER TURDA FARKLI cihaz suçluyorsa kalıcı arıza değil, ZAMAN AŞIMIDIR.**
(mi407 → mi396+mi401 → mi363+mi401; hepsi doğrudan test edilince çalışıyordu.)
FIX: boş dönerse 1 sn bekle + ikinci deneme (17 sn) → 140/142 **→ 142/142**, 0 sahte alarm.
⚠️`tr -d "\r\n"` KORUNMALI: CR gelirse `$` çapası tutmaz, yine sahte alarm üretir.

## 🔴 İKİ PROXY HESABI — KARIŞTIRMA
- `td-customer-<TR_MOBILE_USER>…` = **MOBİL**, port **9999**, TR cihazlar (140 adet)
- `td-customer-<AL_RESIDENTIAL_USER>…` = **RESIDENTIAL**, port **5555**, AL/diğer ülkeler (2 adet: mi38, mi26)
`FLEET_PROXY_USER`=residential, `FLEET_PROXY_MOBILE_USER`=mobil; ülke seçimi
`FLEET_PROXY_MOBILE_COUNTRIES` (varsayılan TR) ile yapılıyor.
🔴HATAM: mi98'e residential kimliği **mobil portla** verdim → hiç çıkış alamadı, saatlerce
"bozuk" sandım. ★**Elle proxy uygularken ülkeye göre DOĞRU hesap+port çiftini kullan.**

## 🟢 ip_nonlocal_bind ŞART (köprüye bağlı redsocks için)
`local_ip = 192.168.<subnet>.1` yapınca: `wd-proxy-restore` boot+90sn'de çalışıyor ama
boot-gate cihazları ~18 dk'ya yayıyor → çoğu köprü yokken bind
`Cannot assign requested address` ile patlar. `/etc/sysctl.d/99-fleet-redsocks.conf` →
`net.ipv4.ip_nonlocal_bind=1`. CANLI KANIT: köprü silinmişken `=0` HATA, `=1` başarılı;
köprü sonradan gelince trafik aktı.

## Son durum (ölçüldü)
142 cihaz · Android/ADB/**DNS**/internet/**WhatsApp** hepsi **142** · sızıntı **0** ·
141 benzersiz çıkış · redsocks 142 hepsi köprüde · kill-switch TCP 142 UDP 144 ·
failed birim 0 · **139 TR + 2 AL** (AL'ler +355 numaralı, ülke eşleşmesi DOĞRU).

⚠️**TEST KİRLİLİĞİ**: test alarmlarım panele düştü (sahte "CANARY BAŞARISIZ" dahil),
7 bildirim elle silindi. ★Test ederken gerçek alarm borusunu kullanma ya da sonra temizle.

İlgili: [[durum-sayfasi-yanlis-veriler-ve-silme-kokleri-2026-08-20]] ·
[[api-restart-agent-stream-proxy-tasima-2026-07-29]] · [[proxy-mimari-cok-port-2hesap-2026-07-21]]

---

## 🟢 GECE SONU: ÜÇ SENARYONUN TAMAMI DENETLENDİ (yarın yoğun kullanım öncesi)

### 1) YENİ CİHAZ — canlı doğrulandı
Operatör 2 cihaz kurdu, tarama sırasında yakalandı; ikisi de eksiksiz aldı:
`enabled=145 running=145 adb=145 DB=145 · redsocks=145 (hepsi köprüde) · REDIRECT=145 · conf=145 · failed=0`

🔴**KURULUM SIZINTI PENCERESİ KAPATILDI**: `systemctl start waydroid@<inst>` konteyneri
açıp cihazı ANINDA ağa çıkarıyor, proxy ise kurulum adımlarında **%76**'da uygulanıyor.
Aradaki her şey host IP'sinden sızıyordu. **CANLI KANIT (01:43)**: operatör TEK cihaz
kurdu, `/durum` anında "⚠ PROXY SIZINTISI · sızıntı 1" gösterdi, %76'da 0'a döndü.
FIX: subnet belli olur olmaz, **konteyner açılmadan önce** kill-switch kurulur.
★**AKIŞ BOZULMUYOR** (kod incelemesiyle doğrulandı): kurulum sırası
`infra 8 → boot 18 → root 35 → screen 47 → vtouch 58 → route 68 → PROXY 76 → apks 84 → a11y 92 → persist 97`
Proxy'den ÖNCEKİ adımların hiçbiri cihaz interneti istemiyor (`wd-provision.sh`'ta
curl/wget/ping/download = **0**; `route` sadece yerel rota; `apks` adımında ağ çağrısı **0**,
APK'lar adb ile push ediliyor).
⚠️**DAVRANIŞ DEĞİŞİKLİĞİ**: proxy'siz kurulan cihaz artık **internetsiz kalır** (önceden
datacenter IP'sinden çıkardı). Bu filoda datacenter IP = ban olduğu için doğrusu bu.
Operatör onayladı: yeni cihazda henüz WhatsApp numarası olmadığı için zararsız.

### 2) SİLME — 14/14 artık türü kapsanıyor (tek tek denetlendi)
systemd symlink · instance dizini · data dizini · redsocks conf · redsocks süreci ·
nat REDIRECT · **FORWARD tcp kill-switch** · FORWARD udp · dnsmasq lease · subnet-map ·
sağlık damgaları · run/init logları · dbus policy · binderfs düğümleri → **hepsi ✓**

### 3) REBOOT ZİNCİRİ — 7 aşama, reboot etmeden denetlendi
```
1) wd-killswitch    enabled · Before=waydroid-container + wd-proxy-restore
2) docker(unless-stopped) · waydroid-container · ufw · ssh.socket · sshd-acil:2222
3) 145 cihaz enabled · boot-gate ~19 dk · Restart=on-failure · KillMode=process
4) wd-proxy-restore enabled · sleep 90 · KillMode=process · ip_nonlocal_bind=1 KALICI
5) fleet-api · fleet-agent · dashboard · caddy
6) wd-boot-toparla(KillMode=process) + izle·durum·fren·watchdog·kurtar·adb-tara
7) 6 timer, HEPSİNDE Persistent=true
```
⏳**TEK EKSİK**: gerçek bir reboot canlı görülmedi (yapılandırma doğru, davranış değil).

## 🆕 BOOT SIZINTI PENCERESİ — yeni `wd-killswitch.service`
iptables kuralları bu makinede **KALICI DEĞİL** (`iptables-persistent` yok, `rules.v4` yok).
Her reboot'ta REDIRECT sıfırlanır; cihazlar 0-18 dk'ya yayılarak açılır, `wd-proxy-restore`
boot+90sn'de başlayıp 142 cihazı ~20 dk'da tarar → **arada sızıntı**. 21 Tem'deki
"ban salgını"nın hâlâ açık hâliydi. FIX: subnet haritasındaki HER subnet için, cihazlar
açılmadan **fail-closed DROP**. Canlı: `eklendi=19 zaten-vardı=143`, birim `active/success`.

## ★ KILL-SWITCH'İN GÜVENLİ OLDUĞU **ÖLÇÜLDÜ** (varsayılmadı)
Meşru cihaz TCP'si FORWARD'a **hiç uğramaz** — PREROUTING REDIRECT paketi yönlendirmeden
ÖNCE yerele çevirir. mi98'e **davranış değiştirmeyen boş zincir** sayacı kondu, 2 gerçek
HTTPS isteğinden sonra sayaç **0** kaldı. Filoya kurulduktan sonra 142/142 çıkış, 0 sızıntı;
DROP sayaçları yalnız **gerçek sızıntı** anlarında arttı (subnet 139/154, 21'er paket).

## 🟢 YARIN İÇİN HAZIRLIK DOĞRULAMASI
- **Mesaj akışı**: 01:45 giden mesaj **SENT**, gelenler **5-7 sn**, son 3 saatte **0 başarısız iş**
- **Hesaplar**: ACTIVE 131 · BANNED 63 · RESTRICTED 2 · FAILED 202 · LOGGED_OUT 8
- ★**Son 3 ban 21 Ağu 10:38-15:58** = sızıntı pencerelerimden (22 Ağu 00:15-01:17)
  **9-15 saat ÖNCE** → sızıntının banla ilgisi YOK, sızıntıdan sonra yeni ban yok
- **Kapasite**: 96 GB RAM boş · disk %4 (3.2 TB) · conntrack %7 · D-state 0
- **Yedekler**: gece 02:31 pg-backup · 03:12 wa-backup · 04:35 canary (hepsi Persistent)
- **Acil erişim**: SSH 22 ✓ · 2222 ✓ · `/kurtar` 401(korumalı) ✓ · `/durum` 200 ✓
- **Hata sayımı** (değişikliklerden sonra 90 dk): ajan **0** · gözcü **0** ·
  API'deki 68 "hata" = `tg getUpdates TimeoutError`, hepsi **01:11'de tek dakikalık patlama**
  (proxy yayımım giden bağlantıları doyurmuş); son 20 dk **0**, bot erişilebilir (`vpswabot`)

## Geri alma yolu (hepsi duruyor)
`/root/*.bak-*` → wd-provision · wd-proxy · wd-saglik · wd-health-watch · mi98.conf ·
`/root/logrotate-yedek/` · `/root/agent-dropin-yedek/timing.conf`

## Commit'ler (5 adet, PUSH BEKLİYOR — izin engeli)
`01b8de2` HMAC imza · `f1ac51e` bind · `9700f8c` kill-switch+tarama · `6a4bf31` FORWARD temizliği ·
`656df05` boot+kurulum kill-switch

---

# 🔴🔴🔴 25 AĞUSTOS: KILL-SWITCH GERİ ALINDI — CİHAZ KURULUMUNU 3 GÜN BOZDU

**Benim hatam ve 3 gün fark edilmedi.** 22 Ağu'de eklediğim fail-closed kill-switch,
cihaz kurulumunu **90 sn → 170-410 sn**'ye çıkardı; 23-25 Ağu arası **her canary düştü**
(`PROV_TIMEOUT: 'boot' adimi 360s icinde bitmedi`) ve **yeni cihaz açılamadı**.

## Mekanizma (ölçüldü, tahmin değil)
Her cihaz için FORWARD'ın **BAŞINA** kural ekliyordum (`-I FORWARD 1`); ayrıca 24 Tem'den
beri **sonda** duran UDP kurallarını da başa taşımıştım. Sonuç:
```
FORWARD 312 kural · ufw-before-forward zinciri 170. SIRADA
```
Her paket ufw'ye varmadan ~170 kural dolaşıyordu. **DHCP'nin sıkı zamanlaması buna
dayanmadı**: konteyner lease alamayıp 9 kez deniyor, ~145 sn sonra `.112` statik yedeğine
düşüyor, kalan bütçe ilk-boot'a (dexopt + `/data` ilklendirme) yetmiyordu.

## A/B kanıtı (aynı makinede peş peşe)
| durum | sonuç | DHCP re-kick | fallback |
|---|---|---|---|
| kill-switch **AÇIK** | mi457 **412 sn FAILED** | 9 | 1 (.112 statik) |
| kill-switch **KAPALI** | mi460 **90 sn COMPLETED** | 2 | 0 (gerçek DHCP IP) |
| kod geri alındıktan sonra | mi461 **91 sn COMPLETED** | 2 | 0 |

FORWARD 312 → 154 kural · ufw sırası 170 → **7**.

## ★★★ASIL DERS
**"Meşru trafiği etkilemez" diye ROTA doğruluğunu ölçtüm (FORWARD sayacı 0) ama
MALİYETİ ölçmedim.** Zincirin başına cihaz-başına kural koymak O(N) büyür ve 141 cihazda
ufw'yi 170. sıraya iter.
- Kural sayısı filo ile büyüyorsa: **tek `/16` jump + ayrı zincir** ya da **ipset** kullan
- **ASLA** per-cihaz kuralı ana zincirin başına koyma
- Değişiklikten sonra **CİHAZ KURULUMUNU da test et** — canary günlük çalışıyordu,
  3 gün kırmızı yandı ve kimse bakmadı

## ⚠️Teşhisi geciktiren kendi hatam
`wd-destroy`'a eklediğim log temizliği, **başarısız kurulumların tek kanıtı** olan
`/var/log/wd-<inst>-init.log` / `-run.log` dosyalarını her teardown'da siliyordu.
→ Kaldırıldı; yalnız donmuş (`.log.*`) kopyalar temizleniyor (birikme zaten
`logrotate maxage=14` ile kapalı).

## Yanlış izler (buraya not: tekrar aynı yollara sapma)
1. ❌ binderfs boş sanıldı → teardown sonrası artıktı, `wd-binder.sh` elle kusursuz çalışıyor
2. ❌ ip6tables `unable to initialize table 'filter'` → **çalışan cihazlarda DA var**, zararsız
3. ❌ D-Bus limiti → `LimitsExceeded` **0 kayıt**
4. ❌ `ip_nonlocal_bind` dnsmasq'ı bozuyor → dnsmasq **arayüze** bağlanıyor
   (`0.0.0.0%waydroid-miXXX:67`), IP'ye değil; 141/141 dinleyici sağlam
5. ❌ zombie/yarım-açılmış kurtarması → gözcü kayıtları kurulum **başarısız olduktan SONRA**;
   benim "yarım açılmış" kodum **0 kez** tetiklenmiş
6. ❌ `zygote` kayboldu sanıldı → load 38'de `lxc-attach getprop` **6 sn zaman aşımına** uğradı

## KORUNANLAR (regresyona katkısı yok — ölçüldü)
`local_ip = 192.168.<subnet>.1` (redsocks yalnız kendi köprüsünde) + `ip_nonlocal_bind=1` —
**90 sn'lik başarılı canary bunlarla çalıştı**. `wd-destroy` FORWARD/nat/damga/subnet-map
temizliği de duruyor.

Commit: `dcc1623`

## ✅ GERİ ALMA SONRASI DOĞRULAMA (25 Ağu 15:50) — otonomların hepsi sınandı

**Yapılandırma 28/28 geçti** · ayrıca **davranışı hiç sınanmamış 3 kalem gerçekten çalıştırıldı**:

| Test | Sonuç |
|---|---|
| `wd-boot-toparla` fonksiyonları | `acik=144 adbn=144 dst=0` — üçü de **tek satır sayı**, karşılaştırma çalışıyor → düzeltilen `\|\| echo 0` hatası gerçekten yok |
| Gözcü boot-stuck ölçüm yolu | `lxc-attach getprop` → `boot_completed=1` — **adresten bağımsız ölçüm çalışıyor** (0 kez tetiklenmesi bozukluk değil, takılı cihaz olmaması) |
| `wd-destroy` uçtan uca | mi457 host artıklarının **hepsi silinmiş** (dizin/conf/birim/subnet-map = 0) |

**Hizalama**: `enabled=144 running=144 adb=144 DB=144` — her iki yönde sıfır artık.
**Canlı**: gözcü 141 sağlıklı · imzasız istek **0** · Host damgası ilerliyor · canary **success** ·
sızıntı **0** · 142 benzersiz IP · mesajlar akıyor · **düzeltmeden sonra 2 cihaz daha başarıyla kuruldu**.

⏳**TEK SINANMAMIŞ**: `wd-boot-toparla`'nın GERÇEK bir reboot ile tetiklenmesi. 22 Ağu'de elle
uçtan uca çalıştırıldı (`Result=success`, filo bozulmadı); fark yalnızca tetikleyicide.

⚠️**AÇIK ÖNERİ**: canary 3 gün kırmızı yandı ve kimse görmedi → **canary başarısız olursa
Telegram alarmı** eklenmeli; bu tür regresyonlar bir daha günlerce gizlenmesin.
