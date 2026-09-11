---
name: account-restricted-otomatik-tespit-2026-07-23
description: "★ACCOUNT_RESTRICTED otomatik-tespit (2026-07-23). Toplu-send'de bazı cihazlar CHAT_NOT_OPENED dönüyordu ama gerçek sebep→hesap KISITLI(\"Your account is restricted. You can't start new chats right now\" banner + read_only_chat_info node, entry-kutusu YOK). Sohbet AÇILIYOR ama yeni-sohbet başlatamıyor(mevcut thread'lere yanıt verebilir→saatler önce SENT yapıyordu). Ban-öncesi durum. FIX: agent.mjs send'de restricted-tespit(banner-regex + read_only_chat_info node)→ACCOUNT_RESTRICTED döner. API agent.service.ts send-outcome→setAccountHealth(RESTRICTED) OTOMATİK. Public API SAĞLAM(çalışmıyor sanılan=aslında hesap-kısıtlaması)."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-23T15:57:45.070Z
---

# ★ ACCOUNT_RESTRICTED OTOMATİK TESPİTİ (2026-07-23)

Kullanıcı "public WA API çalışmıyor" + "905400403800'e tüm WA-cihazlardan test at" dedi.
Toplu-send(14 cihaz) → 8 SENT / 2 kısmi / 4 gitmedi(2 ban + 2 CHAT_NOT_OPENED). Kullanıcı
"CHAT_NOT_OPENED neden" sorunca → CANLI teşhis → GERÇEK sebep ortaya çıktı.

## ★ KÖK-NEDEN: CHAT_NOT_OPENED yanıltıcıydı → hesap KISITLI (RESTRICTED)
- mi9(+905394660382, subnet5→192.168.5.112:5555) send job CHAT_NOT_OPENED dönüyordu.
- CANLI dump+screenshot: WA Conversation ekranı **AÇILDI** ama mesaj-kutusu(`com.whatsapp:id/entry`)
  YOK. Yerine `read_only_chat_info` + `read_only_chat_info_content` node'ları VAR + ekranın altında
  **"Your account is restricted. You can't start new chats right now. Show details"** banner'ı.
- ★ANLAM: hesap KISITLI → **yeni sohbet başlatamıyor** ama mevcut thread'lere yanıt verebilir.
  KANIT: aynı hesap AYNI GÜN sabah 09:52-56'da 3 kez SENT yapmıştı(905400403800 yeni-peer olduğu için
  yeni-sohbet→restricted-banner). Ban DEĞİL ama **ban-öncesi durum**(Business-geçmişli numara deseni).
- Eski regex'ler bunu KAÇIRIYORDU: `account.{0,3}review`("restricted" yok), `banned|suspended`("restricted" yok)
  → yanıltıcı CHAT_NOT_OPENED → hesap ACTIVE kalıyordu(sessizce başarısız).

## ✅ FIX (uçtan uca, hepsi CANLI-DOĞRULANDI + DEPLOY)
### 1) agent.mjs — send'de RESTRICTED tespit (BanAppeal-ban-tespitinin kardeşi)
- `whatsappSend`'de `!chatOpened` bloğunda, ACCOUNT_REVIEW kontrolünden SONRA:
  ```
  const readOnlyChat = h.find('com.whatsapp:id/read_only_chat_info','id') || read_only_chat_info_content
  if (/account is restricted|can.?t start new chats|hesab\w* kısıtl|yeni sohbet başlat/i.test(notice) || readOnlyChat)
     return { status:'ACCOUNT_RESTRICTED', note:'⚠️ Bu WhatsApp hesabı KISITLI — yeni sohbet başlatamıyor...' }
  ```
- İKİ sinyal: banner-metni VEYA read_only_chat_info node(chat-açık+compose-yok=salt-okunur=restricted).
### 2) API agent.service.ts — send-outcome → OTOMATİK setAccountHealth(RESTRICTED)
- send job COMPLETED+result.status işlenirken(:348): `ACCOUNT_BANNED||ACCOUNT_REVIEW` listesine
  **`ACCOUNT_RESTRICTED` EKLENDİ** → `setAccountHealth(health:'RESTRICTED')`. `ok=(COMPLETED && SENT)`
  olduğu için restricted→`!ok`→blok tetiklenir. RESTRICTED rank(1)<BANNED(3)/LOGGED_OUT(2)→monotonik,
  daha-sert-durumu ezmez. Profil kartı ⚠️KISITLANDI + ACCOUNT_BANNED alert-engine(Telegram/webhook) fırlar.
### CANLI DOĞRULAMA(2026-07-23 15:34)
- Test job(mi9→905400403800) → result.status=**ACCOUNT_RESTRICTED** ✅ note-Türkçe doğru.
- mi9 hesabı **ELLE UPDATE YAPMADAN** ACTIVE→RESTRICTED(updatedAt 15:34:02) ✅ = otomatik-tespit tam çalıştı.

## ★ PUBLIC WA API — ÇALIŞIYOR (arıza YOK)
- Kullanıcı "public API çalışmıyor" sandı → CANLI kontrol: route sağlam(`/public/v1/*` Caddy:80→API:4000),
  auth doğru(geçersiz-key 401, geçerli-key geçer), `wa` key(prefix 79bbf913, read/write/admin) **bugün 15:19
  kullanılmış**(lastUsedAt). Sunucu-tarafı 0 hata. Caddyfile `:80{ @public path /public/* → localhost:4000 }`.
- ★"çalışmıyor" sanılan durum = aslında **hesap-kısıtlaması**(mi9 gibi RESTRICTED→mesaj gitmez ama API 200 döner).
  API'yi suçlama→gerçek: numara-kalitesi(Business-geçmişli→WA kısıtlıyor). [[canli-izleme-8bug-sticky-2026-07-22]]#BAN-KÖK.

## ★ EK BULGULAR (bu oturum)
- watest47=mi68(subnet14): CHAT_NOT_OPENED ama sebep FARKLI→cihaz launcher'a düşüyor(dün "provision-çöktü/zombie"
  olan cihaz, kararsız). WA-process var ama Conversation'a geçemiyor. Hesap-kısıtlaması değil, cihaz-instabilitesi.
- Toplu-send tekrar(14 cihaz, 905400403800): 8 tam-SENT + 2 kısmi + sarpcall/watest BANNED(ban-tespit doğru çalıştı,
  dün eklenen "can't use whatsapp" regex) + 2 CHAT_NOT_OPENED(mi9-restricted + mi68-instabil).
- ★KOPYALA-YAPIŞTIR BUG: SQL bloğu SSH'a 2× yapıştı→her cihaza 2 job(28 toplam). Zararsız(2× test-mesaj).

## ★★ DEVAM: LOGGED_OUT TESPİTİ + API-UYARI + FAIL-FAST (aynı oturum, 4 commit)
Kullanıcı "bu tarz hatalarda API bildirsin" + "apiden de uyarı dönsün" dedi. 4 parça daha:
### 1) mi68/watest47 GERÇEK DURUM = LOGGED_OUT (CHAT_NOT_OPENED'ın 2. yüzü)
- watest47 3 GÜN sürekli CHAT_NOT_OPENED. CANLI: WA send-deep-link(`am start VIEW https://api.whatsapp.com/send?phone=`)→
  `com.whatsapp.registration.app.EULA`("Welcome to WhatsApp"/"Agree and continue")=HESAP GİTMİŞ(çıkış/kayıt-silinmiş).
- ★AMA agent send'de screenTexts="352|Contacts|Calendar|Gallery"=LAUNCHER→WA HİÇ AÇILMIYOR(deep-link tutmuyor, cihaz instabil)
  →agent launcher'da kalıp CHAT_NOT_OPENED diyor. Yani mi68'de İKİ katman: (a)hesap LOGGED_OUT (b)WA açılmıyor bile.
  LOGGED_OUT-tespiti bu cihazda TETİKLENEMEDİ(WA açılmadığı için) ama KOD doğru(başka cihazda WA-açılıp-EULA görülürse çalışır).
- FIX agent.mjs: send `!chatOpened` bloğunda registration/EULA activity(`whatsapp\/.*(registration|\.EULA|RegisterName|verifynumber)`)
  VEYA welcome/agree-metni→ACCOUNT_LOGGED_OUT. API agent.service HEALTH_MAP:ACCOUNT_LOGGED_OUT→LOGGED_OUT(rank2>RESTRICTED1).
  mi68 DB elle LOGGED_OUT yapıldı(+905386929621).
### 2) TEKNİK SEND-HATASI OPERATÖRE BİLDİRİM(agent.service, ★"API bildirsin")
- CHAT_NOT_OPENED/COMPOSE_FAILED/INVALID_RECIPIENT gibi TEKNİK hatalar sadece sessiz WHATSAPP_FAILED webhook'a düşüyordu
  →operatöre panel/Telegram bildirimi YOK(COMPLETED+result=CHAT_NOT_OPENED, JOB_FAILED-alert de tetiklenmez). watest47 3-gün fark-edilmedi.
- FIX: send `!ok` + health-durumu-DEĞİL(BANNED/RESTRICTED/REVIEW/LOGGED_OUT zaten setAccountHealth bildiriyor) + broadcast-DEĞİL(spam-önleme)
  →notificationsService.dispatch(panel+Telegram)+alertsService JOB_FAILED. CANLI:mi68 test→"notify sent telegram: WhatsApp mesajı gönderilemedi".
### 3) PUBLIC API JOB-POLL OKUNABİLİR UYARI(public.controller, ★"apiden uyarı dönsün")
- GET /public/v1/jobs/:id + /wait cevabına {ok,retryable,warning} eklendi. jobWarning()=status-kodu→Türkçe açıklama.
  Entegratör ham "CHAT_NOT_OPENED" yerine "Sohbet açılamadı—tekrar deneyin..."+retry-ipucu görür. JOB_WARNING map(SENT/BANNED/LOGGED_OUT/RESTRICTED/REVIEW/RATE_LIMITED/INVALID_RECIPIENT/CHAT_NOT_OPENED/COMPOSE_FAILED).
### 4) SEND-ANI FAIL-FAST(batch.service sendFromDevice)
- Cihazın WA hesabı ZATEN BANNED/LOGGED_OUT ise→job atmadan ANINDA 409(ACCOUNT_BANNED/ACCOUNT_LOGGED_OUT). Boşuna slot-yakmaz+dk-sonra-opak-hata yerine net.
  ★RESTRICTED BLOKLANMAZ(mevcut-thread'e yanıt verebilir). CANLI:watest49(BANNED)→sendFromDevice→409 ACCOUNT_BANNED doğrulandı.

## 🔧 DEPLOY (hepsi CANLI 2026-07-23, 4 commit)
- agent.mjs(RESTRICTED+LOGGED_OUT tespit)→/opt/agent.mjs(yedek .bak-restrict/.bak-loggedout), fleet-agent restart.
- API 3 dosya(agent.service+public.controller+batch.service)→/opt/fleet/apps/api, npm build EXIT0, fleet-api restart health200.
- Commit: 0b40f94(RESTRICTED)+2b46b76(teknik-bildirim)+76296de(LOGGED_OUT+API-uyarı+fail-fast). GIT'E COMMIT EDİLDİ ✓(working-tree temiz).
- ⚠️ push edilmedi(yerel). mi9→RESTRICTED, mi68/watest47→LOGGED_OUT DB'de işaretli.
