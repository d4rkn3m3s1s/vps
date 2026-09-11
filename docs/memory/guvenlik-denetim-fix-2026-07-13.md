---
name: guvenlik-denetim-fix-2026-07-13
description: "★★★Güvenlik denetimi + 4 açık DÜZELTİLDİ + İKİ SUNUCUYA DEPLOY 2026-07-13 — getJob IDOR, agent claimNext cross-tenant (kök neden), proxy autoAssign IDOR, sendMedia SSRF. Kalan alanlar temiz.★★★"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0ce97b6f-23a2-4491-9478-d5dc4d5cc569
---

**★★★ Güvenlik denetimi (kapsamlı ajan taraması) + 4 açık DÜZELTİLDİ + phoenixNAP+prod DEPLOY (2026-07-13) ★★★**

Kullanıcı "güvenlik denetimi yap, açıkları düzelt" dedi. Ajan tüm API'yi taradı (routes→controller→service). İlgili: [[security-round-4]] (önceki turlar), [[phoenixnap-fleet-GOC-TAMAM-2026-07-13]].

## ✅ DÜZELTİLEN 4 AÇIK (tsc temiz, iki sunucuya deploy)
1. **[YÜKSEK] getJob IDOR** — jobs.service.ts:223 `findUnique({where:{id}})` workspace-scope YOK → foreign job payload/result (IG şifre, WA OTP+numara, çözülmüş proxy kimlik DÜZ METİN) sızıyordu (cuid id gerektiği için pratik bar yüksek). FIX: `getJob(id, workspaceId?)` → `findFirst({where:{id, workspaceId}})` + jobs.controller.ts:37 `getWorkspaceId(req)` geçir.
2. **[ORTA-KÖK NEDEN] agent claimNext cross-tenant** — agent.service.ts:52 job'ı sadece deviceId↔hostId eşliyordu, `job.workspaceId === device.workspaceId` KONTROL ETMİYORDU → cross-tenant job kurban cihazda çalışabilir. FIX: devices sorgusuna workspaceId ekle + `workspaceByDevice` map + claim döngüsünde `if(job.workspaceId && workspaceByDevice.get(deviceId)!==job.workspaceId) continue`. ★Bu tek nokta tüm cross-tenant-job sınıfını kapatır.
3. **[ORTA] proxy autoAssign IDOR** — proxy.service.ts:195 `findUnique({where:{id:deviceId}})` workspace-scope yok → foreign deviceId'ye EMULATOR_SET_PROXY yazılabilir. FIX: `findFirst({where:{id:deviceId, workspaceId}})`.
4. **[ŞÜPHELI→düzeltildi] sendMedia SSRF** — batch.service.ts:480 `mediaUrl` API sınırında doğrulanmıyordu (agent guard'a güveniyordu). FIX: `assertSafePublicUrl(input.mediaUrl)` çağır (urlGuard.ts DNS-çözümlü, private/loopback/link-local 169.254.169.254 bloklar). import eklendi.

## ✅ TEMİZ ÇIKAN ALANLAR (ajan doğruladı, açık YOK)
Public API workspace izolasyonu (requirePublicWorkspace her handler'da tutarlı), provision command-injection (execFile argv + katalog whitelist), agent HMAC imza+timing-safe, JWT doğrulama, secret-stripping (toPublic/present), assertSafePublicUrl webhook/calendar/files/notifications kapsıyor, POST /jobs cross-tenant guard (zaten vardı satır 63-66), workspace reset/delete admin+üyelik kontrollü.

## DEPLOY
5 dosya (4 fix + batch) → phoenixNAP(125.253.73.45) + prod(51.158.107.121). Her ikisinde npm run build(tsc temiz)+restart fleet-api(+agent prod'ta). DOĞRULANDI: dist'te workspaceByDevice/workspaceId derlendi, health OK, API temiz başladı.

## SONRAKİ (güvenlik iyileştirme, opsiyonel)
- agent.mjs (host tarafı) SSRF guard'ı DNS-çözecek şekilde güçlendir (API artık koruyor ama derinlik-savunma).
- Instagram/Telegram yeni özellikler eklendiğinde tekrar denetle.
- Rate-limit login brute-force (ajan "temiz" dedi ama izle).
