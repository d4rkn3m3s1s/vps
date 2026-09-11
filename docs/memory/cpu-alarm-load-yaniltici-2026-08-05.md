---
name: cpu-alarm-load-yaniltici-2026-08-05
description: "🔴★★★CPU SATÜRASYON ALARMI YANLIŞ: `load >= cores*0.9` eşiği bir gecede 13 bildirim gönderdi ama ölçümde load 90 iken CPU %96.5 BOŞTAYDI. Waydroid'de load CPU'yu DEĞİL uyuyan thread sayısını yansıtır (92 cihaz≈105.000 thread). FIX:agent /proc/stat'tan cpuBusyPct gönderiyor, eşik busy>=90. ⚠️24 Tem'de aynı tuzak provision için çözülmüş ama ALARM'a uygulanmamıştı."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b35fb77-30e7-48f7-a51f-ef2ea6daeb6b
  modified: 2026-08-05T01:22:06.462Z
---

# CPU satürasyon alarmı yanlış ateşliyordu (5 Ağustos 2026)

## Belirti
Operatörün Telegram'ına **bir gecede 13 kez**:
> ⚠️ *"Sunucu kaynağı kritik: CPU yükü 90/80 (satürasyon). Cihazlar
> yavaşlayabilir/donabilir…"*

## ★★★ Kök neden — load average bu filoda CPU'yu ÖLÇMÜYOR
Alarm koşulu `load >= cores * 0.9` (yani ≥72) idi. **Aynı andaki canlı ölçüm:**
```
load: 90            CPU boşta: %96.5        çalışan thread: 1-3
toplam thread: ~105.000  (92 cihaz × ~1150 thread)
o saatte ağır iş: YOK (yalnızca hafif WHATSAPP_RECEIPTS)
```
Waydroid'de load, CPU'yu **değil uyuyan thread sayısını** yansıtır. Filo büyüdükçe
(48 → 92 cihaz) load-tabanlı eşik sürekli aşıldı → alarm değersizleşti
(**kurt masalı**: gerçek bir doygunlukta da ayırt edilemezdi).

⚠️ **Bu tuzak 24 Tem'de bir kez daha yaşanmıştı** ([[sunucu-kasma-cozum-5ajan-2026-07-24]]:
*"load 98 YANILTICI, CPU %47 idle"*) — o zaman **provision** için çözülmüş ama
**alarm**a uygulanmamıştı. Aynı hata iki farklı yerde.

## Fix (commit `5bfceb2`)
- `agent.mjs`: heartbeat artık **`cpuBusyPct`** gönderiyor — `/proc/stat`'tan iki
  örnekle gerçek meşguliyet. ⚠️ Fonksiyon (`cpuBusyPct()`) **zaten vardı** ve
  provision kararı onu kullanıyordu; sadece API'ye hiç gönderilmiyordu.
- `Host.cpuBusyPct` kolonu (migration, `IF NOT EXISTS`).
- `index.ts`: eşik **`busy >= 90`**. `cpuBusyPct` yoksa (eski agent) load'a düşer
  ama eşik `0.9×` → **`2×cores`** (bu filoda load rutin olarak cores'un yarısını aşıyor).
- Alarm metni ikisini birden gösteriyor: `"CPU %95 meşgul (gerçek satürasyon, load 40/80)"`.
- `loadAvg1m` korundu (panel/geçmiş için).

## Test — 14/14
canlı yanlış alarm (load 90, busy 3) → eski **alarm veriyor**, yeni **susuyor** ·
gerçek doygunluk (busy 90/95/100) → **hâlâ alarm** · sınır (busy 89) → sus ·
eski-agent fallback (load 160/80 → alarm, 90/80 → sus) · kenar (cores=0, busy=0) → sus

## Canlı doğrulama
```
DB: cpuBusyPct=3   ·   sunucu: %96.7 boşta   →  BİREBİR UYUŞUYOR
```

## ★ Genel ders
**Bu filoda `load average`'a ASLA karar bağlama.** Doğru ölçüt `/proc/stat`
idle farkı. Kontrol için: `top -bn2 | grep '^%Cpu' | tail -1` (ilk örnek yanıltıcı).

## Bağlantılı
[[RESUME-kaldigimiz-yer-2026-08-04]] · [[sunucu-kasma-cozum-5ajan-2026-07-24]]
