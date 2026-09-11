---
name: mi46-netd-resolver-adb-uc-karisikligi-2026-07-30
description: "mi46'nın ölü sanılan çıkışının kökü netd resolver'dı (restart çözdü) — ama ondan önce instance adından ADB adresi çıkarmak yanlış cihazı ölçtürdü"
metadata: 
  node_type: memory
  type: project
  originSessionId: 060eed7a-fef7-42f6-a7d8-158fe471cc89
  modified: 2026-07-30T05:18:06.191Z
---

54 kurtarma denemesi başarısız olan mi46 (`+905340456026`, `#tarik`) **tek restart ile
düzeldi**: WA 000 → **200 ×4 üst üste**, çıkış 94.123.236.177 (TR).

## ★★KÖK: netd resolver bozulmuştu

Ağ katmanının **tamamı** çalışan cihazla (mi30) BİREBİR aynıydı — bu yüzden aylarca
"proxy/ağ bozuk" sanıldı:

| kontrol | mi46 | mi30 (çalışan) |
|---|---|---|
| eth0 IP | 192.168.47.112/24 ✓ | 192.168.30.112/24 ✓ |
| `default via` (table eth0) | ✓ var | ✓ var |
| iptables PREROUTING/REDIRECT | ✓ birebir aynı | ✓ |
| gateway ping | 0% kayıp | — |
| dnsmasq (host) | ✓ dinliyor, `dig` çözüyor | ✓ |
| **`http://1.1.1.1`** | **301 (çalışıyor!)** | — |
| **isimle HTTPS** | **000** | 200 |

⚠️ **Düz HTTP proxy üzerinden GEÇİYORDU** — yani TCP+redsocks+proxy sağlamdı, kopuk olan
YALNIZCA isim çözümlemesiydi. `ndc resolver getnetdns 100` mi46'da **boş** yanıt döndü
(mi30 "Command not recognized" der = normal). `setprop net.dns1/2` yazmak DÜZELTMEDİ —
prop bir BELİRTİ, netd'nin kendi durumu bozuktu. `systemctl restart waydroid@mi46` çözdü.

**Teşhis kısayolu:** IP ile HTTP çalışıp isimle çalışmıyorsa iptables/route/proxy ARAMA —
netd resolver'a bak, çözüm restart.
⚠️ `net.dns1` çalışan cihazlarda da BOŞ — "boş = bozuk" SONUCU ÇIKARMA.

## ★★TUZAK: instance adından ADB adresi ÇIKARMA

mi46'nın adresi **192.168.47.112** (subnets.map: `mi46 47`), `.46` DEĞİL. ADB tablosunda
`.46` ve `.47` **ikisi de** `device` görünüyordu → ben `.46`'yı mi46 sandım ve iki ölçüm
turu **ters sonuç** verdi ("bir turda 200, sonraki turda 000" → yanlışlıkla "çıkış
kararsız" teşhisi koydum).

**Ayırt etme:** `getprop ro.product.model` + DHCP lease'teki cihaz adı. mi46 lease'i
`moto-g84-5G` diyor, `.47`'nin modeli `moto g84 5G` → eşleşme kesin. `.46` ise `2210132G`
(başka cihaz).
★DERS: adresi DAİMA `/var/lib/waydroid-subnets.map`'ten oku; isimden çıkarım yapma.

## ★Waydroid restart VERİ KAYBETTİRMEZ

`systemctl restart waydroid@mi46` sonrası WhatsApp paketi kurulu, `shared_prefs` yerinde,
`registration_state=3` — numara/oturum duruyor. `/data` korunuyor.
⚠️ AMA benim "hesap satırı yok, veri kaybı yok" gerekçem YANLIŞTI: sorgu
`d.name LIKE '%5340456026%'` ile aradı ve tutmadı; numara aslında VARDI. Restart güvenliydi
ama gerekçe hatalıydı. **Cihaz adı numarayı içermeyebilir — hesap satırını `deviceId` ile ara.**

İlgili: [[saglamlik-dns-heal-canary-2026-07-28]] · [[container-ip-path-koku-2026-07-28]] ·
[[statik-ip-default-route-eksik-fix-2026-07-27]] · [[eth0-heal-otomatik-kurtarma-2026-07-24]]
