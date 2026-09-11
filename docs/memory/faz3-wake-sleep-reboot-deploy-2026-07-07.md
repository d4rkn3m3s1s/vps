---
name: faz3-wake-sleep-reboot-deploy-2026-07-07
description: "★★★FAZ 3 (wake/sleep/reboot + device↔proxy bağı + host canlı kapasite) DEPLOY + UÇTAN UCA CANLI DOĞRULANDI 2026-07-07★★★ mi5 cihazında SLEEP(wd-stop→container STOPPED, ~2sn)→WAKE(wd-run+boot→ONLINE, ~85sn)→REBOOT(SLEEP+WAKE zinciri doğru sırada) HEPSİ COMPLETED. Host kapasite (diskFreeGb/ramFreeGb/runningPhones) agent heartbeat'ten DB'ye canlı akıyor. ★KÖK KEŞİF: Scaleway prod'da fleet-agent env BOZUKTU — FLEET_API_URL=ölü trycloudflare tüneli + FLEET_API_KEY=DB'de olmayan eski key → 'claim failed: fetch failed'. FIX: URL→http://127.0.0.1:4000 (agent aynı makinede), KEY→DEFAULT_API_KEY. Migration _prisma_migrations'a kayıtlı değildi (kolonlar elle vardı) → migrate deploy idempotent düzeltti."
metadata: 
  node_type: memory
  type: project
  originSessionId: f17ad8bd-033f-403d-bc1b-a475a7fe65b3
---

★2026-07-07 — Kullanıcı "en son nerede kaldık" dedi; Faz 3 kodu commit'siz duruyordu, "deploy + canlı test" seçti. İlgili: [[one-click-device-provision-2026-07-07]] (aynı dal feat/cloud-phone-suite, PROVISION_DEVICE reuse), [[prod-deploy-workflow-scaleway]] (deploy akışı), [[production-deploy-scaleway]].

═══════════════════════════════════════════════════
# FAZ 3 KAPSAMI (migration 20260707000000_faz3_wake_proxy_capacity)
═══════════════════════════════════════════════════
1. **DEVICE_WAKE / DEVICE_SLEEP job type'ları** (enum + JobTypes const + agent.mjs handler). EMULATOR_START Waydroid'i sadece ACK ediyordu, gerçekten start/stop etmiyordu. WAKE=wd-run.sh (detached boot + route), SLEEP=wd-stop.sh (temiz durdur). Reboot=SLEEP+WAKE iki job, agent sırayla işler.
2. **Device.proxyId** FK (Proxy'ye, ON DELETE SET NULL) + index — provision'da atanan proxy cihaza kalıcı bağlanır.
3. **Host.diskTotalGb/diskFreeGb/ramFreeGb** — agent heartbeat'ten. provision.service.capacity() "bu host'a kaç telefon sığar" (DISK_PER bazlı fits). HostsView'da gösterim.
- API: device.service wake/sleep/reboot (instanceOf metadata.instance okur, yoksa 409), controller, routes (/devices/:id/{wake,sleep,reboot}), agent.service.complete() DEVICE_WAKE/SLEEP bloğu (ONLINE/OFFLINE) + heartbeat disk/ram.
- Dashboard: api/devices/[id]/{wake,sleep,reboot}/route.ts proxy + ProfileDetailView/JobsView/HostsView UI.

═══════════════════════════════════════════════════
# ★KÖK KEŞİF: fleet-agent env BOZUKTU (deploy sonrası ilk bakılacak yer)★
═══════════════════════════════════════════════════
Kod zaten sunucuda deploy'luydu (hash'ler local=server birebir, dist derli, .next route'lar var) AMA agent job ÇEKEMİYORDU. /var/log/fleet-agent.log = sürekli `claim failed: fetch failed`. İki sebep:
1. **FLEET_API_URL = ölü cloudflare tüneli** (`...trycloudflare.com`, curl→000). Tünel geçici, `cloudflared tunnel --url` process ölmüş. Agent Scaleway'in KENDİSİNDE çalışıyor → tünele GEREK YOK.
2. **FLEET_API_KEY = DB'de OLMAYAN eski key** (`f185cb2...`, sha256 hash'i ApiKey.keyHash'te yok → 401 "Invalid API key"). Muhtemelen DB taşınmadan önceki key.
**FIX** (/etc/systemd/system/fleet-agent.service, yedek alıp sed):
- `FLEET_API_URL=http://127.0.0.1:4000`
- `FLEET_API_KEY=<API_KEY>` (= .env DEFAULT_API_KEY = ApiKey "default-admin-key", workspaceId=null)
- `systemctl daemon-reload && systemctl restart fleet-agent` → log `starting — polling http://localhost:4000` + `stream channel connected`, fetch failed DURDU.
- FLEET_HOST_KEY=`host_7a51eb...` DOĞRUYDU (sha256→Host.agentKeyHash = "Scaleway ARM PAR1" cmr3o4l24, = mi5'in hostId'si). Değiştirilmedi.

═══════════════════════════════════════════════════
# ★UÇTAN UCA CANLI TEST (mi5, instance=mi5, ip 192.168.253.129:5555)★
═══════════════════════════════════════════════════
- **SLEEP**: container RUNNING→STOPPED ~2sn. result `{stopped:true, STOP_RESULT status=stopped}`, device OFFLINE. ✓
- **WAKE**: container STOPPED→RUNNING, boot ~85sn (15:12:55→15:14:20). result `{awakened:true, status:ONLINE, ip/serial/adbPort}`, device ONLINE, host runningPhones 2→3. ✓
- **REBOOT**: SLEEP job önce (OFFLINE), WAKE sonra (ONLINE) — agent iki job'ı DOĞRU SIRADA işledi. ✓
- **Host kapasite CANLI**: diskTotalGb:91 diskFreeGb:55 ramFreeGb:9 runningPhones:3 — agent heartbeat DB'ye yazıyor (Faz 3 parça 3 kanıtı). ✓

═══════════════════════════════════════════════════
# DEPLOY DURUMU + TUZAKLAR
═══════════════════════════════════════════════════
- Sunucu `root@51.158.107.121` (scw-crazy-jones, git DEĞİL). Agent `/opt/agent.mjs` (systemd fleet-agent, StandardOutput=/var/log/fleet-agent.log). API/dash `/opt/fleet/apps/*`. Waydroid script'ler `/opt/fleet-agent/waydroid/*.sh`. DB=fleet (psql YOK, `node -e` Prisma ile sorgula ama HATA verirse Prisma devasa minified stack basar → sunucuya küçük .mjs yaz, öyle çalıştır).
- **Migration**: kolonlar/enum DB'de fiilen vardı ama `_prisma_migrations`'ta kayıt YOKTU. `npx prisma migrate deploy` idempotent guard'lar (IF NOT EXISTS + duplicate_object) sayesinde çakışmadan geçti + kaydı ekledi.
- **Test yöntemi**: PENDING job DB'ye yaz (Job.payload={deviceId,instance}, Job'da deviceId KOLONU YOK — payload'da), agent 1sn poll'da claim eder. mi5 metadata.instance='mi5'. Gerçek IP resolveLeaseIp ile .129 (script .112 tahmin eder, dnsmasq lease .129 verir).
- **KALAN**: Faz 3 kodu feat/cloud-phone-suite dalında hâlâ COMMIT'LENMEDİ (çalışan kopyada). Kullanıcı deploy+test istedi, commit istemedi. Dashboard UI (wake/sleep/reboot butonları) tarayıcıda görsel test EDİLMEDİ — job katmanı kanıtlandı, endpoint proxy'leri hash-eşleşmesiyle doğru.
