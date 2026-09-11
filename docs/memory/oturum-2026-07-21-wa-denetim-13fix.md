---
name: oturum-2026-07-21-wa-denetim-13fix
description: ★2026-07-21 ÇOK-AJANLI WA JOB DENETİMİ (85 ajan→55 doğrulanmış bug→13 P0/P1 fix DEPLOY). Workflow: 12 eksen denetim + adversarial doğrulama + sentez. Fix'ler: BUG-3(delete yanlış-mesaj→NOT_FOUND), BUG-4(block boş-dump ters-aksiyon→DUMP_EMPTY+verify), BUG-7(inbound burst kayıp→sig+count/anchor), BUG-1b(broadcast reaper yalan-fail muafiyeti), ORCH-1(timeout pendingSettle await=paralel korrupsiyon), SHOT-1(dumpOrRetry: clear/media yalan-CLEARED/SENT), BUG-2(waOpenChat gerçek-sonuç+5 çağıran), BUG-5(profile uydurma-değer), BUG-6(delete verify-after), BUG-8(receipt yanlış-numara guard), COORD-1(locale receipt TR), COORD-2a(send-node anchored), HIZ-1(çift dump+wm size kaldır=paralel kontenşın yarı). 3 servis active. P2(broadcast fan-out+şema) ERTELENDİ.
metadata:
  node_type: memory
  type: project
---

**★ 2026-07-21 OTURUM: ÇOK-AJANLI WhatsApp JOB DENETİMİ + 13 FIX DEPLOY ★**

Önceki: [[oturum-2026-07-20-receipt-maxconc-ban-mimarisi]]. Kullanıcı Telegram'ı erteledi, WA job'larını (toplu-gönder/oku/profil/sil vs.) çok-ajanlı denetimle bug+hız+koordinat iyileştirme istedi. Özel vurgu: "toplu mesaj = AYNI ANDA FARKLI CİHAZLAR" (broadcast + paralel yürütme).

## 🤖 WORKFLOW: 85 ajan, 55 doğrulanmış bug
- Workflow (Workflow tool, dynamic): 12 DENETİM ekseni (send/read/receipt/profile/block/mynumber/media/delete/clear/openchat/parallel/broadcast), her biri 4 mercek (bug/hız/koordinat/screenshot), high-effort. → her bulgu ADVERSARIAL doğrulandı (skeptik ajan çürütmeye çalıştı, real=false elendi) → sentez (dedup→28 fix, 5 kök-neden, önceliklendirilmiş plan).
- Script: c:\Users\furka\.claude\projects\C--Yeni-klas-r-vps\...\workflows\scripts\wa-job-audit-wf_d1bf64aa-e66.js. Sonuç: tasks\wotgfh71p.output (tam plan). 2.8M token, 761s, 0 hata.
- ★DEĞER: adversarial doğrulama yanlış-pozitifleri eledi (block confirm-matcher, "More" substring, waOpenChat-fail-open spekülatifti→real=false). Gerçek bug'lar koddan kanıtlandı.

## ✅ 13 FIX DEPLOY (kullanıcı P0+P1 seçti, hepsi node-check+tsc temiz)
Tüm agent fix'leri deploy/kvm-host/agent/agent.mjs. Kök helper: **h.dumpOrRetry({tries,gapMs})** eklendi (waHelpers, satır ~713)—boş dump'ı retry, hâlâ boşsa [] ama caller INCONCLUSIVE saymalı (başarı/kapandı DEĞİL).

**🔴 VERİ KAYBI / TERS AKSİYON (P0):**
- **BUG-3** pickBubble: matchText bulunamazsa `texts[last]` fallback KALDIRILDI→null→openCab NOT_FOUND. (Eskiden aradığı mesaj ekran-dışıysa SON mesajı siliyordu—geri dönüşsüz.)
- **BUG-4** whatsappBlock: boş dump'ta kör-koordinat-tap KALDIRILDI→dumpOrRetry, hâlâ boşsa DUMP_EMPTY (durum bilinmeden tap=engel↔engel-kaldır ters aksiyon). + rich-text(text+desc union) + verify-after(verb FLIP kontrol→UNVERIFIED).
- **BUG-7** scrapeIncomingBubbles + Telegram ikizi(scrapeTelegramIncoming): `prev.sig===newest` short-circuit tüm batch'i atlıyordu(burst'ün son bubble'ı önceki-emit'e eşitse aradaki YENİ mesajlar KAYIP). FIX: sig=newest+count(değişim tespiti), anchor=son-emit-text(slice için) AYRILDI.
- **BUG-1b** (apps/api/src/modules/jobs/jobs.service.ts): broadcast'in skipBusyCheck ile kuyruğa soktuğu WHATSAPP_SEND'ler ~20s/send işlenirken kuyruk-sonu PENDING_STALE(6dk) aşıp reaper YALAN-FAIL'liyordu. FIX: PENDING reaper `NOT payload.broadcastId` ile broadcast job'larını MUAF tutar(Prisma.DbNull).

**🔴 PARALEL YÜRÜTME (ana odak):**
- **ORCH-1** runJobTask(satır ~8532): timeout'ta pendingSettle YAKALANIYORDU ama finally AWAIT ETMEDEN cihazı serbest bırakıyordu→terk-edilmiş runJob hâlâ ADB'ye yazarken sonraki job aynı serial'e eşzamanlı→EKRAN KORRUPSİYON(fake-SENT/yanlış-ekran-tap). FIX: pendingSettle fonksiyon-scope'a taşındı(try dışı, else finally ReferenceError) + finally'de `Promise.race([pendingSettle, sleep(20000)])` await.

**🔴 YALAN-BAŞARI (verify-after):**
- **SHOT-1** dumpOrRetry: whatsappClearChat(afterClear boşsa []→[].some=false→yalan-CLEARED→ATTEMPTED) + whatsappSendMedia(after boşsa findNode-null→yalan-SENT→SEND_UNCONFIRMED, +backOnChat pozitif kanıt).
- **BUG-6** whatsappDeleteMsg: confirm-tap sonrası verify-after(dumpOrRetry: dialog-gone + tombstone "silindi")→doğrulanamazsa ATTEMPTED değil DELETED. (Eskiden chosen-truthy=DELETED, tap ıskalasa bile.)
- **BUG-5** whatsappProfile: boş dump'ta phone=`+${to}`/name=`from` UYDURMA fallback KALDIRILDI→sadece GERÇEK node'dan, dump boşsa NO_INFO. (Eskiden hiçbir şey okunmadan status:OK+uydurma-değer.)
- **BUG-8** pushOutgoingReceipt: açık chat'in tik'ini waLastSentPeer'a KÖRÜ-KÖRÜNE atfediyordu(operatör başka chat açsa yanlış numaraya receipt). FIX: attribution-guard(ekran-peer-digits `to` ile eşleşir VEYA son-gönderim<5dk+aynı-chat), waLastSentPeer={to,at,peerName}.
- **BUG-2** waOpenChat: `to` yolu id/entry görünmese bile DAİMA `return true`→sonraki tap'ler yanlış ekrana(geçersiz-numara/hesap-review/ANR). FIX: chatOpened takip+ANR-clear(poll içinde)+`from` yolu verify-after+locale(Search/Ara). 5 ÇAĞIRAN(profile/block/media/delete/clear) dönüşü kontrol→false ise NO_CHAT(kör-tap yok).

**🎯 KOORDİNAT + ⚡ HIZ:**
- **COORD-1** readOutgoingReceipt: tik content-desc EN-only(`\bread\b`/`\bdelivered\b`)→TR eklendi(okundu/iletildi/teslim). Türkçe cihazda receipt HİÇ raporlanmıyordu(sessiz). + clear overflow "More options"→"Diğer seçenekler".
- **COORD-2a** whatsappSend: `.includes('id/send')` substring(id/send_container'a da denk gelir)→`/:id\/send$/` anchored + clickable + en-küçük-alan seçimi.
- **HIZ-1** (paralel ROI en yüksek): açık chat'te scrapeIncomingBubbles + pushOutgoingReceipt HER İKİSİ ayrı uiDumpXml + `wm size` alıyordu→ÇİFT dump. FIX: pollWhatsappInbox tek ctx{nodes,sw} paylaşır(scrapeIncomingBubbles(serial,_ctx) stash eder, pushOutgoingReceipt(serial,preNodes,preSw) reuse). + scrape'in `wm size` adb→wmSize() cache. GPU'suz host'ta çok-cihaz kontenşın ~yarı.
- **BUG-1c** broadcast jitter: `(dispatched*2654435761)%1000` deterministik(sabit parmak-izi + error-storm'da donuyor)→`Math.random()*(maxGap-minGap+1)`.

## 🔧 DEPLOY (3 servis active)
- agent.mjs→/opt/agent.mjs(yedek .bak-waaudit). API(whatsapp.service+jobs.service) tar→/opt/fleet extract, npm run build(tsc temiz), restart API-sonra-agent. "max 16 concurrent" + stream connected doğrulandı. dist'te dumpOrRetry/pendingSettle/broadcastId var.
- ★classifier bu oturumda ENGELLEMEDİ—kullanıcı önceki oturumda settings.local.json'a permissions.allow(ssh/scp phoenixnap_y)+autoMode.allow(prod komutları) ekledi, restart sonrası AKTİF.

## ⚠️ ERTELENEN P2 (riskli/geniş, sonraki dalga)
- **BUG-1a/d/e broadcast**: (a)fire-and-forget persist/resume(API restart→#201-1000 kaybolur), (d)koşulsuz-COMPLETED→sayaç-reconcile, (e)★ÇOK-CİHAZ FAN-OUT(tek deviceId→deviceIds[]/pool round-robin shard, DB şema alanı gerekir). Kullanıcının "aynı anda farklı cihaz" isteğinin broadcast tarafı.
- COORD-1 kalan locale: waOpenSettings/whatsappBlocklist/whatsappMyNumber landmark'ları(Settings/Privacy/Phone İngilizce-only→NO_LIST/yanlış-numara TR'de).
- SHOT-1 kalan call-site: whatsappRead(4395)/blocklist(4854)/mynumber(4935) boş-dump ayrımı.
- ORCH-2(otpWatch TOCTOU), ORCH-3(same-device waiter cap bypass, kalıcı=API per-serial exclusivity), SHOT-2(SENT box-clear-only→bubble-doğrula), COORD-2b-e(tapSynNode tapX/tapY, media-tile unique-filename, kör-tap tapScaled), COORD-3(read all-text fallback).

## ✅★ 2. DALGA: P2 KALANLARI + BROADCAST FAN-OUT DEPLOY (2026-07-21 devam) ★
Kullanıcı "kalan taskları bitir" dedi. P2'nin KOD-la-bitirilebilir tümü yapıldı+DEPLOY(migration 20260721000000_broadcast_fanout):
- **COORD-1 kalan locale**: waOpenSettings(More options/Diğer seçenekler, New group/Yeni grup, Settings/Ayarlar, Account/Hesap), whatsappBlocklist(Privacy/Gizlilik, Last seen/Son görülme, Blocked accounts/Engellenen hesaplar, WhatsApp contacts/kişileri, Accounts/Hesaplar), whatsappMyNumber(More options, You/Sen, Phone/Telefon, (You)/(Sen)). findNode array kabul ediyor→string→['EN','TR'].
- **SHOT-1 kalan**: whatsappRead(waOpenChat kullan+NO_CHAT, dumpOrRetry, ★all-text fallback KALDIRILDI=sadece message_text, boş→READ_UNCONFIRMED), whatsappBlocklist/MyNumber dumpOrRetry+boş→NOT_FOUND.
- **SHOT-2**: whatsappSend outgoingBubbleAppeared() helper(sağ-yarı message_text+needle)→box-clear belirsizse(null) bubble görülürse sent=true(pozitif kanıt).
- **ORCH-2**: otpWatchTick TOCTOU→`otpCapturing` Set(busyDevices'tan AYRI, capture-lock, re-check, finally-delete), dispatcher waitForDevice de bekler.
- **ORCH-3**: same-device waiter pile-up→`sameDeviceWaiters` Set(serial başına 1 waiter cap, fazlası claim-skip→reaper re-queue).
- **COORD-2b**: tapSynNode `n.cx/cy`→`n.tapX??n.cx`(clickable-parent, TÜM çağıranları iyileştirir).
- **★★BROADCAST ÇOK-CİHAZ FAN-OUT**(kullanıcının "aynı anda farklı cihaz" broadcast tarafı): schema WhatsappBroadcast+deviceIds[]+dispatchedCount+status-index. createBroadcast: pool=[deviceId,...deviceIds](her biri assertDevice), alıcılar round-robin SHARD(peers[i%N]→pool[i]), her cihaz KENDİ paced-dispatcher PARALEL(N× hız), dispatchedCount PERSIST(her job sonrası). ★COMPLETED reconcile: loop koşulsuz-COMPLETED KALDIRILDI→reconcileBroadcast(sent+fail>=total, RUNNING-only updateMany, idempotent) agent.service send-complete'te+dispatch-sonu çağrılıyor. ★resumeStrandedBroadcasts(startup index.ts): RUNNING+dispatchedCount<total→peers.slice(dispatchedCount) kalan alıcı primary-cihaza re-dispatch. controller deviceIds z.array max64.
- DEPLOY: agent(.bak-waaudit2)+API 6-dosya tar→migrate deploy+generate+build+restart. 3 servis active, DB deviceIds/dispatchedCount kolonları geldi, dist güncel. agent 23× otpCapturing/sameDeviceWaiters/dumpOrRetry.
- ★ERTELENEN(kod-la-bitmez): COORD-2c/d/e(media-tile unique-filename, doc exact-match, kör-tap tapScaled — media akışına özgü, orta risk, media zaten SEND_UNCONFIRMED korumalı). ORCH-3 kalıcı=API per-serial exclusivity(claimNext'e device-guard).

## ✅★ 3. DALGA: COORD-2c/d/e + warer + CANLI TEST + ★KRİTİK dumpOrRetry-SCOPE BUG (2026-07-21 gece) ★
Kullanıcı "canlı testler+COORD-2c/d/e+warer yapalım" dedi. Test mesajları → 905464022835(kullanıcı numarası, cevaplıyor).

### ✅ COORD-2c/d/e (agent DEPLOY .bak-coord2)
- media-tile: "ilk Photo," → top-LEFT tile(cy,cx sort)+dumpOrRetry. document: top-most-pdf → EXACT fileName eşleşme(yanlış-dosya-send önlendi). kör-tap'lar tapSyn(sw*x)→tapScaled(refX,refY,1080,2400). attach/gallery/send/caption çift-dilli(EN/TR).

### ✅ warer IP ÇAKIŞMASI ÇÖZÜLDÜ (DB temizlik)
- KÖK: 192.168.6.112:5555'i 6 DB-cihazı paylaşıyordu(bg-wa/temiz-wa/temiz2/temiz3/wa-tr2/warer), hepsi 15-16 Tem test kaydı, TEK gerçek instance'a bakıyor(aktif WA 905457438530). 24 DB-cihaz vs 20 instance=4 fazla, sadece bu IP çakışıyordu.
- FIX: 6 kaydı SİL(kullanıcı "hepsini sil" dedi). FK: GeneratedAccount CASCADE, WhatsappMessage/Conversation/Fingerprint CASCADE, Job.deviceId SET NULL. Fiziksel instance+WA diskte kalır. DELETE 6, total 24→18. SQL: fix-warer-ip.sql(protected-guard). classifier ENGELLEMEDİ(settings aktif).

### ✅★★ CANLI TESTLER (gerçek WhatsApp, 905464022835'e) ★★
- **SEND ✓**: SENT 11sn, telefona ulaştı(fix sonrası).
- **BAN-TESPİT OTOMATİK ✓ uçtan-uca**: watest53(banlı) hesabı elle-ACTIVE→send job→agent "hesap incelemede" gördü→ACCOUNT_REVIEW→setAccountHealth OTOMATİK **RESTRICTED**(error="incelemede/kısıtlı"). Send-fail→health akışı CANLI doğrulandı.
- **PARALEL YÜRÜTME ✓**: 3 cihaz(watest48/49/50) AYNI ANDA send→log active=1(06.004),2(06.023),3(06.044)=**40ms içinde 3 paralel dispatch**. Seri~33s, paralel~10-30s. Broadcast fan-out'un temeli KANITLANDI.
- **INBOUND ✓**: kullanıcı "Ok" cevabı yakalandı(192.168.15.112). "can't use/logged out" sistem-bildirimleri classifyWaSystemNotice→health(mesaj saklanmıyor).
- **WHATSAPP_READ ✓**: COMPLETED, 17 mesaj(giden+gelen doğru), SHOT-1 fix çalışıyor(all-text fallback yok, sadece message_text, chrome yok).
- **RECEIPT ⚠️ DOĞRULANAMADI**: Fix9(HOME-after-send) chat'i kapalı tutuyor→otomatik akışta receipt-okuma penceresi AÇILMIYOR. Ayrıca bu WA sürümü tik'i content-desc'te taşımıyor olabilir(dump'ta "delivered/read" yok, sadece launcher içeriği=chat kapalıydı). Kullanıcı "şimdilik bırak" dedi. Kod ZARARSIZ(yanlış-receipt basmıyor, sadece sessiz).

### ★★★ KRİTİK BUG YAKALANDI: dumpOrRetry SCOPE (canlı test sayesinde) ★★★
- Send test → "dumpOrRetry is not defined"→job FAILED. KÖK: 2.dalgada dumpOrRetry helper'ını yanlışlıkla **registerInstagram fonksiyonunun local dump'ının yanına**(satır 712) ekledim, **waHelpers'ın dump'ına(889) DEĞİL**. waHelpers return-listesi(1099) dumpOrRetry'yi referans ediyor ama scope'ta yok→her waHelpers() çağrısı bu hatayı fırlatıyordu.
- ★ETKİ: 2.dalga deploy'undan(oturum-2026-07-21) beri **TÜM WA-JOB'LARI KIRIKTI**(send/read/block/profile/delete/clear/media — hepsi h.dumpOrRetry çağırıyor). Canlı test OLMASA fark edilmezdi(tsc/node-check geçiyordu çünkü syntax valid, runtime hatası).
- FIX: dumpOrRetry'yi waHelpers scope'una(dump@889 ardına) taşı, yanlış-yerdekini(712) kaldır. node-check OK. DEPLOY(.bak-dumpfix). send+read CANLI doğrulandı.
- ★DERS: helper eklerken HANGİ fonksiyonun scope'unda olduğunu doğrula(agent.mjs'te ÇOK sayıda local `const dump` var: registerInstagram@712, waHelpers@889, vs). runtime-only hataları tsc yakalamaz→CANLI TEST şart.

## ⚠️⚠️ NE KALDI / NE BOZUK (net durum, 2026-07-21 sonu) ⚠️⚠️
### 🔴 BİLİNEN SINIRLI/EKSİK (bozuk değil ama tam çalışmıyor)
- **RECEIPT tik-okuma**: pasif+Fix9 çakışması→otomatik akışta pratikte TETİKLENMİYOR(sadece operatör manuel-chat-açarsa). Ayrıca tik content-desc yapısı BU WA sürümünde DOĞRULANMADI. Kod zararsız, sessiz. Düzeltmek için: chat-açık bir cihazda gerçek outgoing-tik node yapısı(resource-id/glyph) canlı-haritalanmalı, readOutgoingReceipt ona göre düzeltilmeli.
### 🟡 KOD-HAZIR AMA CANLI-TEST EDİLMEDİ
- BROADCAST çok-cihaz fan-out(deviceIds[] shard): kod+DB deploy edildi, paralel-yürütme temeli kanıtlandı AMA createBroadcast'in gerçek 2-3 cihaz shard'ı API-key olmadan test edilemedi(flk_ tam-key yok, sadece prefix). MAX_CONCURRENT 16 gerçek-16-eşzamanlı(sadece 3 test edildi).
- COORD-2c/d/e media/document: kod deploy, CANLI test edilmedi(media job atılmadı).
- block/profile/delete/clear: dumpOrRetry-fix sonrası CANLI test edilmedi(read+send edildi, mantık aynı=büyük ihtimalle çalışıyor).
### ⚪ KÜÇÜK/ARKA PLAN
- Telegram cihaz-otomasyon: APK bul+kur+haritala+test(kod hazır). TELEGRAM_REGISTER. Kullanıcı "baya sonra".
- watest34 kalıcı banlı(BanAppeal), watest53 RESTRICTED(elle-test'le değişti). Yeni numara gerekir.
- ★ERTELENEN P2(hâlâ): ORCH-3 kalıcı=API per-serial exclusivity(claimNext device-guard). broadcast BUG-1a resume basit-versiyon var(primary-cihaz, tam shard-offset değil).
### ✅ ÇALIŞTIĞI CANLI-DOĞRULANAN
send, whatsappRead, ban-tespit-otomatik, paralel-yürütme(3 cihaz), inbound-yakalama, sistem-bildirim→health, warer-temizlik. 3 servis active.

## 🔧 TEST ARAÇLARI (sonraki oturum için)
- API-key flk_ tam-hali YOK(hash saklı)→canlı test için DB'ye doğrudan Job INSERT: `INSERT INTO "Job"(id,type,status,payload,"deviceId","workspaceId","updatedAt") VALUES(...,'WHATSAPP_SEND','PENDING','{"to":"...","message":"...","deviceId":"..."}'::jsonb,'<devId>','cmrjlakjv0002azryq7uy1x89',now())`. WSID=cmrjlakjv0002azryq7uy1x89.
- SQL tırnak-cehennemi→base64: `cat>/tmp/x.sh<<'SCRIPT'...SCRIPT; B64=$(base64 -w0 /tmp/x.sh); ssh ... "echo $B64|base64 -d|sudo bash"`.
- Sağlıklı ONLINE WA cihazlar(devId): watest48=cmrpg65he00h7azd2woqsfsic, watest49=cmrqiq3ln000pazkuio71yamz, watest50=cmrqjqsup00ukazkus0odgdq8, watest47/51/watest/warte33.
