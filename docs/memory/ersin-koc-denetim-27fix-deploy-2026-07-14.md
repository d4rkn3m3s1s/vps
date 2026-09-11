---
name: ersin-koc-denetim-27fix-deploy-2026-07-14
description: ★★★Ersin Koç 18-eksenli denetim → 57 ham bulgu → 30 CONFIRMED (adversaryal doğrulama) → 27 DÜZELTİLDİ + migration + İKİ SUNUCU DEPLOY 2026-07-14. IDOR/race/secret/leak/perf hepsi. WrongStack+opendroid çıkarımları.★★★
metadata: 
  node_type: memory
  type: project
  originSessionId: 0ce97b6f-23a2-4491-9478-d5dc4d5cc569
---

**★★★ Ersin Koç 18-eksenli kod denetimi + 27 bulgu DÜZELTİLDİ + İKİ SUNUCU DEPLOY (2026-07-14) ★★★**

Kullanıcı Ersin Koç'un 18-eksenli denetim çerçevesini + wrongstack.com + opendroid'i incelet dedi. İlgili: [[guvenlik-denetim-fix-2026-07-13]] (önceki 4 fix), [[wrongstack-guvenlik-cikarimlari-2026-07-14]], [[phoenixnap-fleet-GOC-TAMAM-2026-07-13]].

## SÜREÇ (çok-ajanlı workflow, limit yenildi→ben sıralı bitirdim)
18-eksen paralel tara(7 ajan)→57 ham bulgu→adversaryal doğrula(38 ajan)→30 CONFIRMED/8 REJECTED→BEN sıralı düzelt+tsc+deploy. ★Workflow args STRING gelir→`typeof args==='string'?JSON.parse(args):args` ŞART. Doğrulama 8 yanlış-pozitif eledi (kod zaten koruyor).

## ✅ DÜZELTİLEN 27 BULGU (tsc temiz, iki sunucu deploy)
**Güvenlik/IDOR:** createDevice hostId(assertHostExists), clipboard/pullFile 3-handler(getDevice+404), snapshot clone hostId/groupId(findFirst workspace), errorHandler 401/403/429/5xx logla(brute-force iz), doc-key read-only(write kaldır).
**Race(advisory lock/atomik):** provision nextInstanceName(pg_advisory_xact_lock 424242+hashtext hostId, tx+createDevice tx-param), assertDeviceIdle TOCTOU(advisory lock 838383+tx), provideOperatorOtp(updateMany AWAITING_OTP→REGISTERING count===1), dispatchDue(updateMany SCHEDULED→POSTING claim), terminal-durum(complete updateMany status:RUNNING count===0→409 JOB_ALREADY_FINALIZED, reapStale claimedByHostId:null+koşullu), heartbeat(lastSeen ÖNCE+throw sonra accrue=çift-fatura önle), rollDayIfNeeded(async+await+updateMany dayAnchor guard).
**Kaynak/hata:** EMULATOR_PUSH_FILE tmp try/finally rm+basename, broadcast client.send try/catch, reapStale take:500.
**Perf/migration:** ★Job.deviceId first-class kolon+@@index([deviceId,status]) (payload JSON-path→indexli), claimNext DB-filter(deviceId IN deviceIds, açlık fix), analytics groupBy(byJobType DB'de), FarmActionLog @@index([deviceId,createdAt]).
**Consistency/leak:** provision smsGetNumber→hemen persist+catch smsCancel, autoRegisterWA account.create try/catch→release, startOperatorRegister regJob fail→account FAILED telafi, webhook enum WHATSAPP_SENT/FAILED ekle, public API AppError(MISSING_JOB_ID), complete() quiet() helper(logger.warn).
**Secret:** ★commit'li FLEET_API_KEY(f185cb2d)+FLEET_HOST_KEY(host_6bbbbf) 17 dosyada env-referans (repo'da 0 literal).

## ★MIGRATION: 20260714000000_job_deviceid_farm_index
Job.deviceId TEXT + backfill(payload->>'deviceId') + Job_deviceId_status_idx + FarmActionLog_deviceId_createdAt_idx. IF NOT EXISTS guardlı. İki sunucuda migrate deploy OK, DB'de kolon doğrulandı.

## ⚠️ KULLANICI YAPMALI (git geçmişinde key'ler DURUYOR)
1. FLEET_API_KEY (f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9) → panelden REVOKE+yeni üret.
2. FLEET_HOST_KEY (host_6bbbbfe1fd292aa80f2aa1b7ab1a0326) → host sil+yeniden kaydet.
(Kod temizlendi ama git commit geçmişinde hâlâ görünür.)

## DEPLOY DURUM
19 dosya+migration → tar --force-local(★C: tuzağı) → phoenixNAP(125.253.73.45)+prod(51.158.107.121). Her ikisinde migrate deploy+generate+build(tsc temiz)+restart api+agent. Job.deviceId DB'de + kod derlendi, health OK, active. Dashboard tsc de temiz.

## REJECTED (8 yanlış-pozitif, ele ALINMADI)
idx11(fail() zaten release), idx17(guard var), idx22(idempotency-key zaten gönderiliyor), idx23/26(var ama etki düşük), idx29(nüans), idx30(kod kasıtlı), idx35(fallback KASITLI apiClient).

## WrongStack+opendroid ÇIKARIMLARI (uygulanmadı, gelecek)
WrongStack: ★agent assertPublicUrl string-prefix IP→decimal/hex/IPv4-mapped BYPASS (node:net numeric parse+DNS resolve gerek, [[wrongstack-guvenlik-cikarimlari-2026-07-14]]). Env-strip host agent, fail-closed RPA allowlist. opendroid: WhatsApp resource-id fallback zinciri (com.whatsapp:id/entry/send), clickable-parent tırmanma, vision-LLM ekran-doğrulama.
