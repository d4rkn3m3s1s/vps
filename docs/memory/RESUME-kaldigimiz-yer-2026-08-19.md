---
name: RESUME-kaldigimiz-yer-2026-08-19
description: 19 Ağustos gece oturumu — biten işler, ölçülen sonuçlar ve yarına kalan iş listesi (öncelik sıralı)
metadata:
  type: project
---

# 📌 KALDIĞIMIZ YER — 2026-08-19 (gece ~03:00)

Filo gecenin sonunda: **140/140 ONLINE · D-state 0 · CPU %79 boşta · RAM 95GB boş ·
disk %4 · takılı iş 0 · gözetimsiz cihaz 0**. Tüm servisler aktif.

## ✅ BU GECE BİTENLER (hepsi ölçümle doğrulandı, push edildi)

| iş | sonuç | commit |
|---|---|---|
| WA sağlık yoklamasının 5 kusuru | **ACTIVE 89 → 137** hesap | `375cb74` |
| health-watch önek hatası | 7 cihazı öldürüyordu, kapandı | `375cb74` |
| Gönderim hızı | **18.3 sn → 12.6 sn** | `b2a0d95` |
| Yanlış CPU alarmı | 250ms→1500ms + 3 tur süreklilik | `b2a0d95` |
| **Gelen mesaj kaybı + gecikme** | **291 sn → 1-4 sn**, kayıp bitti | `bf8c0fa` |
| Gözcü `pgrep` israfı | 1335ms → 1.6ms (**825×**) | `151ccd6` |

Detaylar: [[wa-ban-yoklamasi-bayat-on-plan-2026-08-19]] ·
[[gonderim-hizi-ve-yanlis-cpu-alarmi-2026-08-19]] ·
[[gelen-mesaj-kayip-ve-gecikme-2026-08-19]]

## ⏳ YARINA KALANLAR (öncelik sırasıyla)

### 1. 🔴 Fotoğraf indirme — 132 cihazda kapalı
Filoda **132/140 cihazda yalnız `autodownload_roaming_mask`** ayarlı; `cellular` ve
`wifi` maskeleri **hiç yok** → gelen fotoğraf cihaza inmiyor → `file_path` boş →
medya yoklayıcısı eliyor → TG'ye düşmüyor.
⚠️**Root ile yazmak TUTMUYOR — bu gece force-stop'lu yöntemle test edildi**: üç maske
de yazıldı, WhatsApp açılınca `cellular`+`wifi` **silindi**, yalnız roaming kaldı.
Tek yol **UI otomasyonu**.
📍`/opt/fleet-agent/medya-ac-filo.sh` şu an **yalnız "When roaming"** ekranını açıyor
(`grep` ile doğrulandı) — "When using mobile data" ve "When connected on Wi-Fi"
eklenmeli. Timer 6 saatte bir çalışıyor (`wa-medya-supurge.timer`).

### 2. 🟡 Gözcü düzeltmesini filoya yay
`wd-run.sh` yeni kodu **yazıldı ama çalışan 140 gözcü hâlâ eski kopyada** (tmp+rename
ile kuruldu; çalışanlar eski inode'u kullanır). Cihazlar doğal olarak yeniden
başladıkça geçecek. İstenirse **kademeli** restart ile hızlandırılır — ⚠️toplu restart
YAPMA, kademeli yap.

### 3. 🟡 `ensureTouch` her gönderimde 3.4 sn
`ensureVtouch` her gönderimde `wa-bringup.sh` çalıştırmayı deniyor (dosya cihazda VAR)
ama vtouch oluşmuyor; `VT_CACHE_MS=60000` olduğundan neredeyse her gönderimde
tekrarlanıyor. Negatif sonucu uzun süre önbelleğe alırsak gönderim **12.6 → ~9 sn**.

### 4. 🟢 `FLEET_SEND_TIMING=1` açık bırakıldı
`/etc/systemd/system/fleet-agent.service.d/timing.conf`. Gönderim başına ~7 satır log
(şu an fleet-agent.log 60K — sorun yok). Sabah yoğunlukta yavaşlama olursa dökümü
verir. İşi bitince **kapat**.

### 5. 🟢 Kalan hesaplar
KISITLI 2 (ikisi de çevrimdışı cihazda) · YASAKLI 56 (54'ünün cihazı yok) ·
FAILED 202 (179'unun cihazı yok) — canlı kapasite israfı **değil**, eski kayıt.
Canlı 140 cihazın **135'inde çalışan hesap var, 5'i boşta**.

## ⚠️ BU GECE ÖĞRENİLEN YÖNTEM DERSLERİ

- **Her yamadan sonra BAYT denetimi yap.** İki kez sessiz bozulma yaşandı: regex'e
  gerçek `0x08` backspace, betiğe gerçek `0x00` NUL. `node --check` ve `bash -n`
  ikisini de **yakalamaz** (sözdizimi geçerli). `cat -A` / python bayt taraması şart.
- **Çalışan bash betiğini yerinde değiştirme** — bash dosyayı parça parça okur.
  tmp + `mv` (rename) kullan; çalışanlar eski inode'la devam eder.
- **Performans iyileştirmesi sessizce güvenilirlik kaybına dönüşebilir**: sayaç tabanlı
  döngüde turları ucuzlatınca toplam bekleme bütçesi de kısalır. Döngüyü **süre
  tabanlı** yap.
- **Eşiğe dokunmadan önce metriği kendi algoritmasıyla 20-40 kez örnekle.**
- Doğrulama için **ekran görüntüsü** al (`adb exec-out screencap -p`) — dumpsys yalan
  söyleyebilir.
- Kullanıcı **bekleme döngüsü sevmiyor**: uzun `sleep` döngüsü kurma, tek atışlık
  kontrol yap.

---

# 🔄 EK — 19 Ağustos AKŞAM oturumu (22:00-23:00)

Sabah bıraktığım 3 işten **2'si bitti**, ayrıca 2 yeni kök bulundu.

## ✅ Gözcü yaması filoya yayıldı — **cihaz kapatmadan**

`KillMode=process` drop-in eklendi (`/etc/systemd/system/waydroid@.service.d/killmode.conf`):
`systemctl restart waydroid@X` artık **yalnız `wd-run.sh`'i** yeniler; container/weston/lxc
ayakta kalır, yeni wd-run *"zaten çalışıyor → GÖZETİM devralındı"* yolundan devralır.
**Canlı kanıt (mi262):** `lxc-pid 3161273 → 3161273` (AYNI), wd-run değişti, ADB kopmadı.
140/140 cihaz yeni koda geçti, ADB 140'ta sabit kaldı.

⚠️`/run/wd-nogate` dosyası oluşturuldu (boot-gate'in ~6 dk beklemesini atlatmak için).
**Silmeyi unutma** — yoksa reboot'ta tüm cihazlar aynı anda açılmaya çalışır.

**ÖLÇÜLEN CPU ETKİSİ:** `pgrep` 255%→**86%** · `sy` %15.2→**%9.5** · load 24→**16** ·
CPU boşta %76→**%81**. Kalan 86% `wd-health-watch`'un 7 dakikalık turundan.

## ✅ ensureTouch — her gönderimden 3.4 sn kesiyordu
Kalem `vtouchInfo` değil (`getevent -pl` = 35-44 ms), tamamı boşa giden `wa-bringup.sh`
denemesi. Bu imajda vtouch **oluşmuyor** ama betik cihazda **var** → `VT_CACHE_MS=60000`
yüzünden neredeyse her gönderimde tekrarlanıyordu.
FIX: başarısız bringup için **30 dk geri-alım penceresi**. Kanıt: izlerde `+0ms` ve
`+877ms` görüldü. ⚠️Pencere **bellekte** — ajan restart'ında her cihaz bir kez daha öder
(kabul edilebilir; istenirse imleç dosyası gibi diske alınabilir).

## 🆕 KÖK — İŞ AÇLIĞI (16:00 gecikmesinin de sebebi)
Alım döngüsü parti başına **cihaz başına 1 iş** alıyor, aday penceresi ise `cap*4` (=96).
Filoda bekleyen iş 96'yı aşınca pencereye giremeyen cihazların işleri **hiç görülmüyor**
ve 15 dk sonra *"kuyrukta beklerken hiç alınmadı"* diye FAILED oluyor.
**Ölçüm (18 saat):** 50 `WHATSAPP_RECEIPTS` + 8 `WHATSAPP_SEND` böyle düştü (ort. 930 sn).
İki cihazda toplanmış (35 ve 18) — oysa o cihazlar sürenin yalnız **%3**'ünde meşguldü,
yani doygunluk değildi. FIX: pencere `cap*20` (max 500). Semantik değişmez.

## 🆕 16:00 SIÇRAMASI AÇIKLANDI
Gecikme filo geneli değil, **belirli cihazlarda**: `192.168.12.237` (1601 sn) ve
`192.168.144.214` (3 mesaj, ~588 sn — `mi308` o sırada `status=1/FAILURE` ile çökmüş).
★**Önemli:** mesajlar **kaybolmadı**, cihaz dönünce geldi — bu tam olarak imleç
kalıcılaştırmasının garantisi. Düzeltmeden önce bu 3 mesaj kalıcı kaybolurdu.

## ⏳ HÂLÂ KALAN
1. 🔴 **Fotoğraf indirme — 132 cihazda kapalı** (cellular/wifi maskesi yok, root tutmuyor,
   UI otomasyonu gerek). `medya-ac-filo.sh` yalnız roaming ekranını açıyor.
2. 🟡 `/run/wd-nogate` dosyasını sil.
3. 🟡 `wd-health-watch`'un kendi `pgrep` çağrıları (kalan 86% CPU) aynı önbellek
   tekniğiyle düşürülebilir.
4. 🟢 `FLEET_SEND_TIMING` hâlâ açık.
