---
name: adb-instability-fps-fix-2026-07-07
description: "★★★ADB KARARSIZLIĞI + FPS DÜŞÜKLÜĞÜ KÖK NEDEN + ÇÖZÜM 2026-07-07★★★ Kök: Scaleway ARM Waydroid'de GPU YOK (yazılım render) + CPU boğuk (4 CPU'da load 19-23, 4 instance). screencap -p PNG = ~3sn/frame 562KB = ~0.3fps ve her frame ADB'yi 3sn kilitliyor (job/heartbeat yarışıyor = kararsızlık). screenrecord h264 = 0 byte + ADB'yi ASIYOR (encoder yok, scrcpy İMKANSIZ). ÇÖZÜM (deploy+canlı doğrulandı): (1) ham RGBA screencap + host sharp→JPEG 400px q55 = 13KB/frame ~0.7fps (43× küçük, 2.3× hız, encode host'a taşındı) FLEET_STREAM_JPEG=1. (2) jobBusy mutex: stream loop job çalışırken duraklar → job ADB rahat. ★ESM TUZAĞI: import('sharp') NODE_PATH'i YOKSAYAR → mutlak yol /opt/fleet/node_modules/sharp/lib/index.js şart."
metadata: 
  node_type: memory
  type: project
  originSessionId: f17ad8bd-033f-403d-bc1b-a475a7fe65b3
---

★2026-07-07 — Kullanıcı "adb kararsızlığı ve fps düşüklüğü sorununu derinlemesine ele alıp çözelim" dedi. İlgili: [[scrcpy-stream-bridge-decision]] (eski karar — bu donanımda h264 imkansız çıktı), [[live-stream-fix]] (stream.hub geçmiş fix), [[faz3-wake-sleep-reboot-deploy-2026-07-07]] (aynı oturum, wake/sleep kullanıldı).

═══════════════════════════════════════════════════
# ★KÖK NEDEN (gerçek sunucuda ÖLÇÜLDÜ, tahmin değil)★
═══════════════════════════════════════════════════
Scaleway ARM (scw-crazy-jones, 4 CPU) Waydroid, temiz boot mi5, ekran 1080x2400:
- `screencap -p` (cihaz PNG encode): **~3000ms/frame, 562KB** → ~0.3 fps (memory'deki "3fps"ten KÖTÜ).
- `screencap` (ham RGBA, encode YOK): ~1300ms, 10.4MB (1080×2400×4).
- **Ayrıştırma**: cihaz PNG encode'u tek başına +1.7sn ekliyor; ham grab ~1.3sn (yazılım render + 10MB ADB transfer).
- `screenrecord --output-format=h264` → **0 byte + adb shell'i ASIYOR** (encoder yok). ★scrcpy/h264 bridge bu donanımda İMKANSIZ — eski [[scrcpy-stream-bridge-decision]] kararı ölü.
- **CPU boğuk**: `uptime` load average **19-23** (4 CPU!), 4 Waydroid instance aynı anda yazılım-render. screencap yavaşlığının büyük parçası bu.
- **ADB kararsızlığı = her stream frame'i ADB transport'unu ~3sn kilitliyor**; stream `screencap` + job `exec-out cat/input tap` + heartbeat + inbox poll TEK adb server'da yarışıyor. + asılı screenrecord ADB'yi komple donduruyor.

═══════════════════════════════════════════════════
# ★ÇÖZÜM 1: sharp JPEG yolu (KOD + DEPLOY + CANLI DOĞRULANDI)★
═══════════════════════════════════════════════════
agent.mjs `captureFrame`: FLEET_STREAM_JPEG=1 ise ham RGBA screencap (`-p` YOK) çek → `parseRawScreencap` (header w/h uint32LE, 12 veya 16 byte, body=w*h*4) → **host-side sharp** `.jpeg({quality:50})` **TAM ÇÖZÜNÜRLÜK (küçültme YOK, FLEET_STREAM_JPEG_W=0 default)**. Yoksa PNG'ye düşer.
- ★★DOKUNMA REGRESYONU DERSİ (kullanıcı yakaladı): İLK versiyon `.resize({width:400})` yapıyordu → frame 400px geldi AMA cihaz 1080px. LiveScreen.tsx `toDevice()` tıklama koordinatını `oran × frameSize.w` (decode edilen frame genişliği, satır 216/231) ile hesaplar → 400-tabanlı koordinat 1080px cihaza gitti → YANLIŞ YERE dokundu/tıklayamadı. ÇÖZÜM: küçültmeyi KALDIR, tam çözünürlük JPEG gönder → frameSize=1080×2400 → koordinat DOĞRU. ★BONUS: tam çözünürlük q50 (57ms/40KB) resize'DAN HIZLI (540px=139ms) — sharp resize CPU'su encode'dan çok. Yani küçültme hem dokunmayı bozdu hem YAVAŞLATTI.
- **ÖLÇÜM (canlı stream, #2 work, mi3+mi5 uyutulmuş): 1080x2400 JPEG ~40KB/frame, ~1.78 fps** (562KB→40KB = **14× küçük**, 0.3→1.78 = **~6× hız**). Frame geçerli JPEG (ffd8...ffd9 offset 0, hub temiz payload gönderir). Dashboard createImageBitmap zaten JPEG çözer, DEĞİŞİKLİK GEREKMEDİ.
- ★TEŞHİS aracı: startCapture loop'una eklenen `stream first frame`/`stream capture error` bir-kez logları (state.loggedFirst/loggedErr). "0 frame" şikayetinde agent'ın frame üretip üretmediğini AYIRT eder (bende sorun jobBusy değil, küçültme+CPU idi). BIRAKILDI (bir kez basıp susar, zararsız).
- Kazanım kaynağı: cihaz-tarafı PNG encode (1.7sn) elimine, host sharp encode sadece ~0.2sn (native). ADB kilit süresi 3sn→1.7sn (yarıya) → kararsızlık azalır.
- ★**ESM import TUZAĞI**: agent `/opt/agent.mjs` olarak çalışır, yanında node_modules YOK. `import('sharp')` bare specifier BAŞARISIZ, ve **ESM `import()` NODE_PATH'i YOKSAYAR** (CJS'e özgü, NODE_PATH ekledim İŞE YARAMADI). ÇÖZÜM: loadSharp() aday yollar dener: 'sharp' → FLEET_SHARP_PATH → **`/opt/fleet/node_modules/sharp/lib/index.js`** (mutlak, /lib/index.js ŞART) → apps/api/node_modules. Log: "sharp JPEG path enabled via /opt/fleet/node_modules/sharp/lib/index.js".
- sharp opsiyonel dinamik import — agent ZERO-DEP kuralı korundu (CLAUDE.md), yoksa PNG fallback.

═══════════════════════════════════════════════════
# ★ÇÖZÜM 2: ADB izolasyonu (jobBusy mutex)★
═══════════════════════════════════════════════════
agent.mjs stream `loop()`: her iterasyonda `if (jobBusy) { await sleep(200); continue; }`. Bir job çalışırken (tap/swipe/exec-out cat/uiautomator) stream frame ÇEKME → job'ın ADB'si rahat. Job'lar kısa, viewer kısa donar. jobBusy global zaten vardı (inbox poll onu kullanıyordu, stream KULLANMIYORDU — bug buydu). Kod+syntax doğrulandı, deploy edildi (canlı eşzamanlılık testi yapılmadı — mantık inbox poll'unkiyle birebir).

═══════════════════════════════════════════════════
# DEPLOY DURUMU + KALAN
═══════════════════════════════════════════════════
- agent.mjs local=`/opt/agent.mjs` server SHA BİREBİR (65f8d7e6...). fleet-agent env: `FLEET_STREAM_JPEG=1` + `NODE_PATH=/opt/fleet/node_modules` (NODE_PATH zararsız, ESM'de etkisiz ama CJS için bıraktım). FFMPEG/H264_RAW SET EDİLMEDİ (bu donanımda çalışmaz, kapalı doğru). Ayarlanabilir: FLEET_STREAM_JPEG_W (400), FLEET_STREAM_JPEG_Q (55).
- **CPU YÜKÜ ÇÖZÜMÜ (task #8) — BACKEND UÇTAN UCA KANITLANDI, dashboard görsel test kaldı**: OTOMATIK sleep DEĞİL, **panel uyarısı + manuel toplu-sleep** (kullanıcı seçti). Uygulandı+deploy:
  - Agent heartbeat `hostCapacityMetrics()`: `/proc/loadavg` ilk değeri → `loadAvg1m` + `nproc` → `cpuCores`. DB'ye ulaştı doğrulandı (loadAvg1m=20.43, cpuCores=4 = sat %511!).
  - Migration `20260707160000_host_loadavg`: `Host.loadAvg1m` DOUBLE PRECISION (cpuCores ZATEN vardı, tekrar ekleme). Uygulandı.
  - API: heartbeat controller zod + service update (loadAvg1m/cpuCores). provision.service `cpuPressure(ws)`: her host sat=load/cores, HOT eşik FLEET_CPU_HOT=1.5 (150%). sleepable = ONLINE + metadata.instance olan cihazlar (SADECE instance'lılar — DEVICE_SLEEP instance ŞART, device.service.instanceOf 409 yoksa). GET /provision/cpu-pressure. TEST: hot:true, Scaleway sat=4.57, sleepable=['mi5(mi5)'] ✓.
  - Dashboard: ProfilesView `.cpu-pressure-banner` (amber --warn, header altı), 15sn poll /api/provision/cpu-pressure, `sleepIdleDevices()` → her sleepable'a POST /api/devices/:id/sleep (Promise.allSettled). Proxy route api/provision/cpu-pressure. globals.css banner stili. İKİ APP TSC TEMİZ.
  - TOPLU-SLEEP BACKEND KANITLANDI: mi5 WAKE(ONLINE,sleepable'a girdi)→SLEEP(job COMPLETED, mi5 OFFLINE, container STOPPED, sleepable'dan çıktı) ✓.
  - ★TUZAK: eski elle-kurulan ONLINE cihazlar (#2 work, A13) metadata.instance'a SAHİP DEĞİL → sleepable'da GÖRÜNMEZ (doğru+güvenli, çünkü instance'sız uyutulamaz). Sadece provision ile kurulan (mi5) instance'lı.
  - KALAN: dashboard next build sunucuda çok yavaş (CPU boğuk — ironik!), bitince restart + tarayıcıda banner görsel doğrula. Kod commit'lenmedi (feat/cloud-phone-suite).
- Kod agent.mjs'te; feat/cloud-phone-suite dalında commit'lenmedi.
- ★Daha fazla FPS için tek yol minicap (ARM binary, screencap'i ~1.3sn→~150ms) ama riskli/karmaşık — kullanıcı ATLADI. VEYA CPU yükünü azalt (asıl darboğaz cap süresi = render, o da CPU-bağlı).
- TUZAK: mi5 (253.129) test sırasında STOPPED oldu, wd-run.sh mi5 detached ile geri uyandırıldı. adb'de olmayan cihaz (container STOPPED) → 0 frame (beklenen).
