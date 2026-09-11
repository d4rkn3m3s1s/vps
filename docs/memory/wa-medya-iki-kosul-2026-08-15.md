---
name: wa-medya-iki-kosul-2026-08-15
description: "WA gelen medya otomatik inmesi İKİ koşul ister: (1) gönderen REHBERDE (notReliableContact) VE (2) autodownload MASKESİ açık (networkSafe). Biri eksikse inmez. UI cihazdan cihaza FARKLI."
metadata:
  type: project
---

WhatsApp gelen medyayı (foto/video/belge) otomatik indirmesi için **İKİ koşul da**
sağlanmalı. Biri eksikse dosya diske hiç inmez, dolayısıyla TG/API'ye de gitmez.
Kanıt: WhatsApp kendi logu (`files/Logs/whatsapp.log`) her ikisini de ayrı yazıyor.

## Koşul 1 — gönderen REHBERDE olmalı
`MediaAutoDownloadUtils/isAutoDownloadEligible/false reason=notReliableContact`
Rehberde olmayan numaranın medyası inmez (spam koruması; okundu bilgisi de kapanır).
→ Çözüm: gönderen numarayı cihaz rehberine ekle (content-provider, **sürüm-agnostik**).
  ⚠️ `su -c content …` uid=1000 → SecurityException. İzni `com.android.shell`'e ver,
  komutu **su OLMADAN** çalıştır (uid=2000). [[wa-medya-otomatik-indirme-2026-08-15]]

## Koşul 2 — autodownload MASKESİ açık olmalı
`MediaAutoDownload/queueMessageIfNetworkSafe/skipped eligible=false networkSafe=FALSE`
Maske (`autodownload_*_mask`) kapalı/yoksa `networkSafe=false` → inmez.
- Maske açıkken (15) → `networkSafe=TRUE`. Canlı A/B: mi235 maske=15 → indi;
  mi186 maske YOK (default) → `networkSafe=false`, rehber dolu olsa bile İNMEDİ.
- ★ROOT ile maske yazmak TUTMUYOR (WA açılışta geri yükler). Tek yol UI.
- Maske değeri: 1=foto 2=ses 4=video 8=belge → 15=hepsi.

## ★★★ UI CİHAZDAN CİHAZA FARKLI (kullanıcı haklıydı)
Aynı Waydroid imajında bile farklı WhatsApp sürümleri:
- **Yeni sürüm** (mi235): ayarlar ⋮ menüsünde YOK → alt sekme **"You"** → Storage and data
- **Eski sürüm** (mi186, 2.26.30.81): **"You" sekmesi YOK** → ⋮ menüsünde **"Settings"** var
İkisi tam TERS. Koddaki `waOpenSettings()` sadece eski ⋮ akışını biliyor → yeni
sürümde KIRIK. Maske-açma akışı HER İKİ yolu da denemeli (landmark-tabanlı,
koordinat değil). İki script hazır: wa-autodownload.sh (You) + wa-maske-eski.sh (⋮).

## Otonom rehber — kısır döngü düzeltmesi (agent.mjs)
`pollWhatsappMedia`: rehber tamamlama İNMEMİŞ medya mesajı görünce tetiklenir
(inmiş değil — ilk medya zaten inmiyor, dosya yok, yoksa hiç eklenmezdi). Cihaz
başına 3 dk throttle. `WA_CONTACTS_AT` Map. Canlı: "rehbere 3 kisi eklendi" ✅.
⚠️ ensureContacts cihazın KENDİ numarasını da ekliyor (selfNumber verilmedi) — kozmetik, düzeltilecek.

## Medya → TG/API akışı (KURULDU, agent'a gömülü)
agent `pollWhatsappMedia` (mevcut inbound turuna eklendi, yeni döngü YOK) →
tek SQL (yeni _id>pos, file_path dolu) → dosyayı base64 çek (çoklu-kök: eski/yeni
storage yolları denenir) → `POST /agent/whatsapp/media` → API dosyayı saklar
(`/opt/fleet-agent/wa-media`) + Telegram (dispatchWhatsappMedia) + deviceHub + webhook.
FLEET_WA_MEDIA=0 ile kapatılabilir. Tek gösterimlik (tip=42, files/ViewOnce/, silinmeden
yakalanır) ✅ TG+API'ye düştü. Gönderen LID ise jid_map ile gerçek numaraya çevrilir.

## Panel UI (YAPILMADI)
Dosya API'de saklanıyor + deviceHub `whatsapp.media` event'i gidiyor, ama paneli
gösterecek arayüz + indirme ucu henüz YOK. Sıradaki iş.
