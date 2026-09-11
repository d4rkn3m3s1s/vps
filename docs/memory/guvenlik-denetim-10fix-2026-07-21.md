---
name: guvenlik-denetim-10fix-2026-07-21
description: ★★GÜVENLİK+MANTIK+ÖLÇEK DENETİMİ→10 FIX (2026-07-21, kullanıcı "başka bug/açık/hız"). 18-ajan tüm-modül denetim(proxy/WA dışı ilk kez: grants/snapshots/reports/social/alerts/fleet-health)→10 doğrulandı/3 çürütüldü. 4 HIGH GÜVENLİK: (1)grant-transfer RBAC-yok(viewer bile cihazı+credential-vault'u başka WS'e taşıyabiliyordu→requireAdmin+target-üyelik). (2)device WS-broadcast workspaceId-eksik→fail-open→cross-tenant sızıntı(4 event+hub fail-closed). (3+4)snapshot restore/clone guard sadece PRIVATE-blokluyordu WORKSPACE-geçiyordu→!==PUBLIC. MEDIUM: mesaj-retry-çift-gönderim(benim bug'ım, PENDING-only), CSV-truncate-flag, heartbeat-N+1(createMany+bounded), registerAnalytics-cap. LOW: social-oauth req.user→req.auth(connect TAMAMEN kırıktı), alert-threshold fail-closed. Hepsi tsc+build+restart+dist-doğrulandı.
metadata:
  node_type: memory
  type: reference
---

# ★★ GÜVENLİK+MANTIK+ÖLÇEK DENETİMİ → 10 FIX (2026-07-21) ★★

Kullanıcı "başka sorun/bug/kritik açık/hız iyileştirmesi var mı". Önce canlı-perf tarama:
Device seq-scan %99 AMA 28-satır→zararsız(index gereksiz), DeviceMetricPoint retention-var(7gün),
bellek-normal. ⇒ perf ŞU ÖLÇEKTE sağlıklı. Asıl değer KOD-seviyesi güvenlik+henüz-taranmamış-modüller.
18-ajan Workflow(5 lens: auth/IDOR + tenant/injection + mantık×2 + ölçek, adversarial). 13 ham→10 doğrulandı.
[[denetim-24bug-fix-2026-07-21]] önceki denetim(sadece proxy/WA). 

## 🟥 4 HIGH GÜVENLİK AÇIĞI
1. **grant.routes.ts:22 RBAC-YOK**: POST /grants/device/:id/transfer sadece requireApiKey+authenticateJwt→VIEWER(salt-okunur) bile cihazı+farm-hesabı+şifreli-credential-vault+TOTP'yi BAŞKA WORKSPACE'e kalıcı taşıyabiliyordu(exfiltration). FIX: requireAdmin(apikeys/system gibi) + grant.service.transfer'e target-workspace ÜYELİK kontrolü(workspaceMember.findFirst, değilse 403). userId controller'dan geçirildi.
2. **device.controller.ts (220/249/288/306) cross-tenant WS sızıntı**: 4 device event(created/quick/updated/deleted) deviceHub.broadcast'e workspaceId GEÇMİYORDU→hub filtresi `event.workspaceId && client.workspaceId && ...` FAIL-OPEN(event.workspaceId undefined→continue çalışmaz)→HER tenant'ın dashboard'una cihaz-detayı(name/IP/adbPort/hostId/fingerprint) sızıyordu. FIX: 4 broadcast'e `...(wsId?{workspaceId:wsId}:{})` + hub FAIL-CLOSED(`event.workspaceId && client.workspaceId !== event.workspaceId`→client.workspaceId set-olmasa da atla).
3+4. **snapshot.service.ts:92(restore)+168(clone) cross-tenant IDOR**: guard `visibility === 'PRIVATE'` SADECE private-blokluyordu→yabancı WORKSPACE-snapshot id-bilinirse restore/clone edilebiliyordu(listSnapshots göstermese de). FIX: `visibility !== 'PUBLIC'`(PRIVATE+WORKSPACE ikisini de cross-tenant blokla, sadece market-PUBLIC izinli).

## 🟡 3 MEDIUM
- **jobs.service.ts:345 mesaj-retry ÇİFT-GÖNDERİM**(★benim dayanıklılık-fix'imin yan-etkisi): reaper RUNNING-send'i(agent claim-etmiş, MID-SEND olabilir) retry ediyordu→aynı mesaj 2 kez. FIX: retry SADECE `job.status === 'PENDING'`(hiç-claim-edilmemiş güvenli). Detay [[dayaniklilik-3iyilestirme-2026-07-21]].
- **reports.service.ts:62 CSV sessiz-truncate**: take:5000→dashboard-sayımıyla çelişen eksik-CSV. FIX: CAP 50k + count() + `{rows,total,truncated}` döndür, controller `meta:{total,truncated}`(dashboard UI uyarabilir).
- **agent.service.ts:886 heartbeat N+1**: her-heartbeat 2×N seri(update+create)→500 cihazda 1000 round-trip. FIX: metrik-createMany(tek-sorgu) + device-update'ler bounded-paralel(25'lik chunk).

## 🟢 2 LOW
- **social.controller.ts:16,119 OAuth KIRIK**: `(req as any).user` okuyordu ama authenticateJwt `req.auth` set-ediyor→uid HEP undefined→connect/list HEP 401(OAuth tamamen çalışmıyordu). FIX: `req.auth?.userId`.
- **alerts.service.ts:102 threshold koşulsuz-tetikleme**: threshold>0 kural value-sayı-DEĞİLSE(`typeof===number` short-circuit) gate-atlanıp KOŞULSUZ tetikleniyordu(alert-spam). FIX: fail-closed(`threshold>0→ value-yok||value<threshold→continue`).

## 🔧 DEPLOY (hepsi CANLI 2026-07-21)
- 13 dosya(8 fix)→host+build(tsc temiz)+fleet-api restart(health 200). dist'te requireAdmin/fail-closed/PUBLIC-guard/PENDING-only/createMany/req.auth teyit. Yedekler *.bak.<ts>.

## ⚠️ 3 ÇÜRÜTÜLEN (yanlış-pozitif, adversarial-doğrulama eledi) + NOT
- Perf: Device seq-scan %99 ama 28-satır→index GEREKSİZ(100+ cihazda metadata->instance index'i düşünülebilir, şimdi değil). DeviceMetricPoint retention-var.
- HÂLÂ git commit edilmedi(bu 10-fix + önceki tüm iş).
