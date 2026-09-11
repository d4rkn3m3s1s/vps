---
name: bayat-adb-ucu-kurulum-oldurur-2026-07-28
description: "★★★TEK-TIK KURULUM 'boot 150s TIMEOUT' KÖKÜ: adb TCP uçlarını kendiliğinden SİLMEZ. Cihaz silinince ucu host adb sunucusunda 'offline' KALIR; aynı subnet YENİ instance'a verilince (subnet geri-dönüşümü) `adb connect` sadece 'already connected' der → uç offline kalır → provision'ın ADB-yetkilendirme döngüsü 30 tur boşa döner → boot 150s TIMEOUT → kurulum BAŞARISIZ. CANLI: operatör 9 cihaz sildi → tam 9 bayat uç → mi36/mi37/mi20 üst üste düştü; uçlar temizlenince mi21 İLK denemede DONE 131s. ★DERS: 'kod regresyonu' sanmadan ÖNCE `adb devices | grep offline` bak — ben kendi değişikliğim sandım, agent'ı eski sürüme döndürüp test ettim, ESKİ KOD DA DÜŞTÜ → sebep koddu değil bayat uçtu. FIX: ensureConnected offline görürse disconnect→connect + reapStaleAdbEndpoints (adbRecoveryTick'te, host'ta karşılığı olmayan ucu düşürür). commit 4613f59"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1000ff11-d330-4e5b-83fc-9bfb7b16dc6c
  modified: 2026-07-27T22:41:37.283Z
---

# ★★★ BAYAT adb UCU tek-tık kurulumu ÖLDÜRÜR (2026-07-28)

Operatör: "tek tık otonom cihaz internet-çıkış problemini de çözmemiz lazım" +
"bunu kalıntı kalmıcak şekilde yap, ben manuel tespit etmek zorunda kalmayayım".

## KÖK NEDEN
`adb` TCP uçlarını kendiliğinden silmez. Cihaz silinince uç host'un adb sunucusunda
**'offline' KALIR** (adb ayrıca otomatik yeniden bağlamaya çalışır → `adb disconnect`
tek başına kalıcı değil). Aynı subnet YENİ bir instance'a verilince (subnet
geri-dönüşümü) `adb connect` yalnızca *"already connected"* der; uç **offline kalır** →
provision'ın ADB-yetkilendirme döngüsü (30 tur × 2s) boşa döner → `boot` adımı **150s
TIMEOUT** → kurulum BAŞARISIZ.

⚠️ Yanıltıcı log: döngü başarısız olsa bile sonrasında `boot@131s: ADB authorized`
yazılıyor (döngü *tükendi* demek, *başardı* değil). Gerçek durum: `adb devices` → `offline`.

## ★ EN ÖNEMLİ DERS (teşhis sırası)
Üst üste 3 kurulum düşünce **kendi kod değişikliğim sandım**. Doğru hamle: agent'ı
değişiklik ÖNCESİ yedeğe döndürüp test ettim → **ESKİ KOD DA AYNI ŞEKİLDE DÜŞTÜ** →
sebep kod değil ortamdı. Bir kurulum/bağlantı arızasında **önce** şunlara bak:
`adb devices | grep -E 'offline|unauthorized'` ve host instance sayısı ile karşılaştır.

## FIX (iki katman, otonom — commit 4613f59)
1. **ensureConnected**: `get-state` offline ise → `adb disconnect` → 300ms → `adb connect`.
   (adb'nin bu durumdan tek çıkış yolu.) provision/wake/heal hepsi buradan geçer.
2. **reapStaleAdbEndpoints** (yeni) + `adbRecoveryTick` çağrısı: host'ta karşılığı
   OLMAYAN (waydroid.<inst> dizini yok) her offline/unauthorized ucu her tick'te düşürür.
   Çalışan instance subnetlerine ASLA dokunmaz (geçici offline olabilir).

## CANLI KANIT
- Operatör 9 cihaz sildi → `adb devices`'te tam **9 bayat offline uç**.
- mi36 / mi37 / mi20 üst üste `boot 150s TIMEOUT`.
- Uçlar temizlenince **mi21 İLK denemede DONE 131s**, tüm adımlar ✓,
  persist: *"✓ Ag yonlendirme: cihaz internete CIKIYOR (dogrulandi)"*,
  çıkış 5/5 TCP 301, ülke TR/İzmit = beklenen TR.
- Filo tutarlı: 27 host instance = 27 adb online, 0 bayat uç.

Bağlantılı: [[container-ip-path-koku-2026-07-28]] [[proxy-eu-pr-endpoint-koku-2026-07-28]]
[[eth0-heal-otomatik-kurtarma-2026-07-24]]
