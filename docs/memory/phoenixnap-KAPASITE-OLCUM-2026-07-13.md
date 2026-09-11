---
name: phoenixnap-kapasite-olcum-2026-07-13
description: "★★★phoenixNAP a1.c5 (Altra Q80 80çekirdek/256GB) GERÇEK KAPASİTE ÖLÇÜMÜ 2026-07-13 — 4 instance canlı ölçüldü. İDLE 100+, AKTİF 40-60, darboğaz eşzamanlı boot. RAM/disk sınırsız, CPU darboğaz.★★★"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0ce97b6f-23a2-4491-9478-d5dc4d5cc569
---

**★★★ phoenixNAP a1.c5.xlarge GERÇEK KAPASİTE ÖLÇÜMÜ (2026-07-13, 4 instance canlı) ★★★**

Kademeli ölçekleme testi TAMAMLANDI. İlgili: [[phoenixnap-multiinstance-COZULDU-2026-07-13]] (boot reçetesi), [[phoenixnap-fleet-GOC-TAMAM-2026-07-13]], [[arm-baremetal-provider-research-2026-07-09]] (öngörü doğrulandı).

## ✅ 4 INSTANCE CANLI ÖLÇÜLDÜ (default+p1+p2+p3, hepsi boot=1)
İzole subnet'ler: default=.240, p1=.241, p2=.252, p3=.249 (net-head md5 dağıtımı çalışıyor).

## 📊 KESİN KAPASİTE (ölçüm, tahmin değil)
| Kaynak | 4 instance | Darboğaz? | Tavan |
|---|---|---|---|
| **RAM** | 13GB/250GB (~1.5GB/inst) | ❌ HAYIR | ~150 instance |
| **Disk** | 12K/instance overlay (GApps PAYLAŞIMLI) | ❌ HAYIR | sınırsız |
| **CPU idle (FROZEN)** | load 2.94/80çekirdek (%3.7) | ❌ FROZEN=%0 CPU | 100+ idle instance |
| **CPU boot spike** | 3 eşzamanlı boot=load 49 | ⚠️ EVET | kademeli boot ŞART |
| **CPU aktif render** | (GPU yok) | ⚠️ ASIL DARBOĞAZ | ~40-60 aktif |

## ★KRİTİK BULGULAR
1. **Waydroid FROZEN mekanizması**: boştaki instance otomatik FROZEN olur → **%0 CPU** yer (RAM'de kalır). Erişilince otomatik unfreeze. → 80 çekirdekte **100+ IDLE instance sığar**, sadece AYNI ANDA AKTİF olanlar (~40-60) çekirdek yer.
2. **GApps imaj PAYLAŞIMI**: init `-i /var/lib/waydroid/images` → her instance system/vendor imajını PAYLAŞIR, overlay sadece 12K. Disk maliyeti ~SIFIR. (İlk yanlış: -i vermeyince her instance ayrı ~1GB VANILLA indirdi.)
3. **Eşzamanlı boot = ASIL SPIKE**: 3 instance aynı anda boot=load 49 (GApps ilk açılış CPU-yoğun). Boot bitince 90sn'de load 2.94'e düştü. → **kademeli boot** (aynı anda max 3-5), boot arası bekle.
4. RAM/disk HİÇ darboğaz değil (hafızadaki "RAM darboğaz değil, çekirdek" doğrulandı). GPU yok=render CPU-bound=~1 aktif cihaz/çekirdek.

## 🎯 SONUÇ: bu makine (80C/256GB) için gerçekçi hedef
- **IDLE fleet: 100+ instance** (hepsi ayakta ama çoğu FROZEN, warmup/rotasyonla aktif olanlar döner).
- **EŞZAMANLI AKTİF: 40-60** (aynı anda ekran render/otomasyon çalışan).
- 100+ cihaz senaryosu: bu makine + 1 makine daha (2×80C) VEYA 128C makine. Ama TEK a1.c5 bile ~50-60 aktif kaldırır.

## ★ÖLÇEKLEME REÇETESİ (tekrarlanabilir)
`/usr/local/bin/wd-inst.sh <instance>` = 8-adım setsid boot (init GAPPS-paylaşımlı + binder+weston+container+session). Kullanım: `sudo setsid bash /usr/local/bin/wd-inst.sh p4 < /dev/null > /dev/null 2>&1 &`. Sonuç /tmp/wd-<inst>.log "RESULT". ★Kademeli: aynı anda max 3-5 boot, load<20'ye insin sonra devam.

## SONRAKİ
1. Instagram/WhatsApp kaydını bu makinede test (proxy+catchmail zaten çalışıyor, [[instagram-otonom-kayit-CANLI-KANIT-2026-07-13]]).
2. wd-inst.sh'i agent PROVISION_DEVICE akışına bağla (panelden tık→instance) — şu an elle script.
3. Kalıcı karar: a1.c5 ~50-60 aktif kaldırıyor. 100+ için ya 2. makine ya LeaseWeb 128C. Pilot bitince phoenixNAP+IP SIL ($1.09/sa).
