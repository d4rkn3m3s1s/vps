---
name: wa-medya-otomatik-indirme-2026-08-15
description: "Gelen foto/video CİHAZA HİÇ İNMİYORDU: autodownload maskesi. ★root prefs yazma TUTMUYOR (WA sunucudan geri yükler), tek yol UI. ★Ayarlar artık ⋮'de DEĞİL, 'You' sekmesinde"
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-14T23:23:54.437Z
---

**15 Ağustos 2026.** "Gelen fotoğraflar TG'ye/API'ye düşmüyor" şikâyetinin kökü
**iletim değil, İNDİRME** idi.

## Teşhis

`msgstore.db` sorgusu kesin gösterdi:

```
15  tip=1 (FOTO)  benden=0 (gelen)  02:01:54   ← mesaj VAR
    dosya=YOK  boyut=0                          ← ama dosya diske İNMEMİŞ
```

Yani iletilecek bir dosya hiç oluşmamıştı. Medya klasörü (`WhatsApp Images`) boştu.

**Sebep:** `autodownload_*_mask` kapalı. Maske anlamı: **1=foto · 2=ses · 4=video ·
8=belge → 15=hepsi**.

## ★★★ ROOT İLE PREFS YAZMAK TUTMUYOR

Ayar `com.whatsapp_preferences_light.xml` içinde `<int name="autodownload_roaming_mask" value="15"/>`
olarak **görünür** ama **orası kaynak değil**.

**Canlı deney (mi235 / +905349637734):**
1. WA kapalıyken root ile `roaming_mask` 15 → **7** yazıldı, dosyada 7 görüldü ✅
2. WA açıldı → değer **15'e döndü** ❌
3. Aynı deneyde root ile *eklenen* `cellular_mask`/`wifi_mask` anahtarları WA
   açılışında **tamamen silindi**

WhatsApp ayarı kendi (sunucu-senkronlu) kaynağından geri yüklüyor. Tip de suçlu
değil — mevcut anahtar da `<int>`, aynısını yazdık.

**Kullanıcının UI'dan yaptığı ayar ise KALICI oldu** → tek güvenilir yol **UI otomasyonu**.

## ★★ AYARLAR ARTIK ⋮ MENÜSÜNDE DEĞİL

Kodda `waOpenSettings()` eski yolu kullanıyor: Home → **⋮ → Settings**.
Bu WA sürümünde ⋮ menüsünde **Settings YOK** (sadece New group · Linked devices ·
Broadcast lists · Starred · Read all).

**Gerçek yol:** alt sekme **"You"** → Ayarlar → aşağı kaydır → **"Storage and data"**
→ Media auto-download.

Alt sekmeler: `Chats · Updates · Communities · Calls · You`

⚠️ `waOpenSettings()`'e dayanan **her akış bu sürümde kırık** olabilir — kontrol edilmeli.

## Çalışan reçete (canlı doğrulandı)

```
am force-stop com.whatsapp; am start -n com.whatsapp/.home.ui.HomeActivity
tap "You" → tap "Storage and data" (görünmezse yukarı kaydır)
her satır için: "When using mobile data" / "When connected on Wi-Fi" / "When roaming"
  → diyalogda Photos/Audio/Videos/Documents'tan İŞARETLİ OLMAYANA tap
    (⚠️ işaretliye dokunmak KAPATIR — önce `checked="true"` kontrol et)
  → OK
```

Sonuç: WhatsApp'ın kendi yazdığı üç maske de **15** oldu — kalıcı.

## ★★★ ASIL KÖK: ağ tipi `TRANSPORT_PRIMARY`

Maskeler 15 yapıldı, CDN erişilebilir, mesajlar geliyor — **ama medya yine inmedi**
(yeni gelen 2 foto da `dosya=YOK`). Sebep ölçümle bulundu:

```
dumpsys connectivity → TRANSPORT_PRIMARY     ← WiFi DEĞİL, hücresel DEĞİL
ip -br addr          → eth0 (Waydroid sanal ethernet)
getprop gsm.*        → BOŞ (SIM yok)
```

WhatsApp'ın otomatik indirme kararı **"WiFi mi / hücresel mi / roaming mi"** diye
sorar. Waydroid'in ağı bunların **hiçbiri** → eşleşen maske yok → **hiç indirmiyor**.

⚠️ Yani maskeleri açmak **gerekli ama YETERLİ DEĞİL**. "Ayarı açtık, olmalı" diye
varsaymak bu vakada yanlış olurdu — ölçüm şart.

**Doğrulanan sağlıklı bileşenler** (yani suçlu değiller):
- Genel internet: `ipify=200` · `web.whatsapp=200`
- Medya CDN: `media-sof1-2.cdn.whatsapp.net`, `mmg.whatsapp.net` → **404**
  (404 = bağlantı ÇALIŞIYOR, kök dizinde içerik yok. `000` olsaydı erişim yoktu.)
- DNS: hostlar doğru IP'lere çözülüyor

## Sıradaki yol: tıklayarak indirme

Otomatik inmiyorsa **mesaj balonuna tıklamak** WA'ya indirtir. Altyapı şöyle olmalı:
yeni medya mesajı gör → sohbeti aç → indirme ikonuna tıkla → dosya diske iner →
izleyici API/TG'ye yollar.

⚠️ **LID TUZAĞI:** `msgstore.db`'de gönderen `174256235225321` gibi çıkıyor — bu
telefon numarası DEĞİL, WhatsApp'ın iç kimliği (**LID**). `wa.me/<LID>` deep link'i
**çalışmaz**. Önce `lid_jid_map`/`jid` tablosundan gerçek numaraya çevrilmeli.
(Bkz. [[wa-rootdb-medya-lid-numara-2026-07-22]])

## ⚠️ Geçmişe dönük çalışmaz

Ayar açıldıktan sonra **eski** medya kendiliğinden inmez (mesaj 15 hâlâ
`dosya=YOK`). Yalnızca **yeni gelen** medya iner. Eski için mesaja tıklamak gerekir.

## Medya klasörleri

`/data/media/0/Android/media/com.whatsapp/WhatsApp/Media/` altında:
`WhatsApp Images` · `WhatsApp Video` · `WhatsApp Audio` · `WhatsApp Documents`
(her birinde `Sent/` ve `Private/` alt klasörleri)

**Tek gösterimlik (view once):** `message_type=13`.
Diğer tipler: `0=metin 1=foto 2=ses 3=video 9=belge 7/42=sistem`.

## Sıradaki iş (yapılmadı)

1. Bu akışı `agent.mjs`'e fonksiyon + job tipi olarak ekle (kayıt sonrası otomatik)
2. **Medya izleyici**: `msgstore.db`'den son işlenen `_id`'den büyük medya mesajlarını
   sorgula (dosya sistemi taramaya gerek YOK — tek SQL) → API'ye yükle → TG'ye ilet
3. TG/API'den **medya gönderme** yolu

⚠️ Cihazda komut çalıştırırken **base64** kullan: `su -c '...'` içine tırnaklı SQL
koymak sarmalı kırıyor ve komut **sessizce boş dönüyor** (yanlışlıkla "medya yok"
sanılır). Bkz. [[proc-taramasi-systemd-kilidi-2026-08-14]] — sessiz başarısızlık sınıfı.
