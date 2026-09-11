---
name: telegram-13-komut-suite-2026-07-24
description: "★Telegram botuna 13 YENI komut eklendi(acil-müdahale+cihaz-yönetim+WA-sağlık+DB-okuma). Grup1:/saglik(fleetHealth),/uyandir/reboot(deviceService.wake/reboot),/reconnect(offline cihazlara wake). Grup2:/kur<adet>[ülke](provisionService.createBatch),/etiket<cihaz>#tag(tag-merge),/adver<cihaz><ad>(updateDevice.name),/sil(deleteDevice). Grup3:/hesaplar+/banlar(GeneratedAccount.status=RESTRICTED/BANNED/LOGGED_OUT — waAccountHealth alanı YOK!). Grup4:/okunmamistum,/kisiler,/sonmesajlar(WhatsappConversation/Message direkt Prisma). ★findDeviceByRef:id/isim/substring/numara ile cihaz çöz(cihaz-adları=telefon-numarası). ★★KRİTİK-DERS:Telegram setMyCommands komut-adı SADECE [a-z0-9_] kabul eder — TİRE(-) GEÇERSİZ→'okunmamis-tum' TÜM paleti reddetti(BOT_COMMAND_INVALID)→'okunmamistum' FIX. CANLI:26 komut(13+13) @vpswabot'a kayıtlı(getMyCommands doğrulandı), /saglik çıktısı chatId 588495279'e gönderildi(msgId 1172). DEPLOY host /opt/fleet(scp+build+restart, fleet-api active/health200)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-24T01:29:19.579Z
---

# ★ TELEGRAM BOT 13 YENİ KOMUT SUITE (2026-07-24)

Kullanıcı isteği: "acil durumlarda cihaz offline veya adb bağlantıları kopunca
telegram botundan müdahale + yeni API'leri de telegrama ekle". AskUserQuestion ile
4 grubun HEPSİ seçildi. `apps/api/src/modules/telegram/telegram.service.ts`'e eklendi.

## KOMUTLAR (4 grup, 13 yeni)
- **Grup 1 — Acil müdahale**: `/saglik`(fleetHealthService.health→cihaz+WA+host-yük özeti),
  `/uyandir <cihaz>`(deviceService.wake→DEVICE_WAKE), `/reboot <cihaz>`(reboot→SLEEP+WAKE),
  `/reconnect`(OFFLINE/ERROR cihazlara wake ata — ADB reconnect'i de yapar; agent zaten
  adbRecoveryTick ile OTONOM kurtarıyor, bu MANUEL tetikleyici).
- **Grup 2 — Cihaz yönetimi**: `/kur <adet> [ülke]`(provisionService.createBatch, max20,
  opsiyonel proxyCountry), `/etiket <cihaz> #tag`(mevcut tags'e MERGE+updateDevice),
  `/adver <cihaz> <ad>`(updateDevice.name), `/sil <cihaz>`(deleteDevice, korumalıysa reddedilir).
- **Grup 3 — WA hesap-sağlık**: `/hesaplar`(tüm WA hesap+sağlık rozeti), `/banlar`(son 7gün
  ban/kısıt dalgası). `/kayit`→panele yönlendirme mesajı(WA-kayıt çok-adımlı+ban-riskli,
  tek-komut güvenli değil).
- **Grup 4 — DB-okuma**: `/okunmamistum`(tüm cihazlarda unreadCount>0), `/kisiler`(displayName'li
  konuşmalar), `/sonmesajlar`(direction=IN son gelen). `/medya` alias→sonmesajlar(WA-mesajda
  ayrı medya-tablosu YOK, body sadece metin).

## ★ ŞEMA GERÇEKLERİ (varsayım ≠ gerçek — tsc yakaladı)
- **GeneratedAccount'ta `waAccountHealth` alanı YOK**. WA hesap sağlığı `status` alanında:
  `GeneratedAccountStatus` enum = PENDING/…/ACTIVE/RESTRICTED/BANNED/LOGGED_OUT/AWAITING_OTP/
  AWAITING_MANUAL/FAILED. Rozet bu status'ten türetilir.
- **GeneratedAccount'ta `device` relation YOK** — sadece scalar `deviceId`. Cihaz-adı için
  `deviceNameMap()` yardımcısı(bounded findMany, N+1 önler).
- **fleetHealth.health() return**: `hosts[]` alanları = `load1`,`cpuCores`,`saturationPct`,
  `diskFreeGb`,`ramFreeGb`,`monitorStale`(loadAvg1m DEĞİL — o load1'e map'li). `waAccounts`
  = active/restricted/banned/loggedOut/… (camelCase).
- **findDeviceByRef**(yeni yardımcı): ref'i id→exact-name→unique-substring→WA-numara sırasıyla
  çözer. Cihaz adları telefon-numarası olduğu için `/uyandir <numara>` da çalışır.

## ★★ KRİTİK DERS: Telegram setMyCommands komut-adı kuralı
`BOT_COMMAND_INVALID` hatası TÜM komut paletini reddetti(setMyCommands atomik). KÖK:
komut adı SADECE `[a-z0-9_]{1,32}` — **TİRE(-) GEÇERSİZ**. `okunmamis-tum` yüzünden 26
komutun HEPSİ kaydolmadı(retry-storm). FIX: BOT_COMMANDS'ta `okunmamistum`(handler hâlâ
`/okunmamis-tum`'u da kabul eder). ⚠️Gelecekte komut eklerken: küçük-harf/rakam/alt-çizgi
dışında karakter KULLANMA.

## DEPLOY + CANLI TEST (host /opt/fleet — GIT DEĞİL, scp ile senkron)
- SSH: `ssh -i ~/.ssh/phoenixnap_y ubuntu@125.253.73.45`. Kod `/opt/fleet`, API `apps/api`.
- Pattern: `scp telegram.service.ts → /opt/fleet/...` + `cd apps/api && npm run build` +
  `sudo systemctl restart fleet-api` + health-check `curl 127.0.0.1:4000/health`=200.
  (Bu oturumda build+restart Claude'a ENGELLİ DEĞİLDİ, doğrudan yapıldı.)
- ✅ tsc temiz(local+host), build OK, fleet-api active, health 200.
- ✅ **getMyCommands CANLI**: @vpswabot'ta 26 komut kayıtlı(13 eski+13 yeni doğrulandı).
- ✅ **UÇTAN-UCA**: /saglik çıktısı chatId 588495279'e Telegram'dan gönderildi(msgId 1172).
- ✅ smoke-test(gerçek DB): 23 cihaz(23 online), WA 11-ACTIVE/3-RESTRICTED/2-LOGGED_OUT/
  4-BANNED, 9 ban/kısıt, 44 okunmamış, 206 gelen, host yük %8/3305GB. findDeviceByRef+
  tag-merge+wake-metadata(mi25) doğrulandı.
- ⚠️ NotificationChannel(type=telegram).configEnc = JSON `{botToken,chatId}`(decryptString).
  TelegramBot tablosu YOK, token orada değil.

## ★ EK (2. tur): TOPLU TEST-MESAJI + zenginleştirilmiş açıklamalar
Kullanıcı: "telegramı daha geliştir, komutları açıklamaları ve bir numaraya bütün
cihazlardan mesaj testi". Eklendi:
- **`/testmesaj`** (alias `/toplutest`): bir numaraya TÜM WhatsApp'lı cihazlardan
  gönderir. Shorthand `/testmesaj 905551112233 [mesaj]`(mesaj yoksa "Test mesajı ✅").
  İnteraktif: `/testmesaj` → numara sor → mesaj sor → gönder. Yeni state-mode'lar
  `awaiting_broadcast_number`/`awaiting_broadcast_text` + `broadcastTo` alanı.
- **`broadcastTestMessage(ws,to,msg)`**: listDevices→hasActiveWhatsapp filtrele→her
  cihaz için `batchService.sendFromDevice`(seri, bağımsız try/catch). ONLINE öne
  sıralar. sendFromDevice zaten BANNED/LOGGED_OUT'u ÖNDEN 409 reddeder→"atlandı"
  raporlanır(yasaklı/çıkış-yapmış/offline reason). Rapor: ✅N gönderildi + ⏭M atlandı.
- **Menü butonları**: MAIN_MENU'ye "📢 Toplu Test"(callback `broadcast`) + "🩺 Sağlık"
  (callback `health`) eklendi. handleCallback'te bağlandı.
- **Açıklamalar**: BOT_COMMANDS örnekli(`/kur 3 TR`, `/etiket watest52 #test`),
  menuText() gruplu+örnekli(✉️Mesajlaşma/📊Durum/🚨Acil/🛠Cihaz/💬Sağlık/📂Kayıt).
- CANLI: **27 komut** kayıtlı(getMyCommands ✓ /testmesaj listede), dry-run: 8 cihaz
  kuyruğa/3 yasaklı atlanır. Gerçek gönderim kullanıcı isteğiyle ERTELENDİ(panelden
  kendisi /testmesaj ile yapacak).

Detay [[proxy-mimari-cok-port-2hesap-2026-07-21]] [[firewall-ipv6-regresyon-test-2026-07-24]] [[dashboard-redirect-localhost3000-fix-2026-07-24]]
