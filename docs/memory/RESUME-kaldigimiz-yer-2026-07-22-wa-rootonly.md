---
name: RESUME-kaldigimiz-yer-2026-07-22-wa-rootonly
description: 22 Temmuz oturumu — WhatsApp public API'ye 20+ root-DB/root-only ucu eklendi, phoenix'e deploy+canlı test edildi. "Nerede kaldık" cevabı.
metadata:
  type: project
---

# NEREDE KALDIK — 2026-07-22 (WhatsApp root-only API mega genişletme)

Bu oturumda WhatsApp public API'si **20+ yeni root-DB/root-only ucu** ile genişletildi, hepsi phoenix'e (`125.253.73.45`) deploy edildi ve canlı test edildi. İlişkili: [[host-phoenix-erisim]] [[wa-rootdb-medya-lid-numara-2026-07-22]] [[canli-izleme-8bug-sticky-2026-07-22]].

## COMMIT'LER (branch feat/cloud-phone-suite, henüz push EDİLMEDİ — `git push` gerekir)
- `ae9e71d` — root-DB fast paths + WHATSAPP_CONVERSATIONS + ban/rate/OTP detection (önceki)
- `d2ef1b9` — 5 root-DB read: receipts/media/calls/search/unread (önceki)
- `b813937` — root-DB uçları PUBLIC API'ye taşındı + long-poll + batch-claim + 4 yeni (contacts/group-members/chat-summary/account-health)
- `2ba3aa1` — 6 yeni: fetch-media/reactions/polls/read-by/starred/labels-list + account-health & LID bug fix
- `d360ca3` — **SON**: root-only capture — view-once/voice-notes/deleted/links + medya auto-capture

## DEPLOY DURUMU (phoenix canlı)
- Agent `/opt/agent.mjs` + API `/opt/fleet/apps/api` GÜNCEL, migration'lar uygulandı, health 200, api+agent active.
- Deploy repo kaynağı: `deploy/kvm-host/agent/agent.mjs` (+ `.audit-host-snapshot/agent.mjs` senkron kopya, gitignore'da).
- **DEPLOY PROSEDÜRÜ:** API dosyaları root-owned → tar→/tmp→`sudo tar -xzf -C /opt/fleet`→`sudo chown -R ubuntu:ubuntu apps/api/{src,prisma,dist}`→`npx prisma generate`→`npx tsc --noEmit`→`npx prisma migrate deploy`→`npm run build`→`sudo systemctl restart fleet-api`. Agent: scp→/tmp→`sudo cp /opt/agent.mjs`→restart.

## API'DE ŞU AN VAR OLAN TÜM WhatsApp ROOT-DB/ROOT-ONLY UÇLARI (public /v1/whatsapp/*)
Okuma (job döner, GET /v1/jobs/:id/wait ile bekle): conversations, receipts, media, calls, search, unread, contacts, group-members, chat-summary, account-health, reactions, polls, read-by, starred, labels-list, **fetch-media** (indirilmiş medyayı base64), **view-once** (tek görünümlük foto/video base64), **voice-notes** (ses base64), **deleted** (anti-delete — silinen mesaj metni), **links** (tüm URL'ler). Hepsi ekran gezmez, ~1-2sn, ban riski SIFIR.
Yazma (mevcut): send, broadcast, profile, block, blocklist, mynumber, send-media, delete-message, clear-chat.
DX: **GET /v1/jobs/:id/wait** (long-poll, poll döngüsü öldü). **batch-claim** (agent /agent/jobs/next-batch, poll-Hz darboğazı çözüldü).

## CANLI DOĞRULANANLAR (KANIT)
- ✅ **TAM ÇALIŞAN + canlı kanıtlı:** labels-list (3 etiket), account-health ({"number":"+905380525622","name":"Jennifer Brown"}), chat-summary ({total:2,outbound:2}), fetch-media (senin attığın medyayı gördü→pending:true çünkü inmemiş), starred, deleted, links, voice-notes, view-once — HEPSİ COMPLETED + doğru sonuç.
- ✅ Önceki 4 (contacts/group-members/chat-summary/account-health) da canlı doğrulandı.

## AÇIK KALAN / EKSİK (nerede kaldık)
1. **Auto-capture E2E kanıtı EKSİK.** Medya klasör-izleyici ticker (opt-in `FLEET_WA_CAPTURE=1`) kodu tamam; `find -exec ls -la {} +` komutu + regex canlı kanıtlandı (3/3). AMA uçtan-uca "webhook düştü" logunu **göremedim** (agent log yönlendirme sorunu: `/var/log/fleet-agent.log` bazen kesiliyor, journal agent'ın kendi `[agent...]` satırlarını göstermiyor). Prod'da OFF (opt-in), risk yok. **Kaldığımız iş:** gerçek indirilen bir medyayla ya da log yönlendirmesini düzeltip E2E kanıtla.
2. **Agent graceful-drain ~90sn.** Agent shutdown drain döngüsü (60x500ms + adb kill) systemd stop-timeout'unu (91sn görüldü) aşıyor → restart'lar asılıyor, bir kez `failed`'a düştü (hemen `reset-failed`+start ile düzeltildi). **DİKKAT:** agent restart ederken `systemctl kill`/`pkill -f /opt/agent.mjs` KULLANMA (failed'a düşürür). Temiz yol: `sudo systemctl restart` bekle, deactivating'de kalırsa `sudo systemctl kill` + `start`. **Kaldığımız iş:** agent shutdown drain'ini kısalt (main loop'taki `for (let i=0;i<60...)` + SIGTERM handler).

## YAPILMAYAN AMA YAPILABİLİR (root-only, düşük öncelik)
konum (message_location), vcard (message_vcard), durum/story görüntüleme (status*), kanallar (newsletter*), hazır yanıtlar (quick_replies), quoted zincirleri (message_quoted), gruplar-listesi (chat+jid g.us), cihaz-analitiği (message aggregate). Root-DIŞI güçlü: tam-sohbet-yedeği (msgstore.db export), hesap-klonlama (WA veri dizini kopyala).

## ROOT İLE YAPILAMAZ (protokol şart, root yetmez): mesaj gönderme, gruba katılma, arama, story paylaşma, ayar değiştirme, profil-foto, inmemiş medyayı açma.

## KRİTİK TEKNİK NOTLAR (bu cihaz shell'i çok minimal — [[wa-rootdb-medya-lid-numara-2026-07-22]])
- `find -printf`, `find -newermt "date time"`, `ls --time-style`, `tr '\n' '\0'|xargs -0` HEPSİ çalışmıyor. Çalışan: `find ... -exec ls -la {} +` (boşluklu WhatsApp yolları korunur, format "perms links u g SIZE YYYY-MM-DD HH:MM /path").
- Root dosya çekme = `adb exec-out su -c "cat '<path>' | base64"` (adb pull permission duvarını atlar). maxBuffer 64MB.
- Kayıtlı numara: `props` tablosunda DEĞİL → shared_prefs `com.whatsapp_preferences_light.xml` (`registration_jid`+`cc`). Push adı: msgstore props `user_push_name`.
- Chat'ler LID ile key'li; `waChatFilter(num)` jid_map ile çözer, server kısıtı YOK (numara benzersiz).
- SSH-inline tuzağı: boşluklu path/tırnak/JSON payload SSH katmanlarında bozulur → script dosyası yazıp scp+bash ile çalıştır; DB job insert'te `jsonb_build_object` kullan.

## NASIL DEVAM EDİLİR
En mantıklı sıradaki 2 adım: (a) agent drain-timeout fix (stabilite — restart'ları güvenli yapar), (b) auto-capture E2E kanıt (gerçek medya + log fix). Kullanıcı "hangisini" diye seçmeli. Kalan root-only okuma uçları (konum/vcard/gruplar-listesi/analitik) düşük öncelikli, istenirse eklenebilir.
