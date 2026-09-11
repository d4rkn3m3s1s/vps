---
name: mega-tarama2-24bulgu-2026-07-16
description: ★★★2026-07-16 ÇOK-BÜYÜK proje-geneli tarama(47 ajan, 3.7M token): 24 yeni bulgu. 4 cross-tenant IDOR + 4 medium güvenlik DÜZELTİLDİ+DEPLOY+DOĞRULANDI. 4 sahte/gereksiz özellik SİLİNDİ. Panel iyice sadeleşti.★★★
metadata:
  node_type: memory
  type: project
  originSessionId: ecf6878b-cb13-4eb4-9c43-87a0f72a2804
---

**★★★ 2026-07-16 — ÇOK-BÜYÜK PROJE-GENELİ TARAMA + 24 BULGU FIX/SİL ★★★**

Kullanıcı: "çoklu ajanlarla çok çok çok daha büyük bak — gereksiz silinebilecek özellik/optimize/hatalı butonlar/gerçek-olmayan özellik/güvenlik/optimize hepsine bak, rapor+agresif temizle". 47-ajanlı workflow(scratchpad/mega2.mjs): güvenlik×7+sahte/buton×5+optimize/ölükod×4 finder + adversarial onay + sentez. 45 modül+43 sayfa+125 bileşen tarandı. İlgili: [[guvenlik-sahte-silme-2026-07-16]](önceki tur).

## ✅ 8 GÜVENLİK FIX (DEPLOY+DOĞRULANDI) — 4 CROSS-TENANT IDOR + 4 MEDIUM
Önceki taramaların KAÇIRDIĞI yeni açıklar:
1. **SMS request_id IDOR**(accounts.controller.ts smsOtp/smsCancelHandler) — ham request_id(sağlayıcı-global ardışık int)+paylaşımlı SMS_BUS key→başka tenant'ın WA/IG OTP'sini oku(hesap-devri)/numarasını iptal et. FIX: assertOwnsRequestId→GeneratedAccount.findFirst({smsRequestId, workspaceId}) yoksa 404.
2. **apks/install cross-tenant IDOR + fail-open**(apks.service.ts:43) — installBundledApk deviceIds doğrulamıyor, tek koruma claimNext workspace-guard=workspace-less token'da fail-open→kurbanın telefonuna keyfi APK. FIX: dispatch-anı ownership guard(device.findMany{id in, workspaceId} sayı uyuşmazsa 404).
3. **payload accountId IDOR**(jobs.controller.ts:62 + scheduler.service.ts create) — payload.accountId denetlenmiyor→saldırgan kendi cihazına REGISTER_WHATSAPP+payload.accountId=kurban→tamamlanınca kurbanın hesabı FAILED. FIX: iki giriş noktasında da GeneratedAccount.findFirst({id, workspaceId}) yoksa 404.
4. **auto-proxy plaintext şifre**(auto-proxy.ts:84 autoAttachCountryProxyByCountry) — decryptString→düz metin Job.payload→GET /jobs/:id ile workspace'teki herkes okur. FIX: passwordEnc(ciphertext)+materializePayload claim-anı çözer. (önceki turda startOperatorRegister düzeltildi ama BU fonksiyon atlanmıştı—WA/IG tek-tık SICAK yol).
5. **rol-yükseltme**(workspace.controller.ts:88) — operatör davetle admin atayabiliyordu(restrictInvites=off). FIX: memberRole==='admin' && callerRole!=='admin'→403.
6. **SMS rate-limit yok**(accounts.routes.ts:58 /sms/number) — paylaşımlı ücretli-numara bakiyesi boşaltılabilir(maliyet/DoS). FIX: heavyOperationRateLimiter eklendi.
7. **system/overview global sızıntı**(system.routes.ts:8) — sadece requireApiKey→platform-global sayım+host RAM. FIX: authenticateJwt+requireAdmin. ★DOĞRULANDI: apikey-only→401.
8. **saveMap fail-open**(device-agent.controller.ts:105) — `A&&B&&C` fail-open + deviceId ownership yok. FIX: fail-closed guard + device.findFirst({id, workspaceId}).

## ✅ 2 BOZUK-BUTON DÜZELTİLDİ(kullanıcı-etkili) — TEK BFF KÖPRÜSÜ
- **Gruplar cihaz Ekle/Çıkar + Profiller +etiket düzenleme**: PUT /api/devices/:id çağırıyorlardı ama BFF route SADECE PATCH+DELETE export→405→sessizce başarısız. FIX: app/api/devices/[id]/route.ts'e PUT export eklendi(updateDevice helper, PATCH+PUT ikisi de backend PUT'una). Backend deviceRouter.put zaten vardı. TEK köprü İKİ butonu birden düzeltti.

## ✅ 1 SAHTE-ÖZELLİK BACKEND DÜZELTİLDİ
- **Takvim sahte-POSTED**(calendar.service.ts:210) — akışsız+medyasız gönderi hiçbir iş yaratmadan 'Gönderildi'. FIX: flow yok VE mediaUrl yok→POSTED değil FAILED('RPA akışı veya medya gerekli').

## ✅ 4 SAHTE/GEREKSİZ ÖZELLİK SİLİNDİ(agresif temizle, DEPLOY)
1. **ProxiesView 'Varsayılan proxy modu' paneli** — localStorage-only sahte(hiçbir cihazı etkilemiyor). SİLİNDİ+HoloTabs sadeleşti(liste direkt render).
2. **ApplicationsView 'Ekip uygulamaları' sekmesi** — dekoratif boş(backend/prop yok). SİLİNDİ. Fleet-APK+custom-APK KORUNDU.
3. **Sidebar 'Free·1/2' plan kartı** — tamamen hardcoded yanıltıcı. SİLİNDİ(role state+fetch de temizlendi).
4. **Console+Groups no-op START/STOP** — agent EMULATOR_START/STOP'u no-op ack'liyor(Waydroid, docker değil). DÜZELTİLDİ: gerçek wake/sleep/reboot fan-out(POST /api/devices/:id/wake|sleep|reboot, ProfilesView deseni). Groups 'yeniden başlat' artık gerçekten reboot(eskiden yanlış START).

## ✅ EK DÜZELTMELER (kullanıcı "kalanlara da bak" + "provider'ları sil" — DEPLOY+DOĞRULANDI)
- **apks fail-open KÖK KAPATILDI**(jobs.controller.ts createJobHandler): device-hedefli job artık workspace-less token'ı reddediyor(`if(targetDeviceId && !workspaceId) throw WORKSPACE_REQUIRED 403`). Eskiden workspace-less token workspaceId=null job yaratıp claimNext guard'ını(kasıtlı-lax legacy job) atlayarak yabancı cihazda çalışabiliyordu. Bu apks+RPA+shell cross-tenant fail-open sınıfını kökten kapattı.
- **CLOUD-PROVIDERS KOMPLE SİLİNDİ**(kullanıcı: "gereksiz, kendi sunucumuzda/Waydroid yapıyoruz"). External-vendor(GeeLark/VMOS/SELF/DUOPLUS/UGPHONE) entegrasyonu: modules/cloud-providers/(adapters/geelark+vmos/registry/types) + dashboard sayfa+9 BFF route + CloudPhoneControlPanel.tsx + Sidebar nav+i18n + ProfileDetailView cloudProvider bloğu SİLİNDİ. Prisma: model CloudPhoneProvider + enum CloudProviderKind + Workspace.cloudProviders + Device.cloudProvider/cloudProviderId SİLİNDİ. Migration `20260715223607_drop_cloud_providers` DB'ye uygulandı. ★DOĞRULANDI: /cloud-providers→404, 5 cihaz ONLINE, her iki app tsc EXIT0. (CloudProviders 'Telefon oluştur' bozuk-buton bulgusu da otomatik çözüldü.) NOT: Device.externalId KORUNDU(inert). Waydroid/Farm DOKUNULMADI.

## ✅ 3 GÜVENLİ PERF FIX YAPILDI(DEPLOY+DOĞRULANDI) — kullanıcı "3 güvenli fix'i yap" onayı
6 perf bulgusu koddan doğrulandı, davranış-değiştirmeyen 3'ü uygulandı(diğer 3 ölçek-öncesi bırakıldı):
1. **heartbeat seri N-UPDATE→Promise.all**(agent.service.ts:658) — for-await döngüsü→Promise.all(affected.map), her cihaza farklı status/lastSeen(bulk imkansız) ama bağımsız→paralel. Davranış aynı. ★dist'te Promise.all=1 DOĞRULANDI.
2. **ProfilesView 5sn poll gereksiz re-render**(ProfilesView.tsx) — poll'de sameDeviceList(prev,next) fingerprint(id/status/name/ip/group/tags/provisionStatus/wa+igRegisterStatus) karşılaştır, değişmemişse setDevices(prev)→whole-grid re-render atlanır. document.hidden guard ZATEN vardı. (Kart inline+8 parent-closure'a bağlı→React.memo'ya çıkarmak yüksek-riskli refactor, YAPILMADI; bunun yerine düşük-riskli poll-shortcircuit.)
3. **WallView WallCell memo'suz**(WallView.tsx:208) — function WallCell→const WallCell=memo(function...). +NO_FOLLOWERS stabil boş sabit(non-leader cell'lere her render yeni []=memo bozardı, stream frame başına parent re-render var). ★dist memo=1 DOĞRULANDI.
BEKLETİLDİ(ölçek-öncesi, davranış-değiştiren): listDevices take'siz+decrypt(device.service.ts:31, sayfalama ister), getRegistrationShots 30-job JS-filter(batch.service.ts:279, accountId payload'da→kolon+migration ister). claimNext(agent.service.ts:44) ZATEN optimize(dar select+erken return null), dokunulmadı.

## ★ BONUS: cloud-providers silme deploy-ara 500'ü BU BUILD ile KAPANDI
Perf-deploy sırasında keşif: cloud-providers migration'ı Device.cloudProvider kolonunu düşürmüştü ama ESKİ dist heartbeat'te hâlâ o kolonu device.update ile yazıyordu→heartbeat 500(`column Device.cloudProvider does not exist`, requestId ab7ac861, 22:40=deploy-öncesi ara pencere)→cihaz durumu güncellenemiyordu. Bu build(yeni Prisma client+kod) o kolonu artık referans etmiyor→500 ÇÖZÜLDÜ. ★DOĞRULANDI: yeni dist+Prisma client cloudProvider=0, restart(23:09) sonrası 15sn canlı-izleme+log'da HİÇ 500 yok. DERS: DB-migration+kod-deploy arasında eski dist yeni-şemayla çakışabilir→migration'dan HEMEN sonra build+restart şart.

## DEPLOY YÖNTEMİ(bu tur)
Değişen dosyalar→tar→scp→sunucuda tar aç+API tsc+build+restart+dashboard build+restart. DOĞRULAMA: system/overview→401, BFF-PUT var, auto-proxy passwordEnc var, apks guard var, 3 servis active, 5 cihaz ONLINE. SSH phoenixnap_y ubuntu@125.253.73.45. Her iki app tsc EXIT0.
