---
name: wa-medya-ethernet-zorla-indirme-2026-08-15
description: "ÇÖZÜLDÜ — gelen foto inmiyordu; kök BOZUK REHBER KAYDI (kendi ensureContacts hatamız), ethernet DEĞİL. Rehber düzelince foto otomatik indi. Zorla-indirmeye gerek kalmadı."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-15T14:05:19.444Z
---

# WA gelen medya İNMİYORDU — kök: BOZUK REHBER KAYDI (ÇÖZÜLDÜ)

⚠️ Bu notun ilk hâlindeki **"WA ethernet'te otomatik indirmiyor" teşhisi YANLIŞTI.**
Gerçek kök **kendi kodumuzdaki rehber hatasıydı**.

## Gerçek kök (kendi hatamız)
`ensureContacts` yeni kişiyi eklerken `raw_contact` id'sini **`_id DESC` ile TAHMİN**
ediyordu. Ardışık eklemede numara **YANLIŞ kişinin kaydına** yazılıyordu.
Canlı kanıt (113.230): `display_name=+905327329497, data1=+905349636768` — isim başka
kişinin. Aynı `raw_contact_id`'ye iki farklı numara. WhatsApp böyle bir kişiyi
**"güvenilmez" sayıp gelen medyayı OTOMATİK İNDİRMİYOR** (mesaj gelir, medya file_size=0).

## Kanıt zinciri (113.230, aynı cihaz/ağ/maske — tek değişen rehber)
- 13:38:45 / 13:38:51 / 13:38:57 → **İNMEDİ** (rehber bozukken)
- Rehber düzgün senkronlanınca (`raw_contact_id=31, display_name=Efe, number=+9053496…`)
- 13:51:18 → **İNDİ (15303 byte, OTOMATİK)** ✅

## Fix (commit 12f4f36)
- `ensureContacts`: her kişi kendi hesabına yazılır (`account_name=fleet<numara>`),
  id **sorguyla kesin** bulunur (tahmin yok). İsim `Kisi<numara>` — WA numara-formatlı
  (`+905…`) ismi gerçek isim saymıyor (çalışan cihaz 147.235'te isim `Kisi905349636768`).
- Filo onarımı: `deploy/kvm-host/scripts/fix-contacts.sh` — isim "+numara" formatında AMA
  telefon numarası farklı olan data satırlarını siler; **gerçek isimlere (Efe, Ahmet) DOKUNMAZ**.
  153 cihaz tarandı, 9 bozuk kayıt temizlendi, kalan 0.

## ⏭️ Zorla-indirme GEREKMİYOR
Rehber düzgünse WA kendisi indiriyor. (Balona `input tap` ile manuel indirme de çalışıyor —
acil durumda kullanılabilir ama otomatik akış için gerek yok.)

## Yan bulgular
- Root ile 3 maskeyi (roaming/cellular/wifi=15) **düzgün XML** ile yazmak KALICI
  (önceki "root tutmuyor" yanılgısı bozuk XML'dendi — çift `</map>`). Ama asıl kök bu değildi.
- `Transports: ETHERNET` her iki cihazda da aynı; standby bucket, izinler, netpolicy de aynı.

İlgili: [[wa-apk-toplu-guncelleme-ozelligi-2026-08-15]] · [[autodownload-checkbox-surumden-bagimsiz-2026-08-15]]
