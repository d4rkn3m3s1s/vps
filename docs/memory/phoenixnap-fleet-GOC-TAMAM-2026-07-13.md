---
name: phoenixnap-fleet-goc-tamam-2026-07-13
description: "★★★Fleet stack phoenixNAP a1.c5'e GÖÇÜRÜLDÜ + TÜM SERVİSLER ÇALIŞIYOR 2026-07-13. Panel http://125.253.73.45 canlı, host ONLINE 80çekirdek. Erişim+servis+host bilgileri. SONRAKI: multi-instance ölçekleme.★★★"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0ce97b6f-23a2-4491-9478-d5dc4d5cc569
---

**★★★ Fleet stack phoenixNAP a1.c5.xlarge'e GÖÇÜRÜLDÜ — tüm servisler çalışıyor (2026-07-13) ★★★**

Kullanici "fleet'i bu sunucuya göçür, ölçekleme testine geç" dedi. Göç TAMAM. İlgili: [[phoenixnap-waydroid-KANITLANDI-2026-07-13]] (sunucu+waydroid), [[phoenixnap-arm-skus-2026-07-13]], [[prod-deploy-workflow-scaleway]] (prod deploy referansi).

## 🔑 ERİŞİM
- **SSH: `ssh -i C:/Users/furka/.ssh/phoenixnap_y -o IdentitiesOnly=yes ubuntu@125.253.73.45`** (root DEGIL=ubuntu, sudo parolasiz).
- **Panel: http://125.253.73.45** (Caddy :80). Login: admin@fleet.local (parola /opt/fleet/apps/api/.env ADMIN_PASSWORD).
- Prod (Scaleway 51.158.107.121) AYNEN DURUYOR — bu AYRI/YENİ fleet (temiz DB). İki fleet karışmaz.

## ✅ GÖÇ NE YAPILDI
- Zemin: Node **v22.23.1**(prod ile ayni)+Docker29+Caddy2.11 kuruldu.
- Kod: prod /opt/fleet → tar(node_modules/.next/dist HARİÇ, ~1.1MB) → phoenixNAP /opt/fleet. env dosyalari (secret) DOSYA olarak tasindi (ekrana basilmadan).
- agent.mjs(/opt/agent.mjs)+wd scriptleri(/opt/fleet-agent/waydroid/: wd-run/provision/proxy/binder/bringup/stop+net-head)+net-head.sh(/opt).
- DB/Redis: `docker run postgres:16-alpine`(db=fleet, parola API .env DATABASE_URL'den, volume fleet-pgdata)+`redis:7-alpine`. 127.0.0.1:5432/6379.
- `npm install`(879MB, sharp OK+prisma client OK)→`prisma migrate deploy`(TÜM migration temiz DB'ye, up-to-date)→`prisma generate`(★API tsc hatasi=eksik prisma tipleri, generate DÜZELTTİ)→API build(tsc temiz)+dashboard build(next, 135 sayfa).
- systemd: fleet-api(/opt/fleet/apps/api, npm start, :4000)+fleet-dashboard(:3000, npm start)+fleet-agent(EnvironmentFile=/opt/fleet-agent/agent.env, node /opt/agent.mjs, log /var/log/fleet-agent.log)+caddy(:80→/ws+/public=4000, else=3000).
- Caddyfile: `:80 { @ws path /ws/* reverse_proxy localhost:4000; @public path /public/* reverse_proxy localhost:4000; reverse_proxy localhost:3000 }`.

## ✅ CANLI DURUM (dogrulandi)
- API /health {"ok":true}. Stream hub attached. Login OK (JWT). 
- **Host: phoenixnap-a1c5 (id cmrjldxje000oazryfdeo5d48) ONLINE, cpuCores=80, loadAvg 0.59, heartbeat calisiyor.**
- Agent: "stream channel connected" (prod'daki baglaniyor sorunu YOK). agent.env: FLEET_API_URL=http://127.0.0.1:4000, FLEET_HOST_KEY=<agent key 37char>, FLEET_STREAM_JPEG=1, FLEET_SHARP_PATH=/opt/fleet/node_modules/sharp/lib/index.js, FLEET_MAIL_PROVIDER=catchmail. chmod 600.
- Workspace: Default Workspace (id cmrjlakjv0002azryq7uy1x89). Admin: admin@fleet.local.
- ★host agentKey SADECE create aninda doner → yakalayip agent.env'e yazdim (2. host olusturdum, ilkini sildim cmrjlda1m...).

## ⚠️ EKSİK/SONRAKİ
1. **Multi-instance ölçekleme (task #7):** wd-run.sh multi-instance(/opt/waydroid-mi2 python tree — prod'da vardi, buraya GELMEDI, tek-instance wd-hl-boot.sh var). net-head.sh + izole binder/dbus per-instance kur, 5/10/20 Waydroid kademeli boot, load/RAM olc.
   - ★prod wd-run.sh FLEET_WAYDROID_PY=/opt/waydroid-mi2 ister (multi-instance waydroid python). Bu tree GELMEDI → ya prod'dan getir ya tek-instance headless boot'u parametrize et.
   - Tek instance zaten boot etti (wd-hl-boot.sh, IP .240.112, [[phoenixnap-waydroid-KANITLANDI-2026-07-13]]).
2. Cihaz provision panelden test (PROVISION_DEVICE job → agent).
3. Kalici karar: LeaseWeb 128C/€403 vs phoenixNAP $1.09/sa. Pilot bitince phoenixNAP+IP SIL.

## FATURA UYARISI
$1.09/saat 7/24=~$785/ay. Pilot bitince makine+public IP allocation SIL (IP kullanilmasa bile ucret).
