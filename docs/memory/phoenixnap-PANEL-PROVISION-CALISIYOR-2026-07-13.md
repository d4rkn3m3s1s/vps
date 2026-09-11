---
name: phoenixnap-panel-provision-calisiyor-2026-07-13
description: "★★★phoenixNAP'te PANELDEN TEK-TIK CİHAZ OLUŞTURMA ÇALIŞIYOR 2026-07-13 — POST /provision/create → agent → cihaz ONLINE. FLEET_PROVISION_LITE flag (root/vtouch atla). 2 cihaz uçtan uca kuruldu.★★★"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0ce97b6f-23a2-4491-9478-d5dc4d5cc569
---

**★★★ phoenixNAP PANEL→AGENT→CİHAZ tek-tık provision ÇALIŞIYOR (2026-07-13) ★★★**

Kullanıcı "panelden 2 cihaz oluştur" dedi. UÇTAN UCA ÇALIŞTI. İlgili: [[phoenixnap-multiinstance-COZULDU-2026-07-13]] (boot+ADB reçete), [[phoenixnap-fleet-GOC-TAMAM-2026-07-13]].

## ✅ KANITLANAN AKIŞ
`POST /provision/create {name}` (requireApiKey+JWT, mount /provision) → job PROVISION_DEVICE + device oluştur → agent claim → wd-provision.sh (init) + wd-run.sh (boot+ADB) → device ONLINE. 2 cihaz (mi6=panel-1 ONLINE, mi7=panel-2 boot+ADB OK) kuruldu, ikisi de job COMPLETED.

## ★KÖK FIX: FLEET_PROVISION_LITE flag
- SORUN: agent provision `root`(35%)+`vtouch`(58%) adımları prod-özel → `srcSerial` HARDCODED `192.168.248.112:5555` (agent.mjs:3428, prod "work" instance) → o cihaz phoenixNAP'te YOK → cloneApk Magisk/vtouch → "device not found" → job FAILED.
- FIX: agent.mjs:3277 `const PROVISION_LITE = process.env.FLEET_PROVISION_LITE === "1"` + root(3498) ve vtouch(3518) step'lerini `if(PROVISION_LITE){logLine skip}else await step(...)` ile koşullu. agent.env'e `FLEET_PROVISION_LITE=1`. Yedek agent.mjs.bak-provlite. ★perl -0pi ile çok-satırlı regex (sed bozuyor). node -c syntax kontrol ŞART.
- LITE modda Magisk/root GEREKMEZ: WhatsApp/Instagram synthetic tap + a11y ile çalışıyor (root'suz). vtouch (gerçek dokunma) da atlanıyor — synthetic yeterli.

## ★FROZEN TUZAĞI (agent ADB için kritik)
- Waydroid idle instance'ı FROZEN yapar → ADB "unauthorized/offline" görünür. ÇÖZÜM: ADB'den önce `lxc-unfreeze`. wd-adb.sh unfreeze içeriyor. Agent boot doğrulaması ADB'ye bağlanırken cihaz FROZEN'sa bekler; unfreeze sonrası device OK.
- mi7 job COMPLETED oldu ama panel-2 OFFLINE göründü çünkü FROZEN — unfreeze+wd-adb sonrası ADB=OK.

## ★KANITLI CİHAZLAR (bu makinede canlı)
mi6(panel-1, sub 6, 192.168.6.112) ONLINE + mi7(panel-2, sub 7, 192.168.7.112) boot+ADB. Ayrıca c2(3)/c3(4) test cihazları. Her biri izole subnet+IP+ADB authorized+android13+screencap.

## ⚠️ EKSİK/İYİLEŞTİRME
1. wd-run.sh BOOT_DONE'dan önce boot_completed'ı tam yakalamıyor (boot= boş yazıyor) — timing, ama cihaz yine de boot ediyor. İyileştir: boot bekleme döngüsünü uzat.
2. Agent boot doğrulamasında FROZEN-unfreeze otomatik değil — wd-run.sh veya agent'a unfreeze+ADB-retry ekle (şu an elle wd-adb gerekti mi7'de).
3. Provision LITE'ta proxy/apks/a11y adımları çalışıyor mu tam test edilmedi (root/vtouch atlandı, sonrası?).
4. GÜVENLİK DENETİMİ yapılacak (kullanıcı istedi, sıradaki): public API, provision, phoenixNAP deploy.

## KOMUTLAR
Panel: http://125.253.73.45 (admin@fleet.local). SSH: ssh -i C:/Users/furka/.ssh/phoenixnap_y ubuntu@125.253.73.45. Provision test: `POST /provision/create {"name":"x"}` (login→JWT→x-api-key DEFAULT_API_KEY). Cihaz sil+temizle: pkill instance + rm -rf /var/lib/waydroid.INST + sed map.
