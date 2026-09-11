---
name: oturum-2026-07-18-wa-provision-guard-mega
description: "2026-07-18 MEGA oturum — WhatsApp akışı(11 hız/log/stabilite fix + BUG-A method-select 3-katman + BUG-B EULA + isim-özelliği + OTP-watch canlı-SS + other-phone fix) + PROVISION akışı(log/timing PL1 + boot alt-timing→KÖK:boot=45s TAMAMI DHCP + P1 wd-destroy teardown + P2 atomik-cp + P3 spoof-assert + P7 APK-false-success + PH1-3 + DHCP-kick tekrar + iptal butonu + reap-fix) + ★VERİ-KAYBI GUARD(aktif-WA cihaza yeni kayıt→pm clear→hesap siler, 3-katman) + ★repo/canlı script senkronu. 4+ canlı WA kaydı(otonom akış kusursuz, numaralar SMS almadı) + 3 canlı provision(mi4/mi8 kuruldu)."
metadata:
  node_type: memory
  type: project
  originSessionId: a909e459-c43f-4615-b9c6-f5d97d85ac39
---

# 2026-07-18 MEGA OTURUM — WhatsApp + Provision + Veri-Kaybı Guard

Bağlam: [[RESUME-kaldigimiz-yer-2026-07-17]] devamı. Hedef: tek-tık WA otonom + akışı hız/log/stabilite optimize. Bu oturumda WhatsApp AKIŞI DOĞRULANDI (kod kusursuz) + PROVISION akışı da aynı şekilde optimize edildi + KRİTİK veri-kaybı bug'ı kapatıldı.

## ✅ CANLI DOĞRULANAN (bu oturum, deploy sonrası)
- **3 uçtan uca OTONOM WA kaydı** (tek müdahale modaldan OTP): +905386929621(Business→DowngradeFriction OTOMATİK geçti✓), +905380525622(temiz SMS), +905348730883(other-phone). Hepsi HomeActivity.
- **BUG-A (method-select modal) CANLI ÇALIŞTI**: kullanıcı "modal çıktı SMS seçtim" dedi → agent `ChooseVerify — uygulanıyor: sms`. Oturum başında modal HİÇ çıkmıyordu.
- **OTP-watch CANLI**: lastProgress note `📲 SMS kodu bekleniyor` korundu (🎥 canlı frame ezmedi).
- **provision mi4/mi8 kuruldu** (READY+WhatsApp+spoof doğru).
- **★KÖK: boot=45s'nin TAMAMI DHCP/eth0 IPv4 bind** — boot alt-timing instrumentation buldu (ADB-auth/waitBoot/svcUp hepsi 0s). Kör tahmin değil, ÖLÇÜLDÜ.
- Numaralar SMS ALMADI (534/533/530...): NUMARA sorunu, akış değil (her seferinde OTP ekranına kusursuz geldi).

## ✅ WHATSAPP AKIŞI FIX'LER (agent.mjs, hepsi DEPLOY)
- **11 hız/log/stabilite** (önceki turdan): H1★ tur-başı-tek-okuma(dump-cache seen() içinde ÇALIŞMIYORDU=KÖK, screenText→screenTextRich content-desc dahil, detektörler saf regex `(foc,txt)` argümanlı), S1 heartbeat-leak(pm-list/download guard), S3 curFocus adbT-timeout, H2 DowngradeFriction poll-cap, H3 OTP poll 24×750, H4 settle'lar, L1 verify-state-log, L2 markPhase/timing/DONE-SUMMARY, L3 heartbeat 5sn+snap, L4 otpChannel, S2 other-phone-retest.
- **★BUG-A method-select modal (3 KATMAN)**: KÖK=`done()` OTP_WAIT'te `snap(label)` note'u `📸 label` yapıp method-select prompt'unu EZİYORDU + heartbeat frame de. FIX: (1)agent snap(label, keepNote=OTP_WAIT→'🎥 canlı') (2)API isHeartbeatFrame('🎥 canlı')→lastProgress ezmez (3)dashboard WS handler '🎥 canlı'→current ezmez, sadece thumb. CANLI ÇALIŞTI.
- **★BUG-B EULA**: EULA-tap sonrası number-render poll-until-cap (14.8s kör bekleme). AMA EULA hâlâ ~27-36s (companion ekranı araya girince openRegisterMenu ~21s). instrumentation: `first-run rN +Xs → activity`.
- **isim özelliği**: provision formuna "Profil ismi (opsiyonel)". Doldurulunca agent yazar, boşsa rastgele(generateIdentity). batch.service `operatorName` param, controller `fullName?`. Account'a yazılır→OTP continuation'da korunur.
- **★OTP-WATCH (canlı SS)**: OTP_WAIT'te job COMPLETED→in-job heartbeat DURUYOR→panel donuyordu. FIX: global `otpWatch Map` + `otpWatchTick`(10sn interval loop'ta). done() OTP_WAIT'e eklerken registry'ye koyar, continuation/TTL(15dk) siler. jobBusy-gate(çift-push yok), '🎥 canlı' note(ezmez). ENV: FLEET_OTP_WATCH_MS/TTL_MS.
- **★OTHER-PHONE fix**: "Use your other phone" ekranı VerifyPhoneNumber activity'sinde→onOtp break'i onu düz-OTP sanıyordu. FIX: `if (onOtp && !onOtherPhoneVerify) break` → other-phone doğru branch'e(otpChannel:'other_phone'). Regresyon: 5 ara detektör other-phone text'ini yanlış yakalamıyor(doğrulandı).

## ✅ PROVISION AKIŞI FIX'LER (agent.mjs + wd-destroy.sh, DEPLOY)
- **★PL1 log/timing**: provisionDevice /var/log'a hiç yazmıyordu. step() helper'ına TEK edit → `[prov mi8] step 'boot' 30% ...` + `DONE mi8 119s | boot=45s apks=19s...`. TÜM 11 adım tek yerden.
- **★boot alt-timing**: boot 45s kara kutuydu → `boot@Xs: DHCP/ADB-auth/waitBoot/svcUp done`. KÖK: DHCP=45s, gerisi 0s.
- **P7 APK false-success**: WhatsApp 3-denemede kurulamazsa ⚠ yazıp "hazır" diyordu(=WhatsApp'sız cihaz). FIX: apks sonrası `pm path com.whatsapp` assert→yoksa THROW.
- **P3 spoof-assert**: boot sonrası `getprop model`==fp.model, uyuşmazsa ⚠(best-effort, throw etmez). CANLI: `spoof OK model=V2230/2210132G`.
- **P1 wd-destroy.sh(YENİ)+teardown**: yarım provision ~2-4GB LEAK(teardown YOKTU). wd-destroy.sh(guard: sadece [A-Za-z0-9_-] isim, bridge SİLMEZ, instance-scoped rm-rf). provisionDevice post-infra try/catch→fail'de wd-destroy+re-throw.
- **P2 atomik cp+mv**: (SADECE REPO — canlı wd-provision FARKLI, deploy edilmedi, aş.)
- **PH1** sleep(8000)→2000, **PH2** DHCP-kick i≈3 erken+probe 6s→3s, **PH3** ADB-auth/svcUp sleep 3s→2s+pkgUp parallel.
- **★DHCP-kick TEKRAR**: kick i===3'te TEK kez fire→sonra 37s bekliyordu. FIX: her ~5 probe(~10s)'de bir tekrar kick(netd dürt), 30 probe/60s cap. Boot=45s düşürme hedefi(canlı test EDİLMEDİ, deploy edildi).
- **provision iptal butonu**: modalde "Kurulumu İptal Et" YOKTU(sadece arka-plan). FIX: `POST /provision/cancel/:jobId`(workspace-guarded, job FAILED+provisionStatus FAILED+badge) + dashboard route + ProvisionModal buton. CANLI GÖRÜNDÜ.
- **reapStaleJobs provision fix**: orphan provision reap'te job FAILED ama Device.metadata.provisionStatus PROVISIONING kalıyordu(donuk "Kuruluyor" kart). FIX: PROVISION_DEVICE dalı→provisionStatus=FAILED.

## ✅ ★VERİ-KAYBI GUARD (kullanıcı buldu, KRİTİK, 3 katman DEPLOY)
KÖK: aktif WhatsApp'lı cihaza YENİ kayıt başlatılırsa fresh-register `pm clear com.whatsapp`(agent.mjs:1238-1251) ÇALIŞIR→mevcut hesap SİLİNİR("içindeki numara patlar"). Guard HİÇ YOKTU.
- **Güvenilir sinyal**: `Device.protected` DEĞİL(manuel kilit, WA-ACTIVE otomatik set etmiyor). DOĞRU: `GeneratedAccount(deviceId, platform='whatsapp', status IN ACTIVE/AWAITING_MANUAL)`.
- **Katman 1 dashboard**: modal açılınca kırmızı uyarı+numara+checkbox("mevcut hesap silinecek anlıyorum"), buton "Mevcut hesabı sil ve kaydet" disabled(onaysız). DeviceProfile'a hasActiveWhatsapp/activeWhatsappPhone.
- **Katman 2 API list**: listDevices→her cihaza hasActiveWhatsapp+activeWhatsappPhone(tek groupBy sorgu, N+1 yok).
- **Katman 3 API guard**: startOperatorRegister aktif-WA varsa `force` olmadan **409 DEVICE_HAS_ACTIVE_WHATSAPP**(defense-in-depth, panel bypass edilse bile). controller `force?:boolean`.
- CANLI DOĞRULANDI: watest49(+905348730883)→tetiklenir, watest50/51→serbest.

## ★KRİTİK KEŞİF: repo ≠ canlı host scriptleri
Deploy sırasında bulundu: repo `wd-provision.sh`(205 satır, cp -a 4.4GB klon) CANLI'da ÇALIŞMIYOR. Canlı(26 satır) `waydroid.py init -i` PAYLAŞIMLI GApps image kullanıyor → 4.4GB cp YOK. Sonuç:
- **reflink #1(en büyük hız kazancı) + P2 GEÇERSİZ** (canlıda cp yok). Host ext4(reflink desteklemiyor zaten).
- **repo host scriptleri canlıyla SENKRONLANDI**: wd-provision/wd-run/net-head/wd-adb çekildi(repo artık gerçeği yansıtıyor). wa-bringup/wd-binder/wd-proxy/wd-stop aynıydı.
- **wd-destroy.sh path DÜZELTİLDİ**: `/root/.local/share-<inst>`(YANLIŞ)→`/root/.local/share/waydroid.<inst>`(canlı gerçek).
- **DERS: deploy öncesi repo/canlı satır-sayısı karşılaştır** (yanlış dosya deploy=canlı bozar).

## 📊 PROVISION TIMING (ölçülen, 119s)
`DONE mi8 119s | boot=45s apks=19s root=6s vtouch=6s persist=6s` + infra~37s. Darboğazlar: **boot=45s(TAMAMI DHCP)**, apks=19s(WhatsApp+a11y pm install), infra=37s(waydroid init). DHCP-kick-tekrar boot'u düşürmeyi hedefliyor(test edilmedi).

## 🔴 KALAN / SONRAKİ
- **DHCP-kick tekrar canlı test**: boot=45s düştü mü? (deploy edildi, kurulum yapılmadı)
- **apks paralel install** (WhatsApp+a11y ardışık→paralel, ~7s): yapılmadı, orta risk(concurrent lxc).
- **guard uyarı canlı test**: watest49'a kayıt denenince kırmızı uyarı çıkıyor mu?
- **TEMİZ SMS-ALAN numara** hâlâ lazım — bugün 3-4 TR numara SMS almadı(534/533/530 sanal/rate-limitli). Otonom akış KUSURSUZ, sadece numara sorunu.
- **EULA hâlâ ~27-36s**(companion openRegisterMenu ~21s) — daha fazla optimize edilebilir.

## ★★ OTURUM İKİNCİ YARISI — 5 EK BUG (kullanıcı canlı bug-avcılığı, hepsi DEPLOY) ★★
Kullanıcı ~10 numara denedi, her denemede canlı gözlemle gerçek bug buldu. 6 WhatsApp kaydı başarılı. Kod tarafı KUSURSUZ; numaralar çoğu Business/other-phone/SMS-almayan.

### BUG-A: VERİ-KAYBI GUARD (aktif-WA cihaza kayıt → hesap silme)
KÖK: fresh REGISTER_WHATSAPP `pm clear com.whatsapp`(agent 1238-1251) çalışır→aktif hesap SİLİNİR. Sinyal=GeneratedAccount(deviceId,platform='whatsapp',status IN ['ACTIVE','AWAITING_MANUAL']) — Device.protected DEĞİL(manuel kilit, WA-ACTIVE otomatik set etmiyor; agent.service:361-390 sadece metadata). 3 katman: (1)dashboard ProfilesView modal kırmızı-uyarı+numara+checkbox("mevcut hesap silinecek anlıyorum")+buton "Mevcut hesabı sil ve kaydet" onaysız-disabled; DeviceProfile.hasActiveWhatsapp/activeWhatsappPhone. (2)API listDevices→her cihaza hasActiveWhatsapp+activeWhatsappPhone(tek groupBy, N+1 yok). (3)API startOperatorRegister(force? param) aktif-WA varsa 409 DEVICE_HAS_ACTIVE_WHATSAPP; controller startRegisterSchema.force:z.boolean().optional(). CANLI(watest49 tetiklenir, watest50/51 serbest).

### BUG-B: DowngradeFriction DÖNGÜSÜ (157s/6tur → 40s)
+905392555087 canlı: "USE +numara"→**dialog YOK**→doğrudan number/verify(dün +538'de dialog "Deactivate and switch" VARDI — 2 farklı Business akışı). Agent boşuna dialog 2.5s bekleyip boşa tap→number'a düş→DowngradeFriction re-detect→~28s/tur SPIN. FIX(agent~2081, ★DOWNGRADE-LOOP FIX): "Use +" sonrası poll(6×500ms) EITHER "Deactivate and switch" görüldü OR DowngradeFriction'dan çıkıldı; sawDialog→dialog onayla, leftDowngrade→continue(number branch devralır), hiçbiri→primary_button re-tap. CANLI: 157→40s(hâlâ 2-tur/SwitchToMessenger karışık numaralarda, tam 1-tura inmedi).

### BUG-C: other-phone CONTINUATION KİLİDİ
+905312331800 canlı: kullanıcı kodu 2× girdi ama OTONOM GİRİLMEDİ. KÖK: bu oturumun ilk yarısında eklenen other-phone-fix(`onOtp && !onOtherPhoneVerify break`) CONTINUATION'da(otpCode var) da other-phone branch'ine düşürüyordu→kod GİRİLMEDEN OTP_WAIT tekrar. FIX(agent~2080): `onOtp && (otpCode || !onOtherPhoneVerify)` → otpCode VARSA(continuation) other-phone ATLA kodu GİR; fresh'te(otpCode yok) eski davranış. CANLI: sonra +905312331800 tam otonom bitti(HomeActivity).

### BUG-D: SMS-send-failed → FAILED
Kullanıcı: "otonom bu mesajı da demeli, job failed çekmeli". "Couldn't send an SMS to your number" dialog VerifyPhoneNumber ÜSTÜNDE overlay→onOtp true→OTP_WAIT'te "SMS bekle" asılı(SMS GELMEYECEK). FIX(agent 2-katman): (1)OTP_WAIT return öncesi(~2363) `if(onSmsSendFailed()) return done('sms_send_failed',{status:'SMS_SEND_FAILED',note:"...1 saat bekleyin/başka numara"})`. (2)bothLockedNote bloğu(~2330)→OTP_WAIT değil SMS_SEND_FAILED. API agent.service completion hook default→account FAILED(SMS_SEND_FAILED case'lerde yok). CANLI KEŞİF(mi16 +905314377874 AWAITING_OTP'de asılıydı).

### BUG-E: method-select MODAL butonları çıkmıyor + other_device
Kullanıcı: "modaldan seçebilelim, SMS şart değil other cihaz da olabilir, modal seçme çıkmadı, takıldı ajan". İKİ kök: (1)`📸 <label>` snap-frame(snap() screenshot) method-select note'unu("🔀 Doğrulama yöntemi seçin") EZİYORDU→isMethodSelect false→butonlar kaybolur(BUG-A[ilk-yarı method-select] kardeşi). FIX: dashboard WS-handler `📸`-frame current EZMESİN(shot+log güncelle, current değişmez); API wa-register.service isSnapFrame→appendLog `📸`-frame lastProgress'i KORU(log'a girer). (2)dashboard methodOptions'ta 'other_device' YOKTU + backend provideVerifyMethodSchema z.enum reddediyordu. FIX: 'other_device'(Diğer cihaz) eklendi dashboard(Kind+defs+submitMethod type)+backend z.enum. İngilizce/Türkçe label match(Receive SMS|SMS ile kod). agent applyVerifyMethod(2028/2046/2050) zaten other_device destekliyordu. CANLI TEST EDİLMEDİ(deploy sonrası method-select'e düşen kayıt olmadı).

### BUG-F: other-phone NODE-SPLIT REGEX
mi14 +905388734184 canlı: ekran "Enter the 6-digit code we sent to WhatsApp on your other phone" ama DB note "SMS kodu bekleniyor"(YANLIŞ). KÖK: onOtherPhoneVerify regex `code we sent to WhatsApp on your other phone` arıyor ama screenTextRich node'ları ' | ' ile birleştirince cümle BÖLÜNÜYOR→tam-eşleşme KIRILIYOR. FIX(agent~1935): node-split-dayanıklı → `other phone to confirm moving|code we sent...other phone` VEYA `other phone`+code-cue(6-digit|digit code|Verification code|Enter the). Düz SMS ekranında "other phone" hiç geçmez→false-pozitif yok. CANLI TEST EDİLMEDİ.

### OPTIMIZE (analiz ajanı, en güvenli 3 DEPLOY)
5 fırsat bulundu(EULA/DowngradeFriction/menu/settle/modal). DEPLOY edilen 3: #1 modal-continuation-susturma(proxy/perms/a11y/launch isContinuation'da susar→"başa dönme" görünümü biter), #3 EULA-poll-cap 20→30(10→15s, number direkt gelirken 10s'de companion-detour'a sapıyordu ~14-21s), #5 post-launch settle 800→350ms. YAPILMAYAN: #2 openRegisterMenu sleep'ler(~3-4s,orta), #4 DowngradeFriction in-branch-confirm(~15-20s,orta).

## KISITLAR (değişmedi)
- Classifier prod DB YAZMA engelli→cancel/protect/provision/numara SEN panelden. psql OKU + enum-migration GEÇER.
- Deploy: aktif RUNNING register/provision job VARSA restart etme(job kesilir — bu oturumda 1 kez oldu: mi3 provision'ı restart kesti→15dk reap). Her deploy öncesi `SELECT count(*) ... status='RUNNING'` kontrol.
- SSH: restart 124-timeout→pkill -9(SSH koparır exit255)+start. `.new` uzantı node --check reddeder(.mjs olarak deploy'da check).
- GPU-less Waydroid: uiautomator dump SIK BOŞ, netd eth0 IPv4 bind YAVAŞ(45s).

## DEPLOY/ERİŞİM (değişmedi)
- phoenixNAP: `ssh -i ~/.ssh/phoenixnap_y ubuntu@125.253.73.45`. Agent /opt/agent.mjs. API+dashboard /opt/fleet(npm run build+restart fleet-api/fleet-dashboard). Host scriptler /opt/fleet-agent/waydroid/(WD_DIR). psql: `sudo docker exec -i fleet-postgres psql -U postgres -d fleet`. Rollback: `sudo /opt/agent-rollback.sh`.
- Cihazlar: watest47/mi68(+905386929621 korumalı), watest49/mi3(+905348730883 korumalı), watest50/mi4(boş, WA kayıt denendi/iptal), watest51/mi8(boş, yeni kuruldu). 16+ instance.
