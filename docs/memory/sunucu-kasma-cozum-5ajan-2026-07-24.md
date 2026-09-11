---
name: sunucu-kasma-cozum-5ajan-2026-07-24
description: "★SUNUCU \"KASMA\" ÇÖZÜMÜ (2026-07-24, 5-ajan derin analiz). Panelde load 95.7/80=%120 \"kasma\" görünüyordu. GERÇEK: (1)load YANILTICI—CPU %47 idle, I/O yok, throttle yok, normalize load 1.2/core=sağlıklı. (2)AMA 2 GERÇEK sorun: CPU governor ondemand→1.74GHz'de takılı(%28 kayıp)→performance yapıldı(3.0GHz). (3)★EN BÜYÜK: 4 cihaz(mi3/mi7/mi16/mi68) WhatsApp EULA ekranında 1-5 GÜNDÜR takılı, GPU'suz spinner'ı 60fps software-render→her biri 3-4 core, toplam ~12 core(SF CPU'sunun %96'sı)→WA force-stop→LOAD 98→4, CPU %95 idle. FIX: governor-performance(cpu-perf.service reboot-persist) + agent EULA-reaper(60sn, 8dk-grace) + provision animasyon=0 + 28-cihaz canlı animasyon=0 + mi12-orphan-temizlik."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9707e58c-215c-46d7-9857-dad5e4cc10c7
  modified: 2026-07-23T21:22:51.401Z
---

# ★ SUNUCU "KASMA" ÇÖZÜMÜ — 5-AJAN DERİN ANALİZ (2026-07-24)

Kullanıcı "sunucu kasması, işlemciyi bozmadan çöz, ajanlarla çoklu derin araştırma" dedi.
5 uzman ajan(governor/surfaceflinger/weston-leak/cgroup/waydroid-tuning) paralel SALT-OKUMA
analizi → birleşik teşhis. phoenixNAP a1.c5 (ARM Neoverse-N1, 80 core, 256GB, GPU YOK).

## 🔍 KÖK-TEŞHİS: "kasma" büyük ölçüde YANILTICI + 2 gerçek fırsat
- **Load 98 ama CPU %47 idle** — I/O yok(PSI io=0), throttle yok(cgroup nr_throttled=0), swap 0,
  disk boşta, 80 core'a homojen dağılmış. Normalize load=98/80≈1.2/core=SAĞLIKLI hafif overcommit.
- Load'u şişiren: 29 Waydroid×~30 daemon=34K thread'in runnable/vsync-bekleme kuyruğu(voluntary
  ctx-switch). D-state process'ler=kworker(kernel thread, takılmıyor). **Panel ham-load gösteriyor,
  80'e bölmüyor→false-positive alarm.**

## 🔴 GERÇEK SORUN #1 (EN BÜYÜK): 4 cihaz EULA'da takılı, ~12 core yiyor
- **mi3/mi7/mi16/mi68** WhatsApp `com.whatsapp.registration.app.EULA` ekranında 1-5 GÜNDÜR takılı
  (WA process uptime: 4gün21sa/2gün7sa/1gün5sa/21sa). GPU YOK→spinner'ı swiftshader ile CPU'da
  60fps render→her biri surfaceflinger %300-370(3-4 core). Toplam ~1231%(SF CPU'sunun %96'sı).
- Bunlar TERK EDİLMİŞ kayıt oturumları(hesaplar zaten ölü: BANNED/LOGGED_OUT/RESTRICTED). Kimse
  ilerletmemiş, WA açık, spinner dönüyor. **Hepsi protected=true(kullanıcı uyardı) ama silmedik—
  sadece WA'yı force-stop ettik(veri/oturum dokunulmadı, protected ihlal değil).**
- ★ÇÖZÜM: `am force-stop com.whatsapp` 4 cihazda → **LOAD 98→4, CPU %95 idle** (CANLI ölçüldü).
  ⚠️DERS: `ps pcpu` kümülatif-ömür-ortalaması gösterir(4gün SF hâlâ %373 görünür) ama gerçek anlık
  CPU top-2iterasyon'da %95 idle. Gerçek için `top -bn2 -d1 | tail -1` kullan, `ps pcpu` YANILTICI.

## 🟡 GERÇEK SORUN #2: CPU governor ondemand→1.74GHz takılı (%28 kayıp)
- governor=`ondemand`, up_threshold=95→bursty Waydroid yükünde frekans hep düşük(1.74/3.0GHz=%58).
  9 core 1.0GHz'de takılıydı. Thermal throttle YOK(thermal_zone yok), boost yok.
- ★ÇÖZÜM: `cpupower frequency-set -g performance`→80 core 3.0GHz(+%73 frekans). Reboot-persist:
  `/etc/systemd/system/cpu-perf.service`(oneshot+RemainAfterExit, ExecStart=cpupower...performance,
  enabled). ⚠️cpupower.service YOK bu sistemde→kendi unit'imizi yazdık. Governor değişikliği
  process'leri BOZMAZ(sadece frekans), çalışan cihazlar etkilenmez.

## ⚪ YANLIŞ ALARMLAR (ajanlar çürüttü)
- "88 weston leak"→YANLIŞ: her instance 3 weston açar(weston+keyboard+desktop-shell), 29×3=87 normal.
  Weston'lar %0 CPU. Tek gerçek leak: mi12 çift-başlatma boş kabuk(eski wd-run pid12983+dbus+sleep,
  4.9gün, lxc/weston YOK). GÜVENLİ temizlendi(mi12=tr-test container 3988949 ppid=1 ayrı, ADB-online
  kaldı). ⚠️DERS: orphan öldürmeden ÖNCE lxc-start parent'ının farklı olduğunu + ADB-online'ı doğrula.
- IO scheduler/cpuset-pinning: dokunma(disk boşta faydasız, pinning mevcut homojen dağılımı bozar).

## ✅ KALICI FIX (kod, commit 6ce4a1e)
- **agent.mjs eulaReaperTick**(60sn'de bir, EULA_GRACE_MS=8dk): ADB-cihaz WA registration/EULA
  ekranında grace'ten uzun takılırsa VE job'ı YOKSA(busyDevices'ta değil→canlı-kayıt kesmez)→
  force-stop+HOME. eulaStuckSince map. shutdown'da clearInterval. Bu sınıfın birikmesini önler.
- **provision 'screen' adımı**: window/transition/animator_animation_scale=0(GPU'suz animasyon=bosa CPU).
  Yeni cihaz boot'tan animasyonsuz. Env: FLEET_EULA_REAPER_MS/FLEET_EULA_GRACE_MS.

## 🔧 CANLI UYGULANAN (host, kod-dışı)
- governor→performance + cpu-perf.service(enabled+reboot-persist).
- 4 takılı cihaz force-stop(load 98→4).
- 28 cihaza canlı animasyon=0(`settings put global *_animation_scale 0`, reboot'ta silinir→provision'a eklendi).
- mi12 orphan 3-pid temizlendi.
- agent.mjs deploy+restart(yedek /opt/agent.mjs.bak-eula-<ts>).

## 📊 SONUÇ
- **Load 98→3, CPU %47 idle→%95 idle, frekans 1.74→3.0GHz.** Sistem "taş gibi" rahatladı.
- Kapasite: RAM 40-50 instance sığar; sınır="aynı anda kaç cihaz ekran-render ediyor"(~10-12 aktif).
  MAX_CONCURRENT=16 doğru levye. EULA-reaper artık takılmaları otomatik temizleyecek.
- ⚠️push edilmedi(commit 6ce4a1e + önceki 10 commit yerel).
