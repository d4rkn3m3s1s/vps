---
name: RESUME-kaldigimiz-yer-2026-07-21
description: ★★İLK BUNU AÇ★★ 2026-07-21/22 tam durum. 21:3-DALGA(85-ajan WA-denetim→55bug→13fix+BROADCAST-fanout). 22:provision-500-fix+TOPLU-CİHAZ+duvar-tespiti+APK-otomatik-güncelleme+5-OPTİMİZASYON+cihaz-RENAME+SAĞLIK-DASHBOARD+KAYIT-ANALİTİĞİ+OTOMATİK-YEDEKLEME+mesaj-kayıt-bug+★★PROXY-MİMARİSİ(ban-kök:çok-port+2hesap+reboot-persist). SON-OTURUM:★provision+auto-proxy TR→MOBİL-hesap-seçimi(ortak proxy-accounts.ts, auto-proxy findFirst-ülke-filtresiz BUG-fix)+★★34-AJAN-DENETİM→24-BUG-FIX("proxy-fail→sessizce-datacenter-IP→ban" teması; agent.mjs-provision-throw+restore.sh-9bug-tam-yeniden+otomatik-kayıt-proxy+OTP/şifre-şifrele+metadata/yarış)+21-SIR-SIZINTISI-DB-temizliği. ⚠️⚠️TÜM İŞ HÂLÂ GIT'E COMMIT EDİLMEDİ(katlandı). 4 servis active + systemd-timer/servisler enabled + /etc/fleet-proxy.env.
metadata:
  node_type: memory
  type: project
---

# ★★ 2026-07-21/22 — KALDIĞIMIZ YER (buradan devam) ★★

3 büyük dalga(21) + 2 ek iş(22: enum-fix + toplu-provision). Detaylar: [[oturum-2026-07-21-wa-denetim-13fix]]. Önceki: [[oturum-2026-07-20-receipt-maxconc-ban-mimarisi]], [[adb-reconnect-error-heal-2026-07-20]].

## ⚠️⚠️⚠️ EN KRİTİK — İLK YAPILACAK: GIT COMMIT ⚠️⚠️⚠️
**Son 3 GÜNÜN TÜM işi (ban-mimarisi + 41-fix + broadcast-fanout + enum-fix + toplu-provision) HOST'A DEPLOY EDİLDİ ama GİT'E COMMIT EDİLMEDİ.**
- Branch: `feat/cloud-phone-suite`. Son commit: `cf8c87e`(19 Temmuz, idempotency).
- UNCOMMITTED(25 kalem = 18 dosya + 7 yeni klasör/dosya): API(schema/index/wa-register/agent/device/jobs/provision-{controller,routes,service}/webhooks/whatsapp-{controller,service}/routes) + dashboard(globals/HealthView/ProfilesView) + agent.mjs + wd-proxy.sh. YENİ: 2 migration + fleet-health(api+dashboard) + provision/batch + wa-apk-update.sh + wa-backup.sh. AYRICA host'ta(git'te DEĞİL, /opt/fleet-agent'ta): wd-proxy-restore.sh + 3 systemd unit(wd-proxy-restore.service, wa-backup.timer, wa-apk-update.timer) + fleet-api proxy.conf env.
- (ESKİ 17-kalem notu):
  - agent.mjs, apps/api/{schema.prisma, index.ts, agent.service.ts, device.service.ts, jobs.service.ts, webhooks.controller.ts, whatsapp.controller.ts, whatsapp.service.ts, provision.controller.ts, provision.routes.ts, provision.service.ts}, apps/dashboard/{globals.css, profiles/ProfilesView.tsx}.
  - YENİ: migrations/{20260720000000_account_health_states, 20260721000000_broadcast_fanout}, apps/dashboard/.../api/provision/batch/
  - ★NOT: `20260719012000_telegram_register` migration'ı host'a EL İLE geri kondu(bkz enum-fix) — repoda zaten var, commit'e dahil değil(untracked değil, mevcut).
- ★RİSK: local disk kaybı=3 günlük iş gider(host'ta dist var ama src bu repoda). İLK İŞ: gözden geçir+commit.

## ✅ 2026-07-22 EK İŞLER (bu oturum, DEPLOY edildi)
### 1) ★provision 500 BUG FIX (enum eksikliği)
- Panelde "Tek Tıkla Cihaz Oluştur"→Unexpected error/500. KÖK: DB `JobType` enum'unda **TELEGRAM_REGISTER YOK**(TELEGRAM_SEND vardı). Kod(prisma-client+job.types) tanıyor, `assertDeviceIdle` bu enum'u sorguluyor→Postgres "22P02 invalid input value"→provision 500. 19-Tem'de `20260719012000_telegram_register` migration'ı host'a DEPLOY EDİLMEMİŞ(tar'a dahil edilmemiş)→DB enum eksik kaldı.
- FIX: `ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'TELEGRAM_REGISTER'`(canlı, restart bile gerekmedi). Migration dosyası host'a geri kondu + _prisma_migrations'a kaydedildi. Doğrulandı: enum sorgusu hatasız, son loglar temiz.
### 2) ★★TOPLU CİHAZ OLUŞTURMA (yeni özellik, kullanıcı istedi)
- Modal'a: **ADET seçici(1-20)** + isim OPSİYONEL(boş=rastgele wa-x7k2, önek verilirse watest→watest-a3f sıralı-benzersiz) + adet>1 bilgi-metni + buton "N cihaz kur" + sonuç-toast.
- API: `provisionService.createBatch(count,namePrefix?,proxyCountry)` → N cihaz arka-arkaya, her biri `uniqueRandomName`(DB-çakışma kontrollü, 8-deneme+uzun-suffix fallback) + her cihaza AYRI proxy(aynı ülke, provider-rotation farklı-IP, createInstance per-device auto-proxy). ★HATA-TOLERANSLI(biri patlarsa host-dolar diğerleri devam, per-device sonuç listesi). advisory-lock isim/subnet çakışmasını önler.
- Controller: `createBatchHandler`+batchSchema(count 1-20, namePrefix). Route: POST /provision/batch. Dashboard-proxy: api/provision/batch/route.ts.
- ★CANLI TEST ✓: createBatch(count:2) → batchtest-d2t6(mi18)+batchtest-t2xe(mi19) benzersiz-isim, failed:0, ayrı-instance, PROVISION_DEVICE job RUNNING. Test cihazları temizlendi(DELETE 2). ⚠️PROXY test'te atanmadı çünkü FLEET_PROXY_HOST env BOŞ(kod doğru, prod'da thordata env varsa atar).
- DEPLOY: API+dashboard build+restart(3 servis active), batch dist'te.

## ✅ 2026-07-22 DEVAM — BÜYÜK OTURUM (hepsi DEPLOY, detaylar ilgili memory'lerde)
### 3) ★DUVAR-TESPİTİ (WhatsApp kayıt bloklama) — agent.mjs + wa-register.service
- Sorun: WhatsApp OTP ekranını CustomRegistrationBlockActivity("Download official WhatsApp")'a çeviriyor→ajan OTP_WAIT'te park→duvarı GÖRMÜYOR→panel sonsuz "SMS bekleniyor". Kullanıcı "otonomda uyarı vermiyor" dedi.
- FIX: (a)registerWhatsApp verify-loop: onWall onOtp'den ÖNCE(pre-OTP guard). (b)otpWatchTick: park sırasında activity kontrolü→CustomRegistrationBlock görülürse device_wall FAILED rapor+otpWatch.delete. (c)wa-register.service: device_wall+FAILED→hesap AWAITING_OTP'den FAILED + ★cihaz metadata.waRegisterStatus temizle(yoksa kart "kayıt sürüyor" kalır). CANLI: mi20/+355 duvara toslayınca artık ⛔FAILED dedi.
### 4) ★APK OTOMATİK GÜNCELLEME — deploy/kvm-host/wa-apk-update.sh + systemd timer(2 günde bir)
- Kök: bundled whatsapp.apk statik/eski(2.26.25.81)→"resmi uygulama" duvarı. FIX: whatsapp.com/android'den güncel APK indir(&amp;→& decode ŞART, host=IP+referer, `file` ile doğrula—unzip YOK host'ta). /opt/fleet-agent/wa-apk-update.sh + wa-apk-update.timer(ENABLED, 23-Tem 04:51). CANLI: 2.26.28.78 indi+kuruldu(watest55 provision bununla). Retention son-5-gün.
### 5) 5 OPTİMİZASYON DEPLOY (kullanıcı istedi, #1 sleep→poll ERTELENDİ-riskli)
- #5 heartbeat N+1→2 updateMany(agent.service). #6 dashboard poll 5→20sn(WS canlı). #7 MAX_CONCURRENT 16→24. #3+#9 provision boot-stagger(MAX_CONCURRENT_PROVISIONS=4, agent.mjs activeProvisionCount). #8 APK cp→hardlink(ln -f, 137MB kopya yok).
### 6) CİHAZ RENAME(ProfilesView): kart isme kalem-ikonu→inline input(Enter/Esc/blur), optimistik+rollback+toast. Backend zaten hazır(PUT /devices/:id). İsim KOZMETİK(instance/hesap/proxy etkilenmez).
### 7) ★SAĞLIK DASHBOARD(#3) + KAYIT ANALİTİĞİ(#7) — YENİ modül fleet-health(api+dashboard)
- API: fleet-health.service(health(): cihaz-durum+WA-hesap-sağlık ACTIVE/RESTRICTED/BANNED/LOGGED_OUT/awaiting + bugünkü-kayıt başarı/hata + host-CPU/RAM. registerAnalytics(): ülke/proxy-ülke/model bazında başarı-oranı). controller+routes+mount(/fleet-health). GeneratedAccount→Device relation YOK(deviceId FK)→ayrı-sorgu+map. Device model=fingerprint.model.
- Dashboard: /health sayfası(HealthView)→WA-hesap-sağlık tile'ları(renkli) + bugünkü-kayıt + 3 analitik-tablo(ülke/proxy/model, renk-kodlu başarı%). 2 proxy-route(api/fleet-health/*). CSS wa-health-grid/analytics-3col.
### 8) ★MESAJ KAYIT BUG(dedupeKey)—agent.service. Kullanıcı "apiden mesaj kayboluyor". Kök: OUT WhatsappMessage `dedupeKey` set edilMİYordu(null)+`.catch(()=>null)` hatayı YUTUYORDU→başarısız-create sessizce kaybolur→panelde iz yok. FIX: dedupeKey=sha256(out|dev|peer|body|ts) unique üret + catch gerçek-hatayı log'lar. CANLI:ft2 mesajı(FAILED bile) artık kaydedildi.
### 9) ★★PROXY MİMARİSİ — BAN SALGINI KÖK-NEDENİ(en kritik iş, ayrı detay)
Kullanıcı "apiden mesaj proxy gömülü mü" + "bazıları kısıtlı". Detay: [[proxy-mimari-cok-port-2hesap-2026-07-21]]. ÖZET: TÜM cihazlar datacenter-IP(125.253.73.45)'ten çıkıyordu(proxy düşmüş)→WhatsApp ban(50 FAILED). 4 kök: iptables-reboot-persist-değil + tek-port-12345-çakışma + proxy-env-BOŞ + TR-residential-ÖLÜ. FIX: wd-proxy.sh ÇOK-PORTLU(AL12345/BG12346/TR12347) + reboot-persist(wd-proxy-restore.sh+systemd ENABLED) + 2-thordata-hesap(residential@5555 AL/BG + mobile@9999 TR-SADECE, host <PROXY_HOST_ID>.eu.thordata.net, `-country-` format) + fleet-api-proxy-env. CANLI:tüm ACTIVE cihaz ülke-IP'den(watest48→TR-IP 85.105.x, destek1→AL-IP 79.106.x, datacenter YOK).

### 10) ★provision + auto-proxy TR→MOBİL HESAP SEÇİMİ(kod) — proxy-accounts.ts ORTAK MODÜL
Kullanıcı "wa numara girince otomatik değişecek+gömülü kalacak mı" sorunca DERİN BAKILDI→2 fix: (a)provision.service TR→mobil(9999)/diğer→residential(5555) env-tabanlı seçim; (b)★auto-proxy.ts BUG: WA-numara girince ülkeyi doğru buluyordu AMA credential'ı `findFirst(orderBy createdAt desc)`=EN SON EKLENEN(ülke-filtresiz)→AL-provision sonrası TR-numara AL-hesaba giderdi→"Login not available". FIX: ORTAK modül `accounts/proxy-accounts.ts`(proxyCredsFor+isMobileProxyCountry), provision+auto-proxy İKİSİ import→aynı ülke asla farklı hesap. fleet-api env'e FLEET_PROXY_MOBILE_*+MOBILE_COUNTRIES=TR eklendi. CANLI-TEST: watest66 provision TR→12347(mobil, 176.219.x TR-Vodafone/88.229.x TR-TT); autoAttachCountryProxy(+90…)→job port=9999 mobil, mi22 çıkış=TR. ⇒ 3 katman: provision→register→reboot hepsi doğru-hesap.

### 11) ★★34-AJAN SESSİZ-BUG DENETİMİ→24 FIX(en büyük iş, ayrı detay [[denetim-24bug-fix-2026-07-21]])
Kullanıcı "bu tarz başka neleri gözden kaçırmış olabilir". Workflow(34-ajan/6-lens/adversarial/1.96M-token)→24 doğrulandı/4 çürütüldü. TEMA="proxy başarısız/eksik→SESSİZCE datacenter IP→ban". EN KRİTİK: agent.mjs:6937 provision-proxy iptables-FAIL olsa bile cihaz HAZIR(log-only,throw-yok)→artık throw. wd-proxy-restore.sh 9-bug TAM-YENİDEN(TR/AL/BG/US-dışı ülke→sessizce-AL→ban; proxyCountry-öncelik+tam-E.164+LEFT-JOIN+dedup+DB-guard+credential-env /etc/fleet-proxy.env). batch:otomatik-kayıt-proxy-HİÇ-eklemiyordu+OTP/IG-şifre-payload-düz-metin(→şifreli+materializePayload otpCodeEnc). auto-proxy ölü-proxy-filtresi. fallback-port-çakışma(deterministik-hash). metadata-spread+ownership-guard+appendLog-mutex+fire-forget-log. HEPSİ tsc+host-build+restart+CANLI(restore 11→14 cihaz, mi21→BG İLK-KEZ). ⚠️CRITICAL-throw runtime-canlı-test bekliyor(kod-doğru, gerçek-kayıt yapılmadı).

### 12) ★ESKİ SIR SIZINTISI TEMİZLİĞİ(DB)
21 terminal-job(5 EMULATOR_SET_PROXY düz-metin proxy-şifre <PROXY_PASS>-HÂLÂ-AKTİF + 16 REGISTER_WHATSAPP düz-metin otpCode) GET/jobs/:id ile sızıyordu→`UPDATE Job SET payload=payload-'password'-'otpCode' WHERE...AND NOT...Enc`. Job korundu(sadece sır çıktı). Doğrulama:düz-metin password=0,otpCode=0.

## ⚠️ UNCOMMITTED İŞ KATLANARAK BÜYÜDÜ
3 gün + bu oturum(provision/auto-proxy TR-mobil, proxy-accounts.ts, 24-bug-fix, sır-temizliği) HÂLÂ GIT'E COMMIT EDİLMEDİ. ⚠️.audit-host-snapshot/ credential içerir→.gitignore'a eklendi(commit'e girmemeli).

## ✅ BUGÜN CANLI-DOĞRULANAN (çalışıyor, test edildi)
- **send** ✓ SENT 11sn, 905464022835'e ulaştı.
- **whatsappRead** ✓ COMPLETED 17 mesaj(SHOT-1 fix: all-text fallback yok, sadece message_text).
- **ban-tespit OTOMATİK** ✓ uçtan-uca: send-fail(hesap incelemede)→setAccountHealth→RESTRICTED otomatik.
- **PARALEL yürütme** ✓ 3 cihaz(watest48/49/50) 40ms içinde active=1,2,3(broadcast fan-out temeli).
- **inbound** ✓ "Ok" cevabı yakalandı. sistem-bildirim("can't use/logged out")→health(classifyWaSystemNotice).
- 3 servis(fleet-api/agent/dashboard) active. host uptime 2 gün(reboot yok).

## ⚠️ NE KALDI / NE BOZUK (net)
### 🔴 SINIRLI (bozuk değil, tam çalışmıyor)
- **RECEIPT tik-okuma**: Fix9(HOME-after-send) chat kapalı tutuyor→otomatik-akışta receipt TETİKLENMİYOR(sadece manuel-chat-açıkken). Tik content-desc yapısı BU WA sürümünde DOĞRULANMADI(dump'ta delivered/read yoktu). Kod zararsız/sessiz. DÜZELTMEK İÇİN: chat-açık cihazda gerçek outgoing-tik node(resource-id/glyph) canlı-haritala→readOutgoingReceipt düzelt. Kullanıcı "şimdilik bırak" dedi.
### 🟡 KOD-HAZIR AMA CANLI-TEST EDİLMEDİ (yarın test edilebilir)
- **BROADCAST gerçek çok-cihaz shard**: kod+DB(deviceIds[]/dispatchedCount)+migration deploy, paralel-temel kanıtlandı AMA createBroadcast'in 2-3 cihaz shard'ı API-key olmadan test EDİLMEDİ(flk_ tam-key hash'li, yok). MAX_CONCURRENT gerçek-16(sadece 3 test).
- **media/document** send(COORD-2c/d/e): kod deploy, media-job atılmadı.
- **block/profile/delete/clear**: dumpOrRetry-fix sonrası canlı-test edilmedi(read+send edildi=aynı mantık, muhtemelen OK).
### ⚪ KÜÇÜK/ARKA PLAN
- Telegram cihaz-otomasyon(TELEGRAM_SEND): kod hazır, APK bul+kur+haritala+test. TELEGRAM_REGISTER. Kullanıcı "baya sonra".
- watest34 kalıcı-banlı(BanAppeal). watest53 RESTRICTED(bugün ban-test'le değişti, gerçekten banlı). Yeni numara gerekir.
- ERTELENEN P2: ORCH-3 kalıcı=API per-serial exclusivity(claimNext device-guard). broadcast resume basit(primary-cihaz, tam shard-offset değil).

## 🔧 TEST ARAÇLARI (kopyala-kullan)
- **API-key flk_ tam-hali YOK**(hash saklı)→CANLI TEST için DB'ye Job INSERT:
```sql
INSERT INTO "Job"(id,type,status,payload,"deviceId","workspaceId","updatedAt")
VALUES ('test_'||'HHMMSS','WHATSAPP_SEND','PENDING',
'{"to":"905464022835","message":"...","deviceId":"<devId>"}'::jsonb,
'<devId>','cmrjlakjv0002azryq7uy1x89',now());
```
- **SQL tırnak-cehennemi→base64**: `cat>/tmp/x.sh<<'SCRIPT'\n...\nSCRIPT` sonra `B64=$(base64 -w0 /tmp/x.sh); ssh ... "echo $B64|base64 -d|sudo bash"`.
- **★JSON payload INSERT'te tırnak sorunu→`jsonb_build_object`**: `INSERT ... payload ... SELECT 'id', 'WHATSAPP_SEND', 'PENDING', jsonb_build_object('to','905...','message','x','deviceId','<devId>'), '<devId>', '<wsid>', now();` (::jsonb escape'i tamamen atlar, DENENDİ çalıştı).
- **★Cihaz çıkış-IP kontrol(proxy aktif mi)**: `adb -s <ip>:5555 shell "curl -s https://api.ipify.org"` → 125.253.73.45=datacenter(KÖTÜ), ülke-IP=proxy-aktif(İYİ).
- **Sağlıklı ONLINE WA cihazlar(devId → numara)**: watest48=cmrpg65he00h7azd2woqsfsic(905380525622), watest49=cmrqiq3ln000pazkuio71yamz(905348730883), watest50=cmrqjqsup00ukazkus0odgdq8(905312331800), watest47=cmrpdlxld00klazew8qx6j25v(905386929621), watest51=cmrqkm8rl01nzazkuy1iefaft(905392555087), watest=cmrnq3v7e02ivazq3rd5z6n4l(905391147788), warte33=cmrp5aih50cehaz52w1cphx2f(905380590746).
- **Job sonucu oku**: `SELECT status,error,result FROM "Job" WHERE id='...';`
- **Kullanıcı test-numarası: 905464022835**(cevap veriyor). watest48 IP=192.168.15.112.

## 🔧 ERİŞİM / DEPLOY (değişmedi)
- SSH: `ssh -i ~/.ssh/phoenixnap_y ubuntu@125.253.73.45`(host a1-c5-xlarge-us-sw1, 80core/250GB).
- DB: `sudo docker exec -i fleet-postgres psql -U postgres -d fleet`. WSID=cmrjlakjv0002azryq7uy1x89.
- ★DEPLOY(classifier artık ENGELLEMİYOR—settings.local.json aktif): agent.mjs base64→/opt/agent.mjs(+yedek), API src tar→/opt/fleet extract→`sudo npx prisma migrate deploy`+`sudo npx prisma generate`(★client KÖKe /opt/fleet/node_modules/.prisma)+`sudo npm run build`+restart. API-SONRA-agent restart. agent restart takılırsa→`systemctl kill -SIGKILL+reset-failed+start`.
- HOST YEDEKLER(agent geri-dönüş): /opt/agent.mjs.bak-{dumpfix(EN SON GÜNCEL), coord2, waaudit2, waaudit}. API: /opt/fleet...bak-*.
- ★DERS(bugün): helper eklerken HANGİ fonksiyon scope'unda olduğunu doğrula(agent.mjs'te çok `const dump` var). runtime-only hata tsc/node-check yakalamaz→CANLI TEST şart. SQL'de PowerShell→SSH tırnak base64.

## 📋 ÖNERİLEN SIRA (buradan devam)
1. **★GIT COMMIT**(EN KRİTİK, 3 günlük iş uncommitted=25 kalem). Gözden geçir+commit. Not: host systemd unit'leri + proxy env git'te YOK(sadece script'ler repo'da).
2. (opsiyonel) TOPLU-PROVISION panelden gerçek-test(3-5 cihaz aynı anda kur — kod+canlı-service test edildi ama panel-UI'dan uçtan-uca denenmedi). Proxy için FLEET_PROXY_HOST env kontrol.
3. Broadcast gerçek shard canlı-test(2-3 cihaz, DB'ye broadcast tetikle veya API-key üret).
4. media/block/profile/delete/clear canlı-test(dumpOrRetry-fix doğrula, send+read edildi=aynı mantık).
5. (opsiyonel) receipt tik-yapısı canlı-haritala VEYA Telegram APK.

## ⚠️ GENEL KALAN/BOZUK (net durum, 2026-07-22 sonu)
- 🔴 FİLO SAĞLIĞI: 9 ACTIVE / 50 FAILED / 3 kısıtlı-banlı WA-hesap. Çoğu Business-geçmişli AL-numara+datacenter-IP(proxy düşüktü) yüzünden BANDI. Proxy düzeldi→bundan sonraki kayıtlar daha iyi olmalı. Temiz(hiç-WhatsApp-görmemiş) numara ŞART.
- 🔴 RECEIPT tik-okuma: Fix9 çakışması→otomatik-akışta tetiklenmiyor(zararsız, sessiz). Tik content-desc yapısı doğrulanmadı.
- 🟡 PROXY provision TR→mobil-hesap KOD seçimi eksik(şu an fleet-api env residential-only, restore-script TR'yi mobil'e telafi ediyor). provision.service'e TR→Hesap2-mobil-seçimi eklenmeli.
- 🟡 CANLI-TEST edilmedi: broadcast-gerçek-shard(API-key yok), media/block/profile/delete/clear, TOPLU-PROVISION panel-UI, SAĞLIK-DASHBOARD panel-UI(service-katmanı doğrulandı).
- 🟡 RESTRICTED rozeti panelde: API DOĞRU döndürüyor(canlı doğrulandı destek2/watest53=RESTRICTED, watest49=BANNED), kod+deploy doğru→kullanıcı GÖREMEDİ=muhtemelen TARAYICI CACHE(hard-refresh Ctrl+Shift+R gerekir).
- ⚪ Telegram cihaz-otomasyon(APK gerekli). ERTELENEN P2: #1 sleep→poll(191 sleep, riskli), ORCH-3 kalıcı=API per-serial exclusivity, broadcast BUG-1a tam-resume.
- ⚪ TARAYICI KONSOL GÜRÜLTÜSÜ: `content.js`/`watchwithme.in`/`ERR_BLOCKED_BY_CLIENT`/`ws failed` = kullanıcının reklam-engelleyici eklentisi, PANELLE ALAKASIZ.

## 🔧 HOST OTOMATİK SERVİSLER (systemd, hepsi ENABLED — git'te DEĞİL, /opt'ta)
- **wd-proxy-restore.service**: boot'ta(docker+90sn) tüm aktif-WA cihazlarına ülke-proxy geri-uygula(reboot-persist). /opt/fleet-agent/wd-proxy-restore.sh.
- **wa-backup.timer**: günde-bir(03:09) aktif-WA cihaz userdata yedek→/opt/device-backups(retention 3). /opt/fleet-agent/wa-backup.sh.
- **wa-apk-update.timer**: 2-günde-bir(23-Tem 04:51) whatsapp.apk güncelle. /opt/fleet-agent/wa-apk-update.sh.
- fleet-api proxy env: /etc/systemd/system/fleet-api.service.d/proxy.conf(residential).
- ★Bu host-dosyaları git'te YOK(script'ler repo deploy/kvm-host'ta var ama systemd unit'ler host-only). Reprovision'da yeniden kurulmalı.
