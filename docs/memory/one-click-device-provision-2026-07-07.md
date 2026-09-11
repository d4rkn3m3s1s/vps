---
name: one-click-device-provision-2026-07-07
description: "★★★TEK TIKLA CİHAZ OLUŞTUR özelliği 2026-07-07★★★ Dashboard'da tek tık → sıfırdan yeni izole Waydroid instance (mi4,mi5...) kur + boot + root + vtouch + benzersiz kimlik + route + proxy + APK'lar + a11y + ekran → WhatsApp-hazır. Adım-adım canlı ilerleme modalı (süre+yüzde+etiket, WS provision.progress). Mevcut yarım provision modülü SİLİNDİ, 0'dan yazıldı. Host script motoru (deploy/kvm-host/waydroid/wd-provision.sh parametrik) + agent PROVISION_DEVICE handler + API + dashboard. Kök root bug ÇÖZÜLDÜ (bozuk 29KB Magisk stub → gerçek 12.7MB APK container-içi pm install). mi5 ile uçtan-uca canlı doğrulandı. tsc iki app temiz. Kritik tuzaklar: overlay/rootfs klon eksikti, DHCP .112 değil .129 verdi"
metadata: 
  node_type: memory
  type: project
  originSessionId: cfb27ac2-236a-4e57-bdbf-a6c3555e147a
---

★2026-07-07 — Kullanıcı "tek tıkla cihaz oluştur, kurulum sihirbazı, #1/#2 gibi eksiksiz otonom, panelden adım adım süre+ne yapılıyor görünsün" dedi. Kök tetikleyici: #3 kurarken root reddi bug'ı ("root apk'sı bozuk doğru kurmamışsın" — HAKLIYDI). İlgili: [[waydroid-3rd-mi3-setup-2026-07-07]] (root fix detayı), [[waydroid-2nd-whatsapp-MASTER-detay-2026-07-06]] (adım reçetesi).

═══════════════════════════════════════════════════
# ★KÖK ROOT BUG ÇÖZÜMÜ (kullanıcı yakaladı, en kritik keşif)★
═══════════════════════════════════════════════════
Klon userdata'daki Magisk APK bir **STUB** (29063 byte, versionName=1.0, primaryCpuAbi=**null** — native lib yok). Gerçek Magisk 12.7MB (0fe46c5a-delta v26301 arm64-v8a). magiskd stub'ı manager olarak tanımaz → `su: request rejected` tüm su reddi. (magiskd RAM-handshake teorisi YANLIŞTI.)
**ÇÖZÜM**: #2'nin gerçek APK'sını `adb pull` → yeni instance'a push → **container-içi `lxc-attach pm install -r -g`** (ADB'de 'Broken pipe', lxc-attach STABİL) → `am start` app aç (manager trust) → `su -c id`=uid=0. magisk.db 2000|2 ALLOW klonla gelir.

═══════════════════════════════════════════════════
# MİMARİ (5 parça, hepsi git repo'da C:\Yeni klasör\vps)
═══════════════════════════════════════════════════
1. **Host script motoru** `deploy/kvm-host/waydroid/`: net-head.sh (instance→subnet md5), **wd-provision.sh <inst>** (izole altyapı: lxc klon+sed retarget, image kopya, **overlay+overlay_rw+overlay_work+host-permissions klon + boş rootfs mkdir** ←KRİTİK, binderfs, bridge+dnsmasq, userdata klon, systemd unit+dbus conf; son satır `PROVISION_RESULT subnet=N ip=IP port=5555`), wd-run.sh (boot orkestrasyon), wd-binder.sh, wa-bringup.sh (env-parametrik spoof WA_MODEL/WA_IMEI/WA_ANDROID_ID), wd-proxy.sh (redsocks+thordata+iptables). install-agent.sh + install-arm-oracle.sh script kopyalar. Agent WD_DIR=/opt/fleet-agent/waydroid.
2. **Agent** `deploy/kvm-host/agent/agent.mjs`: guard istisnası (PROVISION_DEVICE serial'siz), runJob case, helper'lar (hostSh/lxcAttach/waitBoot/**resolveLeaseIp**/pushB64/cloneApk/reportProgress), `provisionDevice(job)` 11-adım (infra→boot→root-fix→screen→vtouch+kimlik→route→proxy→apks→a11y→persist→done). REUSE applyFingerprint/ensureVtouch/launchApp. Zero-dep. `/opt/agent.mjs` sunucuda (repo ile senkron tutuldu).
3. **API** `apps/api/src/modules/provision/{service,controller,routes}.ts` (SİLİNDİ+0'dan): PROVISION_STEPS, nextInstanceName (subnet-çakışma atlar), createInstance (host seç + Device oluştur hostId-bağlı + fingerprint DEŞİFRE payload'a + job). agent/{routes,controller,service}.ts: `/agent/jobs/:id/progress` + complete() PROVISION_DEVICE bloğu (Device ipAddress/adbPort/ONLINE/READY). routes/index.ts mount. devices/device.service.ts createDevice hostId connect eki. devices/device.types.ts hostId.
4. **Dashboard** `apps/dashboard/`: lib/live.tsx FleetEvent'e provision.progress. profiles/ProfilesView.tsx "Tek Tıkla Cihaz Oluştur" butonu (Zap ikonu) + startProvision. profiles/ProvisionModal.tsx (YENİ, useFleetEvents canlı, süre mm:ss, health-bar CSS, adım listesi). api/provision/{create,steps}/route.ts proxy.
5. **DB**: değişiklik YOK (PROVISION_DEVICE enum var, Device.metadata instance/subnetId/provisionStatus).

═══════════════════════════════════════════════════
# ★UÇTAN-UCA CANLI DOĞRULANDI (mi5, 2026-07-07)★
═══════════════════════════════════════════════════
Gerçek sunucuda mi5 kuruldu, HER adım kanıtlandı: infra (PROVISION_RESULT✓), boot (container RUNNING + "Android with user 0 is ready"✓), **root (su→uid=0 gerçek Magisk✓)**, screen (Override 1080x2400✓), apks (cloneApk→WhatsApp kuruldu✓). #1/#2/#3 regresyon YOK. İki app tsc temiz. mi5 test artığı temizlendi (disk iade).

═══════════════════════════════════════════════════
# ★KRİTİK TUZAKLAR (mi5'te bulundu, düzeltildi)★
═══════════════════════════════════════════════════
1. **overlay/rootfs klon EKSİKTİ**: cfg-only kopya → session "Waydroid is not initialized". wd-provision.sh'e `overlay/overlay_rw/overlay_work/host-permissions` cp + boş `rootfs` mkdir eklendi (rootfs=mount-point, 2.3G içerik system.img'den mount, KOPYA DEĞİL). overlay=Magisk boot hook (root için ŞART).
2. **DHCP IP tahmini yanlış**: script `.112` bastı ama container DHCP'den `.129` aldı (#3 de `.112` değil `.113` almıştı). Agent `resolveLeaseIp` ile dnsmasq lease dosyasından (`/var/lib/misc/dnsmasq.waydroid-<inst>.leases`) GERÇEK IP okur, serial'ı günceller.
3. **nextInstanceName subnet çakışması**: net-head.sh md5-based → mi4→248 (=work/#2!) çakışır. nextInstanceName kullanılan subnet'leri atlar (mi4 atlanır, mi5→253 kullanılır).
4. **klon userdata APK'ları pm görmez**: /data/app'te APK fiziksel var ama packages.xml senkronsuz → `pm list` boş. Agent cloneApk zaten #2'den `pm install -r` ile yeniden kurar (klon userdata'ya güvenmez), bu sorun otomatik çözülür.
5. **SSH tuzakları** (memory'de belgeli): `systemctl restart fleet-agent` agent job'la meşgulse SIGTERM'de asılır (deactivating); `pkill`/`systemctl kill` SSH'ı koparabilir (exit 255) ama komut çalışır. Detached: `nohup setsid bash script >log 2>&1 </dev/null & disown`.

═══════════════════════════════════════════════════
# ★PROVISION İYİLEŞTİRMELERİ 2026-07-08 (mi6 dersleri, DEPLOY)★
═══════════════════════════════════════════════════
mi6 kurulurken provision boot 180s TIMEOUT'a takıldı (CPU boğuk→boot geç) → job FAILED→sonraki adımlar (APK/a11y/proxy) HİÇ çalışmadı→cihaz yarım kaldı, elle tamamlamak gerekti. DÜZELTİLDİ (agent.mjs, deploy):
1. **Boot timeout 180s→300s** + timeout'ta resolveLeaseIp ile IP yeniden çöz + 30s ek bekleme. Yoğun host'ta ilk boot 3-5dk sürer, 180s erken FAIL ediyordu.
2. **cloneApk'a adb install FALLBACK**: lxc-attach `pm install` mi6'da "Unable to open /data/..."+Binder hatası verdi, `adb install -r -g <local.apk>` STABİL çalıştı. Artık lxc-attach başarısızsa host'tan pull edilen APK'yı adb install eder.
3. STABİLİTE: yanmış/kullanılmayan instance'lar STOPPED tutulmalı (CPU boğulması boot'u yavaşlatır → provision timeout). mi5(yandı)+mi3 STOPPED, mi6+work+def RUNNING → load 20+'den ~4'e düştü.
- Provision ZATEN tüm adımları içeriyordu (APK'lar, a11y enable, ekran 1080x2400, proxy, root, vtouch) — sadece boot timeout yüzünden ulaşamıyordu. Artık tam otonom.

═══════════════════════════════════════════════════
# KULLANIM + DEPLOY
═══════════════════════════════════════════════════
- Kullanıcı: Profiller → "Tek Tıkla Cihaz Oluştur" → modal açılır → provision.progress canlı akar (infra→...→done, süre+yüzde+adım). Numara/ülke opsiyonel (proxy için, FLEET_PROXY_* env).
- Deploy (memory [[prod-deploy-workflow-scaleway]]): scp değişen dosyalar → /opt/fleet + /opt/agent.mjs + /opt/fleet-agent/waydroid/*.sh; cd apps/api && npm run build; cd apps/dashboard && npm run build; systemctl restart fleet-api fleet-dashboard fleet-agent. Sunucu git DEĞİL.
- Env: FLEET_WD_SRC (klon kaynağı serial, default 192.168.248.112:5555=#2), FLEET_WD_PREFIX (mi), FLEET_WD_DIR (/opt/fleet-agent/waydroid), FLEET_PROXY_HOST/PORT/USER/PASS (thordata, verilmezse proxy adımı atlanır).
- Kapsam WhatsApp-hazır ile biter; numara/OTP register DAHİL DEĞİL (ayrı, [[waydroid-2nd-whatsapp-MASTER-detay-2026-07-06]] reçetesi).
