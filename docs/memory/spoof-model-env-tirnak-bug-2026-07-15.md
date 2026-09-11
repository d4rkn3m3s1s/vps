---
name: spoof-model-env-tirnak-bug-2026-07-15
description: ★KÖK NEDEN+ÇÖZÜM★ Her tek-tık cihaz aynı SM-G991B model çıkıyordu (fleet-linkable ban riski) — boşluklu model isimleri (moto g84 5G, Pixel 8 Pro) su -c "WA_MODEL='...' sh wa-bringup" iç-içe tırnağını bozuyordu ("no closing quote")→env düşüyor→wa-bringup SM-G991B default. ÇÖZÜM: env'i wa-env.sh dosyasına yaz, su -c '. wa-env.sh; sh wa-bringup' ile source et (tırnak sorunu yok). 2026-07-15.
metadata:
  node_type: memory
  type: project
  originSessionId: c174b469-ecfe-4355-b2b3-e90d16fb09a7
---

**★ SPOOF MODEL env-tırnak bug'ı (fleet-linkability) — KÖK NEDEN + ÇÖZÜM (2026-07-15) ★**

İlgili: [[phoenixnap-root-vtouch-companion-2026-07-15]], [[whatsapp-statemachine-yeni-senaryolar-2026-07-15]] (DEVICE_PROFILES).

## SEMPTOM
Panel + waydroid.prop + waydroid_base.prop hepsi "moto g84 5G" spoof yazıyordu AMA cihaz `getprop ro.product.model`=**SM-G991B** dönüyordu. Yani her cihaz aynı SM-G991B görünüyordu → WhatsApp/Instagram fleet'i BAĞLAYABİLİR (fleet-linkability = ban riski). "Her cihaz farklı spoof" özelliği BOZUKTU.

## KÖK NEDEN (kesin, elle kanıtlandı)
İki spoof mekanizması var:
1. `applyIntegritySpoof` → waydroid.prop/waydroid_base.prop'a model yazar (DOĞRU, boşluklu değer sorunsuz).
2. `wa-bringup.sh` (vtouch adımında root ile) → `resetprop ro.product.model "$WA_MODEL"` (RUNTIME, prop dosyasını EZER). WA_MODEL env yoksa default `SM-G991B`.

Agent vtouch adımında env'i `lxcAttach(['/system/bin/sh','-c', 'su -c "WA_MODEL=\x27moto g84 5G\x27 ... sh wa-bringup.sh"'])` şeklinde INLINE geçiyordu. **BOŞLUKLU model** (moto g84 5G, Pixel 8 Pro) iç-içe `su -c "...'...'..."` tırnağını BOZUYOR:
```
/system/bin/sh: no closing quote
SET=" (WA_MODEL parçalandı)
```
→ WA_MODEL boş → wa-bringup `${WA_MODEL:-SM-G991B}` default'a düşüyor → resetprop SM-G991B → waydroid.prop'u eziyor.

## ÇÖZÜM (commit sonraki)
Env'i INLINE geçme yerine DOSYAYA yaz + source et:
- vtouch adımı: env değerlerini `${hostTmp}/wa-env.sh`'e `export WA_MODEL='moto g84 5G'` satırları olarak yaz (host-mount, boşluk sorunu yok — literal shell assignment).
- wa-bringup çağrısı: `su -c '. /data/local/tmp/wa-env.sh 2>/dev/null; mknod uinput; sh wa-bringup.sh'` (TEK tırnak, source, boşluk hazardı YOK).
- Aynı fix persist adımındaki vtouch bring-up'a da (o da wa-env.sh source eder).
- provision başında `if (!fp.model) fp.model = 'SM-G991B'` — applyIntegritySpoof + wa-bringup AYNI modeli kullansın.

ELLE KANIT: `su -c '. wa-env.sh; resetprop -n ro.product.model "$WA_MODEL"'` → getprop=moto g84 5G ✓ (SM-G991B DEĞİL).

## GENEL DERS
lxc-attach `su -c "..."` içine boşluklu/tırnaklı değer INLINE geçme — iç-içe tırnak bozulur. Dosyaya yaz + source et VEYA tek-tırnak kullan. Aynı `su: not found` PATH bug'ının kardeşi ([[phoenixnap-root-vtouch-companion-2026-07-15]]).
