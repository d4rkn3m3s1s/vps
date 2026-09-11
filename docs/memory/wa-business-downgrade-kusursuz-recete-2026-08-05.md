---
name: wa-business-downgrade-kusursuz-recete-2026-08-05
description: "🟢★★★ Business DOWNGRADE KUSURSUZ REÇETE (boş cihazda baştan sona elle doğrulandı): İKİ ADIM DA a11y CLICK — (1) id=primary_button → onay diyaloğu AÇILIR, (2) text='Deactivate and switch' → AŞILIR. ⚠️Sentetik tap HİÇ geçmez; vtouch basar AMA koordinat ıskalayınca diyaloğu İPTAL edip WhatsApp'ı KAPATIR. Ayrıca tam kayıt akışının tüm adım koordinatları."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-05T18:20:25.136Z
---

# WhatsApp Business downgrade — KUSURSUZ REÇETE

Boş cihazda (mi108 / 192.168.108.112, `+90 535 224 81 39`) baştan sona **elle**
çalıştırılıp her adım ss ile doğrulandı.

## ★★★ DOWNGRADE — İKİ ADIM DA a11y
```bash
# 1) "USE +90…" → onay diyaloğunu AÇAR
am broadcast -a com.fleet.a11y.CLICK --es id primary_button
# 2) Onay diyaloğu → downgrade AŞILIR → PrimaryFlashCallEducationScreen
am broadcast -a com.fleet.a11y.CLICK --es text "Deactivate and switch"
```

### Neden a11y (diğerleri neden OLMAZ)
| Yöntem | Sonuç |
|---|---|
| `input tap 540 2064` (sentetik) | ❌ HİÇ geçmez — eski kodun tek yaptığı buydu, 5 tur spin |
| vtouch `tap 540 2064` | ⚠️ USE+'a BASAR, ama diyalog açılınca 2. tıklama ıskalarsa diyaloğu **İPTAL EDER** — canlıda WhatsApp KAPANDI |
| **a11y CLICK** | ✅ Erişilebilirlik ağacından tıklar, **koordinattan bağımsız, ıskalama YOK** |

⚠️ Onay diyaloğunun düğmeleri **uiautomator dump'a DÜŞMEZ** (dump'ta yalnızca
`com.whatsapp:id/headline` başlığı var) → düğüm bulup tıklamak İMKANSIZ, a11y şart.
⚠️ Diyalog tespiti dump yerine **`screenText`**ten yapılmalı (başlık görünür).

## Tam kayıt akışı — doğrulanmış adımlar (1080×2400)
| # | Adım | Yöntem |
|---|---|---|
| 1 | Alert "OK" | **sentetik** `input tap 583 1351` (vtouch burada ÇALIŞMADI) |
| 2 | EULA "AGREE AND CONTINUE" | `input tap 540 1910` (`id=eula_accept`) |
| 3 | "More options" ⋮ | `input tap 1027 147` |
| 4 | "Register new account" | `input tap 812 430` |
| 5 | İzin "Allow" | `input tap 540 1245` (×2, `id=permission_allow_button`) |
| 6 | Ülke kodu + numara | `a11y SET_TEXT id=registration_cc text=90` → `id=registration_phone` |
| 7 | NEXT | **a11y** `CLICK id=registration_submit` (sentetik tap GEÇMEDİ) |
| 8-9 | Business downgrade | yukarıdaki iki a11y adımı |

⚠️ `a11y SET_TEXT`/`CLICK` **KISA id** ister (`registration_cc`), tam yol
(`com.whatsapp:id/registration_cc`) **ÇALIŞMAZ**.
⚠️ `registration_cc`/`registration_phone` EditText'leri sentetik tap VE vtouch ile
odak KABUL ETMEZ → `input text` sessizce no-op olur; a11y SET_TEXT şart.
⚠️ Ülke kodunu yazmak ülkeyi OTOMATİK seçer ("90"→Turkey) → ülke seçiciye gerek yok.

## Teşhis
```bash
adb -s $D shell "dumpsys window | grep -o mCurrentFocus.*"        # hangi ekran
adb -s $D shell "uiautomator dump /sdcard/d.xml; grep -oE 'text=\"[^\"]{3,45}\"[^>]*bounds=\"[^\"]*\"' /sdcard/d.xml"
adb -s $D shell "settings get secure enabled_accessibility_services"  # a11y açık mı
```
★ **Ekranın gerçekte ne olduğunu dump'a değil SS'e sor** — dump'ta "deactivate your
Business" görmek diyaloğun AÇIK olduğunu KANITLAMAZ (arka plandaki sayfa başlığı da
aynı metni taşıyor; bu yüzden bir kez yanlış teşhis kondu).

İlgili: [[vtouch-fifo-sessiz-noop-downgrade-2026-08-05]] ·
[[downgrade-spin-rapor-sisirme-2026-08-04]] · [[waydroid-uinput-real-touch]]
