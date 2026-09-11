---
name: windows-avd-stack
description: "Redroid abandoned — full stack moved to Windows + Google AVD emulator (Android 14, WHPX). WhatsApp native input works."
metadata: 
  node_type: memory
  type: project
  originSessionId: 27407aa3-afb1-4b1b-8795-dc7f23a050e8
---

**THE REDROID ERA IS OVER.** The whole touch/IME/NAT catch-22 ([[whatsapp-redroid-touch-fix]]) was a consequence of redroid being an x86 emulator on a custom WSL kernel. Replaced with Google's official Android Studio emulator (AVD) on the Windows host.

**What runs where now (2026-06-25):**
- **AVD** `wa01`: Pixel 6, Android 14, `system-images;android-34;google_apis_playstore;x86_64`, WHPX-accelerated. SDK at `%LOCALAPPDATA%\Android\Sdk` (cmdline-tools + platform-tools + emulator). JDK17 at `%LOCALAPPDATA%\Android\jdk17`. Start: `emulator.exe -avd wa01 -no-snapshot-save -gpu swiftshader_indirect -accel on -port 5584`. Console 5584, **ADB over TCP at `127.0.0.1:5585`** (`adb connect 127.0.0.1:5585`). `hw.keyboard=yes`, Play Store enabled, in `~/.android/avd/wa01.avd/config.ini`.
- **API** (4000): Windows, `cd apps/api; npx tsx watch src/index.ts`. Health `GET /health` → `{ok:true}`.
- **Dashboard** (3000): Windows, `node node_modules/next/dist/bin/next dev -p 3000` from `apps/dashboard`. (`cmd /c npm run dev` detaches and dies — launch next directly.)
- **Host agent**: Windows, `node deploy/kvm-host/agent/agent.mjs` with env `FLEET_API_URL=http://localhost:4000`, `FLEET_API_KEY=f185cb2...`, `FLEET_HOST_KEY=host_6bbbbfe1...`, `FLEET_ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`. Connects to stream hub, heartbeats devices ONLINE.
- **Postgres+Redis**: still WSL docker (`db-hostnet.yml`), reachable from Windows at `localhost:5432`/`6379` via wslrelay. DB `vps_emulator`, user/pass postgres/postgres. No redroid phones started — just data services.

**Wiring:** device serial in the agent = `${device.ipAddress}:${device.adbPort}`. Set Local Phone 01 (`cmqlrf4ni000gj50fjimgvk4u`) to ip `127.0.0.1` port `5585`. Host `local-wsl2` (`cmqqskm1i000hj5d0w5efjgw6`) owns the FLEET_HOST_KEY. Verified end-to-end: `POST /devices/:id/shell` ran on the AVD and returned `sdk_gphone64_x86_64`.

**Login**: `POST /auth/login` {email,password} with `x-api-key` header; token at `data.accessToken` (nested). admin@local.dev / Admin2026!. Workspace `cmqlrdynh0002j50f0d5oimqv`.

**Native input PROVEN** on the AVD: `adb shell input text/tap` works in Settings & dialer. BUT WhatsApp's RegisterPhone EditText rejects synthetic tap/motionevent/TAB focus (anti-automation) — needs a real mouse click in the emulator window, then `input text` fills it. See [[whatsapp-avd-registration]].
