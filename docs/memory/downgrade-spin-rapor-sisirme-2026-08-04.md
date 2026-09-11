---
name: downgrade-spin-rapor-sisirme-2026-08-04
description: "🔴★★DOWNGRADE SPIN: onDowngradeFriction SADECE aktivite adına bakıyor→tıklama tutmasa da ekran aynı kalınca döngü BAŞTAN başlıyor, 14 turun HEPSİ aynı ekranda yanıyor. FIX:downgradeRounds sayacı+kademeli tıklama+4 turda net tanı. ★★TEŞHİS TUZAĞI:'input tap çalışmıyor' hipotezi A/B ile ÇÜRÜTÜLDÜ. ★reports %98 gösteriyordu GERÇEK %76(1334'ün 326'sı gitmemiş)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 6b35fb77-30e7-48f7-a51f-ef2ea6daeb6b
  modified: 2026-08-04T15:35:35.410Z
---

# DowngradeFriction sonsuz döngü + rapor şişirme (4 Ağustos 2026)

## 1. ★★ DOWNGRADE SPIN — kayıt 14 turun hepsini aynı ekranda yakıyordu

**Canlı olay** (`+905360459761` / `wa-t31k`): agent DowngradeFriction ekranında
**27 sn'de bir aynı adımı** tekrarladı, 5 turda hiç ilerleme olmadı. Operatöre
"takıldı" göründü. Ekranda:
```
"Are you sure you want to deactivate your Business account?"
   [USE +90 536 045 97 61]   [USE A DIFFERENT NUMBER]
```

### Kök neden
`onDowngradeFriction` **yalnızca aktivite adına** bakıyor:
```js
if (/DowngradeFriction|downgrade\./i.test(f)) return true;
```
"USE +" tıklaması **işe yaramasa da** ekran hâlâ aynı aktivite olduğu için döngü
her turda "yine downgrade" deyip **baştan başlıyordu** — *ilerleme kaydı yoktu*.
14 turluk bütçenin tamamı aynı ekranda yanıyordu.

### Fix (commit `f5a5d64`)
`downgradeRounds` sayacı +
- **Kademeli tıklama**: a11y → dump'tan `"USE +"` metni → `primary_button` ID →
  koordinat → **3. turdan itibaren `tapNode`** (gerçek dokunma).
  Eskiden HER TUR aynı iki adım atılıyordu; biri çalışmıyorsa 14 tur da çalışmıyordu.
- **4 turdan sonra NET TANI ile bırak** (yalancı `OTP_WAIT`'ten çok daha iyi):
  *"USE + düğmesi yanıt vermiyor — elle basın ya da numarayı atlayın."*

Test: **9/9** izole senaryo. Eski kod 14 tur yakıp sebep bildirmiyor; yeni kod 5.
turda temiz tanıyla duruyor; sağlıklı (1. tur) ve yavaş (3./4. tur) yollar
**haksız yere kesilmiyor**.

## ⚠️⚠️ TEŞHİS TUZAĞI — yanlış hipotez nasıl çürütüldü
İlk hipotezim: *"bu Waydroid'de `input tap` çalışmıyor, sadece vtouch çalışıyor"*.
Gerekçe: DowngradeFriction ekranında `adb shell input tap` hiçbir şey yapmadı,
`vtouch tap` ise anında tepki verdi.

**A/B testiyle ÇÜRÜTÜLDÜ**: nötr bir ekranda (Settings uygulaması) `input tap 540 1064`
→ `SettingsHomepageActivity` → `SubSettings`'e geçti. Yani `input tap` **çalışıyor**;
o ekranda tıklama tutmamasının sebebi başkaydı.

**Ders:** "komut X çalışmıyor" sonucuna tek bir ekrandan varma — nötr bir ortamda
A/B yap. Yanlış hipotezle `tapSyn`'i baştan yazsaydım hiçbir şey düzelmezdi.

## 2. ★ PANEL BAŞARI ORANI ŞİŞİRİYORDU
30 Tem'de **analytics** düzeltilmiş, **reports EDİLMEMİŞTİ**.
`Job.status === 'COMPLETED'` yalnızca "iş koştu, ajan rapor döndü" demek; mesajın
gidip gitmediği `result.status`ta (`SENT`/`CHAT_NOT_OPENED`/`ACCOUNT_RESTRICTED`…).

**Canlı fark:** panel **%98** gösteriyordu, gerçek gönderim oranı **%76**
(1334 gönderimin **326'sı ulaşmamış**). Artık ikisi ayrı:
- `successRate` = iş çalışma oranı (altyapı sağlıklı mı)
- `sendRate` = **gerçek gönderim oranı** (operatörün önemsediği)

## 3. Log kirliliği
`pm disable ...chimera.PersistentDirectBootAwareApiService` her kurulumda uyarı
basıyordu (**209 kez**). Birçok GApps imajında bu bileşen yok; kurulumu etkilemiyor
(hatayı alan cihazların hepsi COMPLETED). Yalnızca **bu** komutun hatası yutuluyor,
diğerlerinin uyarısı korunuyor.

## Bağlantılı
[[RESUME-kaldigimiz-yer-2026-08-04]] · [[on-ucus-yarim-deploy-dist-bayat-2026-08-04]]
