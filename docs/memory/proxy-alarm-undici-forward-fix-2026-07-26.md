---
name: proxy-alarm-undici-forward-fix-2026-07-26
description: "★★'Proxy havuzu sağlıksız N/N BAŞARISIZ' alarmı SÜREKLİ yanlış-pozitif. KÖK: proxy.service.ts check() `await import('undici')` yapıyordu ama undici KURULU DEĞİL(package.json'da yok, Node built-in olarak import EDİLEMEZ)→her check ERR→catch{FAILED}→HER proxy HER ZAMAN FAILED(check hiç çalışmamış). FIX-ADIMLARI(3 katman): (1)undici npm-install DENENDİ ama Node v22 yerleşik-fetch'iyle ÇAKIŞIR('invalid onRequestStart method')→kaldırıldı. (2)CONNECT-tünel(node:http+https createConnection) DENENDİ ama thordata port-5555'te CONNECT'i HOST-IP'sine yönlendiriyor(exit=125.253.73.45 datacenter YANLIŞ). (3)✓ÇÖZÜM: FORWARD-proxy(node:http, tam-URL `GET http://api.ipify.org/...`, HTTP-hedef ki CONNECT'e düşmesin)→proxy KENDİ exit-IP'sinden gider→gerçek proxy-IP döner(197.184.172.3). ★thordata HOST doğru form `<sub>.pr.thordata.net`(.eu tutarsız→.pr'ye çevir). ★username SUFFIX ŞART: `-country-<cc>-sessid-<x>-sesstime-<dk>`(mobile sesstime-tek-başına REDDEDER, sessid şart). CANLI: revalidateDue checked5 ok5 failed0 → alarm SUSAR. thordata bakiye-API: `GET openapi.thordata.com/api/account/traffic-balance?token=<KEY>`(proxy-user DEĞİL, ayrı Dashboard-token; kullanıcı KEY=db87091d... verdi)."
metadata: 
  node_type: memory
  type: project
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-26T14:42:17.033Z
---

# ★★ PROXY-ALARM YANLIŞ-POZİTİF KÖK-NEDEN + FIX (2026-07-26)

Kullanıcı: "⚠️ Proxy havuzu sağlıksız — N proxy başarısız" alarmı SÜREKLİ tekrarlıyor
(15:21, 15:51, 16:21, 16:51...). Ayrıca WA-kayıtta "proxy TR ama numara AL banlar"
(YANLIŞ-ALARM, gerçek proxy AL). "proxyler içinde hesaba girip GB/kredi kontrol et".

## ★★ ASIL KÖK NEDEN: check() undici-import HER ZAMAN fail
`proxy.service.ts` `check()` metodu proxy'yi test etmek için `await import('undici')` +
`new undici.ProxyAgent()` + `fetch(...,{dispatcher})` kullanıyordu. AMA:
- **undici package.json'da dependency DEĞİL, kurulu değil** (Node v22 fetch'i undici-tabanlı
  ama `import('undici')` ayrı-paket ister, YOK). → import ERR → `catch { status='FAILED' }`
  → **HER proxy HER ZAMAN FAILED** → alarm her revalidateDue'da çalar. check() HİÇ çalışmamış.
- ⚠️YANILTICI: `/tmp`'ten `node -e import(undici)` fail eder ama `/opt/fleet/apps/api`
  WorkingDirectory'sinden (root-hoisted /opt/fleet/node_modules) çalışabilir → test-cwd tuzağı.

## FIX — 3 katman denendi, 3.'sü çözdü
1. **undici npm-install**: Node v22 YERLEŞİK fetch'iyle ÇAKIŞIR → `TypeError: fetch failed,
   cause: InvalidArgumentError: invalid onRequestStart method`. Ayrı-undici + built-in-fetch
   sürüm-uyumsuz. → `npm uninstall undici`.
2. **CONNECT-tünel** (node:http CONNECT + node:https createConnection→socket): CONNECT status
   200 döner AMA thordata port-5555'te trafiği HOST'un kendi çıkışına yönlendirir → exit-IP=
   `125.253.73.45`(HOST datacenter-IP, YANLIŞ, proxy bypass edilmiş).
3. ✅**FORWARD-PROXY** (curl-eşdeğeri): `http.request({host:proxyHost, path:'http://api.ipify.org/
   ?format=json', headers:{Host, Proxy-Authorization:Basic}})`. Tam-URL path = forward-proxy modu,
   HTTP-hedef (https DEĞİL, yoksa CONNECT'e düşer). Proxy hedefe KENDİ exit-IP'sinden gider →
   dönen IP GERÇEK proxy çıkışı. Zero-dep (node:http built-in). CANLI: 197.184.172.3/141.98.140.151
   (gerçek AL/TR proxy-IP), 5 OK / 0 FAILED, revalidateDue failed=0 → alarm SUSAR.

## ★ thordata FORMAT DERSLERİ (kullanıcının resmi bilgisiyle doğrulandı)
- **HOST doğru form: `<sub>.pr.thordata.net`** (pr=proxy). Config'te `.eu.thordata.net`
  tutarsız/yavaş → check()'te `.eu`→`.pr` çevrilir. (curl .pr ile US-IP döndürdü, çalışıyor.)
- **username SUFFIX ŞART**: `td-customer-<id>-country-<CC>-sessid-<x>-sesstime-<dk>`. Suffix'siz
  thordata REDDEDER. ★sessid ŞART (mobile hesabı `sesstime` tek-başına REDDEDER; residential+
  mobile ikisi de sessid ile çalışır). check() countryCode'dan suffix üretir (sessid=hcheck).
- **2 hesap**: residential `td-customer-<AL_RESIDENTIAL_USER>`@5555(AL/BG), mobile `td-customer-<TR_MOBILE_USER>`
  @9999(TR). FLEET_PROXY_USER/PASS + FLEET_PROXY_MOBILE_USER/PASS env'de(fleet-api Environment=).
- ★env-tuzağı: `node -e` TEST scriptleri systemd env ALMAZ → proxyCredsFor null(yanlış). Gerçek
  fleet-api env'li. Test'te `systemctl show fleet-api -p Environment` import et.

## ✅ thordata BAKİYE/GB OTOMATİK KONTROL + ALARM (kuruldu, canlı)
- API: `GET https://openapi.thordata.com/api/account/traffic-balance?token=<TOKEN>` →
  `{code:200, data:{traffic_balance:<MB>, expiration_time:"YYYY-MM-DD"}}`. traffic_balance = MB.
- ★TOKEN proxy-user/pass DEĞİL — ayrı Dashboard→My-Account token'ı. Proxy-user ile "Token error"(10047).
- **ENTEGRASYON**: proxy.service `fetchThordataBalance(token)` + `checkThordataCredit()`. index.ts
  ticker: boot+30s ilk, sonra 12 SAATTE BİR. env `FLEET_THORDATA_TOKEN`(residential) +
  `FLEET_THORDATA_TOKEN_MOBILE`(opsiyonel) + `FLEET_PROXY_CREDIT_ALERT_GB`(varsayılan 2). Eşik
  altındaysa yeni `PROXY_CREDIT_LOW` AlertTrigger(migration+fail-open) → Telegram top-up uyarısı.
- ★env: fleet-api drop-in `/etc/systemd/system/fleet-api.service.d/proxy.conf`(unit-file DEĞİL,
  sadece NODE_ENV orada). Token oraya eklendi. daemon-reload+restart şart.
- **CANLI KANIT**: bakiye 0.76 GB(781MB, bitiş 2026-08-06) → eşik-2GB-altı → Telegram'a
  "notify sent ⚠️ Proxy trafiği azaldı — residential (AL/BG): 0.8 GB kaldı" DÜŞTÜ.
- ⚠️AKSİYON: residential hesabı 781MB KALDI(az!) — top-up gerek. mobile hesabı için 2. token yok.

Detay [[eth0-heal-otomatik-kurtarma-2026-07-24]] [[proxy-mimari-cok-port-2hesap-2026-07-21]]
[[canli-izleme-8bug-sticky-2026-07-22]]
