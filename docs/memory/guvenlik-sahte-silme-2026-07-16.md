---
name: guvenlik-sahte-silme-2026-07-16
description: ★★★2026-07-15/16 MEGA İŞ: 6 güvenlik açığı DÜZELTİLDİ + 6 sahte özellik KOMPLE SİLİNDİ(UI+API+DB+migration) + OTP modal 4 senaryo + N+1/crash-guard autofix. HEPSİ DEPLOY+DOĞRULANDI. Panel sadeleşti, sadece gerçek özellikler kaldı.★★★
metadata:
  node_type: memory
  type: project
  originSessionId: ecf6878b-cb13-4eb4-9c43-87a0f72a2804
---

**★★★ 2026-07-15/16 — GÜVENLİK FIX + SAHTE ÖZELLİK SİLME (mega-audit sonrası) ★★★**

Kullanıcı: "hepsini düzeltelim, sahteleri komple sil (UI+API+DB+nav), karmaşık çok özellik olmasına gerek yok". Mega-audit(34 agent, 55 bulgu) + 2 keşif ajanı(sahte harita + güvenlik fix noktaları) + 1 uygulama ajanı(Prisma schema + dashboard). İlgili: [[bugun-2026-07-15-oturum2-audit-wa-recete-fixes]].

## ✅ 6 GÜVENLİK AÇIĞI DÜZELTİLDİ+DEPLOY+DOĞRULANDI
1. **Cross-tenant heartbeat IDOR**(device.routes.ts:53) — POST /devices/:id/heartbeat JWT'siz+scope'suz+ÖLÜ KOD(agent /agent/heartbeat kullanıyor). FIX: rota+handler(heartbeatDeviceHandler)+service(deviceService.heartbeat)+schema KOMPLE SİLİNDİ. ★DOĞRULANDI: /devices/x/heartbeat→404.
2. **Stream fail-open**(stream.hub.ts:243+setMirror:342+stream.controller.ts:17) — `A&&B&&A!==B` → token-ws VEYA device-ws null olunca kontrol atlanıyordu(workspace'siz token başka cihaza canlı DOKUNMA). FIX: `!device.workspaceId||!workspaceId||...!==` REJECT (3 nokta fail-closed).
3. **2FA bypass**(serviceAuth.ts:8) — isServiceAuth herhangi geçerli key'e true. FIX: sadece bootstrap key(`keyPrefix==='default'&&workspaceId===null&&userId===null&&scopes.includes('*')`). ★Dashboard apiClient DEFAULT_API_KEY=bootstrap→kırılmaz(doğrulandı).
4. **Webhook SSRF**(webhook.queue.ts:103) — teslimatta doğrulama yok. FIX: fetch öncesi `assertSafePublicUrl(hook.url)`+`redirect:'manual'`(DNS-rebinding+redirect koruması).
5. **cloud-providers SSRF**(cloud-providers.service.ts create:54/update:79) — baseUrl doğrulanmıyor. FIX: `assertSafePublicUrl(baseUrl)` create+update.
6. **PROVISION plaintext proxy şifresi**(provision.service.ts:288) — password:PROXY_PASS düz metin Job.payload'a. FIX: `passwordEnc:encryptString(PROXY_PASS)` + materializePayload NESTED proxy desteği(payload.proxy.passwordEnc de çözer). Proxy tablosuna proxy.passwordEnc as-is(zaten şifreli).

## ✅ 6 SAHTE ÖZELLİK KOMPLE SİLİNDİ (UI+API+DB+nav+migration) — DEPLOY+DOĞRULANDI(404)
- **FleetHub/geehub**(FAKE,APK'sız placeholder), **Otomasyon şablonları**(FAKE,hepsi EMULATOR_OPEN_APP=sadece app açıyor), **Referral**(BROKEN,Stripe'a kredi hiç gitmiyor), **Trendler**(BROKEN,writer null-ws/reader scoped→daima boş), **Library**(FAKE,sizeBytes hep 0,gerçek upload yok), **Usage+Costs**(BROKEN,Stripe usage-record hiç gitmiyor). 
- Silinen: dashboard sayfa+BFF+Sidebar nav+ikon+i18n key + API modül(referral/trends/library/usage/costs)+route mount + catalog templates/listings(catalog modülü KORUNDU—apps Profiles kullanıyor).
- **Prisma migration** `20260715120000_drop_fake_features`: 6 model(Referral/MetricSnapshot/DeviceUsage/LibraryAsset/AutomationTemplate/MarketplaceListing)+3 enum(ReferralStatus/LibraryAssetType/ListingCategory)+relation(User.referralCode/referrals, Workspace.libraryAssets/metricSnapshots, Device.usage) DROP IF EXISTS. DB'ye UYGULANDI.
- ★BAĞIMLILIK TEMİZLİĞİ(silmeden derlenmezdi): billing.service(REFERRAL_REWARD_RATE+convertReferral bloğu), users.service/controller(recordSignup+referralCode), index.ts(trends ticker), agent.service(usage accrue kaldır+lastSeen korundu). +4 GİZLİ bağımlılık schema silince çıktı: analytics.service(deviceUsage→onlineMinutes:0/topDevices:[]), files.service+controller(libraryAsset→URL-only), workspace.bootstrap(libraryAsset backfill), workspace.service(resetWorkspace deleteMany).

## ✅ KORUNAN GERÇEK ÖZELLİKLER (silme! keşif ajanı KANITLADI)
- **Farm**: SAHTE DEĞİL. recordOutcome doğru(processor.ts'ten beslenir), warmup/health/ban-risk GERÇEK, AI panel+index.ts tick+costs kullanıyor. Kullanıcı "sahte" sandı ama gerçek.
- **Synchronizer**: gerçek follower input mirror(stream.hub, wall ile ortak).
- **Applications**: Fleet-APK + custom-APK yükleme GERÇEK(korundu), sadece "store" sekmesi(APK'sız katalog kartları) kaldırıldı. AppCatalogItem+/catalog/apps KORUNDU(Profiles kullanıyor).

## ✅ OTP MODAL 4 SENARYO + AUTOFIX (DEPLOY)
- OTP modal: agent other-phone→`otp_wait`step+`OTP_WAIT`status+📲note(FAILED path'ten çıktı), API OTP_WAIT'te note→account.error, modal(WhatsappRegisterModal.tsx) otpNote'a göre SMS(mavi)/other-phone(mavi+açıklama)/rate-limit(turuncu) ayrımı.
- N+1×3: telegram /durum(groupBy), cloud syncPhones(findMany+Map), bulk setProxy(findMany+Map).
- crash-guard: webhook+notifications dispatch try/catch, index.ts process.on unhandledRejection/uncaughtException.
- scheduler: runDue take:200 + createJobRecord workspaceId. proxy passwordEnc.
- dashboard poll-guard(DEPLOY): NotificationCenter(/api/jobs 5sn)+WhatsappView(LIST 8sn/THREAD 5sn) interval'lerine `document.hidden` guard(arka plan sekmede poll durur).
- ★FINAL DOĞRULAMA: 3 servis(api/dashboard/agent) active, API health OK, DB sorgu OK, 5/9 cihaz ONLINE. HER İKİ APP tsc EXIT0.

## ✅ DERİN ADVERSARIAL DOĞRULAMA (21 ajan, 1.2M token) + 8 DÜZELTME (DEPLOY)
Yaptığım işi çok-ajanlı doğrulattım(scratchpad/verify-audit.mjs): güvenlik×4+sahte×3+regresyon×2 denetim, her bulgu adversarial onay. SONUÇ: çekirdek SAĞLAM(5/6 güvenlik fix+6 sahte silme+N+1/crash-guard temiz doğrulandı) ama 8 gerçek sorun onaylandı+DÜZELTİLDİ+DEPLOY:
1. 🔴cloud-providers RUNTIME SSRF EKSİKTİ: save-time guard var ama adapter(geelark:120/vmos:93) baseUrl'i her fetch'te guard'sız çağırıyordu(DNS-rebinding açık). FIX: geelark+vmos call()'a `assertSafePublicUrl(${this.base}${path})` eklendi(import ../../../lib/urlGuard).
2. 🟠uncaughtException handler REGRESYON: log-and-continue process'i bozuk state'te tutuyordu(systemd temiz-restart bozuldu). FIX: index.ts handler'a log+`process.exit(1)`(Node undefined-state→temiz restart). unhandledRejection dalı log-only KALDI(fire-and-forget için doğru).
3. 🟠BillingView dangling /api/usage fetch: silinen endpoint'e 404, panel ölü. FIX: usage state+fetch+Usage tipi+Tahmini-maliyet-HoloStat+UsageMeterPanel(198-263 sed) kaldırıldı. billing.usage(device/member sayısı=GERÇEK) KORUNDU.
4. 🟡OTP modal regex: `/bekle/` normal SMS "bekleniyor"a takılıp yanlış rate-limit talimatı. FIX: rate-limit'e-özgü kalıp(`\d+\s*(saat|hours?|dakika)|Send SMS in|kısıtl|too many|geçici bekle`).
5. 🟡Analytics onlineMinutes=0 yanıltıcı "Çevrimiçi süre(14g)" tile kaldırıldı(page.tsx). service onlineMinutes:0 döner ama gösterilmiyor.
6. 🟢agent 2 rate-limit dalı(switch_rate_limited:1646+bothLocked:1756) curStep='otp_wait'+waProgress emit etmiyordu→modal OTP kutusu açılmayabilir. FIX: curStep='otp_wait'+waProgress+done('otp_wait',...).
7. 🟢DeviceHeartbeatInput ölü tip(device.types.ts:36) silindi.
★FINAL: 8 fix tsc-clean(API+dash EXIT0)+DEPLOY+doğrulandı(process.exit var, adapter assertSafePublicUrl var, 3 servis active, 5 cihaz ONLINE).

## 🔴 KALAN
- **Instagram tek-tık**: IG APK repo'da bundled DEĞİL(pkgFor'da instagram.apk yok). registerInstagram(agent.mjs:562) IG-install mantığı eksik→IG APK bundle(instagram.apk 141MB APKPure 438)+pkgFor'a ekle+registerInstagram install bloğu+akış test.
- WhatsApp ACTIVE: temiz numara+cihaz hazır, +90531(1saat SMS-blok)/+359(bugün çok denendi geçici blok). Reçete KUSURSUZ kanıtlandı(temiz2 SMS OTP'ye ulaştı).
- Kalan safe-autofix(dashboard memo/poll-guard) opsiyonel.

## DEPLOY YÖNTEMİ (bu oturum, 79 dosya)
git status→değişen+yeni tar(migrations dahil)+silinecek liste txt→scp→sunucuda tar aç+rm silinenleri+rm boş dizinler+prisma generate+tsc+`prisma migrate deploy`+build+restart. DOĞRULAMA: silinen route→404, korunan→401, DB sorgu OK, cihaz ONLINE. Repo git DEĞİL(prod). SSH phoenixnap_y ubuntu@125.253.73.45.
