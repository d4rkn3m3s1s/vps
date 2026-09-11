---
name: phoenixnap-scaleway-userdata-UYUMSUZ-2026-07-14
description: ★★★KÖK NEDEN: Scaleway'in 'work' userdata'sını phoenixNAP'e taşımak BOOT ETMİYOR (SurfaceFlinger çöküyor). Katman katman uyumsuzluk: ashmem izni→EGL angle/swiftshader→SurfaceFlinger lazy-start SELinux 0x20. ÇÖZÜM: userdata taşıma DEĞİL, phoenixNAP-native SIFIRDAN kur (temiz LITE init BOOT EDİYOR boot_completed=1) + APK'ları sıfırdan pm install. 2026-07-14★★★
metadata:
  node_type: memory
  type: project
  originSessionId: c174b469-ecfe-4355-b2b3-e90d16fb09a7
---

**★★★ phoenixNAP: Scaleway userdata TAŞIMA çalışmıyor → SIFIRDAN kur (2026-07-14) ★★★**

Kullanıcı "sunucudaki bütün cihazları sil, phoenixNAP'te tek-tık reçeteye uygun 1 cihaz kur, Scaleway'deki sürüm ve reçeteyle" dedi. İlgili: [[phoenixnap-systemimg-bozuk-onarim-2026-07-14]], [[RESUME-kaldigimiz-yer-2026-07-14]], [[phoenixnap-PANEL-PROVISION-CALISIYOR-2026-07-13]].

## YAPILAN TEMİZLİK (TAMAM)
- phoenixNAP'te 13 Waydroid instance (c1/c2/c3/dev1/dev2/mi5-10/p1/p2/p3/test1) + 5 DB cihaz kaydı SİLİNDİ. Base image KORUNDU (system.img 1981640704 bytes OK). Panel 0 cihaz. Script: /tmp/wipe-instances.sh (KORUNAN: /var/lib/waydroid base + /root/.local/share/waydroid base).
- Silme sonrası subnet map sıfırlanır → yeni instance subnet 2'den başlar (net-head.sh).

## 🔴 KÖK NEDEN: Scaleway 'work' userdata phoenixNAP'te BOOT ETMİYOR
"Tam Scaleway reçetesi" = wd-provision.sh.prod-bak (205 satır, SRC_INSTANCE=work klonlar). Klon kaynağı `work` phoenixNAP'te YOKTU→Scaleway'den getirildi (SSH key HİÇBİR sunucuya bırakılmadı, iki-hop: Scaleway→local scratchpad→phoenixNAP; scp key kopyalama classifier'a takılır=DOĞRU). work parçaları: /var/lib/waydroid.work (lxc+overlay=Magisk boot hook 18M) + /root/.local/share-work/waydroid/data (2.1G WhatsApp+GApps+Magisk userdata). images phoenixNAP'in SAĞLAM image'ına symlink.
- **Klonlanan cihaz (mi5) BOOT ETMEDİ.** Katman katman uyumsuzluk çıktı:
  1. `/dev/ashmem` izni `----------`(000)→zygote "Permission denied"→crash döngüsü. FIX: `lxc-attach chmod 666 /dev/ashmem`→ashmem hatası bitti AMA boot yine tamamlanmadı.
  2. `ro.hardware.egl`: dosya(waydroid.prop)=swiftshader AMA runtime getprop=**angle** (bir yerden override, build.prop'larda YOK, cfg [properties] override TUTMADI çünkü ro.* immutable). 
  3. **SurfaceFlinger başlamıyor**: `servicemanager: Tried to start SurfaceFlinger as lazy service, unable`; `libc: Unable to set property ctl.interface_start aidl/SurfaceFlinger error 0x20`(=SELinux/prop reddi). boot_completed hiç 1 olmadı.

## ✅ ÇÖZÜM (KANITLANDI): phoenixNAP-native SIFIRDAN kur
- **TEMİZ LITE init instance (clean1, work'ten DEĞİL, paylaşımlı system.img+temiz userdata) BOOT ETTİ**: `egl=angle, boot_completed=1, zygote=running`. → `angle` EGL phoenixNAP'te SORUNSUZ; sorun SADECE Scaleway'in taşınan userdata'sıydı (kendi ortamında oluşmuş, phoenixNAP GPU/SELinux stack'iyle uyumsuz).
- **"LITE" = eksik sürüm DEĞİL**: aynı Android+GApps (aynı system.img). Fark: WhatsApp/Magisk/a11y'yi hazır userdata KLONLAMAK yerine boot sonrası SIFIRDAN pm install. Sonuç Scaleway ile birebir aynı ama boot eden.
- KARAR: Scaleway userdata onarımını BIRAK (ashmem→egl→SELinux saatlerce, belirsiz). clean1'e Scaleway'deki AYNI APK'lardan sıfırdan kur.
- LITE reçete geri aktif: `cp wd-provision.sh.lite-bak wd-provision.sh`. prod-bak (work-klon) ARTIK KULLANMA (phoenixNAP'te boot etmez).

## SONRAKİ
clean1 (subnet 3, 192.168.3.112:5555, boot_completed=1) → WhatsApp+Magisk+a11y+ADBKeyboard sıfırdan kur (APK host-mount büyük dosya için, kaynak Scaleway çalışan cihazdan pm path+pull) → integrity spoof wa-bringup.sh + vtouch → panel tek-tık WA test. Numara+proxy KULLANICI verecek.
SSH: phoenixnap_y ubuntu@125.253.73.45, scaleway_fleet root@51.158.107.121.
