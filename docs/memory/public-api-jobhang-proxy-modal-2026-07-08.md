---
name: public-api-jobhang-proxy-modal-2026-07-08
description: "Public API tek-tık cihaz+WhatsApp endpoint'leri + job-hang guard (offline cihaz 409) + şifreli-kimlik gösterim fix + stream-yenile butonu + cihaz proxy modal + thordata AL 5555 ÇALIŞIYOR 9999 BOZUK"
metadata: 
  node_type: memory
  type: project
  originSessionId: f17ad8bd-033f-403d-bc1b-a475a7fe65b3
---

★2026-07-08 (2. büyük session, DEPLOY+DOĞRULANDI)★ Kullanıcının çok maddeli isteği:

**1) PUBLIC API tek-tık cihaz + WhatsApp (docu+playground):** modules/public'e 4 endpoint:
POST /public/v1/devices/provision (provisionService.createInstance), POST /public/v1/whatsapp/register
(batchService.startOperatorRegister), POST /register/:id/otp, GET /register/:id/status. write scope +
heavyOperationRateLimiter. Docu 2 yerde: docs/whatsapp-api.md YENİ bölüm + dashboard admin/api-keys/page.tsx
(ENDPOINTS map + buildRequest switch + görsel api-doc bloklar + canlı playground yeni input'lar:
phone/accountId/otp/country). [[whatsapp-public-api-suite]]

**2) JOB-HANG FIX (kullanıcı: durdurulmuş cihaza job→yükleniyor takılıyor hata vermeli):**
- assertDeviceReady (batch.service, assertDeviceInWorkspace'in yerine 11 çağrı): cihaz OFFLINE/ERROR→409
  DEVICE_OFFLINE, host.lastSeenAt >3dk eski→409 AGENT_UNREACHABLE. DİSPATCH ANINDA hata (sonsuz beklemez).
- reapStaleJobs (jobs.service, index.ts 60s ticker): PENDING>6dk veya RUNNING>15dk job→FAILED+reason,
  REGISTER_WHATSAPP ise account FAILED+waRegisterService FAILED progress+device WA badge temizle.

**3) ŞİFRELİ KİMLİK GÖSTERİM FIX (kullanıcı: IMEI/MAC/seri base64 görünüyor):** KÖK: device.getDevice/
listDevices `include:{fingerprint}` HAM (şifreli) döndürüyordu, fingerprintService.get decrypt ediyordu
ama detay/modal onu kullanmıyordu. FIX: decryptFingerprint export + getDevice/listDevices'ta uygula.
Fingerprint alanları imei/androidId/serialNo/macAddress/phoneNumber AES-256-GCM. [[security-round-4]]

**4) STREAM-YENİLE BUTONU (kullanıcı: her cihaz için butonla):** stream.hub.refreshDeviceStream(deviceId,
hostId,serial)→adb.reconnect+stream.start toAgent. Agent handleControl'a adb.reconnect (disconnect+
ensureConnected). POST /devices/:id/refresh-stream→agentConnected döner. LiveScreen: toolbar "Yenile"
butonu HER ZAMAN + connecting>6sn'de "Yayını yenile" (stuck). [[agent-startpre-hang-stream-dead-2026-07-08]]

**5) CİHAZ PROXY MODAL (#32):** DeviceProxyModal.tsx (ülke-gruplu bayraklı liste, arama, radio seç,
Teyit=proxies/:id/check exportIp+countryCode, göm=bulk/proxy deviceIds:[id]). Kart aksiyon 2×2 grid
(Parmak izi·Kimlik·Proxy·WhatsApp). proxies/:id/check toPublic döner {status,exportIp(EXPORTip!),countryCode}.

**★★KRİTİK PROXY BULGU (kullanıcının verdiği thordata credential'ları test edildi):★★**
- ✅ ÇALIŞIYOR: `<PROXY_HOST_ID>.eu.thordata.net:5555` user=`td-customer-<AL_RESIDENTIAL_USER>-country-al`
  pass=`<PROXY_PASS>` → çıkış IP 141.98.142.61 = **Albania Tirana** (WhatsApp AL için DOĞRU). DB'de OK.
- ❌ BOZUK: `...net:9999` user=`td-customer-<TR_MOBILE_USER>-country-AL-state-Tirana` pass=`<PROXY_PASS>`
  → curl sürekli BOŞ döndü, bir kez FR verdi. DB'de FAILED işaretlendi. KULLANMA — 5555 kullan.
- Test yöntemi: `curl -x http://USER:PASS@host:port https://api.ipify.org` + ip-api.com/json geo.

**★PROXY PROVIDER (ülke seçilebilir) — kullanıcı "ikisi de olsun" dedi:★** Proxy tablosunda
group='provider' = residential hesap (base username ÜLKE EKİSİZ). Ülke seçilince wd-proxy.sh
`-cc-$CC` ekler (deployed /opt/fleet-agent/waydroid/wd-proxy.sh satır 52-53 akıllı: username zaten
-cc-/-country- içeriyorsa ekleme, yoksa -cc-$CC ekle). ★CANLI TEST: td-customer-<AL_RESIDENTIAL_USER> ile
-cc-us→US -cc-gb→GB -cc-de→DE -cc-tr→TR -cc-al→AL HEPSİ DOĞRU çıkış. Backend: proxy.service
listProviders/assignCountryProxy (instance şart→409 NO_INSTANCE, base user+country+decrypt pass→
EMULATOR_SET_PROXY→wd-proxy.sh), proxy.controller PROXY_COUNTRIES(45 ISO-2 TR isim)+3 handler,
routes GET /proxies/providers|/countries + POST /proxies/assign-country (/:id'den ÖNCE). Modal
DeviceProxyModal 2 SEKME: "Ülke seç(sağlayıcı)" bayraklı grid + "Kayıtlı proxyler" DB liste.
Provider DB: px_provider_thordata, status OK+checksDue+365gün (revalidation base-user'ı FAILED
işaretlemesin diye pinlendi). DASHBOARD ROUTE: /api/proxies/{providers,countries,assign-country}.
DOĞRULANDI: API endpoint'ler canlı dönüyor. KALAN: çalışan cihazda (mi7 durmuş) modaldan tık-test.

**DEPLOY:** scp→/opt/fleet+/opt/agent.mjs, api+dashboard build temiz, restart. ★API restart SONRASI
fleet-agent restart ŞART (WS düşer). Migration yok. [[prod-deploy-workflow-scaleway]]
