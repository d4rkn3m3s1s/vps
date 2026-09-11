---
name: gelen-mesaj-kayip-ve-gecikme-2026-08-19
description: Gelen WhatsApp mesajlarının bir kısmı TG'ye hiç düşmüyordu — imleç bellekteydi (restart=kayıp) ve rehber tetiği kısır döngüde 5 dk gecikme yaratıyordu
metadata:
  type: project
---

# 🔴★★★ GELEN MESAJ: BİR KISMI KAYIP + KALANI 5 DK GEÇ

Şikâyet: *"attığım bazı mesajlar TG'ye düşüyor bazıları düşmüyor, foto hiç düşmüyor"*.
Zincir baştan sona izlendi: **cihaz `msgstore.db` → ajan → API → TG**. Sorun **TG
botunda veya API'de değil, ajandaydı**.

## Teşhis yöntemi (tekrar kullan)

Cihazın kendi DB'sindeki satırları API'deki satırlarla **birebir** karşılaştır:
- cihazda: `sqlite3 msgstore.db` (sorguyu **dosyayla gönder** — iç içe tırnak bozulur)
- API'de: `WhatsappMessage` (kolonlar: `waTimestamp`, `body`, `direction`, `dedupeKey`)
Gecikme ölçümü: `createdAt - waTimestamp`.

## ★★★KÖK 1 — İMLEÇ YALNIZCA BELLEKTEYDİ (gerçek kayıp)

`WA_INBOX_POS` / `WA_MEDIA_POS` birer `Map`. Ajan her yeniden başladığında Map boşalıyor,
ilk tur imleci **"mevcut en son mesaja" tohumluyor** → ajan kapalıyken gelen her şey
**kalıcı olarak** atlanıyor, hiçbir iz kalmıyor.
**Kanıt:** kaçan mesajların saatleri ajan restart saatleriyle (01:59:41, 02:06:53) birebir
örtüştü. Bu gece deploy için ~7 restart yaptım → o yüzden çok belirgin oldu.

FIX: imleçler `/var/lib/fleet-agent/wa-inbox-pos.json`'a **atomik** (tmp+rename) ve
**borçlanmalı** (3sn debounce) yazılır, açılışta yüklenir.
⚠️**TOHUM YOLU DA yazmalı** — ilk denememde orayı atlamıştım, dosya hiç oluşmadı ve
düzeltme tamamen işlevsiz kalıyordu. Doğrulama: restart sonrası imleç 1723, cihaz max
1724 → yeniden tohumlamadı.

## ★★★KÖK 2 — REHBER TETİĞİ KISIR DÖNGÜDE (5 dk gecikme)

`pollWhatsappMedia`'daki "bekleyen medya" sayacı `m._id > pos` kullanıyordu; `pos` ise
**yalnızca inmiş medya gönderilince** ilerliyor (`if (!rows.length) return;` imleci
güncellemeden çıkar). İndirilmiş medyası olmayan cihazda `pos` **hiç ilerlemez** → sayaç
sonsuza dek > 0 → `ensureContacts` her cihazda **3 dakikada bir, süresiz** çalışır.

⚠️**MALİYET:** `ensureContacts` her numara için ayrı `content query` yapıyor,
**tanesi ~1021 ms**. 20 kişilik cihazda tek çağrı ~20 sn. 140 cihaz × 3 dk = tur
bütçesinin kat kat üzeri → gelen kutusu turu geride kalır.

FIX: tetik için **ayrı taban** (`WA_MEDIA_TRIG_POS`), `ensureContacts` her çalıştığında
ilerletilir. Ayrıca liste `GROUP BY user ORDER BY max(_id) DESC LIMIT 25`
— ⚠️**sırasız LIMIT hep EN ESKİ kişileri alır**, yeni gönderen hiç eklenmez, medyası inmez.

**ÖLÇÜLEN SONUÇ:** gecikme **291/311 sn → 24/46/48/49 sn**.

## 📷 FOTOĞRAF — iki ayrı sebep

1. **Cihaza hiç inmiyor:** `message_media.file_path` boş → medya sorgusu eliyor.
   Kök: otomatik indirme maskeleri. **Filoda 132/140 cihazda yalnız 1 maske**
   (`autodownload_roaming_mask`) ayarlı; `cellular` ve `wifi` **hiç yok**.
2. **İnen tek foto** da restart-sıfırlaması yüzünden atlandı (KÖK 1).

⚠️**ROOT İLE YAZMAK TUTMUYOR — DOĞRULANDI:** force-stop → 3 maskeyi de root'la yaz →
WhatsApp'ı aç → **cellular ve wifi SİLİNİYOR**, yalnız roaming kalıyor. Yani
[[wa-medya-otomatik-indirme-2026-08-15]] notu doğru: **tek yol UI**.
⏳ **YAPILMADI:** 132 cihazda cellular+wifi maskelerini UI ile açmak.

## Ek

- receipt taraması 6 turda bire indirildi (~30 sn): Conversation açıkken `uiautomator
  dump` (~2050 ms/cihaz) her turda gelen-mesaj yolunu geciktiriyordu.
- inbox sorgusuna `LIMIT 200` — uzun kesinti sonrası birikim tek turu kilitlemesin.

Bkz. [[wa-gecikme-mesgul-cihaz-ve-bilgi-karti-2026-08-17]] · [[wa-medya-otomatik-indirme-2026-08-15]]
