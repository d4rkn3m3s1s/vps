---
name: vision-instagram-envstrip-2026-07-14
description: ★★★Vision-LLM fallback (dump bozuk→Claude'a ekran-tanı) + TEK-TIK INSTAGRAM (servis+panel+hook, otonom email) + güvenlik (host agent env-strip secret sızıntısı + fail-closed RPA shell DENY) 2026-07-14. HER ÜÇ APP tsc TEMİZ, henüz DEPLOY EDİLMEDİ.★★★
metadata:
  node_type: memory
  type: project
  originSessionId: 0ce97b6f-23a2-4491-9478-d5dc4d5cc569
---

**★★★ Vision fallback + Tek-tık Instagram + Güvenlik (env-strip + fail-closed RPA) — 2026-07-14 ★★★**

Kullanıcı "hepsi ile" dedi (opendroid ③ vision + Instagram üretim + güvenlik). İlgili: [[ersin-koc-denetim-27fix-deploy-2026-07-14]], [[wrongstack-guvenlik-cikarimlari-2026-07-14]], [[RESUME-kaldigimiz-yer-2026-07-08]]. **UYARI: henüz DEPLOY EDİLMEDİ — kod yazıldı+tsc temiz, iki sunucuya scp+build+restart GEREKİYOR.**

## 1) VISION-LLM FALLBACK (opendroid ③ — bozuk uiautomator'ı aşar)
KÖK MİMARİ: agent zero-dep+key TUTMAZ → JPEG'i API'ye POST → API server-side Claude vision (key API'de, AI Device Agent pattern'i). Model=claude-opus-4-8 (vision+forced-tool `locate_target` koordinat döndürür).
- **API**: `ai.service.ts` `analyzeScreen(imageBase64,target,hint)` + `aiService.locateOnScreen`. `agent.controller.ts` `visionAnalyzeHandler` + schema (image≤1.5MB base64 JPEG). Route: `POST /agent/vision/analyze` (host-agent auth: requireApiKey+requireHostAgent+verifyAgentSignature).
- **Agent**: `visionLocate(serial,target,hint)` = grabPng+shrinkPng(720px)→/agent/vision/analyze→koordinat. `pngSize(png)` IHDR'dan gerçek genişlik okur → ölçek=origW/min(720,origW), vision koordinatını GERÇEK cihaz pikseline çevirir (720px→1080px ×1.5 DOĞRULANDI). sharp yoksa/API down→null (graceful degrade). `tapByOrVision`, IG `tapBy`/`typeInto`/`waitFor` vision-farkında (dump boşsa devreye girer). WA `waHelpers`: `tapVision`+`tapByV` eklendi; companion "Register new account" (mi7 kök-fix noktası) tapScaled'den ÖNCE vision denemesi eklendi.
- İzole test 4/4 GEÇTİ (pngSize+ölçek+küçük-cihaz+garbage). Gerçek-cihaz test BEKLİYOR (mi7 dump bozuk olduğu için ZATEN bu yüzden yapıldı).

## 2) TEK-TIK INSTAGRAM (WhatsApp'ın paraleli, ama OTONOM email)
IG OTP e-postadan (catchmail) OTOMATİK gelir → operatör-OTP adımı YOK.
- **Yeni dosya** `ig-register.service.ts`: IG_REGISTER_STEPS(14 adım: queued→launch→signup→email→code_wait→code→password→birthday→name→username→terms→done+wall), igRegisterService(reportProgress+getStatus+broadcast `instagram.register.progress`).
- **batch.service.ts** `startInstagramRegister(ws,deviceId,overrides?)`: kimlik+email(makeInbox seed)+şifre üret→GeneratedAccount(platform:instagram)→REGISTER_INSTAGRAM job→device meta igRegisterStatus/AccountId/Email/JobId. Job dispatch fail→account FAILED telafi.
- **Endpoint**: `POST /accounts/instagram/register` + `GET .../:id/status` (accounts.routes+batch.controller startInstagramRegisterHandler/igRegisterStatusHandler). Dashboard proxy: `/api/accounts/instagram/register[/[id]/status]`.
- **Panel**: `InstagramRegisterModal.tsx` (WA modal'ın uyarlaması; OTP kutusu YOK, `wall`=captcha/SMS turuncu uyarı). ProfilesView: IG state+startInstagram()+badge(igRegisterStatus)+buton(card-action-ig pembe)+onay modal+progress modal+IG_REGISTER_STEPS_CLIENT. ★lucide `Instagram` ikonu YOK→`Camera` kullan.
- **agent.service** completion hook REGISTER_INSTAGRAM: CREATED→ACTIVE, CAPTCHA_WALL/SMS_WALL→**AWAITING_MANUAL**(YENİ enum), diğer→FAILED + device meta temizle. Progress routing REGISTER_INSTAGRAM→igRegisterService.
- **agent.mjs** registerInstagram(serial,payload,**job**) imzası: igStep helper(reportProgress+shot 320px) akış boyunca 12 adım rapor. Dönüşlere igStep('wall'/'done').
- ★MIGRATION `20260714120000_ig_awaiting_manual`: `ALTER TYPE GeneratedAccountStatus ADD VALUE IF NOT EXISTS 'AWAITING_MANUAL'`. Prisma generate ŞART.

## 3) GÜVENLİK (WrongStack çıkarımları)
- **Env-strip (agent.mjs satır ~58)**: `stripSecretEnv()` — API_KEY/HOST_KEY sabitlere kopyalandıktan SONRA process.env'den SENSITIVE `/(KEY|SECRET|TOKEN|PASSWORD|PASSWD|BEARER|AUTH|COOKIE|CREDENTIAL|PRIVATE)/i` + HARD_DROP(FLEET_API_KEY,FLEET_HOST_KEY) SİL → adb shell/su -c/bash script child'lara sızmaz. PATH/HOME/ANDROID_*/FLEET_API_URL/FLEET_WAYDROID_PY KORUNUR (test 7-tut/7-sil PASS). ★FLEET_RPA_ALLOW_SHELL SHELL içerir ama pattern'de yok=korunur.
- **Fail-closed RPA**: (Katman1 API) ai.service ALLOWED'dan `shell` ÇIKARILDI + schema enum'dan shell+command silindi (LLM shell üretemez). (Katman2 agent) runRpaStep `shell` case→FLEET_RPA_ALLOW_SHELL!=='1' ise THROW (default DENY, operatör explicit açar). execAgentAction(AI device agent) ZATEN allowlist+default throw=güvenli.

## DURUM: 3 APP tsc/syntax TEMİZ. DEPLOY EDİLMEDİ.
SONRAKİ: (1)iki sunucuya deploy(scp+prisma migrate deploy+generate+build+restart api+agent, tar --force-local ★C: tuzağı) (2)mi7 uyandır→gerçek cihazda vision+IG tık-test (3)WA companion vision doğrula. Prod=51.158.107.121, phoenixNAP=125.253.73.45.
