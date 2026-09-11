---
name: bildirim-kaliciligi-ekran-kurtarma-2026-07-29
description: "★★CİHAZ EKRAN KURTARMA + KALICI BİLDİRİM (29 Tem). Canlı: 38 cihazın 8'i izin diyaloğu/ContactPicker'da TAKILI, RUNNING job YOK — hiçbir job bitiminde ekran temizlenmiyordu. FIX: runJob'a ortak finally→returnToHome + paket-bağımsız dismissPermissionDialog (TR metinler EKSİKTİ) + reaper kapsamı genişletildi → 8/8 kurtarıldı. Bildirimler artık Notification tablosunda (eskiden sadece useState → yenilemede kayıp)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 060eed7a-fef7-42f6-a7d8-158fe471cc89
  modified: 2026-07-29T01:33:26.434Z
---

# 29 Tem 2026 — bildirim kalıcılığı + cihaz ekran kurtarma

## ★★ 1. "Cihaz kendi kendine galeriye girmiş" — kök: hiçbir job ekranı temizlemiyordu

**Canlı ölçüm:** 38 cihazın **6'sı `GrantPermissionsActivity`**, 2'si `ContactPicker`'da
takılı — ve **RUNNING job SIFIR**. İşler bitmiş, ekran kimse tarafından toparlanmamıştı.

**Üç kök birden:**
1. `whatsappSendMedia` satır içi foto grid'i bulamayınca **Gallery uygulamasını açıyor**;
   Gallery kendi izin diyaloğunu çıkarıyor ama kod izinleri yalnızca `WA_PKG`'ye veriyordu.
2. **Ortak izin-diyaloğu helper'ı YOKTU** — aynı mantık 7 yere kopyalanmış, hepsi kayıt
   akışının içinde, **hepsi İngilizce-only** (`İzin ver` dosyada HİÇ geçmiyordu; Türkçe
   cihaz yalnızca resource-id + kör koordinatla kurtuluyordu).
3. **Ortak cleanup YOKTU**: `runJob`'un switch'inde try/finally yok; `runJobTask`'ın
   finally'si sadece sayaç tutuyor. Yalnızca `whatsappSend`'in **BAŞARI** yolu HOME'a
   dönüyordu — her hata çıkışı (`NO_CROP`/`ATTACH_FAILED`/`ACCOUNT_BANNED`…) cihazı
   olduğu ekranda bırakıyordu.

**FIX (agent.mjs):**
- `dismissPermissionDialog(serial)` — paket-bağımsız, tek dump + resource-id → **TR+EN**
  metin (`İzin ver`, `Tümüne izin ver`, `Uygulamayı kullanırken`…) → kör koordinat.
- `returnToHome(serial)` — diyaloğu kapat, HOME, launcher değilse bir kez daha (picker/crop
  ilk HOME'u yutabiliyor).
- `runJob` → `runJobInner` + **ortak finally**: UI süren her job sonunda (başarı VE hata)
  `returnToHome`. `NO_UI_CLEANUP_JOBS` seti root-DB okumalarını (RECEIPTS, MEDIA, SEARCH…)
  ve host-seviyesi işleri **muaf** tutar — boşuna ADB maliyeti olmasın.
  ⚠️ Cleanup **`runJob`'un** finally'sinde olmalı, `runJobTask`'ta DEĞİL: `withJobTimeout`
  akışı öldürmüyor, timeout sonrası geç tap'ler daha dıştaki HOME'u ezerdi.
- **Reaper kapsamı genişletildi** (eski regex yalnızca `com.whatsapp/...registration|EULA`
  görüyordu): artık `permissioncontroller|GrantPermissions|packageinstaller|ContactPicker|
  CropImage|documentsui|gallery|SetAsProfilePhoto|Resolver|Chooser`. Modal durumunda
  force-stop yerine **dismissPermissionDialog + BACK + HOME**.

**CANLI SONUÇ:** grace geçici 30 sn'ye düşürülüp test edildi → **8/8 takılı cihaz
kurtarıldı** (izin diyaloğu 6→0, ContactPicker 2→0, launcher 23→31). Test ayarı geri alındı
(varsayılan 8 dk). Gerçek `WHATSAPP_SET_NAME` job'ı `NO_PROFILE` ile **başarısız** bitti ve
cihaz yine de `launcher3`'te kaldı ✓

## 2. Profil akışları: hız (kör bekleme → poll)

`waOpenProfileScreen` (set-name + set-avatar'ın ORTAK yolu) **10.3 sn kör sleep**
içeriyordu (800+3500+1500+2500+2500); avatar ayrıca 3500+4000+1200. Projede zaten çalışan
`pollNode`/`currentActivity` deseni vardı (whatsappSend iyi kullanıyor) ama profil
akışlarında hiç yoktu. Hepsi "ekran hazır mı" pollingine çevrildi (400 ms aralık, üst sınır
eski süreden toleranslı). Ayrıca avatar'ın `NO_CROP` yolunda araya giren izin diyaloğu/
chooser artık onaylanıyor. **Canlı: SET_NAME job'ı 15 sn'de bitti.**

## 3. Bildirimler artık KALICI (Notification tablosu)

**Eski hâl (3 bug bir arada):** `NotificationCenter` bildirimleri KENDİ üretiyordu — 5 sn'de
bir `/api/jobs` diff'i, sonuç yalnızca `useState([])`. (a) yenilemede hepsi kayboluyordu,
(b) `bootstrapped` guard'ı her mount'ta ilk turu **bilerek atıyordu** → operatör panelde
değilken biten işler HİÇ görünmüyordu, (c) `res.json()` kontrolsüz + boş catch → oturum
bitince bildirimler **sessizce sonsuza dek** duruyordu.

**Yeni:** `model Notification` (workspaceId, kind, title, detail, refType/refId, read).
`feed.service.ts` → `createNotification()` + `jobNotification()`. Yazma noktaları: agent
job-complete, `reapStaleJobs`, in-process `processor`, alarm fırlatma. Uçlar:
`GET/POST read/DELETE /notifications/feed`. Panel açılışta hidrat + `notification.created`
WS olayı ile canlı ekleme; okundu sunucuda.
- ★`COMPLETED` ≠ başarılı: on-device işler gerçek sonucu `result.status`'ta taşır
  (SENT/NO_PROFILE/ACCOUNT_BANNED). `jobNotification` bunu ayırt eder → canlı testte
  `COMPLETED` + `NO_PROFILE` bildirimi **`err`** olarak yazıldı ✓
- ★`WHATSAPP_RECEIPTS` ve benzeri yüksek hacimli okumalar feed'e YAZILMAZ (24 saatte 2175
  adet → feed'i boğardı).
- `lib/safeFetch.ts` — `redirect:'manual'` + content-type + 401 ayrımı. Aynı sessiz-hata
  sınıfı `JobsView`/`AlertsView`'da da var (henüz geçirilmedi, not).

## ⚠️ Aynı gün ortaya çıkan AYRI sorun: thordata residential 502

Deploy sonrası WhatsApp erişimi 38/38 → 17/38 düştü. **Bu değişikliklerle İLGİSİZ:**
host'tan doğrudan proxy testi de **502** veriyor → `errorMsg: Resource IP connection failed`.
Bakiye **dokunulmamış** (10518.94 GB, hiç düşmemiş → trafik zaten geçmiyor), redsocks 38/38
ayakta, hepsi residential. Yani: **mevcut sticky session'lar çalışıyor, YENİ session
açılamıyor** — sağlayıcı havuz sorunu. 28 Tem'de mobile hesap (`XRiHAsiywous@9999`) benzer
şekilde ölmüştü ve tüm filo residential'a taşınmıştı → artık tek hesaba bağımlıyız.

İlgili: [[api-restart-agent-stream-proxy-tasima-2026-07-29]] · [[public-api-kategori-mimarisi-2026-07-29]]
