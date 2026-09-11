---
name: ram-tavani-alarmi-ve-lsof-tuzagi-2026-08-13
description: "🟢★★★ RAM TAVANI ALARMI eklendi (3 sinyal: ramLow<%15 · swap>=%20 · <10 cihaz sığıyor) — daha önce SADECE CPU+disk izleniyordu, oysa bu filoda ilk duvar RAM. ★Deploy'dan 1 dk sonra uçtan uca ateşledi. ⚠️⚠️KENDİ `lsof` KOMUTUM 45 GB RAM YEDİ ve swap'ı %100 doldurdu → tavanı ~195 sandım, temizleyince GERÇEK ~233 çıktı."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-13T01:50:53.370Z
---

# RAM tavanı alarmı + kendi ölçüm aracımın yarattığı sahte kriz

## Operatör sorusu
"Filo büyürse sıkıntı olur, nerede bozulur/patlar?"

## ★★★ CEVAP: İLK DUVAR RAM — ve alarmı YOKTU
Host alarmları CPU ve diski izliyordu (`HOST_SATURATED`), **RAM'i izlemiyordu**.
Ölçülen tavanlar (13 Ağu, 250 GB / 80 çekirdek):
```
RAM       : cihaz başı ~1.1 GB  → TAVAN ~233 cihaz   ← İLK DUVAR
subnet    : 165/492 (12 Ağu genişletildi)            → sorun değil
CPU       : %92 boşta, 80 çekirdek                   → bol
disk      : 117 GB / 3.2 TB                          → alakasız
D-Bus     : 126/1024 (5 Ağu çözüldü)                 → sağlam
thread    : 184K / 2.05M · pg 43/100 · inotify 1024  → uzak
```
RAM biterse Waydroid container'ları OOM ile ölür → cihazlar rastgele düşer ve
**süren kayıtlar yarıda kesilir (numara yanar)** — sessizce fark edilmesi en pahalı arıza.

## ⚠️⚠️ EN BÜYÜK DERS — ÖLÇÜM ARACIM KRİZİ KENDİSİ YARATTI
Tavan ölçerken çalıştırdığım `sudo lsof | wc -l` 600 sn'de bitmeyip **arka planda
çalışmaya devam etti** ve **45.2 GB RAM** yedi, swap'ı **%100** doldurdu.
```
kirli ölçüm : 223/250 GB used · avail 27 GB · cihaz başı 1320 MB → "tavan ~195"
lsof öldü   : 178/250 GB used · avail 72 GB · cihaz başı 1098 MB → GERÇEK ~233
```
Yani operatöre **yanlış bir tavan rakamı** verdim ve neredeyse gerçek bir OOM'a sebep
oluyordum. ★161 instance'lı bir hostta `lsof` (argümansız) ÇALIŞTIRMA — `/proc/sys/fs/
file-nr` aynı bilgiyi bedavaya verir. Aynı sınıf tuzak `pgrep -f` ile de yaşandı
(kendi komutunu yakalar).

## FIX — 3 sinyalli alarm (agent → API → Telegram)
**agent.mjs** `hostCapacityMetrics()`: artık `ramTotalGb` + `swapUsedPct` de gönderir.
★`free` DEĞİL **`available`** ölçülür — buff/cache geri kazanılabilir olduğu için
`free` bu makinede daima ~2 GB görünür (ölçüm: free 1.9 GB / available 40 GB).

**index.ts** `HOST_SATURATED` bloğu (mevcut CPU/disk kontrolünün yanına):
```
ramLow      : kullanılabilir RAM < %15
swapping    : swap >= %20        ← RAM tükenmeden ÖNCEKİ ilk işaret
capacityLow : < 10 cihaz sığıyor (ÖLÇÜLEN cihaz-başı maliyetten, sabit varsayım YOK)
```
Alarm metni ne yapılacağını da söyler: *"YENİ CİHAZ KURMAYI DURDURUN … RAM ekleyin
veya ikinci host tanımlayın"* — "boşta cihazı uyut" burada YETERSİZ (sorun anlık yük
değil, kalıcı tavan).

★ Şema: `Host.ramTotalGb` + `Host.swapUsedPct` (migration idempotent, `IF NOT EXISTS`).
⚠️ Zod şemasına da eklemek ŞART — yoksa alanlar **sessizce düşer** ve alarm veri görmez.

## KANIT — uçtan uca canlı doğrulama
```
deploy +1 dk : Telegram → "⚠️ Sunucu kaynağı kritik: phoenixnap-a1c5 · swap %100"
DB ↔ gerçek  : 84 GB free / %100 swap / 154 cihaz — BİREBİR aynı
swapoff/on   : swap %100 → %0 (cihazlar etkilenmedi: 155 wd-run / 154 adb)
sonra        : ramLow hayır · swap hayır → ALARM SUSTU
```
Birim test 6/6 (bugünkü gerçek veri · tavana dayanma · **eski agent verisi yok →
alarm susmalı**). ★Bugünkü durumda RAM %16 ile `ramLow` eşiğinin ÜSTÜNDEYDİ ama
**swap sinyali yakaladı** — üç sinyali birlikte koymak bu yüzden doğru karar.

## ⚠️ SWAP KENDİLİĞİNDEN BOŞALMAZ
Kernel swap'ı geri almaz; RAM bollaşsa bile %100 kalır ve alarmı boşuna tetikler.
Temizlik: `swapoff -a && swapon -a` — ÖNCE `available > swap*1.5` doğrula (85 GB vs
8 GB → güvenliydi).

## ÖNERİ (operatöre verildi)
**~185-200 cihazda dur.** 233 teknik tavan ama tampon kalmaz; bir provision dalgası
OOM tetikler. Kalıcı: RAM ekle (512 GB ≈ 460 cihaz) veya ikinci host (`Device.hostId`
zaten var, mimari destekliyor).

İlgili: [[subnet-tavani-238den-492ye-2026-08-13]] · [[cpu-alarm-load-yaniltici-2026-08-05]] ·
[[dbus-baglanti-limiti-kurulum-donuyor-2026-08-05]]
