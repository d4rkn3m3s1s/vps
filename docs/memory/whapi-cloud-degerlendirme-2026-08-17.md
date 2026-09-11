---
name: whapi-cloud-degerlendirme-2026-08-17
description: "Whapi.cloud (hazir WhatsApp API) dokuman incelemesi — numara basi $29/ay (155 cihaz=~$4.5k/ay), PROXY dokumanda YOK, ban kokunu ONLAR DA \"kullanim davranisi\" diyor; \"3 sorun ayni kok\" teklifi CURUK"
metadata: 
  node_type: memory
  type: reference
  originSessionId: a9614e2b-33cb-436b-bb65-298d256a8fb6
  modified: 2026-08-17T14:26:14.663Z
---

# Whapi.cloud değerlendirmesi (2026-08-17) — doküman okundu

Bir danışman/AI "gateway'i Whapi'ye taşı, ban+gecikme+webhook üçünü birden çözer"
teklifi getirdi. Dokümanı okudum; **gerekçe çürük**, ama bir gerçek avantajı var.

## Ne olduğu (ÖNEMLİ)
Meta'nın **resmi Business API'si DEĞİL**. Kendi ifadeleri: "linked-device session",
QR/pairing kodu ile bağlanıyor, **WhatsApp Web ile aynı mekanizma** — bağlantı onların
sunucusunda tutuluyor. Yani bizim yaptığımızın **AYNI KATEGORİSİ** (resmi olmayan,
cihaz oturumu tabanlı). Tek fark: UI otomasyonu yerine soket.

## Fiyat — karar kalemi
| Plan | Ücret | Kapsam |
|---|---|---|
| Developer Sandbox | **$0 sonsuza kadar** | 150 mesaj/gün, 1.000 API isteği/ay |
| Developer Premium | **$29/ay NUMARA BAŞINA** (yıllık $40, %33 ind.) | sınırsız mesaj |

"Kanal" = tek WhatsApp numarası. **155 cihaz × $29 ≈ ayda $4.495**. Hacim indirimi
"var" deniyor ama **oran belirtilmemiş**. 5 gün deneme. Mesaj başı ücret yok.

## Teklifin 3 iddiası vs doküman
1. **"Webhook → real-time"** ✅ DOĞRU (webhook var: gelen mesaj/teslim/okundu push).
   ⚠️AMA bizde gecikme bugün **3-19 sn**'ye indi ve WA'nın cihaza teslimatı zaten
   2-3 sn. Webhook yalnızca yoklama payını (0-2 sn) siler → kazanç **birkaç saniye**,
   "3 dk → anında" DEĞİL. Ayrıca bizde webhook **ZATEN VAR**
   (`webhooksService.dispatch('WHATSAPP_MESSAGE')`, agent.service.ts:1542) + WS push.
2. **"Kanal başı mobil proxy → ban yok"** ❌ **DOKÜMANDA HİÇ YOK**. Ne per-channel
   proxy, ne kimin sağladığı, ne ülke seçimi — `llms-full.txt` dahil hiçbir yerde
   bulunamadı. Teklifin bu ayağı **desteklenmiyor**.
3. **"Panel aynı kalır"** ✅ mimari olarak mümkün, ama kaybedilenler teklifte YOK.

## ★★★BAN: doküman BİZİM ÖLÇÜMÜMÜZLE AYNI ŞEYİ SÖYLÜYOR
> "Restrictions are primarily caused by **how the WhatsApp account is used**"
> (agresif gönderim, zayıf gönderen itibarı, **düşük alıcı etkileşimi**)

Bu, [[ban-koku-cevapsizlik-2026-08-15]] ölçümünün aynısı (cevapsızlık: sağlam %30,
banlı %53, kısıtlı %65). → **Sağlayıcı değiştirmek ban'ı ÇÖZMEZ**; doküman bunu
kendisi kabul ediyor. **Ban garantisi/tazminat YOK.** Rate limit yok ("no limits")
ama "şüpheli desen" uyarısı var.

## Kaybedeceklerimiz (root erişimi gider)
`msgstore.db` doğrudan okuma (bugün gecikmeyi çözen yöntemin TA KENDİSİ) · profil
adı/avatar · rehber yazma · WA APK güncelleme · fingerprint/anti-detection · RPA ·
canlı ekran+kontrol · Business downgrade · kayıt otomasyonu.
Ayrıca: WA oturumu iptal ederse **yeniden QR** gerekiyor (prosedür dokümanda yok),
telefonu **14 günde bir** açmak şart.

## SONUÇ / KARAR ÇERÇEVESİ
- ❌ "ban + gecikme + webhook aynı kök" **ÇÜRÜK**: gecikme bizim kodumuzdaydı ve
  çözüldü ([[wa-gecikme-mesgul-cihaz-ve-bilgi-karti-2026-08-17]]), ban kökü davranış,
  webhook zaten var.
- ✅ **GERÇEK avantajı: UI kırılganlığından kurtulmak.** Bugünkü "Disappearing
  messages kartı" tam bu sınıftan (WA bir kart ekler → gönderim durur). Ölçülebilir
  maliyet: 2 saatte 3 CHAT_NOT_OPENED + 4 CONNECTION_FAILED.
- ★ÖNERİ: **ücretsiz Sandbox ile 1 numarada POC** (sıfır maliyet, 150 mesaj/gün
  yeterli). Ölçülecek gerçek soru: soket tabanlı erişim UI otomasyonundan **gerçekten
  daha az mı kırılıyor**, ban oranı farklı mı? Cevap netleşmeden 155 numara taşımak
  (~$4.5k/ay) kumar.

Kaynaklar: https://whapi.cloud/docs · https://whapi.cloud/price ·
https://support.whapi.cloud/help-desk/llms-full.txt (LLM'ler için tam metin — proxy
sorusu burada da yanıtsız)
