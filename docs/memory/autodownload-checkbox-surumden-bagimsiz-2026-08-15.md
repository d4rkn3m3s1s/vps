---
name: autodownload-checkbox-surumden-bagimsiz-2026-08-15
description: "WA_SET_AUTODOWNLOAD checkbox toggle tek WA sürümünde bile TUTMUYOR — \"güncelleyince çalışır\" hipotezi çürüdü. roaming_mask 0 kalıyor. Diyalog açılışı/checkbox toggle sorunu, AÇIK."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-15T02:59:40.313Z
---

# Autodownload checkbox toggle sürümden bağımsız tutmuyor (AÇIK sorun)

Kullanıcı stratejisi "olmadı güncelleriz" → filo tek sürüme (2.26.31.78) toplandı, hipotez:
"tek sürümde autodownload navigasyonu güvenilir çalışır". **ÇÜRÜDÜ.**

**Kanıt:** 37.115 (artık 2.26.31.78) → `WA_SET_AUTODOWNLOAD` job → sonuç
`ok:false, ayarlanan:1, status:KISMI`. Job sonrası manuel okuma:
`autodownload_roaming_mask" value="0"` — **checkbox toggle GERÇEKTEN tutmadı** (roaming
hâlâ 0). a11yClickText + koordinat-tap ikisi de denendi, hiçbiri kutuyu açmadı.

**Doğrulanan alt-gerçekler:**
- Maske DOĞRU yerde: `com.whatsapp_preferences_light.xml` → `autodownload_roaming_mask`
  (cellular/wifi anahtarları bazı cihazlarda hiç yazılmamış olabilir).
- `masks:[""]` boş dönüşü = job içi `readMasks` (adbSu su-c grep) bazen boş döndürüyor
  (ölçüm sorunu) — ama manuel grep 0 gösterdi, yani yanlış-negatif DEĞİL, gerçekten 0.
- Bu sürümde Storage yolu: ⋮ "More options" → **"Settings X"** (tam "Settings" DEĞİL) →
  Settings'te "Storage and data" **scroll gerektiriyor** (ilk ekranda yok) → roaming satırı.
- `am start -n com.whatsapp/.home.ui.HomeActivity` WA'yı açar; `.HomeActivity` ve `monkey`
  AÇMADI (launcher'da kalır). WA açık mı: `dumpsys window | grep mCurrentFocus`.

**Sıradaki (yapılmadı):** checkbox neden tutmuyor — (a) "When roaming" satırına tıklama
diyaloğu AÇMIYOR olabilir (kod "ayarlandı" sanıyor ama ekran değişmiyor — canlı dump ile
doğrula), (b) diyalog CheckedTextView+CheckBox karışımı, tap koordinatı yanlış düğüme
gidiyor olabilir. Not: medya AKIŞI (pollWhatsappMedia, view-once dahil) ZATEN çalışıyor —
bu sadece "otomatik indirme tetikleme" maskesi.

Bağlam: [[wa-apk-toplu-guncelleme-ozelligi-2026-08-15]] · [[wa-business-downgrade-kusursuz-recete-2026-08-05]] (diyalogda a11y şart, sentetik tap geçmez)
