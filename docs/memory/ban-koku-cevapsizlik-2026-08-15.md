---
name: ban-koku-cevapsizlik-2026-08-15
description: "WA hesap kısıtlama/ban kökü ÖLÇÜLDÜ — hacim/yaş/proxy DEĞİL, CEVAPSIZ SOHBET ORANI. Sağlam %30, banlı %53, kısıtlı %65. Karşılıklılık (giden/gelen) sağlamlarda 1.2, kısıtlılarda 2.3."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-15T15:41:09.555Z
---

# WA ban/kısıtlama kökü = CEVAPSIZLIK (ölçüldü, 2026-08-15)

Filo durumu (15 Ağu): ACTIVE **52**, RESTRICTED **51**, BANNED **45**, FAILED 175.
Bugün tek günde 14 RESTRICTED + 4 BANNED (dün 5, 12 Ağu 9) → en kötü gün.

## ★★★ASIL BULGU — cevapsız sohbet oranı
| Durum | Yazışılan kişi | Cevapsız kişi | **Cevapsız %** | Giden/Gelen |
|---|---|---|---|---|
| ACTIVE (sağlam) | 18.0 | 6.6 | **%30** | **1.2** |
| BANNED | 13.3 | 6.5 | %53 | 1.9 |
| RESTRICTED | 3.9 | 2.6 | **%65** | 2.3 |

Desen monoton: cevapsızlık arttıkça hesap kaybı artıyor. WhatsApp **hacme değil
KARŞILIKLILIĞA** bakıyor. Sağlam hesap attığı kadar cevap alıyor (1.2), kısıtlanan
2.3 kat fazla gönderiyor = cevapsız soğuk mesaj.

## ÇÜRÜYEN HİPOTEZLER (tekrar bu yollara sapma)
- **HACİM DEĞİL**: sağlam hesaplar ort. **64** mesaj, kısıtlananlar **7** — sağlamlar
  9 KAT FAZLA atmış. Kısıtlanmadan önceki 24 saatte yalnızca 2-20 mesaj.
- **YAŞ DEĞİL**: kısıtlananlar ort. 144 saat, sağlamlar 159 saat — aynı aralık.
  ("~70 saatte ban" eski hipotezi bu veriyle desteklenmiyor.)
- **PROXY IP DEĞİL**: 5 cihazda çıkış IP'leri farklı ve TR (176.234.x, 31.169.x,
  88.243.x ×2, 95.0.x) — sessid çalışıyor, IP paylaşımı yok.
- **MOBİL PROXY VAR ve kullanılıyor**: ayrı thordata hesabı (`td-customer-<TR_MOBILE_USER>`,
  port 9999), `FLEET_PROXY_MOBILE_*` + `FLEET_PROXY_MOBILE_COUNTRIES=TR` tanımlı
  (/etc/fleet-api-proxy.env). "Mobil yok" diye alarm verme — VAR. 138 cihaz 9999'da.
  Kod notu: TR residential havuz ölü, TR mobil hesaptan çıkmak ZORUNDA.

## Uygulanabilir öneriler (henüz YAPILMADI)
- Cevapsız sohbet oranını hesap başına izle; eşiği aşınca (>%50) o hesabın yeni
  sohbet açmasını otomatik durdur/yavaşlat (mevcut sohbetlere cevap devam).
- Soğuk mesajı cevap gelene kadar sınırla (ör. ilk mesajdan sonra 2. mesajı
  cevap gelmeden atma).
- Farm/warmup akışında hedefi "cevap alınabilir kişi" seçmeye ağırlık ver.

İlgili: [[ban-dalgasi-gecikmeli-toplu-denetim-2026-08-08]] (o gün 3 hipotez çürümüştü —
bu ölçüm cevapsızlığı ilk kez sayısal olarak gösteriyor)
