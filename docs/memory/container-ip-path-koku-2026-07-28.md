---
name: container-ip-path-koku-2026-07-28
description: "★★★AYLARDIR SÜREN 'internet-çıkış/route' sorunlarının GERÇEK kökü: systemd servis PATH'inde /bin ve /sbin YOK. lxc-attach host PATH'ini container'a geçirir; Android'de ip/pm/setprop /system/bin'de ve oraya sadece /bin→/system/bin symlink'i ile ulaşılır. Sonuç: agent'ın HER `lxc-attach -- ip ...` çağrısı 'Failed to exec ip' ile SESSİZCE düşüyordu (hepsi .catch()/2>/dev/null ile yutuluyor) → (1) provision route adımı HİÇBİR ŞEY eklemiyordu (yeni cihaz TCP 000), (2) eth0-heal'in route KONTROLÜ 0 dönüyordu → her tick 'route YOK' (~66 satır/dk sonsuz spam) ve heal hiçbir cihazı onaramıyordu. Elle test EDİNCE ÇALIŞIYOR görünür (interaktif/sudo PATH'inde /bin VAR) → aylarca 'netd route siliyor' sanıldı, netd masumdu: route hiç EKLENMİYORDU. FIX: container-içi ip/pm/setprop MUTLAK yola (/system/bin/ip). ⚠️TUZAK: setprop mutlak olunca `ctl.restart adbd` GERÇEKTEN çalışıp adbd'yi boot ortasında restart etti → ADB@70s→132s → KALDIRILDI. commit 172d659"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1000ff11-d330-4e5b-83fc-9bfb7b16dc6c
  modified: 2026-07-27T22:42:20.754Z
---

# ★★★ container-içi `ip` HİÇ çalışmıyordu — PATH'te /bin yok (2026-07-28)

## KÖK NEDEN
`lxc-attach` **host'un PATH'ini** container'a geçirir. systemd'nin varsayılan servis
PATH'i `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin` — **/bin ve /sbin YOK**.
Android'de `ip`/`pm`/`setprop` `/system/bin` altında ve oraya **sadece `/bin →
/system/bin` symlink'i** ile ulaşılır. Sonuç: agent'ın her çıplak-binary çağrısı
```
lxc-attach: Failed to exec "ip" - No such file or directory
```
ile **sessizce** düşüyordu (tüm çağrılar `.catch()` / `2>/dev/null` ile yutuluyor).

## İKİ SEMPTOM, TEK KÖK
1. **provision route adımı hiçbir şey eklemiyordu** → yeni cihaz internete çıkamaz
   (panel "hazır" der, cihaz TCP 000 → WhatsApp "Couldn't connect"). persist adımı de
   bu yüzden "⚠ çıkış heal-tick ile tamamlanacak" veriyordu.
2. **eth0-heal'in route KONTROLÜ** aynı şekilde düşüp `0` dönüyordu → her tick
   "route YOK" (35 cihaz → ~66 satır/dk **sonsuz spam**) ve heal **hiçbir cihazı
   onaramıyordu** (route-ekleme de aynı sebeple düşer).

## ★ NEDEN AYLARCA BULUNAMADI
Elle test edilince **çalışıyor görünüyor**: interaktif/sudo PATH'inde `/bin` VAR
(`sudo secure_path` = `...:/sbin:/bin`). Bu yüzden "netd route'u siliyor" sanıldı —
**netd masumdu, route hiç EKLENMİYORDU**.

## KESİN TEŞHİS YÖNTEMİ
```bash
# agent'ın PATH'i ile → HATA
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin \
  lxc-attach -n waydroid -P /var/lib/waydroid.<inst>/lxc -- ip route show table eth0
# mutlak yol ile → ÇALIŞIR
lxc-attach -n waydroid -P /var/lib/waydroid.<inst>/lxc -- /system/bin/ip route show table eth0
```
Ayrıca `.catch()` yutuyorsa hatayı görmek için geçici debug log şart (stderr'i yazdır).

## FIX (commit 172d659)
- agent.mjs: container-içi `ip`/`pm`/`setprop` → **mutlak yol** (`/system/bin/...`), 17 çağrı.
- fleet-agent.service: PATH'e `/sbin:/bin` (güvenlik ağı; canlıda drop-in KALDIRILDI çünkü
  mutlak yollar yeterli ve `/sbin` container'da Magisk binary'leriyle çakışabilir).

## ⚠️ TUZAK — düzeltme YENİ hata doğurdu
`setprop` mutlak yola çevrilince `authorizeAdb`'deki `setprop ctl.restart adbd` **gerçekten
çalıştı** → adbd'yi **boot ortasında** yeniden başlattı → ADB yetkilendirme 70s → 89/132s →
provision boot timeout. Aylardır sessizce düşen bu çağrı **gereksizdi** (adbd `adb_keys`'i her
auth denemesinde okur) → **KALDIRILDI**. DERS: uzun süredir sessizce başarısız olan bir çağrıyı
çalışır hale getirmek, o çağrının yan etkisini de ilk kez devreye sokar.

## CANLI KANIT
- heal spam ~66/dk → 110 saniyede 1; `eth0-heal: mi34 → route-added onarıldı` (heal **ilk kez**
  otonom onarım yaptı). Filo 35/35 TCP 301.

Bağlantılı: [[bayat-adb-ucu-kurulum-oldurur-2026-07-28]] [[statik-ip-default-route-eksik-fix-2026-07-27]]
[[eth0-heal-otomatik-kurtarma-2026-07-24]]
