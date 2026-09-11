---
name: session-state-live-issues
description: "WIP 2026-06-29: canlı sorun teşhisi. Agent kopukluğu FIXED (konsol+stream çalışıyor). KALAN: /ai tasarım bozuk (kod), WSL internet yok (catchmail/sms/fonts ortam sorunu), 2./3. emülatör kapalı."
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

**Kullanıcı şikayetleri + teşhis (2026-06-29):**

1. **Konsol "adb device not found" + Wall "Bağlanıyor takılıyor" → FIXED.** Kök neden: host agent
   API restart'larında "fetch failed" alıp ASILI kalmıştı (eski PID 22:29'da başlamış, claim/heartbeat
   failed döngüsü). API + key aslında SAĞLAM (curl heartbeat 200). ÇÖZÜM: agent'ı öldür + temiz yeniden
   başlat → "stream channel connected" + "stream start @20fps" + konsol getprop 2sn'de COMPLETED. ✓
   DERS: API her restart'ında AGENT'I DA yeniden başlat (agent /mnt/c değil Windows node, otomatik reconnect güvenilmez).
   Restart reçetesi [[live-stream-fix]]'te.

2. **catchmail/sms "fetch failed" → ÇÖZÜLDÜ 2026-06-29: API ARTIK WINDOWS NODE'DA.** Kök neden: WSL'de
   DEFAULT ROUTE YOK (sadece 172.28.0.0/20 link route; dockerd default'u silmiş — [[wsl-nat-networking-fix]]).
   `ip route add default via 172.28.0.1 onlink` rota ekledi ama Hyper-V firewall NAT'ı forward etmedi → hâlâ 000.
   ✅ KALICI ÇÖZÜM (kullanıcı seçti): API'yi WSL yerine WINDOWS node ile çalıştır. Windows'ta internet VAR
   (catchmail.io=200) + WSL Postgres(5432)/Redis(6379) localhost'tan erişilebilir (TcpTest=True) + ADB Windows'ta.
   BAŞLATMA: `Start-Process node "node_modules\tsx\dist\cli.mjs watch src/index.ts"` cwd=apps/api (dotenv .env'i
   oradan okur), log=_api-win-host.log. Script: deploy/local-test/_api-win.cmd. SONUÇ: /accounts/sms/countries
   = 72 ülke (internet ÇALIŞIYOR). Bu ayrıca agent-kopma sorununu da hafifletir (artık API+agent ikisi de Windows).
   NOT: WSL API'yi (tsx watch) öldür önce (port 4000). DERS: bu projede API'yi WSL'de DEĞİL Windows'ta çalıştır.
   ⚠️ INFRA: Postgres+Redis WSL'DE DOCKER CONTAINER (fleet-local-postgres, fleet-local-redis, net=host).
WSL/VM restart edince dockerd ÖLÜR → her ikisi de düşer → API boot edemez ("Can't reach DB localhost:5432" /
"ECONNREFUSED 6379"). KURTARMA: (1) dockerd'yi DETACHED WINDOWS process ile başlat:
`Start-Process wsl '-d Ubuntu -u root bash -lc dockerd'` (WSL-lc içinde setsid/nohup YETMEZ — distro proc'ları ölür;
Windows-owned process distro'yu ayakta tutar). (2) `wsl -d Ubuntu bash -lc "docker start fleet-local-postgres
fleet-local-redis"`. (3) localhost:5432/6379 Windows'tan erişilir olunca API restart. Postgres/Redis WSL'de
apt/binary olarak YOK — sadece docker. dockerd default route'u silebilir ([[wsl-nat-networking-fix]]).

⚠️ KOD İYİLEŞTİRME (bu turda): Redis artık OPSİYONEL — webhook.queue.ts + jobs/queue.ts connection'a
lazyConnect:true + retryStrategy(capped 10s) + queue/worker .on('error') warn-once eklendi; enqueueDelivery
try/catch. Redis düşse bile API boot eder, webhook teslimi Redis dönünce devam eder (host-agent yolu zaten etkilenmez).
Postgres hâlâ ZORUNLU (boot'ta upsert). tsc temiz.

⚠️ ZORUNLU SONUÇ-2: API Windows'a taşınınca `ADB_BIN` da TAM YOLA çekilmeli. Konsol shell exec
(adbBridge.service → adb.service spawn(env.adbBin)) API HOST'unda doğrudan adb çalıştırır. ADB_BIN=adb
(çıplak) Windows API process'inin PATH'inde olmadığı için ENOENT → 502 "Hata 502" (konsol komutları patlar).
ÇÖZÜM: apps/api/.env → `ADB_BIN=C:\Users\furka\AppData\Local\Android\Sdk\platform-tools\adb.exe` + API restart.
DOĞRULANDI: getprop ro.product.model → sdk_gphone64_x86_64 exitCode 0, uptime çalışıyor. 502 gitti.
NOT: API her restart'ında AGENT da restart edilmeli (long-poll kopar → "claim failed: fetch failed" döngüsü;
DB'de PENDING birikmez, jobs çözülür ama agent reconnect güvenilmez). Agent restart sonrası temiz.

⚠️ ZORUNLU SONUÇ-1: API Windows'a taşınınca DASHBOARD da Windows'a taşınmalı. Sebep: dashboard apiClient
   server-side `API_BASE_URL=http://localhost:4000` kullanır; WSL'deki dashboard'dan localhost:4000 = WSL loopback
   (API artık orada YOK) → /api/auth/login + tüm SSR sayfaları "fetch failed" 500 (SettingsPage, ProfilesPage…).
   ÇÖZÜM: dashboard'ı da Windows node'da çalıştır → `Start-Process node "node_modules\next\dist\bin\next dev
   --turbopack"` cwd=apps/dashboard, log=_dash-win.log. .env değişikliği GEREKMEZ (localhost her ikisinde de
   Windows). DOĞRULANDI: /login 200, /api/auth/login 200 {ok:true}, /settings 200, /profiles 200.
   TAM STACK ARTIK WINDOWS: API(2688) + AGENT(28572) + DASHBOARD(46596), hepsi node.exe. Postgres/Redis hâlâ WSL
   (localhost'tan erişiliyor). Start-Process ile başlat (Register-ObjectEvent log shell ölünce process'i öldürür —
   KULLANMA; Start-Process -RedirectStandardOutput kullan).

3. **Cihaz durumu yanlış (02/03 sahte ONLINE, 01 REBOOTING'de takılı) → KOD DÜZELTİLDİ 2026-06-29.**
   Kök neden: agent heartbeat SADECE `runningPhones` (sayı) gönderiyordu; API tarafı host'a bağlı TÜM cihazları
   ONLINE işaretliyordu (hangi serial gerçekten erişilebilir bakmadan) + REBOOTING/STARTING geçiş durumlarını
   HİÇ temizlemiyordu. ✅ DÜZELTME: (a) agent.mjs `reachableSerials()` — `adb devices`'tan "device" olan
   serial'leri döner; heartbeat'e `serials:[...]` ekler. (b) agent.service.heartbeat: `serials` varsa GERÇEK
   KAYNAK kabul → serial erişilebilir ise ONLINE (REBOOTING/STARTING'i de temizler), değilse OFFLINE'a düşürür;
   `serials` yoksa eski davranış (geriye uyumlu). (c) controller heartbeatSchema'ya `serials: z.array(z.string())`.
   SONUÇ (doğrulandı): Phone01→ONLINE (5585 erişilebilir, REBOOTING çözüldü), Phone02/03→OFFLINE (emülatör kapalı).
   Sadece çalışan emülatör ONLINE + yayın verir. ESKİ NOT (hâlâ geçerli): kapalı AVD frame vermez (normal).

4. **/ai sayfası tasarımı → FIXED + DOĞRULANDI 2026-06-29.** ASIL kök neden: `.ai-page { align-items: center }`
   (globals.css:1693). `.page` bir flex-column; `align-items:center` TÜM çocukları (stat grid + paneller +
   3-col grid) içerik-genişliğine büzüp ortaya yığıyordu (ekran görüntüsündeki dar-orta-sütun). DÜZELTME:
   `align-items: stretch` (çocuklar tam genişlik). Hero zaten `.ai-hero` içinde kendi ortalamasını yapıyor.
   İKİNCİ kusur: `.ai-card-3d` (+ `.holo-card-3d`) CSS'i YOKTU → Holo3D wrapper'ı (yalnız inline 3D transform
   uygular, kendi layout'u yok) çöküyordu. EKLENDİ: `.ai-card-3d,.holo-card-3d{position:relative;display:flex;
   height:100%;border-radius:12px}` + `.ai-card-3d>.ai-card{flex:1;width:100%;height:100%;min-height:150px}`.
   ÖNEMLİ CACHE DERSİ: /mnt/c'de Turbopack POLLING açık olsa bile globals.css değişikliğini hot-reload ETMEDİ
   (servis edilen CSS chunk eski kaldı: align-items yok). `touch` da tetiklemedi. ÇÖZÜM: dev server'ı yeniden
   başlat (`.next/cache` + `.next/static/chunks` temizle → `bash deploy/local-test/_dash-dev.sh` yetersiz kaldı,
   process setsid&'da ölüyor; ÇALIŞAN yol: `Start-Process wsl ... 'npm run dev'` ile WINDOWS-detached başlat).
   DOĞRULANDI: servis edilen CSS'te `.ai-page{align-items:stretch}` + `.ai-card-3d{...}` MEVCUT, /login 200,
   API 200, agent PID19728 bağlı. DERS: globals.css düzenlemesi sonrası /mnt/c'de dev server RESTART şart.

5. Konsol başlığı "Local Phone 01 · rebooting" gösteriyordu — cihaz status'u REBOOTING'de takılı kalmış
   olabilir (eski bir job'dan). Agent restart sonrası heartbeat ONLINE'a çekmeli; doğrulanacak.

ÖNCEKİ TUR: 8 sahte/bozuk özellik düzeltildi ([[feature-honesty-audit]] sonu). Bu tur ekstra olarak agent
kopukluğu + teşhis. Stack: API:4000 (200), dashboard:3000 (Turbopack), agent PID değişken (her API restart'ında yenile).