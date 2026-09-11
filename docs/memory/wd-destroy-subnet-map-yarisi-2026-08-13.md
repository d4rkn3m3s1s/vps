---
name: wd-destroy-subnet-map-yarisi-2026-08-13
description: "🔴★★★ TOPLU SİLMEDE subnet-map YARIŞI: wd-destroy'un harita silme bloğu KİLİTSİZDİ → N paralel destroy birbirinin silmesini eziyordu. A/B: ESKİ 8/12 kaldı, YENİ 0/12. ★Ayırt edici: TEK silme çalışıyor, TOPLU silme HİÇ silmiyor. ★net-head.sh'te kilit VARDI (3 ref), wd-destroy'da YOKTU (0 ref). ⚠️Ölçüm hatam 155 cihazı 'orphan' gösterdi (chr() kaçışı bozuktu)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-13T02:24:30.740Z
---

# wd-destroy subnet-map yarışı — toplu silmede hiçbir satır silinmiyordu

## Bağlam
Önceki turda "132 emekli cihazın 28'i haritada duruyor, `wd-destroy.sh` siliyor
görünüyor ama kayıtlar kalıyor — **kök neden araştırılmadı**" diye bırakılmıştı.

## ★★★ KÖK NEDEN — kaybolan güncelleme (lost update)
Harita silme bloğu "oku → süz → geri yaz" yapıyor ama **KİLİTSİZDİ**:
```bash
grep -vE "^$INSTANCE " "$MAP" > "$tmp" && cat "$tmp" > "$MAP"   # kilit YOK
```
Operatör panelden birden çok cihazı birden silince agent `DEVICE_DESTROY` işlerini
**aynı anda** koşturuyor. N süreç haritayı aynı anda okuyup yazınca **son yazan,
diğerlerinin silmesini eziyor**.

## ★★ AYIRT EDİCİ BULGU (teşhisin anahtarı)
```
TOPLU silme (11 iş, 01:33:45-46 aynı saniye) → 11/11 HARİTADA KALDI
TEK silme   (mi287, mi284)                    → 0/2 kaldı ✓ (doğru çalıştı)
wd-destroy.sh kilit referansı : 0   ← ATOMİK DEĞİL
net-head.sh  kilit referansı : 3   ← bu yüzden O çalışıyordu
```
★ "Betik doğru mu?" diye tek başına test etmek YETMEZ — tek çağrıda kusursuz
çalışıyordu (canlı test: satırı sildi + mezarlığa ekledi). Hatayı **paralellik**
ortaya çıkarıyor.

## A/B KANIT (canlı, 12 sahte kayıt + 12 PARALEL silme)
```
ESKİ kod → 8/12 KALDI
YENİ kod → 0/12 kaldı   ✅
```

## FIX
`net-head.sh`'in **KULLANDIĞI AYNI** mkdir-tabanlı kilit (flock'suz — betik `sh` ile
de çalışabiliyor). Aynı kilit olması ŞART: net-head TAHSİS ederken biz SİLERSEK
yarış tahsis tarafında da oluşur. 5 sn sonra zorla devam eder — silmeyi BLOKLAMAK
daha kötü (cihaz zaten yok edilmiş).

Ayrıca 11 hayalet kayıt temizlendi: **boş subnet 321 → 332**, canlı 155/155 cihaz
haritada (0 kayıp).

## ⚠️⚠️ KENDİ ÖLÇÜM HATAM — 155 cihazı "ORPHAN" ilan ettim
`metadata->>'instance'` sorgusunu `chr()` kaçışlarıyla yazdım, sorgu **boş döndü**
→ karşılaştırma listesi boş → **her cihaz "DB'de yok"** göründü. Bir an "155 orphan
var" sandım. Düz tırnakla yeniden çalıştırınca: 155 kayıt, **gerçek orphan 0**.
★ Bir karşılaştırma listesi BOŞ dönüyorsa, sonucu yorumlamadan ÖNCE listenin
kendisini doğrula (`wc -l`) — boş liste "hiçbiri eşleşmedi" gibi görünür.

## ⚠️ Yanlış çıkan diğer hipotezler
- "wd-destroy betiği bozuk" → HAYIR, tek çağrıda kusursuz (canlı test edildi)
- "zombi wd-run harita'ya geri yazıyor" → HAYIR, hayaletlerin hepsi `wd-run=0`
- "mi111/mi112 orphan" → HAYIR, ikisi de DB'de kayıtlı ve meşru

İlgili: [[subnet-tavani-238den-492ye-2026-08-13]] · [[instance-isim-mezarligi-2026-08-04]] ·
[[subnet-cakismasi-kurulum-olduruyordu-2026-08-12]]
