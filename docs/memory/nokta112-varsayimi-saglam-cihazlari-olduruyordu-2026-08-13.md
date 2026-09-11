---
name: nokta112-varsayimi-saglam-cihazlari-olduruyordu-2026-08-13
description: "🔴★★★ '.112 VARSAYIMI' 3 YERDE: health-watch sağlam cihazları ZOMBIE sanıp yeniden başlatıyor, 6 turda DEGRADED kilitliyordu (bugün 98 gereksiz restart, 29 cihaz kilitli — 29'u da SUÇSUZ). ★DHCP 23 cihaza .112 DIŞI adres veriyor. ★A/B: mi270 betik→.172.112 'not found' / GERÇEK→.172.211 'device'. ★Tek-tek ADB kurtarma HİÇ YOKTU (eşik: filonun yarısı)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-12T23:16:01.667Z
---

# ".112 varsayımı" — sağlam cihazları öldüren üçüncü kök

## Belirti (operatör)
"Cihazlar kendi kendine duruyor", panelde **"Durduruldu"**, Telegram'da sürekli:
```
⚠️ Sağlık uyarısı [DEVICE_DEGRADED]: wa-ekhp
6 ardisik zombie-restart sonuc vermedi; otomatik restart durduruldu
```

## ★★★ KÖK NEDEN — kod IP'nin son oktetini VARSAYIYORDU
Üç ayrı yerde `192.168.<subnet>.112` **üretiliyordu**:
```
wd-health-watch.sh:187   adb_addr_for()  -> echo "192.168.$sn.112:5555"
agent.mjs:11971          reachSubnets    -> /192\.168\.(\d+)\.112/
agent.mjs:12009          reconnect       -> adb connect 192.168.${sub}.112:5555
```
DHCP başka adres verince varsayım TUTMUYOR. **CANLI ÖLÇÜM (DB):**
```
.112 olan     : 112 cihaz
.112 OLMAYAN  :  23 cihaz   ← hepsi YENİ cihazlar (mi244, mi256-mi271)
```

## ★★ A/B KANIT (aynı instance, yan yana)
```
mi270  betik bakıyor →192.168.172.112:5555 = "error: device not found"
       GERÇEK adres  →192.168.172.211:5555 = "device"     ← cihaz SAĞLAMDI
```
Betik ADB'ye ulaşamayınca "reconnect başarısız + host süreci ayakta" görüp
**ZOMBIE** ilan ediyor → cihazı yeniden başlatıyor → 6 tur sonra **DEGRADED**
işaretleyip DURDURUYOR. Cihaz hiç bozuk değildi.

## HASAR (bir günde)
```
98  gereksiz zombie-restart (12 Ağu)
45  DEGRADED bildirimi / 12 benzersiz cihaz
29  zfail kilidi  → doğrulandı: 29'unun da 29'u SUÇSUZ
     18'i zaten ADB'de "device"; kalan 8'i tek `adb connect` ile 8/8 geri geldi
```

## ★ İKİNCİ BOŞLUK — tek cihaz için kurtarma HİÇ YOKTU
`adbRecoveryTick`'te yeniden bağlanma YALNIZCA "filonun yarısından fazlası
erişilemez" (adb server wedge) olunca çalışıyordu. Filo 123/124 sağlıklı olduğu için
eşik hiç tetiklenmedi → tek tek düşen uçları **kimse geri bağlamadı** → cihaz
panelde sonsuza kadar "Durduruldu".

## FIX (deploy edildi + canlı doğrulandı)
1. `adb_addr_for()` → adresi container'ın kendi eth0'ından OKUR (yedek: lease dosyası,
   son çare eski varsayım). **Test: 6/6 doğru.**
2. `agent.mjs` → `instanceIp(inst)` yardımcısı; `.112` regex'i `\.\d+` oldu. **4/4 doğru.**
3. `agent.mjs` → tek-tek uç kurtarma (`adb-reconnect`), tur başına 12 cihaz limitli.
4. 29 yanlış `zfail-*` kilidi temizlendi.

## SONUÇ (canlı)
```
deploy ONCESI : 131 ONLINE / 10 OFFLINE · health-watch "zombie" spam'i
deploy SONRASI: 140 ONLINE /  1 OFFLINE
health-watch  : "TAMAM: 139 sağlıklı, 0 reconnect, 0 ERİŞİLEMEZ, 0 çıkış-ölü"
```

## ⚠️⚠️ DERS — AYNI TUZAK ÜÇÜNCÜ KEZ
"IP'yi isimden/subnet'ten ÇIKARMA" 30 Tem'de (mi46 = .47.**112** değil) ve 12 Ağu'da
(mi244 = **.53**) yazılmıştı; ikisinde de yalnızca o anki çağrı düzeltildi, **kodda
üreten yerler bırakıldı**. Bu filoda adres DAİMA canlı kaynaktan okunmalı.

## ⚠️ TEŞHİS TUZAĞI
`/var/log/<inst>-ct.log`'daki "Starting up container" satırını "yeniden başladı" diye
okudum — dosyada TEK kayıt olduğu için o aslında İLK açılıştı (`grep -c` = 1). Restart
sayısını `NRestarts` ve health-watch logundan doğrula.

İlgili: [[adb-reap-kayit-oldururken-numara-yakiyordu-2026-08-13]] ·
[[health-watch-kurtarma-cihazi-bozuyordu-2026-08-05]] · [[mi46-netd-resolver-adb-uc-karisikligi-2026-07-30]]
