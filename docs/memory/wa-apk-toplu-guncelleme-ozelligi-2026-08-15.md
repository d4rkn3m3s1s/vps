---
name: wa-apk-toplu-guncelleme-ozelligi-2026-08-15
description: "WhatsApp'ı filo-referans APK'ya VERİ KORUYARAK güncelleyen toplu özellik (panel+TG+agent). Filoda 3+ farklı WA sürümü UI otomasyonunu bozuyordu; bu hepsini tek sürüme topluyor."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-15T02:58:56.467Z
---

# WhatsApp Toplu APK Güncelleme (WA_UPDATE_APK)

**Neden:** Filoda **3+ farklı WA sürümü** vardı (2.26.25.81 / 2.26.29.71 / 2.26.30.77 /
2.26.31.78). autodownload menüsü HER sürümde farklı (activity adı, "Settings" vs
"Settings X", scroll gereksinimi, checkbox davranışı) → otomasyon güvenilmezdi. En
eskiler "custom ROM/güncelle" Alert ekranında. **Çözüm:** aynı-imzalı referans APK'yı
`pm install -r -d` ile üstüne yaz → hesap/mesaj/oturum **KORUNUR**, sürüm tek noktaya toplanır.

## Canlı kanıt (veri koruma)
37.115: `2.26.30.77 → 2.26.31.78`, install=**Success**, chat listesi + eski mesajlar
("Haber ver bana", "Missed voice call") DURDU. Toplu: 5 cihaz 3 farklı sürümden 18 sn'de
2.26.31.78'e, **kasmadan** (paralel).

## Mimari (nasıl çalışır)
- **Referans APK**: `/opt/fleet-agent/apk/whatsapp-latest.apk` (141 MB, tek base.apk) +
  `.apk.version` (idempotency için; dosya adı `whatsapp-latest.apk.version` — `.apk` DAHİL,
  agent `apkPath + '.version'` okur). Yeni sürüm çekmek için: filodaki en güncel+sağlıklı
  cihazdan `adb pull $(pm path com.whatsapp)` → bu iki dosyayı güncelle.
- **agent.mjs `waUpdateApk(serial, payload, jobId)`**: readVer (before) → idempotent-skip
  (before===target ise ZATEN_GUNCEL) → push → `pm install -r -d` → readVer (after) →
  her aşamada `reportProgress(jobId,'wa-update',%,not)` (panel modalı için canlı yüzde).
- **Job**: `WA_UPDATE_APK` (job.types.ts + schema.prisma enum + migration
  20260815040000). EXCLUSIVE değil (paralel güvenli). timeout 240s.
- **Panel**: /profiles → cihaz seç → bulk-action **"WhatsApp Güncelle"** → `/api/bulk/jobs`
  `{jobType:'WA_UPDATE_APK'}` → `WaUpdateModal.tsx` (çoklu-cihaz canlı ilerleme; her cihaz
  yüzde+not+durum; `provision.progress` WS event'ini jobId'ye göre filtreler). bulk.service
  `runJob` artık `jobs:[{deviceId,id}]` de döndürür (modal satır↔job eşlemesi).
- **TG**: `/waguncelle` → ONLINE cihazların ilk 50'sine (kasmasın) idempotent güncelleme.

## ⚠️ ÖLÜMCÜL TUZAK (yaşandı, kurtarıldı) — bkz [[enum-deploy-500-tuzagi-2026-08-15]]
Enum'u DB'ye ekleyip API'yi (Prisma client) deploy ETMEDEN o tipte satır yaratınca
`prisma.job.findMany()` → **"Value 'WA_UPDATE_APK' not found in enum"** → `claimBatch`
500 → **TÜM filo job alamaz**. Sıra: önce schema+`prisma generate`+API restart, SONRA job.

## Autodownload checkbox HÂLÂ AÇIK — bkz [[autodownload-checkbox-surumden-bagimsiz-2026-08-15]]
Güncelleme hipotezi ("tek sürümde autodownload çalışır") **ÇÜRÜDÜ**: 37.115 tek sürümde
(2.26.31.78) bile `WA_SET_AUTODOWNLOAD` → roaming_mask **hâlâ 0** (checkbox toggle
tutmadı). Sürümden bağımsız ayrı sorun. Ama medya AKIŞI (pollWhatsappMedia) zaten çalışıyor.
