---
name: public-api-denetim-2026-07-17
description: "2026-07-17 — WhatsApp Public API 4-ajan denetimi. API güvenlik açısından SAĞLAM(workspace-izolasyon/scope/injection/SSRF tam). 4 kod hatası düzeltildi+deploy(OTP-sızıntı, 500→404, broadcast-şekil, offline-check). 2 yeni endpoint(GET /jobs/:id, POST verify-method). docs+openapi düzeltildi. Kalan geliştirmeler(webhook events, idempotency, bulk) yapılmadı."
metadata: 
  node_type: memory
  type: project
  originSessionId: 65c2d856-7523-44ea-8873-91d6208f24be
---

# WhatsApp Public API denetimi (2026-07-17)

4 paralel ajan (güvenlik + correctness + doküman-uyum + optimizasyon) ile denetlendi. [[RESUME-kaldigimiz-yer-2026-07-17]].

## Genel: API GÜVENLİK açısından SAĞLAM
workspace-bound flk_ key(sha256-hash, revoke anında), workspace izolasyonu KUSURSUZ(IDOR yok — her deviceId/accountId/jobId `findFirst{id,workspaceId}`), scope(read/write/admin) tam, injection yok(execFile argv+shArg), SSRF korumalı(mediaUrl private-IP block), rate-limit(heavy=20/dk key-başına). 24 endpoint hepsi dokümante.

## ✅ DÜZELTİLEN 4 KOD HATASI (deploy edildi, /opt/fleet API build+restart)
1. **★H-1 güvenlik**: `/register/:id/otp` yanıtı `toPublic()` döndürüyordu→decrypt OTP+telefon SIZIYORDU(external boundary). FIX: `{id,status,phoneNumber}` projekte(public.controller.ts).
2. **BULGU 1**: `wa-register.service.ts:162` `getStatus` ham `Error`→500(polling'de patlıyordu). FIX: `AppError 404 ACCOUNT_NOT_FOUND`.
3. **BULGU 4**: broadcast kod `{id,total}` ama doküman `{broadcastId,queued}`→istemci undefined. FIX: controller `{broadcastId:id, queued:total}` projekte(doküman DOĞRU kaldı).
4. **BULGU 5**: `provideOperatorOtp`+`provideVerifyMethod` offline cihazda 6dk asılı. FIX: `assertDeviceReady` eklendi→anında 409.

## ✅ 2 YENİ ENDPOINT (deploy, 401 doğrulandı=canlı)
- **GET /v1/jobs/:jobId**: en büyük DX açığı — her async endpoint {jobId} döndürüyordu ama okuma yolu YOKTU(mynumber/blocklist sonuçları erişilemezdi). Workspace-scoped getJob, payload'ı DÖNMEZ(secret güvenliği), `{id,type,status,result,error,timestamps}`.
- **POST /v1/whatsapp/register/:id/verify-method**: yöntem seçimi(sms/voice/missed_call) Public API'ye(panel paritesi). provideVerifyMethod servisi zaten vardı.

## ✅ DOKÜMAN + OPENAPI (ajan, doğrulandı)
docs/whatsapp-api.md 7 düzeltme(proxyAssigned proxyId-kaldır, webhook payload from/text/ts, X-Fleet-Signature HMAC header'ları, eksik hata kodları, rate-limit netleştir, 2 yeni endpoint). docs/openapi.yaml: eksik 7 endpoint + 6 şema(components/schemas yoktu→eklendi). js-yaml parse OK.

## ✅ SONRADAN YAPILDI+DEPLOY (oturum 2. yarısı)
- **webhook-events** ✅: WHATSAPP_AWAITING_OTP/REGISTERED/REGISTER_FAILED + DEVICE_PROVISIONED. Enum(schema.prisma)+migration(20260718000000, idempotent ADD VALUE)+dispatch(agent.service.ts complete: nextStatus→event; provision COMPLETED→DEVICE_PROVISIONED). Register/provision artık poll-only DEĞİL.
- **GET /v1/me** ✅: {workspaceId, keyId, label, scopes, deviceCount}.
- **POST /v1/whatsapp/send/bulk** ✅: {messages:[{deviceId,to,message}]} max 100→[{jobId,status}|{error}], heavyOperationRateLimiter.

## 🟡 HÂLÂ YAPILMAYAN (sonraki oturum)
- **Idempotency-Key**: retry'da duplicate mesaj/kayıt. createJobRecord choke-point.
- Panel'de olup API'de yok(hepsi S efor, servis workspace-guarded): mark-read, conversations/bulk, canned-replies, contact-info/avatar-read, device wake/sleep/reboot, webhook self-mgmt.
- **efficiency**: listDevices pagination YOK(tüm cihazlar), messages cursor yok(sadece limit).
- **hepsi DEPLOY ama CANLI doğrulanmadı**(webhook tetiklenmedi, /me+bulk 401=route-var ama gerçek key'le test edilmedi).
