---
name: gonderim-hizi-ve-yanlis-cpu-alarmi-2026-08-19
description: WhatsApp gönderimi 18.3→12.6 sn (ekran dökümü 2050ms vs odak 35ms) ve yanlış CPU satürasyon alarmının kökü (250ms örnekleme penceresi)
metadata:
  type: project
---

# 🟢★★★ GÖNDERİM 18.3 → 12.6 sn · 🔴★★★ CPU ALARMI YANLIŞTI (3. kez)

## Ölçüm anahtarı KODDA ZATEN VAR — tahmin etme

`FLEET_SEND_TIMING=1` (systemd drop-in ile açılır) `whatsappSend` adımlarını
zaman damgasıyla loglar. Gerçek döküm:

```
ensureTouch                     +3453ms
ensureAdbKeyboard               +3588ms
chat opened (entry poll)       +13134ms   ← en büyük kalem
dialog+invalid check (1 dump)  +15678ms
send tap + verify              +18305ms
SENT                           +18337ms
```

## ★★★Ana kalem: ekran dökümü çok pahalı

**Canlı ölçüm (3 tekrar):** `uiautomator dump` **~2050 ms**, `dumpsys window`
**~35 ms** → **60 kat**. Sohbet açma döngüsü her turda tam ekran dökümü alıyordu.
FIX: önce **odak** sor, pahalı dökümü yalnız `Conversation` öne gelince al.
Sonuç: `chat opened` 13134→**6853 ms**, toplam **18.3→12.6 sn**, 5/5 SENT.

⚠️**BENİM YAPTIĞIM HATA — tekrar etme:** sayaç tabanlı döngüde (9 tur) turlar
ucuzlayınca **toplam bekleme bütçesi de kısalır** (23 sn → 8 sn) ve yavaş açılan
sohbetler `CHAT_NOT_OPENED`'a düşer. Ucuz kapı eklerken döngüyü **SÜRE tabanlı**
yap (`Date.now() + 23000`), yoksa performans iyileştirmesi sessizce güvenilirlik
kaybına dönüşür.

⚠️Kalan kalem: **`ensureTouch` ~3.4 sn** — `ensureVtouch` her gönderimde
`wa-bringup.sh` çalıştırmayı deniyor (dosya cihazda VAR) ama vtouch oluşmuyor;
`VT_CACHE_MS=60000` olduğu için neredeyse her gönderimde tekrarlanıyor.
Negatif sonucu uzun süre önbelleğe almak ~3.4 sn daha kazandırır. HENÜZ YAPILMADI.

## 🔴Yanlış CPU satürasyon alarmı — kök: 250 ms örnekleme penceresi

Operatöre **8 dakikada 6** "CPU %91-98 meşgul (gerçek satürasyon)" bildirimi gitti;
o sırada **load 14-19/80 (=%17-24)** idi. Ajanın kendi algoritmasıyla 40 örnek:

```
min 9 · medyan 25 · p90 54 · max 97   →  40 örnekten YALNIZCA 1'i ≥90
```

CPU gerçekte ~%25; 250 ms'lik pencere ara sıra ani tepe yakalıyor, alarm **tek
örnekle** ateşliyor. ⚠️`guest`/`guest_nice` = 0 doğrulandı → bilinen `/proc/stat`
**çift-sayma hatası DEĞİL**, tamamen örnekleme gürültüsü.

FIX iki taraflı: ajan penceresi **250→1500 ms** (aynı ölçümde 13-31 aralığı) ve
API'de **süreklilik şartı** `CPU_SAT_STREAK=3` (tur 60 sn → ≈3 dk kesintisiz).

★DERS: bu alarm **üçüncü kez** yanlış ateşledi (önce `load` eşiği, sonra bu).
Bir eşik değiştirmeden önce **o metriği kendi algoritmasıyla 20-40 kez örnekle** —
tek okuma ile karar veren alarm er geç kurt masalına döner.

Bkz. [[cpu-alarm-load-yaniltici-2026-08-05]] · [[wa-ban-yoklamasi-bayat-on-plan-2026-08-19]] ·
[[wa-gecikme-mesgul-cihaz-ve-bilgi-karti-2026-08-17]]
