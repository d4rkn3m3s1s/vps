---
name: eth0-heal-otomatik-kurtarma-2026-07-24
description: "★CİHAZ OFFLINE KÖK-NEDEN + OTOMATİK KURTARMA. idilcall/mi19 2+ saat 'ADB erişilemiyor reconnect başarısız'→DEVICE_WAKE 180s-timeout. KÖK: Waydroid boot'ta container-eth0'a IPv4 ATANMIYOR (sadece IPv6 link-local)→host→192.168.<sub>.112 'No route to host' (ARP INCOMPLETE). adb-server-bounce ÇÖZMEZ (sorun adb değil container-ağı). FIX(elle+otomatik): `lxc-attach -n waydroid -P /var/lib/waydroid.<inst>/lxc -- ip addr add 192.168.<sub>.112/24 dev eth0 + ip link set eth0 up` → anında ping+ADB. OTOMATİK: agent.mjs healInstanceEth0()+adbRecoveryTick her erişilemez-ama-RUNNING instance'a uygular(90s tick)+wakeDevice/DEVICE_WAKE içine de eklendi(180s-timeout yerine heal-dener). ★PROXY: iptables REDIRECT subnet-bazlı(IP-bağımsız)→eth0-heal proxy'yi BOZMAZ; ensureInstanceProxy() redsocks-canlılık+REDIRECT-varlık kontrol eder, eksikse redsocks-inst-<inst>.conf'tan wd-proxy.sh ile yeniden kurar. ★★DEPLOY-TUZAK: systemd `/opt/agent.mjs` çalıştırır — `/opt/fleet-agent/agent.mjs` DEĞİL! İkisi ayrı, yanlışa deploy=sessiz-etkisiz. ★PROXY-ALARM YANLIŞ-POZİTİF: API health-check thordata session-proxy'yi API-sunucusundan fetch'le test eder→FAILED, ama GERÇEK trafik cihazdan redsocks'la çıkar(mi2=88.230 TR, mi7=141.98 ONE-ALBANIA AL — doğru!). CANLI: 23/23 online, heal 14:26+14:27 UTC iki-kez otomatik onardı."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-26T13:57:11.039Z
---

# ★ CİHAZ OFFLINE KÖK-NEDEN + eth0 OTOMATİK KURTARMA (2026-07-24)

Telegram loglarında idilcall/mi19 2+ saat "⛔ Cihaz erişilemiyor: ADB'den erişilemiyor,
reconnect başarısız" + DEVICE_WAKE 180s-timeout. Operatör mesajlaşmaya devam edemiyordu.

## KÖK NEDEN
Waydroid instance boot ettiğinde (container RUNNING, "Android with user 0 is ready")
bazen **container içindeki eth0'a IPv4 ADRESİ ATANMIYOR** — sadece IPv6 link-local kalır.
- SEMPTOM: host→`192.168.<sub>.112` "No route to host", `ip neighbor`=INCOMPLETE (ARP çözülemiyor).
- adb-server-bounce ÇÖZMEZ (sorun ADB'de değil, container ağında).
- veth-bridge L2 SAĞLAM (vethXXX@if2 → waydroid-<inst> bridge UP) — sadece IP yok.

## FIX (elle bulundu → otomatikleştirildi)
Container'ın **nokta-path** lxc dizini: `/var/lib/waydroid.<inst>/lxc` (waydroid-<inst> DEĞİL).
```
lxc-attach -n waydroid -P /var/lib/waydroid.<inst>/lxc -- ip addr add 192.168.<sub>.112/24 dev eth0
lxc-attach -n waydroid -P /var/lib/waydroid.<inst>/lxc -- ip link set eth0 up
adb connect 192.168.<sub>.112:5555
```
→ ANINDA ping (0% kayıp) + ADB `connected`. (route add default "unreachable" verir ama gerekmez.)
subnet = `sh /opt/fleet-agent/waydroid/net-head.sh <inst>` (mi19→22). ⚠️`subnetIdForInstance`
(agent md5→241..256) YANLIŞ subnet verir — net-head.sh KULLAN.

## OTOMATİK (agent.mjs, /opt/agent.mjs)
- **healInstanceEth0(inst)**: net-head→subnet, lxc-info RUNNING?, eth0 IPv4 var mı? yoksa
  ip-add+link-up+adb-connect. Sonra ensureInstanceProxy() çağırır.
- **adbRecoveryTick** (90s): adb-server-bounce'tan ÖNCE, çalışıyor(wd-run var)-ama-erişilemez
  HER instance'a healInstanceEth0 uygular (tek cihaz düşünce çoğunluk-wedge beklemeden düzelir).
- **wakeDevice/DEVICE_WAKE**: ensureConnected sonrası erişilemezse 180s-waitBoot yerine ÖNCE
  eth0-heal dener → `/uyandir`/`/reconnect` Telegram komutları artık gerçekten kurtarır.
- CANLI KANIT: mi19 düştü, agent 14:26 + 14:27 UTC **iki kez otomatik onardı** (log:
  "eth0-heal: mi19 → 192.168.22.112 onarıldı"). 23/23 online.

## PROXY: eth0-heal proxy'yi bozar mı? (operatör sorusu "proxy'yi de gömüyor mu")
- HAYIR — iptables REDIRECT kuralları **subnet-bazlı** (`192.168.<sub>.0/24 → redir ports <lport>`),
  IP-bağımsız → eth0-IP değişimi REDIRECT'i etkilemez. redsocks daemon da ayrı process.
- Yine de savunma: **ensureInstanceProxy(inst,sub)** heal sonrası çağrılır: redsocks-inst-<inst>.conf
  var mı + redsocks daemon canlı mı + iptables REDIRECT kuralı var mı kontrol eder; EKSİKSE
  config'ten CC/login/pass/upstream-ip/port çıkarıp `wd-proxy.sh <inst> <cc> <user> <pass> <host> <port>`.
  ⚠️REGEX-TUZAK: config'te İKİ `ip`/`port` var (local_ip/local_port + upstream). Upstream için
  `grep -E '^[[:space:]]*ip = '` (local_ önekini dışla) — yoksa 0.0.0.0/local_port alınır.

## ★★ EN KRİTİK DEPLOY-TUZAK
systemd **`/opt/agent.mjs`** çalıştırır (`ExecStart=/usr/bin/node /opt/agent.mjs`), AMA repo/scp
hedefi kolayca `/opt/fleet-agent/agent.mjs` sanılır — İKİSİ AYRI DOSYA. Yanlışa deploy edince kod
sessizce ETKİSİZ (agent eski dosyayı çalıştırmaya devam eder, log'da hiç yeni-fonksiyon yok). Her
agent deploy'unda `/opt/agent.mjs`'e cp + `grep -c <yeni-fonksiyon> /opt/agent.mjs` ile doğrula.
Agent logu **journald'de DEĞİL** → `/var/log/fleet-agent.log` (StandardOutput=append).

## PROXY-ALARM YANLIŞ-POZİTİF (log'u dolduran gürültü)
"⚠️ Proxy havuzu sağlıksız N/N BAŞARISIZ" alarmı: API health-check (proxy.service.ts:329)
thordata sticky-session proxy'yi **API-sunucusundan** `fetch(ipify,{ProxyAgent})` ile test eder →
session-context yok → thordata reddeder → FAILED. AMA gerçek trafik **cihazdan redsocks** ile çıkar
ve ÇALIŞIR: mi2=88.230.50.57(Türk Telekom), mi3=81.213(TR), mi7=141.98.140.7(AS42313 ONE ALBANIA=AL
residential — Arnavutluk hesapları için DOĞRU). Datacenter-sızıntı YOK → alarm gürültü. (adb-shell
curl/ping Waydroid'de tutarsız — çıkış-IP testi güvenilmez; loglardaki "✅ gönderildi" gerçek kanıt.)

## ★ PROVISION eth0-DHCP TAKILMASI → STATİK-IP FALLBACK (2026-07-25)
Kullanıcı: "tek tık 2 cihaz kurdum %18'de takıldı (eth0 IPv4 gecikti DHCP), tek tık
sorunsuz çalışıyordu" = REGRESYON. KÖK: provisionDevice'daki `dhcpKick` döngüsü (agent.mjs
~7804) eth0 IPv4'ü DHCP ile almaya çalışıyordu ama netd yavaş self-timer'a bağlı →
canlı: mi12 boot=403s, mi13=411s (kimi zaman 300s-cap'te FAILED). eth0-heal (adbRecoveryTick)
sonradan kurtarıyordu ama provision o ana kadar takılı kalıyordu.
- ✅ FIX: DHCP döngüsüne i===8 (~16s) STATİK-IP FALLBACK — DHCP hâlâ vermediyse
  `ip addr add 192.168.<subnetId>.112/24 dev eth0 + link up + route` (healInstanceEth0 ile
  AYNI, anında çalışır). subnetId provision scope'unda mevcut (7758).
- ★★KRİTİK BUG (ilk denemede): statik@22s atandı AMA sonraki dhcpKick'ler(`ifconfig eth0
  down/up`) statik IP'yi FLUSH etti → boot yine 69s+ sürdü. FIX-2: statik atandıktan SONRA
  dhcpKick ÇALIŞTIRMA (`else if (!staticApplied && ...)`). Statik-sonrası sadece IP-bind poll.
- ✅ CANLI KANIT: mi20 fix'li provision → statik@22s → kick durdu → **DONE 123s (boot=69s)**.
  Önce 403-411s/FAILED → şimdi ~123s = ~4x hızlı. mi12+mi13 (takılan cihazlar) COMPLETED+ONLINE.

## ★★ 2. BUG (aynı gün): adbRecoveryTick ↔ provision eth0 YARIŞI → FAILED
Statik-fix'ten SONRA yeni provision'lar HÂLÂ ara-sıra FAILED oldu (mi14/mi20 tekrar).
KÖK: provision statik-IP atarken AYNI ANDA `adbRecoveryTick`→`healInstanceEth0` de aynı
instance'a IP atıyordu (canlı log: 14:11:54 eth0-heal + 14:11:56 provision-fallback art-arda)
→ iki mekanizma çakışıp boot-session'ı bozuyor → container çöküyor → waitBoot FAILED →
teardown → ZOMBİ kalıntı (wd-run çalışır ama session ölü, eth0-heal her 90s IP atar ama
tutmaz). ✅ FIX: `provisioningInstances` Set — provisionDevice başında add, DONE/catch'te
delete. healInstanceEth0 başında `if (provisioningInstances.has(inst)) return {reason:'provisioning'}`
→ provision devam ederken heal DOKUNMAZ. ✅ CANLI KANIT: mi20 DONE 124s + mi21 DONE 127s
(boot=69s), `eth0-heal: mi21` log sayısı=0 (guard çalıştı, hiç karışmadı). FİLO 28/28 online.
- ★ZOMBİ TEMİZLİK: FAILED-yarım instance = wd-run çalışır + container RUNNING ama
  weston/session process YOK + eth0-IP tutmaz. Kurtarılamaz → `pkill wd-run.sh <inst>` +
  `lxc-stop -k` + `wd-destroy.sh <inst>` + DB'den sil (job→FAILED, GA.deviceId→null, device.delete).
  ⚠️pkill SSH'ı bloklar — sonra ayrı komutla devam et.
- ★node-script tuzağı: prisma bağlantısı açık kalınca `node -e` ÇIKMAZ (çıktı boş görünür)
  → `finally{await prisma.$disconnect();process.exit(0)}` ŞART.

## ★ PROXY "YOK" YANLIŞ-ALARM: node-e test env'siz → proxyCredsFor null (2026-07-25)
Kullanıcı: "WA kayıt UYUMSUZLUK proxy TR ama numara AL banlar" + "tek-tık fixlerken
bozduk". TEŞHİS: mi12/mi13(AL-numara cihazları) + benim mi14/20/21 test-cihazlarında
proxy "yok" göründü. AMA:
- ★KÖK: `proxyCredsFor(cc)` credential'ı `process.env.FLEET_PROXY_USER/PASS/MOBILE_*`'ten
  MODULE-LOAD'da okur. Benim `node -e`/`.cjs` TEST scriptlerim systemd env'i ALMADAN çalıştı
  → env boş → proxyCredsFor NULL → provision payload'da proxy YOK. YANILTICI: kod/credential
  SAĞLAM, sadece test-harness env'siz. GERÇEK fleet-api (systemd, Environment= dolu) provision'da
  proxy DOĞRU oluşuyor (kanıt: env import edip test → payload.proxy VAR, AL=residential:5555,
  TR=mobile:9999). ⚠️DERS: agent/api kodunu `node -e` ile test ederken systemd env'i İMPORT ET
  (`systemctl show fleet-api -p Environment`) yoksa env-bağımlı fonksiyonlar yanlış null döner.
- ★proxyCredsFor kontrolü: `grep -c "^FLEET_PROXY_USER=" /proc/PID/environ` YANLIŞ (ham
  byte-stream'de ^ anchor çalışmaz, tr '\0' '\n' ŞART). Gerçekte 9 FLEET_PROXY env yüklüydü.
- ★SENIN cihazların (mi12/mi13) proxy'si TAM SAĞLAM: proxy=AL, redsocks=up, REDIRECT=VAR,
  upstream çıkış-ülke=AL (host-tarafı test). AL-numara+AL-proxy UYUMLU, ban riski YOK.
  Dashboard "proxy TR banlar" uyarısı YANLIŞ-POZİTİF (proxy-test cihaz-içi curl'e güvenir,
  Waydroid'de `adb shell curl` tutarsız → doğrulanamadı → yanlış TR varsayar).
- ★AĞ-KOPUK teşhisi: `adb shell su -c curl api.ipify.org` Waydroid'de GÜVENİLMEZ (bazen boş).
  KESİN test = host-tarafı `curl -x http://user:pass@upstream:port ipinfo.io/country`. Gateway
  ping + redsocks-listen + iptables-REDIRECT-C ile zincir kontrol et.

## AÇIK KONULAR
- Proxy-alarm gürültüsü: health-check'i cihaz-taraflı yapmak ya da bu alarmı susturmak (gelecek).
- +355682317479 hesabı BANNED (çok mesaj → WhatsApp banı; ağ/proxy ile ilgisi yok).

Detay [[firewall-ipv6-regresyon-test-2026-07-24]] [[telegram-13-komut-suite-2026-07-24]]
[[cihaz-acma-proxy-healthwatch-2026-07-23]] [[proxy-mimari-cok-port-2hesap-2026-07-21]]
