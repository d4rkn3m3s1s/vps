---
name: wa-ban-yoklamasi-bayat-on-plan-2026-08-19
description: WA sağlık yoklamasının 5 ayrı kusuru — 48 sağlam hesap yanlışlıkla parkta duruyordu; ayrıca health-watch önek hatası 7 cihazı öldürdü
metadata:
  type: project
---

# 🔴★★★ YOKLAMA 48 SAĞLAM HESABI PARKTA TUTUYORDU (5 KUSUR)

Panelde **KISITLI 48 / ACTIVE 89** idi. Cihazlara **gerçekten bakınca** (ekran
görüntüsü) hesapların çalıştığı görüldü. Sonuç: **ACTIVE 89 → 137**, KISITLI 48 → 2.

## ★★★KUSUR 1 — resmi "WhatsApp" sohbeti "kısıt" sanılıyordu (42 hesap)

Yoklama listedeki **İLK** sohbeti açıyordu. WhatsApp'ın kendi promo mesajları listeyi
sürekli başa taşıdığı için açılan sohbet çoğu zaman **resmi hesap** oluyordu — ve o
sohbet doğası gereği tek yönlü: `read_only_chat_info` **HER ZAMAN** var, yazma kutusu
(`entry`) **YOK** → `RESTRICTED`. Monotonik kural yüzünden etiket kalıcıydı.
**Gözle kanıt:** sohbetin altında *"Only WhatsApp can send messages"*.
FIX: satır adı tam `WhatsApp` olanı **atla**; açılan ekran yine resmiyse **hüküm verme**.

## ★★★KUSUR 2 — `uiautomator dump` başarısızsa BAYAT DOSYA okunuyordu

`uiDumpXml` dosyaya döküp `cat` ediyor. Dump hang/timeout ederse (`Conversation`
ekranında oluyor) **eski dosya yerinde kalıyor** ve önceki ekran "canlı" sanılıyor.
⚠️Kod `exec-out cat` ile *tazelik* sorununu çözmüş ama **dosyanın bayatlığını** değil.
**Kanıt:** bir cihaz 5 turda **birebir aynı** kanıtı döndürdü, oysa ekranda sohbet
açıktı. FIX: dump'tan önce `rm -f` — aynı `shell` çağrısında, **ek tur maliyeti yok**.

## ★★★KUSUR 3 — `findNode` SUBSTRING: "New chat" yerine Meta AI'ya basıyordu

`h.find('com.whatsapp:id/fab','id')` → `findNode` `.includes()` kullanır ve düğüm
sırasında **`fab_second` ÖNCE** gelir; `"…:id/fab_second".includes("…:id/fab")`=true.
Yani `content-desc="Message your assistant"` (Meta AI) butonuna basılıyordu.
FIX: **tam kimlik** eşleşmesi (`resId === '...'`). ⚠️Bu tuzak bu dosyada tekrar eden bir sınıf.

## ★★KUSUR 4 — açılış (splash) ekranında hüküm veriliyordu

Soğuk başlatmada WhatsApp önce `com.whatsapp.Main` gösterip **sonra** ban ekranına
geçiyor. Yoklama 4.5sn'de bakıp `Main`'i görünce "açıldı, ban yok" diyordu.
(Sıcakken ban ekranı ~1sn'de geliyor — iki ölçüm turunda da +1.0sn.)
FIX: `Main` görülürse bekle; ayrıca ban kararı **görev yığınına** da bakar
(`dumpsys activity activities`) — yasaklıda 23 eşleşme, sağlamda 0.

## ★★KUSUR 5 — yoklama WhatsApp'ı KAPALI bırakıyordu

Yoklama `am force-stop` ile bitiyordu. **Kapalı WA'ya mesaj ULAŞMAZ.** 20 dk'da 2
cihaz → sessizce susan gelen kutuları. Ölçüm: **5 cihaz** kapalıydı.
FIX: bitişte `am start`. (Aynı tuzak daha önce medya betiğinde 27 cihazı susturmuştu.)

## 🔴★★★AYRI KÖK — health-watch ÖNEK HATASI 7 CİHAZI ÖLDÜRDÜ

`wd-destroy.sh`'de düzelttiğim hatanın **ikinci kopyası** `wd-health-watch.sh`'deydi:
```
00:38:08  🧟 mi30: ... ZOMBIE → runtime temizlenip yeniden başlatılıyor
00:38:47-00:39:20  mi300 mi304 mi305 mi306 mi307 mi308 mi309 ÖLDÜ (mesajsız exit 1)
```
İki kusur: (a) `pgrep -f "wd-run.sh mi30"` **komşunun** sürecini bulup "host süreç
ayakta = ZOMBIE" dedirtiyor; (b) `pkill -9 -f "wayland-mi30"` vb. **5 desen bağsız**
→ komşuların weston/xdg/lxc-start/dnsmasq süreçleri `kill -9`.
**Canlı ölçüm:** eski desen `wayland-mi30` → **7 süreç**, bağlı yeni desen → **0**.
Aynı gece `mi9` için de tetiklenmişti (mi90/95/96/98).
FIX: `($|[^0-9])` ile bağla — 6 desen. ⚠️Bu sınıf hatayı **her yerde** ara.

## Yöntem notları

- ⚠️`node --check` **anlamsal** hatayı yakalamaz: Python yaması regex'e gerçek bir
  **backspace baytı (0x08)** yazmıştı, regex sessizce hiç eşleşmiyordu. Yamadan sonra
  dosyayı `cat -A` ile **gözle doğrula**.
- `KillMode=process` sayesinde `systemctl restart fleet-agent` cihazlara dokunmaz
  (cgroup'taki redsocks/adb/wd-run/weston yaşar) — bu doğrulandı.
- Tek cihazda (`192.168.65.29`) `uiautomator` **`null root node`** veriyordu; instance
  restart'ı düzeltti. Filoda yalnız 1/140 — yaygın değil.
- Doğrulama için **ekran görüntüsü şart**: `adb exec-out screencap -p`.

Bkz. [[cihaz-dusme-6-kok-otonom-kurtarma-2026-08-17]] · [[wa-saglik-sessiz-yoklama-2026-07-28]]
