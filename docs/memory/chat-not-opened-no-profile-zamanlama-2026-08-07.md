---
name: chat-not-opened-no-profile-zamanlama-2026-08-07
description: "🟢★★ CHAT_NOT_OPENED + NO_PROFILE ikisi de ZAMANLAMA, cihaz/hesap arızası DEĞİL. ★CHAT_NOT_OPENED'ın kökü: `screenTexts`='Searching…' — WhatsApp deep link'te önce numarayı arıyor, agent `notice`'ı TEK KEZ okuyup belirsiz hataya düşüyordu (gerçek sonuç INVALID_RECIPIENT). ★NO_PROFILE: menü açılışı kör `sleep(600)`. ⚠️İki vakada da 'cihaz bozuk' hipotezim canlı ölçümle ÇÜRÜDÜ."
metadata: 
  node_type: memory
  type: project
  originSessionId: 470cd62f-77c7-4a2b-a886-b7423529a779
  modified: 2026-08-07T14:10:48.891Z
---

# CHAT_NOT_OPENED + NO_PROFILE — ikisi de zamanlama

Genel tarama sırasında çıkan iki anomali, cihazda **elle** test edildi (ss + dump).

## ★ CHAT_NOT_OPENED — tek cihazda %36 yoğunlaşma
`+905395264232` (192.168.12.112) son 6 saatte 36 vakanın **13**'ünü tek başına üretti.

⚠️ **İlk hipotezim: "hesap bozuk/kısıtlı"** → **SS ÇÜRÜTTÜ**: sohbet listesi dolu,
mesajlar çift-tikli, ban/kısıt YOK. Hesap tamamen sağlıklı.

### Gerçek kök neden
DB'deki `result->>'screenTexts'` = **`Searching…`**

WhatsApp bir deep link (`wa.me/<num>`) ile sohbet açarken **önce numarayı arıyor**,
sonra sonucu gösteriyor. Agent `notice`'ı **TEK KEZ** okuyor (`whatsappSend`,
`if (!chatOpened) { const notice = await h.screenText() }`) — tam o ara ekrana denk
gelirse hiçbir desen tutmuyor ve belirsiz `CHAT_NOT_OPENED`'a düşüyor.

### ★KANIT (elle, aynı cihaz)
```
905305793542 → 1sn sonra ekranda: "The phone number … isn't on WhatsApp."
905358906699 → 2sn'de sohbet AÇILDI
```
Sinyal **VARDI** (`INVALID_RECIPIENT` deseni kodda zaten mevcut), agent onu görmeden
karar veriyordu. Doğru sonuç: **INVALID_RECIPIENT** (numara WhatsApp'ta yok).
"Sohbet açılamadı" demek operatörü YANLIŞ YÖNLENDİRİYOR.

**FIX:** ekran `searching|aranıyor` durumundaysa 700ms × 6 tekrar oku; bu arada
sohbet açılırsa normal akışa devam et.

## ★ NO_PROFILE — 43 vaka (hepsi WHATSAPP_SET_NAME)
⚠️ **"Cihaza özgü arıza" hipotezi de ÇÜRÜDÜ**: 2 ayrı cihazda elle test ettim, akış
SORUNSUZ çalıştı (`HomeActivity → SettingsTabActivity → ProfileInfoActivity`).
Vakalar 6+ cihaza DAĞILMIŞ (en fazla 3'er) = kararsız zamanlama.

### Kök neden
`waOpenProfileScreen`'de menü açılışı **kör `sleep(600)`** idi; kodda *"activity
değişmediği için poll edilemez"* diye yorumlanmıştı. Menü animasyonu geç biterse
"Settings" tıklaması BOŞA gidiyor → Settings hiç açılmıyor → `NO_PROFILE`.

**FIX:** menü artık **dump'tan** doğrulanıyor ("Settings/Ayarlar" göründü mü, 3 deneme)
+ Settings ve ProfileInfo tıklamaları tutmazsa bir kez daha deneniyor.

### Doğrulanmış koordinatlar (1080×2400)
| Adım | Koordinat | Not |
|---|---|---|
| ⋮ menü | (1018, 151) = 0.943×0.063 | ✓ çalışıyor |
| Settings | (684, 948) = 0.633×0.395 | ✓ gerçek bounds `[596,906][1028,963]` |
| Avatar | (540, 492) = 0.5×0.205 | ✓ gerçek bounds `[329,284][750,705]` |

Koordinatların hepsi DOĞRU — sorun onlarda değildi, zamanlamadaydı.

## ⚠️⚠️ DERS
**İki vakada da ilk hipotezim "cihaz/hesap bozuk" idi; ikisini de CANLI ÖLÇÜM çürüttü.**
Yoğunlaşma her zaman arıza demek değil. Bir cihazda hata birikmesi, o cihazın daha
çok İŞ ALMASINDAN da kaynaklanabilir.
★ `screenTexts` alanına BAK — hatanın gerçek sebebi çoğu zaman orada yazıyor.

## Sistem geneli (7 Ağu 13:00 taraması) — TEMİZ
```
133 cihaz ONLINE · 0 takılı job · 0 agent hatası · 0 API hatası
CPU %5.2 · RAM 147/250 · D-Bus 28/1024 · proxy ülke-port uyumsuzluğu 0
Son 6 saat: 1751 OK + 55 SENT · CHAT_NOT_OPENED %2
health-watch: "133 sağlıklı, 0 sızıntı, 0 reconnect, 0 erişilemez, 0 çıkış-ölü"
```
Dünkü düzeltmelerin hepsi yerinde: tur limiti 9 ✓ · profil kapalı ✓ · gerçek CPU ✓ ·
boot-restore enabled ✓ · D-Bus 1024 ✓

İlgili: [[RESUME-kaldigimiz-yer-2026-08-06]] · [[wa-saglik-sessiz-yoklama-2026-07-28]] ·
[[account-restricted-otomatik-tespit-2026-07-23]]
