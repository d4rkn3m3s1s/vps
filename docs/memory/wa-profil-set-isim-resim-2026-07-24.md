---
name: wa-profil-set-isim-resim-2026-07-24
description: "★★WhatsApp KENDİ PROFİL isim+resim DEĞİŞTİRME uçtan uca (API+site+Telegram) KANITLANDI. Job: WHATSAPP_SET_NAME + WHATSAPP_SET_AVATAR (yeni enum+migration). Agent handler whatsappSetName/whatsappSetAvatar (agent.mjs). ★İSİM reçetesi (1080x2368, WA v2.26, EKRAN-ORANI koordinat): Main→⋮menü(0.943,0.063)→Settings(0.633,0.395)→AVATAR'a tap(0.5,0.205)[isim metnine DEĞİL, yanındaki ⊕ hesap-ekle açar]→ProfileInfoActivity→Name(0.289,0.438)→MOVE_END+30×DEL→ADB_INPUT_TEXT broadcast→Save(0.5,0.894). ★★RESİM reçetesi (galeri-picker ATLA — Waydroid'de BOŞ gelir): resmi /sdcard/DCIM/Camera'ya push→`content call scan_volume external_primary`→_id al→`pm grant READ_MEDIA_IMAGES`→`am start -n com.whatsapp/.SetAsProfilePhoto -a ATTACH_DATA -d content://media/external/images/media/<id> -t image/png`(DOĞRUDAN CropImage'e düşer!)→Done(0.833,0.933). API: batchService.setProfileName/setAvatar + /accounts/whatsapp/profile/name|avatar. Telegram: /profilisim <cihaz> <ad> + /profilresim <cihaz>+foto(getFile→b64→setAvatar, awaiting_profile_photo mode). Site: WhatsappProfilePanel.tsx. CANLI-SS: Jennifer Brown→Test Profil→Fleet Bot→Zara Destek + mavi TEST→kırmızı FLEET avatar. ★API prefix /accounts (NOT /api). ★ADB_INPUT_TEXT boşluk: adb shell \"...--es msg '<txt>'\" tek-tırnak."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-24T15:53:01.569Z
---

# ★★ WhatsApp KENDİ PROFİL isim + resim DEĞİŞTİRME (2026-07-24)

Kullanıcı: "apiden WA profil ismi değiştirme + profil resmi ekleme, sağlıklı cihazda
tespit et SS ala ala koordinat vs, hem siteden hem apiden hem Telegram botundan
sorunsuz hızlı optimize stabil". Uçtan uca YAPILDI + CANLI-SS KANITLANDI.

## KANITLANMIŞ KOORDİNAT REÇETELERİ (watest48/mi2, 1080x2368, WA v2.26.25.81)
Koordinatlar EKRAN-ORANI (fx,fy) yazıldı → farklı çözünürlükte de çalışır. Tümü
SYNTHETIC `input tap` (uiautomator WA'da hang → SS-SS koordinat sür).

### İSİM (WHATSAPP_SET_NAME)
1. `am start -n com.whatsapp/.Main` → HomeActivity
2. ⋮ menü (0.943, 0.063) → Settings (0.633, 0.395)
3. **AVATAR'a tap (0.5, 0.205)** → ProfileInfoActivity. ⚠️İSİM METNİNE tap YANLIŞ:
   yanındaki ⊕ ikonu "Add another WhatsApp account" sheet'i açar. Avatar dairesi DOĞRU.
4. Name satırı (0.289, 0.438) → ProfileInfoFragmentHost
5. Sil: `KEYCODE_MOVE_END` + 30× `KEYCODE_DEL`
6. Yaz: `adb shell "am broadcast -a ADB_INPUT_TEXT --es msg '<isim>'"` (TEK-tırnak,
   boşluk dahil UTF-8 intact; --es msg "iki kelime" → boşluktan sonrası pkg sanılır!)
7. Save (0.5, 0.894) → ProfileInfoActivity'ye döner (doğrulama). Maks 25 karakter.

### RESİM (WHATSAPP_SET_AVATAR) — ★galeri-picker ATLA
Waydroid'de WA galeri-picker + Android-13 photo-picker BOŞ gelir (MediaStore'da resim
olsa bile "No photos" — Waydroid photopicker provider bug). ÇÖZÜM: picker'ı hiç kullanma:
1. base64→cihaza push `/sdcard/DCIM/Camera/wa_avatar.png`
2. `adb shell su -c "content call --uri content://media --method scan_volume --arg external_primary"`
3. `_id` al: `content query --uri content://media/external/images/media --projection _id:_data --where "_data='...'"`
4. `pm grant com.whatsapp READ_MEDIA_IMAGES` (+ READ_EXTERNAL_STORAGE)
5. **★DOĞRUDAN**: `am start -n com.whatsapp/.SetAsProfilePhoto -a android.intent.action.ATTACH_DATA
   -d content://media/external/images/media/<id> -t image/png` → CropImage ekranına DÜŞER!
6. Done (0.833, 0.933) → profil resmi ayarlandı.

## KATMANLAR (hepsi deploy + canlı)
- **Job type**: schema enum WHATSAPP_SET_NAME/WHATSAPP_SET_AVATAR + migration
  20260724160000 + JobTypes const + EXCLUSIVE_JOB_TYPES + agent timeout (120s/150s).
- **Agent** (agent.mjs, /opt/agent.mjs): whatsappSetName, whatsappSetAvatar,
  waOpenProfileScreen, currentActivity helper. WA_PKG='com.whatsapp'. writeFile/rm
  (node:fs/promises named import, fs.promises DEĞİL).
- **API**: batchService.setProfileName/setAvatar (assertDeviceReady + validation
  25char/8MB) + batch.controller handler + accounts.routes POST
  `/accounts/whatsapp/profile/name` ve `/profile/avatar`. ★Prefix `/accounts` (app.use
  '/accounts'), `/api` DEĞİL — 404 alırsan prefix'i kontrol et.
- **Telegram**: `/profilisim <cihaz> <ad>` (findDeviceByRef+setProfileName). `/profilresim
  <cihaz>` → awaiting_profile_photo mode → kullanıcı foto gönderir → handlePhotoMessage
  (pollBot'ta message.photo/document yakalanır → downloadTelegramFileB64 getFile→b64 →
  setAvatar). TgMessage'a photo[]+document eklendi. 29 komut kayıtlı.
- **Site**: WhatsappProfilePanel.tsx (isim input + FileReader→base64 resim upload,
  önizleme) ProfileDetailView'e eklendi + 2 API proxy route (name/avatar).

## CANLI KANIT (SS ile)
Jennifer Brown → Test Profil → Fleet Bot → Zara Destek (isim, API job'ları).
Boş avatar → mavi TEST → kırmızı FLEET (resim, API job). Job COMPLETED status:OK,
agent 11-18s işledi. Üst-üste değişim sorunsuz.

## DERSLER
- WA v2.26'da profil ekranına AVATAR'a tap (isim/⊕ değil). SetAsProfilePhoto intent
  galeri-picker'ı komple atlatır = en stabil avatar yolu.
- ADB_INPUT_TEXT boşluklu string: `adb shell "...--es msg '<txt>'"` (tek-tırnak sarmalı).
- Test-logo: Windows PowerShell System.Drawing ile PNG üret + base64.

## ★ DOKÜMAN + PUBLIC API (2. tur — kullanıcı "dokümana + postman'a ekledin mi")
İlk turda sadece İÇ API (/accounts/whatsapp/profile/*) eklenmişti; Public API + 3
doküman yeri EKSİKTİ. Tamamlandı:
- **Public API** (public.controller + public.routes): `POST /public/v1/whatsapp/profile/name`
  (setNameHandler) + `/profile/avatar` (setAvatarHandler, heavyRateLimit). requireScope
  'write' + requirePublicWorkspace. Canlı: geçersiz-key→401, route+auth+validation OK.
- **Postman** (2 kopya: dashboard/public + docs, AYNI tutulur): "Kendi profil ismini/resmini
  değiştir" item'ları "Profil getir"den sonra. Site'den indirilebilir (200).
- **/api-docs** (ApiDocsView.tsx): "Kişi işlemleri" grubuna 2 endpoint.
- **/admin/api-keys** (page.tsx interaktif test aracı): EndpointKey'e profileName/profileAvatar,
  ENDPOINTS sözlüğü, buildRequest case'leri, testProfileName/testAvatarB64 state + input
  render (avatarB64 textarea). Operatör gerçek flk_ key ile buradan canlı test eder.
★DERS: yeni endpoint eklerken 4 yeri güncelle — Public API(controller+routes) + Postman(2
kopya) + /api-docs + /admin/api-keys test-aracı. İç API'ye eklemek Public API'ye eklemez.

Detay [[whatsapp-profil-degistirme-2026-07-07]](eski manuel reçete, 1080x2400)
[[telegram-13-komut-suite-2026-07-24]] [[eth0-heal-otomatik-kurtarma-2026-07-24]]
