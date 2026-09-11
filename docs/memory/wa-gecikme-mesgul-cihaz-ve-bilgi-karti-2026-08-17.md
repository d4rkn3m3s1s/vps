---
name: wa-gecikme-mesgul-cihaz-ve-bilgi-karti-2026-08-17
description: "Gelen mesaj 3-5 dk gec dusuyordu (kok=MESGUL CIHAZ ATLANIYORDU, 190-555sn->3-19sn) + CHAT_NOT_OPENED'in 3. sebebi WA \"Disappearing messages\" karti (entry'yi ortuyor)"
metadata: 
  node_type: memory
  type: project
  originSessionId: a9614e2b-33cb-436b-bb65-298d256a8fb6
  modified: 2026-08-17T13:36:10.205Z
---

# 2026-08-17 — İKİ KÖK ÇÖZÜLDÜ (ikisi de CANLI ÖLÇÜMLE, tahminle DEĞİL)

## 1) 🔴★★★ GELEN MESAJ 3-5 DK GEÇ DÜŞÜYORDU — kök: **MEŞGUL CİHAZ ATLANIYORDU**

**Belirti:** mesajlar panele/TG'ye 3-5 dk gecikmeli ve **ÖBEK ÖBEK** düşüyordu
(13:03:18'de ÜÇÜ aynı saniyede, 12:58:32'de İKİSİ aynı saniyede).

**Kök:** `whatsappInboxTick` şunu yapıyordu:
`reachableSerials().filter(s => !busyDevices.has(s))` — yani **job çalışan cihaz
TAMAMEN atlanıyordu**. Cihaz sürekli job alıyorsa mesajları HİÇ okunmuyor, ancak
cihaz boşalınca hepsi toplu düşüyordu. Ölçüm: bir cihaz **20 dk'da 64 job** almış
(51 RECEIPTS + 10 SEND). Aynı pencerede filoda 135 job vardı.

**FIX:** inbox okuması ile ekran işi AYRILDI.
- `msgstore` SQL'i (**0.04 sn, EKRANA DOKUNMAZ**) artık meşgul cihazda da çalışır —
  job'ın `uiautomator dump`/`screencap`'i ile **farklı yüzey**, yarışmaz.
- receipt kısmı (`dumpsys` + scrape) EKRANI okur → yalnızca cihaz boştayken.
- `pollWhatsappMedia` da ekrana dokunmuyor (waSql + exec-out) → meşgulken güvenli.
- Ayrıca `FLEET_WA_INBOX_MS` 5000 → **2000** (agent.env).

**SONUÇ (canlı doğrulama): 190-555 sn → 3-19 sn.**

### ⚠️⚠️ ÖLÇÜMLE ÇÜRÜYEN 5 HİPOTEZ — tekrar denenmesin
| Hipotez | Gerçek ölçüm |
|---|---|
| "`dumpsys` pahalı, turu yiyor" | **0.02 sn** |
| "12'li dalga yavaş / BATCH düşük" | dalga **0.08 sn**, TAM TUR (154 cihaz) **0.69 sn** |
| "WhatsApp mesajı geç itiyor" | mesaj cihaza **2-3 sn**'de varıyor (canlı test) |
| "soket kopuyor / doze uyutuyor" | soket **20 sn kesintisiz ESTABLISHED**, doze **ACTIVE** |
| "cihaz saati kaymış" | cihaz ve host epoch'u **birebir aynı** |

★DERS: "yavaş" denince önce **tur mimarisi** suçlanır ama burada tur zaten 0.69 sn'ydi.
Asıl sorun **kimin taranmadığı**ydı. Gecikmeyi ölçmenin doğru yolu:
`createdAt - waTimestamp` (ikisi de DB'de duruyor).

---

## 2) 🔴★★★ CHAT_NOT_OPENED'in **ÜÇÜNCÜ** SEBEBİ — WA "Disappearing messages" KARTI

**Belirti:** TG/panelden gönderim "❌ Sohbet ekranı açılamadı (mesaj kutusu
görünmedi) (CHAT_NOT_OPENED)". **Aynı hedef İKİ AYRI cihazdan da** başarısız.

**Kök:** sohbet ASLINDA AÇILIYOR (`mCurrentFocus=com.whatsapp/com.whatsapp.Conversation`)
ama üzerine WhatsApp'ın KENDİ bilgi kartı biniyor:
"**Disappearing messages are on in this chat**" + [OK] [LEARN MORE] — ve
**KENDİLİĞİNDEN KAPANMIYOR** (t+2/4/7/10 sn'nin hepsinde ekrandaydı).

★★KANIT (192.168.109.13 → 905400403800):
- kart varken `grep -c com.whatsapp:id/entry` = **0** (mesaj kutusu YOK)
- OK'a basıldıktan sonra = **1** (kutu AÇILDI, OK/LEARN MORE **gitti**)

Eski kod yalnızca **ANR** diyaloğunu temizliyordu (`clearAnrDialog`), bu kartı
tanımıyordu → entry poll 9 tur × 500ms boşuna dönüyor
(log: `chat opened (entry poll)=false: +27497ms`).

**FIX:** `clearWaInfoCard` — ANR temizleyicinin YANINDA, aynı ritimde.
YALNIZCA Conversation ekranında + entry YOKKEN çalışır (dar kapsam).
**LEARN MORE'a DEĞİL OK'a** basar (LEARN MORE tarayıcı açıp sohbetten çıkarır).

### ⚠️⚠️ `findNode` İKİ TUZAĞI (agent.mjs:7977) — bu dosyada kod yazarken KRİTİK
1. **REGEX DESTEKLEMEZ** — `String(cand).toLowerCase().includes(q)` yapar.
   Regex verirsen `"/disappearing messages/i"` **METNİ** aranır, HİÇBİR ZAMAN
   eşleşmez ve **sessizce** çalışmaz. → **DİZİ** kullan (findNode diziyi sırayla dener).
2. **SUBSTRING eşleşir** — `tapSynIf('OK')` ekrandaki "**Bok**", "**Tok**at",
   "Lo**ok**ing" gibi metinlere takılıp **YANLIŞ düğmeye basabilir**.
   → Buton TAM METİN eşitliğiyle seçilmeli: `t === 'ok' || t === 'tamam'`, sonra
   koordinatından tıkla.

---

## Sıradaki (ölçüldü, henüz yapılmadı)
- **`WHATSAPP_SEND` ortalama 15.7 sn** (145 RECEIPTS 0.5 sn'de bitiyor, SEND 15.7).
  En yavaş adımlar: `chat opened=false` **27-29 sn** (bu kart fix'i ile büyük ölçüde
  düşmeli) ve `send tap 0 + verify (still=false)` **12-15 sn** — verify döngüsü
  ayrıca incelenmeli.
- **RECEIPTS job'ı 30 dk'da 145 adet** — ucuz ama sürekli `busyDevices`'a sokuyor;
  toplu/aralıklı yapılabilir.
- **Gecikme görünürlüğü YOK**: `createdAt - waTimestamp` panele (p95 + eşik alarmı)
  konmalı — bu sorun haftalarca sessiz kaldı, kullanıcı söyleyene kadar bilinmiyordu.
- **2 sn'lik tur aralığı BOŞ SİSTEMDE ölçüldü** — job-yoğun pencerede doğrulanmalı
  (bkz. [[iyilestirmeler-2026-08-15]] BATCH dersi: boş sistem ölçümü yanıltır,
  25'e çıkarınca 8 cihaz düşmüştü).

İlgili: [[chat-not-opened-no-profile-zamanlama-2026-08-07]] (1. ve 2. sebep) ·
[[proc-taramasi-systemd-kilidi-2026-08-14]] · [[wa-medya-ethernet-zorla-indirme-2026-08-15]]
