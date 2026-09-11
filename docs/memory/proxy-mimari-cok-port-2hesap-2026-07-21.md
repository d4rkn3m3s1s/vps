---
name: proxy-mimari-cok-port-2hesap-2026-07-21
description: ★★KRİTİK PROXY MİMARİSİ (2026-07-21). BAN SALGINI KÖK-NEDENİ: (1)iptables REDIRECT reboot-persist DEĞİL→18-Tem reboot'ta eski cihaz proxy'leri silindi→datacenter IP(125.253.73.45)→WhatsApp ban. (2)tek-port 12345 çakışması→aynı anda 1 ülke. (3)proxy env BOŞ→yeni provision proxy'siz. (4)TR residential ÖLÜ. ÇÖZÜM: wd-proxy.sh ÇOK-PORTLU(AL12345/BG12346/TR12347), reboot-persist systemd(wd-proxy-restore), 2 thordata hesabı(residential@5555 + mobile@9999, TR SADECE mobil), fleet-api proxy env. Tüm ACTIVE cihaz doğru ülke-IP'den çıkıyor(datacenter yok).
metadata:
  node_type: memory
  type: reference
---

# ★★ PROXY MİMARİSİ — ÇOK-PORT + 2 HESAP (2026-07-21) ★★

WhatsApp fleet'inin proxy sistemi. Bu bilgi HAYATİ — yanlış proxy = ban salgını. [[phoenixnap-fleet-GOC-TAMAM-2026-07-13]] proxy'nin ilk kurulumu.

## 🔴 BAN SALGINI KÖK-NEDENİ (4 katman, hepsi düzeltildi)
Kullanıcı "apiden mesaj kayboluyor" + "bazıları kısıtlı" dedi→derin teşhis→filoda 50 FAILED+3 kısıtlı/banlı hesap. Kök:
1. **iptables REDIRECT reboot-persist DEĞİL**: kurallar RAM'de, `netfilter-persistent` yok. 18-Tem reboot'ta TÜM eski cihaz(watest*) proxy kuralları SİLİNDİ→datacenter IP(125.253.73.45)'ten çıktılar→WhatsApp "AL/TR'den kaydoldu şimdi datacenter'dan mesaj" gördü→BAN.
2. **tek-port 12345 çakışması**: wd-proxy.sh 3 ülkeyi(AL/BG/TR) aynı port 12345'te çalıştırıyordu + her çağrıda `pkill -x redsocks`(TÜM redsocks öldür)→aynı anda SADECE 1 ülke. TR uygulanınca AL/BG düşüyordu.
3. **provision proxy env BOŞ**: FLEET_PROXY_HOST/USER/PASS hiç set edilmemiş→yeni provision'lar HİÇ proxy almıyordu.
4. **TR residential ÖLÜ**: Hesap1(emBoE0o264he) TR pool boş/tükenmiş.

## ✅ ÇÖZÜM (hepsi CANLI, 2026-07-21)
### 1) wd-proxy.sh ÇOK-PORTLU (deploy/kvm-host/waydroid/wd-proxy.sh + /opt/fleet-agent/waydroid/)
- `rs_port_for(cc)`: AL=12345, BG=12346, TR=12347, US=12348, diğer=12349. Her ülke KENDİ portu→hepsi AYNI ANDA çalışır.
- redsocks başlatma: "kill EVERY redsocks" KALDIRILDI→sadece BU ülkenin portunu yönet(başka ülke daemon'una dokunma). CANLI: AL(12345)+TR(12347) aynı anda çalışıyor, farklı cihazlar farklı ülke-IP'den çıkıyor.

### 2) ★★2 THORDATA HESABI (host: <PROXY_HOST_ID>.eu.thordata.net, format: `-country-<cc>`)
- **Hesap1 RESIDENTIAL** @port **5555**: user=`td-customer-<AL_RESIDENTIAL_USER>` pass=`<PROXY_PASS>`. AL✓ BG✓ **TR ÖLÜ✗**.
- **Hesap2 MOBILE** @port **9999**: user=`td-customer-<TR_MOBILE_USER>` pass=`<PROXY_PASS>`. AL✓ TR✓ BG✓. ★TR SADECE BURADA çalışıyor(mobil).
- ★KURAL: TR→Hesap2-mobil(9999), AL/BG→Hesap1-residential(5555). Kullanıcı "2si ayrı hesap, biri mobil biri residential" dedi.
- ★ESKİ YANLIŞ format(düzeltildi): host=IP `43.157.66.4` + `-cc-<CC>`. DOĞRU: hostname + `-country-<cc>`. wd-proxy.sh case zaten `-country-` embed'liyse eklemez.
- CANLI kanıt: watest48(TR)→85.105.129.226(TR-TTNet), destek1(AL)→79.106.x(AL), hiçbiri datacenter değil.

### 3) reboot-persist: /opt/fleet-agent/wd-proxy-restore.sh + systemd wd-proxy-restore.service(ENABLED)
- Boot'ta(docker sonrası+90sn sleep) DB'den aktif/kısıtlı-WA cihazlarını oku→her birine ülke-eşleşmeli proxy geri-uygula. cc_from_phone(numara→ülke: 90→TR,355→AL,359→BG,1→US). TR→mobil, diğer→residential.
- CANLI test: 11 cihaz geri-uygulandı, 0 hata. Bir daha reboot'ta proxy DÜŞMEZ.

### 4) fleet-api proxy env: /etc/systemd/system/fleet-api.service.d/proxy.conf ★2 HESAP(2026-07-21 GÜNCELLENDİ)
- Residential(default AL/BG/US): FLEET_PROXY_HOST=<PROXY_HOST_ID>.eu.thordata.net, PORT=**5555**, USER=td-customer-<AL_RESIDENTIAL_USER>, PASS=<PROXY_PASS>.
- ★Mobile(TR): FLEET_PROXY_MOBILE_HOST=aynı-host, PORT=**9999**, USER=td-customer-<TR_MOBILE_USER>, PASS=<PROXY_PASS>, FLEET_PROXY_MOBILE_COUNTRIES=TR.
- ✅TAMAM(kod yazıldı+deploy+canlı): provision.service.ts'e `proxyCredsFor(country)` eklendi→MOBILE_PROXY_COUNTRIES(env, default 'TR')'daki ülke→mobil hesap(9999), diğer→residential(5555). Mobil env yoksa residential'a fallback. ARTIK TR numara İLK provision'da direkt mobil alır(restore-script telafisine gerek yok). tsc temiz, host build+restart, process env doğrulandı, health 200. Eski PROXY_PORT default 9999→5555 düzeltildi(residential default).

## ✅★★ STICKY-SESSION (PER-INSTANCE SABİT IP) — 2026-07-21 GEÇ, BAN KÖK-NEDENİ #2 ✗→✓
- ★KÖK: thordata mobil pool VARSAYILAN olarak her istekte IP DÖNDÜRÜYORDU(rotating). Kullanıcı "API'den mesaj sabit IP'den mi gidiyor" sordu→CANLI TEST: cihaz-içi 6 istek→6 FARKLI IP(217.131/188.132/88.247/88.244/88.241 hepsi TR ama değişken). WhatsApp bunu "aynı hesap 5sn'de farklı şehirlerden bağlanıyor"=BOT→ban görüyordu. Business-geçmişli-numara + bu rotating-IP = ban'ın 2 büyük kök-nedeni.
- ★ÇÖZÜM(kullanıcı "cihaz-başına ayrı sabit IP" seçti): thordata sticky username tag `-sessid-<id>` ile IP sabitlenir(CANLI doğrulandı: -sessid-test123→4 istek aynı IP). MİMARİ DEĞİŞTİ: ülke-başına-tek-redsocks → **PER-INSTANCE redsocks+port+sessid**. wd-proxy.sh: CONF=/etc/redsocks-inst-<instance>.conf, port=12500+subnetId(çakışmasız 12506-12739), LOGIN=<user>-country-<cc>-sessid-<instance>. Her cihaz KENDİ sabit IP'si(gerçek-telefon gibi), farklı cihaz farklı IP(izole).
- ★CANLI KANIT: mi11→88.243.94.100(6/6 aynı, ÖNCE her istek farklıydı), mi16→188.119.17.6(mi11'den FARKLI=izole). 24 cihaz sticky uygulandı 0-hata(port 12506-12529). Eski per-country redsocks(12345/46/47) durduruldu, sadece per-instance kaldı. restore+health-watch wd-proxy.sh'ı çağırıyor→sessid otomatik(değişiklik gerekmedi).
- ⚠️ eski `-cc-<CC>` format→`-country-<cc>` yapıldı(login'de). sticky-IP ömrü(thordata'da ne kadar sabit) sağlayıcıya sorulabilir ama sessid çalışıyor.
- ★★KRİTİK BUG(sticky-mimarinin yan-etkisi, HEMEN düzeltildi 2026-07-22): AL numara TR-cihaza(mi26, önceden TR-sticky) kaydolunca panel "UYUMSUZLUK proxy TR ama numara AL" uyardı. KÖK: wd-proxy.sh `pgrep -f "redsocks -c $CONF"` ile "config-DOSYA-adı için daemon var mı" bakıp REUSE ediyordu—ama CONF-PATH per-instance-SABİT, İÇERİĞİ(login country+sessid) ÜLKE değişince değişiyor. AL yazıldı(config doğru: -country-AL-sessid-mi26) AMA daemon ESKİ TR-login'le çalışmaya devam etti(etimes=198s, restart olmadı)→"APPLIED ama exit=TR match=false"=uyumsuzluk-ban-riski. FIX: config yazıldıktan sonra HER uygulamada `pkill -f "redsocks -c $CONF"`+start(login-refreshed)→çalışan-daemon her zaman yazılan-config'le eşleşir. CANLI KANIT: TR→AL geçiş(85.106.x TR→79.106.x AL, bug olsaydı TR kalırdı), mi26→AL uygulandı çıkış=AL, 24 cihaz yeniden-uygulandı 0-hata. Panel-uyarı-mantığı(agent.mjs:1362 sanity-check, mismatch→⚠ ama hard-abort-YOK)DOĞRU, korundu. Kullanıcı "otomatik-düzelt+devam" istedi ama kök-neden(restart-bug) düzeldiği için ek-self-heal-katmanı GEREKMEDİ(ertelendi).

## 🔧 KOMUTLAR (proxy yönetimi)
- Manuel uygula: `bash /opt/fleet-agent/waydroid/wd-proxy.sh <instance> <CC> <user> <pass> <PROXY_HOST_ID>.eu.thordata.net <port>` (TR→9999+Hesap2, AL/BG→5555+Hesap1).
- Tümünü geri-uygula: `sudo /opt/fleet-agent/wd-proxy-restore.sh`.
- Çıkış-IP kontrol: `adb -s <ip>:5555 shell "curl -s https://api.ipify.org"` (datacenter=125.253.73.45 KÖTÜ, ülke-IP İYİ).
- Proxy test(host): `curl -x "http://<user>-country-<cc>:<pass>@<PROXY_HOST_ID>.eu.thordata.net:<port>" https://api.ipify.org`.
- redsocks kontrol: `pgrep -a redsocks`(ülke başına ayrı config/port).

### 5) ★WA NUMARA GİRİNCE OTOMATİK DOĞRU HESAP(2026-07-21 GEÇ) — auto-proxy.ts FIX
- ★KÖK BUG: auto-proxy.ts (WA one-click register'da numara→ülke→proxy uygular) ülkeyi doğru buluyordu(90→TR) AMA credential'ı `prisma.proxy.findFirst(orderBy createdAt desc)` ile alıyordu=EN SON EKLENEN proxy(ülke filtresi YOK). AL provision'dan sonra TR numara girilince→TR, AL hesabına giderdi→"Login not available". 
- ✅FIX: Ortak modül `accounts/proxy-accounts.ts`(proxyCredsFor+isMobileProxyCountry, env-tabanlı TR→mobil/diğer→residential) oluşturuldu. provision.service.ts VE auto-proxy.ts İKİSİ de bunu import ediyor→aynı ülke asla farklı hesap seçemez. auto-proxy önce env-creds(proxyCredsFor(cc)) dener, yoksa DB'ye düşer(artık countryCode-eşleşmeli findFirst, sonra newest). pass encryptString ile şifreli taşınır.
- ✅ DEPLOY+CANLI: 3 dosya host'a, tsc temiz, build, restart, health 200. Yani ARTIK: provision(cihaz kurulunca) + auto-proxy(WA numara girilince) İKİSİ de ülkeye göre otomatik doğru hesabı seçer, sonra reboot-restore gömülü tutar. 3 katman: provision→register→reboot.
- ★★CANLI TEST EDİLDİ(2026-07-21 15:07): mi22'ye gerçek autoAttachCountryProxy(+905551234567) çağrıldı(fleet-api env ile)→EMULATOR_SET_PROXY job COMPLETED: country=TR **port=9999 user=td-customer-<TR_MOBILE_USER>(MOBİL)**. iptables mi22(subnet24)→REDIRECT 12347(TR mobil). Gerçek çıkış-IP=94.55.18.161(TR/Türksat). DB metadata.proxyCountry=TR gömüldü. ⇒ TEK-TIK WA SONRASI PROXY OTOMATİK+DOĞRU HESAP+GÖMÜLÜ, kanıtlandı.
- ⚠️Test-notu: bu test mi22'ye kalıcı TR proxy bıraktı(zaten TR olacaktı, zararsız). Manuel test job'u için batch/register akışını taklit etti — gerçek WA-kayıt akışında da aynı fonksiyon çağrılır(batch.service.ts:381,897).

## ⚠️ KALAN/DİKKAT
- ✅ provision.service + auto-proxy.ts TR→mobil-hesap seçimi ARTIK KODDA(ortak proxy-accounts.ts). restore-script hâlâ ikinci güvence.
- wd-proxy.sh + provision.service.ts repo'da güncel — git commit edilmeli(uncommitted iş içinde). Host'ta yedek: provision.service.ts.bak.<ts>.
- Hesap1 TR residential ölü kaldıkça TR hep mobil kullanmalı. Kullanıcı thordata TR-residential yenilerse Hesap1 TR de açılır.
- redsocks reboot'ta wd-proxy-restore ile geri gelir(ama iptables-save YOK, restore-script DB-driven).
