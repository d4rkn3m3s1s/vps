---
name: phoenixnap-arm-skus-2026-07-13
description: "phoenixNAP Bare Metal Cloud ARM SKU'lari (a1.c5 Altra Q80 + a2.c9 AmpereOne A96) — kullanici phoenixnap.com'dan bakiyor; Waydroid icin degerlendirme+riskler+kiyas"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0ce97b6f-23a2-4491-9478-d5dc4d5cc569
---

**★ phoenixNAP Bare Metal Cloud ARM SKU degerlendirmesi (2026-07-13) — kullanici KESIN teyit etti: phoenixnap.com'dan bakiyor ★**

Kullanici 100+ Waydroid olcekleme icin phoenixNAP'tan 2 ARM SKU'suna bakiyor. İlgili: [[arm-baremetal-provider-research-2026-07-09]] (onceki 58-ajan arastirma: ip-projects/Fornex/AWS + LeaseWeb).

## SKU'LAR (ikisi de phoenixNAP, kullanici teyit etti)
1. **a1.c5.xlarge = Ampere Altra Q80-30** (80C@3.0GHz, 256GB DDR4, 2×4TB NVMe, 2×25Gbps). phoenixNAP HPE ProLiant RL300 Gen11. Lokasyon Phoenix AZ + Ashburn VA (ABD, **Avrupa YOK**).
2. **a2.c9.xlarge = AmpereOne A96-36X** (96C@3.6GHz, 384GB DDR5, 4TB+1TB NVMe boot, 2×25Gbps). Yeni nesil AmpereOne.

## ★KRITIK CIP FARKI (Waydroid/binder riski)
- **a1 (Altra Q80-30): EN GUVENLI.** Prod'da KANITLI recete Altra Max M128 (Neoverse-N1/ARMv8.2) uzerinde calisiyor. Q80-30 = BIREBIR AYNI mikromimari (tek fark cekirdek sayisi 80 vs 128). binder DKMS/binderfs/LXC aynen calisir. 32-bit ARM VAR.
- **a2 (AmpereOne A96): RISKLI/erken-benimseyen.** 2 gercek belirsizlik: (1)🔴 **32-bit ARM (AArch32) TAMAMEN DUSURULDU** — sadece 64-bit-only native lib'li APK'lar INSTALL_FAILED_NO_MATCHING_ABIS verir (WhatsApp arm64-v8a=ETKILENMEZ, ama riskli). (2)⚪ AmpereOne'da Waydroid calistigina dair KAMUDA KANIT YOK. binder AYNI (CPU-agnostik), page-size AYNI (4K, ★64K/largemem kernel KURMA=Android bozar). AVANTAJ: 3.6GHz+DDR5+custom cekirdek = cihaz-basi ~%30-40 daha iyi yazilim-render perf.

## FIYAT (phoenixNAP a1.c5 dolar fiyati LOGIN-GATED, web'de gizli!)
- a1.c5: tahmini ~$620-800/ay (DOGRULANMADI, bmc.phoenixnap.com konsol/sales'ten teyit sart). 15TB ucretsiz egress. Saatlik faturalama VAR.
- a2.c9: phoenixNAP fiyati bulunamadi (AmpereOne genelde teklif-bazli). ip-projects Frankfurt AmpereOne A96 €609'dan (baz 64GB).

## KIYAS + KARAR
- **Fiyat/cekirdek LIDERI: LeaseWeb RL300 (Altra Max M128, 128C, Frankfurt, ~€403+€49 kurulum, 256GB config).** phoenixNAP 80C@~$700'e yeniliyor (LeaseWeb %60 fazla cekirdek ~yari fiyat + Avrupa).
- **phoenixNAP'in TEK avantaji: SAATLIK esneklik** (pilot/binder smoke-test icin ideal, taahhutsuz ac-kapat) + ABD lokasyonu sartsa.
- Bare-metal root + IPMI/OOB + rescue mode: HER UCUNDE VAR (recete icin uygun).
- Waydroid gercekci: a1(80C)≈40-45 cihaz, a2(96C)≈50-70, LeaseWeb(128C)≈40-60. GPU YOK=CPU-bound=~1 cihaz/cekirdek, RAM darbogaz DEGIL.

## TAVSIYE
1. Kalici prod: **LeaseWeb/Fornex Altra Max M128 (Avrupa, kanitli nesil, ucuz)** tercih.
2. phoenixNAP: sadece **saatlik binder smoke-test pilotu** icin mantikli (a1 Altra=guvenli test, a2 AmpereOne=once 32-bit+binder+Waydroid canli dogrula).
3. a2 (AmpereOne) alinacaksa: ZORUNLU smoke-test (binder DKMS boot + Waydroid boot + getconf PAGE_SIZE=4096 + WA kayit) + tum APK'larda arm64-v8a lib teyit + 64K kernel KURMA.
4. SONRAKI: kullanici phoenixNAP konsolundan a1.c5 KESIN dolar fiyatini + ARM stok durumunu almali (2026 tedarik krizi).
