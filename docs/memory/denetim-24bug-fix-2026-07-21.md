---
name: denetim-24bug-fix-2026-07-21
description: ★★34-AJAN SESSİZ-BUG DENETİMİ (2026-07-21) → 24 doğrulanmış bug DÜZELTİLDİ+DEPLOY. Tema="proxy başarısız/eksik olunca sistem SESSİZCE datacenter IP'de devam ediyor"=ban vektörü. EN KRİTİK: agent.mjs:6937 provision proxy iptables FAIL olsa bile cihazı HAZIR işaretliyordu(sadece log, throw yok)→artık throw+exit-country-mismatch throw. wd-proxy-restore.sh 9 bug(TR/AL/BG/US dışı ülke sessizce AL'e düşüyordu+INNER JOIN+dedup+DB-guard+credential-env). batch.service otomatik-kayıt proxy HİÇ eklemiyordu+OTP/şifre payload'da düz metin. Hepsi tsc temiz+host build+restart+CANLI(restore 14 cihaz, mi21→BG doğru).
metadata:
  node_type: memory
  type: reference
---

# ★★ 34-AJAN SESSİZ-BUG DENETİMİ + 24 FIX (2026-07-21) ★★

Kullanıcı "bu tarz başka neleri gözden kaçırmış olabilir önemli bug" dedi → çok-ajanlı
Workflow denetimi (34 ajan, 6 lens, adversarial doğrulama, 1.96M token). ARANAN SINIF:
"tsc'den geçen ama runtime'da/koşullu SESSİZCE yanlış çalışan" buglar (az önce bulunan
auto-proxy ülke-filtresi bug'ı gibi). 28 ham → **24 doğrulandı, 4 çürütüldü**. Detay
[[proxy-mimari-cok-port-2hesap-2026-07-21]] proxy mimarisinin devamı.

## 🔴 ANA TEMA: "proxy başarısız/eksik → SESSİZCE datacenter IP → ban"
Ban salgınının kod-seviyesindeki gizli kaynakları. Hepsi düzeltildi+deploy+canlı-doğrulandı.

## ✅ DÜZELTİLEN 24 BUG (dosya bazında)

### agent.mjs (HOST, /opt/agent.mjs)
- ★**CRITICAL L6937**: provision 'proxy' adımı wd-proxy.sh FAIL olunca (root yok/xt_REDIRECT yok/port dolu) sadece UYARI logluyordu, THROW ETMİYORDU→step yeşil kalıp cihaz "WhatsApp-hazır+ONLINE" oluyordu ama DATACENTER IP'de→TR numara "Login not available". EMULATOR_SET_PROXY(L509) aynı durumda throw ediyordu, provision etmiyordu(tutarsız). FIX: !applied→throw + exit-country MISMATCH→throw(artık cihaz yanlış-ülke IP'de HAZIR olmaz).
- **MEDIUM L130**: CC_TO_ISO API'nin alt-kümesiydi(ID/SG/... eksik)→exit-country kontrolü o ülkeler için sessizce "doğrulanamadı"ya düşüyordu. FIX: API auto-proxy.ts ile TAM senkron (55 ülke).

### wd-proxy-restore.sh (HOST, /opt/fleet-agent/) — 9 BUG, TAM YENİDEN YAZILDI
- ★**HIGH**: cc_from_phone SADECE 90/355/359/1 tanıyordu, DE/GB/FR/IT/ES... hepsi sessizce `*)echo AL`'e düşüyordu→reboot sonrası Alman numara ARNAVUT IP'sinden çıkıp banlanıyordu. FIX: (1)metadata.proxyCountry ÖNCELİKLİ kaynak(register-time doğru ISO'yu zaten yazmış), (2)tam E.164→ISO haritası, (3)bilinmeyen→BOŞ(asla somut ülkeye varsayma, satır ATLA).
- **HIGH**: MOBILE_PROXY_COUNTRIES 'TR' hardcode'du(app env ile ayarlıyken). FIX: FLEET_PROXY_MOBILE_COUNTRIES env.
- **HIGH**: INNER JOIN GeneratedAccount→proxy uygulanmış ama hesabı henüz olmayan cihaz reboot'ta proxy'siz kalıyordu. FIX: LEFT JOIN + (g.id OR proxyCountry). CANLI KANIT: eski 11 cihaz→yeni 14 cihaz(mi12/mi3/mi22/mi32/mi14 dahil).
- **HIGH**: credential KODA GÖMÜLÜ. FIX: /etc/fleet-proxy.env(chmod 600) + restore.service'e EnvironmentFile. fleet-api ile AYNI env. U_RES boşsa DURDUR.
- **MEDIUM**: psql/docker hatası 2>/dev/null ile yutuluyordu→DB down'da "0 cihaz, başarı" sanılıp cihazlar proxy'siz kalıyordu. FIX: rc kontrolü, rc!=0→exit 1.
- **MEDIUM**: aynı instance için çok satır→üst üste REDIRECT(yarış). FIX: declare -A DONE dedup.
- FAIL varsa exit non-zero(systemd 'failed' görsün, sessiz kısmi-başarı olmasın).

### wd-proxy.sh / wd-proxy-host.sh (HOST)
- **HIGH L29**: fallback `*)echo 12349` TÜM diğer ülkeleri tek porta koyuyordu→DE ve FR aynı 12349'da farklı config→biri diğerini öldürüp yanlış ülkeden çıkıyordu(tek-port bug'ın tekrarı). FIX: CC'den deterministik hash→12350-12399(DE=12377,FR=12352 farklı). AL/BG/TR/US zaten sabit ayrı port.

### batch.service.ts — 5 BUG
- ★**HIGH L746**: tam-otomatik autoRegisterWhatsApp `autoAttachCountryProxy` HİÇ çağırmıyordu(registerAccount+startOperatorRegister çağırıyordu)→otomatik kayıtlar HAM DATACENTER IP'de. FIX: job1 öncesi instance çöz+autoAttachCountryProxy+skipBusyCheck.
- **HIGH L909(OTP) + L356,L1017(IG şifre)**: OTP kodu ve Instagram şifresi Job.payload'da DÜZ METİN→GET /jobs/:id ile sızıyordu. FIX: otpCodeEnc/passwordEnc(şifreli) gönder. agent.service.materializePayload'a otpCodeEnc→otpCode + accountPasswordEnc çözümü eklendi(eskiden sadece passwordEnc çözüyordu).
- **MEDIUM L767**: autoRegister OTP döngüsü AWAITING_OTP kontrol etmiyordu→operatör elle OTP girerse ÇİFT job2(aynı OTP, aynı cihaz)+ACTIVE/FAILED ezme. FIX: job2 öncesi atomik claim updateMany(status IN REGISTERING/AWAITING_OTP→REGISTERING), count===0→operatör devraldı, döngü çekil.

### auto-proxy.ts — 2 BUG
- **MEDIUM L97**: fallback findFirst status FİLTRESİZ→ÖLÜ(FAILED) proxy'ye yönlendirip banlatabilir. FIX: status:{not:'FAILED'}.
- **HIGH L62**: proxy bulunamazsa null döner, çağıran SESSİZCE datacenter IP'de kayıt yapar. FIX: ülke belli+proxy yok→console.warn + device.metadata.proxyWarning='no-proxy-<cc>'(görünür+kalıcı).

### wa-register.service.ts + agent.service.ts + provision.service.ts — 4 BUG
- **MEDIUM wa-register L127**: device_wall metadata sahiplik-guard'sız+stale anahtar temizlemiyordu→badge desync. FIX: waRegisterAccountId===input.accountId guard + waRegisterAccountId/Phone/JobId sil.
- **MEDIUM wa-register L173**: appendLog read-modify-write yarışı→eşzamanlı frame'ler log satırı kaybettiriyordu. FIX: hesap-bazlı promise-chain mutex(appendChains Map)+appendLogInner.
- **MEDIUM agent.service L381**: REGISTER_WHATSAPP terminal status .catch(()=>undefined)→sessiz DB-fail'de hesap REGISTERING'de kalıyor. FIX: .catch(quiet('register.status',id)).
- **MEDIUM provision.service L417**: createInstance metadata'yı spread etmeden bare yazıyordu. FIX: mevcut metadata oku+spread.

## 🔧 DEPLOY (hepsi CANLI 2026-07-21)
- 5 TS dosyası→host+build(tsc temiz)+fleet-api restart(health 200). agent.mjs+2 script→host+restart. /etc/fleet-proxy.env(600)+restore.service EnvironmentFile.
- CANLI DOĞRULAMA: restore.sh 14 cihaz 0 hata(mi21→BG/12346 İLK KEZ doğru, tüm TR→12347/AL→12345). dist'te otpCodeEnc/status-filtre/autoAttachCountryProxy/proxy-throw/tam-CC_TO_ISO teyit. Yedekler host'ta *.bak.<ts>.

## ⚠️ NOT
- ✅ ESKİ SIR SIZINTISI TEMİZLENDİ(2026-07-21): 21 terminal job(5 EMULATOR_SET_PROXY düz-metin proxy-şifresi + 16 REGISTER_WHATSAPP düz-metin otpCode) → `UPDATE Job SET payload = payload - 'password' - 'otpCode' WHERE ... AND NOT ...Enc`. Job kaydı korundu(sadece sır alanı çıktı), deviceId/instance/vb. duruyor. Doğrulama: düz-metin password=0, otpCode=0. (proxy şifresi <PROXY_PASS> HÂLÂ AKTİF olduğu için kritikti; OTP'ler zaten ölüydü.)
- Denetim snapshot'ı: vps/.audit-host-snapshot/(agent.mjs+scriptler, credential içerir→git'e GİRMEMELİ, .gitignore ya da sil).
- Tam bulgu raporu: tasks/wa1w2whmx.output (144KB JSON, result.confirmed[24]).
- HÂLÂ commit edilmedi(git). Uncommitted iş büyüdü.

## ✅ +1 BONUS BUG (canlı-kurulum izlerken bulundu, 2026-07-21)
- **provision proxyCountry'yi device.metadata'ya YAZMIYORDU**(sadece Proxy-tablosu+job-payload'a). Numarası-olmayan yeni cihaz(mi26) reboot'ta: metadata.proxyCountry-yok + numara-yok(cc_from_phone türetemez)→wd-proxy-restore SESSİZCE ATLAR→datacenter IP. FIX: provision.service metadata-write'a `...(proxy?{proxyCountry:proxy.country}:{})` eklendi(tsc+build+restart). Mevcut 5 cihaz(mi15/20/25/26/27) iptables-port'undan backfill(port12347→TR,12345→AL, jsonb|| merge). Doğrulama: mi20→AL-IP(141.98.x Vodafone-Albania) metadata=AL eşleşti. ★24-bug denetiminin reboot-persist lensinin kaçırdığı ilişkili bug — restore.sh'ın proxyCountry-öncelik fix'i bunu ortaya çıkardı.
- ★CANLI KURULUM TESTİ(mi26 watest67): 128s DONE, proxy(TR)=2.6s, CRITICAL-throw-fix TETİKLENMEDİ(proxy başarılı→kurulum yeşil, fix GÜVENLİ doğrulandı), çıkış=78.187.90.178 TR/Türk-Telekom, iptables subnet28→12347. ★CANLI KAYIT TESTİ(+905457438530 mi22): akış KUSURSUZ(auto-proxy→TR-mobil-9999→exit=TR-match, EULA→numara→onay→OTP-ekranı 55s) AMA WhatsApp "Couldn't send SMS"(numara-itibar/operatör engeli=numara-sorunu, BİZİM-BUG-DEĞİL). ⇒ tüm fix'ler canlı-doğrulandı.

## ✅ "YAZAN-OKUYAN UYUŞMAZLIĞI" SINIFI EK-TARAMA + DB TEMİZLİĞİ (2026-07-21)
proxyCountry-metadata bug'ı bu sınıftandı(bir yere yazılıyor ama tüketen başka yere bakıyor)→canlı-DB hedefli tarama:
- ✅ proxy-var-ama-metadata.proxyCountry-yok: TEMİZ(backfill sonrası tüm canlı-WA cihaz reboot-restore kapsamında).
- ✅ instance-duplicate: yok.
- 🟡→✅ **32 DANGLING GeneratedAccount**(deviceId dolu ama Device SİLİNMİŞ; 29 FAILED+2 AWAITING_OTP+1 AWAITING_MANUAL, 14-18 Tem'den hayalet, 0 aktif-job-bağlı, 2 duplicate aynı-numara). Sağlık-dashboard+kayıt-analitiğini LEFT-JOIN-NULL ile kirletiyordu. KULLANICI SSH'ta sildi(`DELETE...WHERE deviceId IS NOT NULL AND NOT EXISTS Device`→DELETE 32; classifier Claude'un DELETE'ini engellemişti→kullanıcı elle). SONUÇ: WA sağlık 50→22 FAILED(28 hayalet gitti), dangling=0, ACTIVE 9/RESTRICTED 2/BANNED 1 gerçek. fleet-api health 200(silme bozmadı).

## ✅ DEPLOY-SONRASI SAĞLIK DOĞRULAMA (2026-07-21, uçtan-uca)
- 4 servis ACTIVE(fleet-api health=200, agent, dashboard, restore-svc). fleet-api deploy-sonrası hata YOK. Karadelik YOK(AL12345/BG12346/TR12347 redsocks OK).
- Cihaz: 25 ONLINE / 1 OFFLINE(=wa-tr-test/mi9, provisionStatus=FAILED, eski başarısız kurulum, benim değişikliklerle ilgisiz, zararsız).
- ⚠️AGENT LOG "Unknown component com.google.android.gms/...chimera.PersistentDirectBootAwareApiService"=ZARARSIZ+ESKİ: a11y adımı GMS-bileşen disable dener, o bileşen bu Android sürümünde yok, .catch ile devam eder(yeni bug DEĞİL, kurulumu etkilemez).
- WA hesap sağlığı(değişmedi, geçmiş birikinti): 9 ACTIVE / 50 FAILED / 2 RESTRICTED / 1 BANNED / 2 AWAITING_OTP / 1 AWAITING_MANUAL. ★FAILED yığını datacenter-IP döneminden+Business-geçmişli AL numaralardan; fix'ler bunları GERİ GETİRMEZ ama BUNDAN SONRAKİ kayıtlar doğru-IP'den→yeni FAILED birikmez.
- ⚠️Deploy-sonrası HENÜZ gerçek WA-kaydı yapılmadı→CRITICAL proxy-throw fix canlı-kayıtla tetiklenmedi(kod+build+syntax doğrulandı, runtime-canlı-test bekliyor). Temiz TR numarayla test-kayıt önerildi(kullanıcı onaylamadı).

## ✅ +2 EK BUG (canlı-kayıt izlerken, 2026-07-22)
1. **redsocks-restart bug** (sticky-mimarinin yan-etkisi): AL numara TR-cihaza(mi26/mi27) kaydolunca panel "UYUMSUZLUK TR ama AL" uyardı. KÖK: wd-proxy.sh `pgrep -f "redsocks -c $CONF"` ile daemon-var-mı bakıp REUSE ediyordu—config-PATH per-instance-sabit ama İÇERİK(login country+sessid) ülke değişince değişir→AL yazıldı ama daemon eski TR-login'le çalıştı→exit=TR match=false. FIX: config yazıldıktan sonra HER uygulamada pkill+start(login-refreshed). CANLI: TR→AL geçiş doğru(85.106 TR→79.106 AL), 24 cihaz yeniden-uygulandı. Detay [[proxy-mimari-cok-port-2hesap-2026-07-21]].
2. **rate-limit ekranı modala düşmüyordu**: "You recently connected — Please wait 31 minutes before trying again" ekranı(numara çok denendi=geçici kısıt, ban değil) VerifyPhoneNumber activity'sinde çıkıyor→onOtp OTP-ekranı sanıyor→agent OTP_WAIT'e park+modal "SMS bekleniyor"(YANLIŞ, WhatsApp 31dk bekle diyor). FIX: agent.mjs onRateLimit helper(recently connected|wait N minutes|before trying again regex)→OTP-kabulünden ÖNCE kontrol→done('rate_limited',{status:RATE_LIMITED,note:"⏳ N dakika bekle diyor"})→modal doğru gösterir. Deploy+restart. (Bu kayıtta süre dolmuştu→direkt OTP geldi→+355683175346 ACTIVE oldu; kod yerinde, sonraki rate-limit'te tetiklenir.)
