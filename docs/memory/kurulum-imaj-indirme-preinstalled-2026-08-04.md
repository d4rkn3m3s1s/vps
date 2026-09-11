---
name: kurulum-imaj-indirme-preinstalled-2026-08-04
description: "🔴★★★KURULUM HER SEFERİNDE 1GB İMAJ İNDİRİYORDU: `-i /var/lib/waydroid/images` YOK SAYILIYOR çünkü initializer.py kararı SADECE `preinstalled_images_paths` listesine bakıyor(/etc/waydroid-extra/images, /usr/share/waydroid-extra/images). AYLARDIR böyleydi, ağ hızlıyken görünmedi; 64kB/s'ye düşünce kurulumlar toptan yandı. FIX:symlink+self-heal→init 5-10dk→1sn. ⚠️`-f` SUÇLU DEĞİL."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b35fb77-30e7-48f7-a51f-ef2ea6daeb6b
  modified: 2026-08-04T17:20:26.319Z
---

# Kurulum her seferinde 1 GB imaj indiriyordu (4 Ağustos 2026)

## Belirti
Operatör: *"yeni cihaz oluşturamıyorum"*. Kurulumlar 5-10 dk sürüp zaman aşımına
düştü; **mi103/104/106/107/108/109/110 kayboldu**.

## ★★★ Kök neden — `-i` parametresi YOK SAYILIYOR
`wd-provision.sh` yıllardır şunu çağırıyordu (yorumu da "ayrı indirme yok" diyordu):
```bash
waydroid.py --instance "$INSTANCE" init -f -i /var/lib/waydroid/images
```
**Gerçek tersiydi.** `initializer.py`'nin indirme kararı:
```python
preinstalled_images_paths = ["/etc/waydroid-extra/images",
                             "/usr/share/waydroid-extra/images"]
if args.images_path not in preinstalled_images_paths:
    helpers.images.get(args)             # ← İNDİR
else:
    helpers.images.remove_overlay(args)  # ← yerel kullan
```
Bizim yolumuz **listede olmadığı için** her kurulum `system.zip` (905 MB) +
`vendor.zip` (148 MB) indiriyordu.

## ⚠️ Neden aylarca görünmedi
Satır **14 Tem yedeğinde de var**. Ağ hızlıyken (2-11 MB/s) indirme ~3 sn sürüyordu:
```
14:50  mi99   → 36 sn ✅
15:57  mi105  → 85 sn ✅
16:55  mi109  → system indirme 5 DAKİKA ❌ (hız 64 kB/s'ye düştü)
```
**Ders:** "ağ hızlı olduğu için gizlenen bağımlılık" — yavaşlayınca toptan çöker.

## ⚠️ `-f` SUÇLU DEĞİL
İlk hipotez `-f` (force) bayrağıydı. Kod okunarak **çürütüldü**: `-f` yalnızca
`if is_initialized(args) and not args.force` kontrolünü atlar, **indirme kararını
etkilemez**. Karar tamamen `images_path in preinstalled_images_paths` testinde.

## Fix (commit `04e1bdb`)
- İmajlar `/usr/share/waydroid-extra/images`e **symlink**'lenir.
  `os.path.isfile()` symlink'i takip eder → kopya gerekmez (**2.4 GB tasarruf**).
- init artık `-i "$PREINST"` ile çağrılıyor.
- **SELF-HEAL**: symlink yoksa betik her kurulumda yeniden kurar.
- **GÖRÜNÜRLÜK**: init logunda `Downloading` geçerse UYARI basar — bir daha
  sessizce yavaşlamaz.

## Doğrulama (canlı)
```
init: 5-10 dk → 1 SANİYE · Downloading satırı: 0
mi111 gerçek kurulum: boot_completed=1, ADB bağlı, 65 sn'de açıldı
self-heal: symlink silindi → otomatik geri kuruldu, indirme 0
```

## ⚠️ SÜREÇ HATASI — tekrarlanmasın
Teşhis sırasında test için **`mi111` adı canlı isim havuzundan alındı** ve
operatörün aynı anda kurduğu cihazla çakıştı; o kurulum
`"Can't find service: package"` ile düştü. **Test instance'ları canlı havuzdan
alınmamalı** (yüksek bir ad, ör. `mi900+`, kullanılmalı).

## Bağlantılı
[[RESUME-kaldigimiz-yer-2026-08-04]] · [[instance-isim-mezarligi-2026-08-04]]
