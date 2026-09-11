---
name: wa-rootdb-medya-lid-numara-2026-07-22
description: WhatsApp root-DB gerçekleri — kayıtlı numara nerede, LID chat çözümü, medya root ile nasıl çekilir (canlı kanıtlı)
metadata:
  type: project
---

**2026-07-22:** WhatsApp public API'ye 10 yeni root-DB ucu eklendi + 4 bug fix, phoenix'e (125.253.73.45) deploy edildi, canlı doğrulandı. Commit'ler: `b813937` (ilk 5: receipts/media/calls/search/unread public'e + long-poll + batch-claim), `2ba3aa1` (fetch-media/reactions/polls/read-by/starred/labels + bug fix). İlişkili: [[host-phoenix-erisim]] [[canli-izleme-8bug-sticky-2026-07-22]].

## Modern WhatsApp (2.26.x) root-DB gerçekleri — CANLI KANITLI

**Kayıtlı numara `props` tablosunda DEĞİL.** `wa.db props` tablosu modern build'de `registration_jid` içermiyor (boş/yok). Numara **shared_prefs**'te:
- `/data/data/com.whatsapp/shared_prefs/com.whatsapp_preferences_light.xml` → `<string name="registration_jid">905380525622</string>` + `<string name="cc">90</string>`
- Push/görünen ad: `msgstore props` tablosu `user_push_name` key'i.
- Agent'ta `readWaPref(serial,key)` helper'ı bu XML'leri okur (regex ile). account-health bunu kullanıyor. **Why:** props'a bakan eski kod hep null döndürüyordu.

**Her chat LID ile key'leniyor** (server='lid'), `s.whatsapp.net` DEĞİL. Gerçek numara `jid_map` ile çözülür: `jid_map(lid_row_id PK, jid_row_id, sort_id)` — `lid_row_id` = chat'in LID jid._id'si, `jid_row_id` = gerçek numara jid'i. Zincir: `chat.jid_row_id → jid(lid) → jid_map.lid_row_id → jid_map.jid_row_id → jid(gerçek numara)`.
- **KRİTİK:** Bir numaranın **birden fazla jid kaydı** olabilir (biri s.whatsapp.net, biri farklı). `waChatFilter`'da `j.server='s.whatsapp.net'` kısıtı KALDIRILDI — sadece `j.user=NUM` ile eşleştir (numara benzersiz), yoksa jid_map eşleşmesi kaçıyor → `0||||` boş sonuç. **How to apply:** LID-tabanlı herhangi bir chat sorgusunda server kısıtı koyma.

## Root ile MEDYA çekme — CANLI KANITLI

- WhatsApp medyayı **sadece indirilince** diske yazar. İnmemiş medya: `message_media.file_path` BOŞ, `file_size=0` → sadece `media_key`(BLOB) + `direct_path`(CDN URL, `oe=` süreli) var, dosya diskte YOK.
- **İnmiş medya root ile çekilir:** `adb -s <serial> exec-out su -c "cat '<path>' | base64"` — `adb pull` "Permission denied" duvarını atlar (stdout'tan akıtır). `maxBuffer 64MB`. `fetch-media` ucu bunu yapıyor; inmemiş medya `pending:true` döner.
- **How to apply:** root dosya çekme = her zaman `exec-out su -c cat` (pull DEĞİL). Host'un /tmp'sine pull da izin hatası verir.

## Değerli tablolar (300+ şema içinden, canlı doğrulanmış kolonlar)
- `message.starred` (yıldızlı) · `message_add_on_reaction(reaction, sender_timestamp, message_add_on_row_id)` (emoji) · `message_poll(message_row_id PK — poll_name YOK, soru message.text_data'da)` + `message_poll_option(option_name)` + `message_poll_vote` · `receipt_user(message_row_id, receipt_user_jid_row_id, read_timestamp, receipt_device_timestamp)` (grup okundu) · `labels(_id, label_name, color_id, predefined_id)` + `labeled_jid(label_id, jid_row_id)` (predefined_id>0 = sistem etiketi Unread/Favorites/Groups).

## Root'tan YAPILAMAZ (UI şart): mesaj gönderme (DB write protokol tetiklemez), inmemiş medya açma, profil-foto (şifreli), gruba katılma/arama (protokol imzası), ayar değiştirme.

## Deploy prosedürü (phoenix): dist/ ROOT-owned → build öncesi `sudo chown -R ubuntu:ubuntu apps/api/{src,prisma,dist}` ŞART yoksa tsc EACCES verir. API dosyaları root-owned → tar→/tmp→`sudo tar -xzf -C /opt/fleet`. Sonra generate→tsc→`prisma migrate deploy`→`npm run build`→`sudo systemctl restart fleet-api`. Agent: scp→/tmp→`sudo cp /opt/agent.mjs`→restart fleet-agent.
