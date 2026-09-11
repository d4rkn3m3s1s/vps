---
name: whatsapp-redroid-touch-fix
description: "redroid touch device requires use_redroid_stream=1; WhatsApp number field still rejects ALL synthetic text injection (input text, keyevent, ADBKeyboard)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 27407aa3-afb1-4b1b-8795-dc7f23a050e8
---

**THE touch fix for redroid:** the touchscreen (`/dev/input/event0` = "redroid vinput", MT protocol B, ABS_MT_POSITION_X max 600 / Y max 1280) is only created when the container is launched with **`androidboot.use_redroid_stream=1`**. Without it, `/vendor/etc/init/uinputd.rc` keeps `vendor.uinputd` **disabled** (it only starts `on property:ro.boot.use_redroid_stream=1`), so `/dev/input` is empty and taps never reach views. The host `uinput`/`evdev` modules must also be loaded (`modprobe uinput evdev` — they're modules on this WSL kernel, not builtin). Add this flag to every redroid `docker run` (up-3phones.sh, _fix-touch.sh, agent launch).

With the flag, **raw `sendevent` taps to event0 work in WhatsApp** (EULA "Agree" accepted, country picker opens + selects, RegisterPhone field focuses with cursor — all confirmed). Synthetic taps reach WhatsApp's hw-accelerated screen.

**Why:** the platform was blocked for many sessions on "WhatsApp touch unstable". Root cause was never touch flakiness — it was the missing stream flag → no touch device at all. `input tap` sometimes "worked" via uinput fallback but unreliably.

**How to apply / still-open blocker:**
- sendevent tap helper (screen 600x1280, 1:1 coords): `sendevent DEV 3 47 0; 3 57 1; 1 330 1; 3 53 <X>; 3 54 <Y>; 0 0 0; 3 57 -1; 1 330 0; 0 0 0` (DEV=/dev/input/event0). See `deploy/local-test/_sendevent-tap.sh`.
- Pin `export ANDROID_SERIAL=127.0.0.1:5555` — redroid registers BOTH as `127.0.0.1:5555` AND `emulator-5554` (same device, 2 transport_ids) → "more than one device" errors without it.
- **UNSOLVED:** WhatsApp's `registration_phone` field rejects EVERY text-injection method — `input text`, `input keyevent` (KEYCODE digits), and ADBKeyboard `ADB_INPUT_TEXT` (broadcast returns result=0 but no commit). Field focuses (cursor visible, mInputShown=true) but text never lands → NEXT stays disabled. The soft keyboard never visually renders in headless redroid (mInputShown=true but no key grid), so soft-key tapping isn't possible either.
**Injection methods ALL tried & blocked by WhatsApp's number field** (each leaves NEXT disabled): input text, input keyevent digits, ADBKeyboard broadcast (result=0 no commit), clipboard `service call clipboard` + KEYCODE_PASTE.
**scrcpy fully explored:**
- scrcpy 1.25 (apt) + scrcpy v4.0 (prebuilt at `/tmp/scrcpy-v4/...`, self-contained adb+server) both **connect headless with `--no-window`/`--no-display`** (controller thread starts).
- `--keyboard=uhid` (the HID-bypass) **FAILS: redroid kernel has no `/dev/uhid`** (`ls /dev/uhid` = "Invalid argument", UhidManager.open → ENOENT). UHID unavailable on this WSL kernel.
- SDL window mode (needed for xdotool typing) **fails/hangs under Xvfb** for both v1.25 and v4 (SDL needs GPU features Xvfb lacks; the `wsl.exe bash -lc` call goes silent when SDL scrcpy launches).
- **Only remaining path:** run scrcpy `--no-window` and hand-write a control-socket client that sends INJECT_KEYCODE/INJECT_TEXT control messages (scrcpy injects via InputManager.injectInputEvent — the trusted path WhatsApp accepts). Not yet built. Scripts: `_scrcpy-v4-uhid.sh`, `_scrcpy-v4-win.sh`, `_scrcpy-type.sh`.
**scrcpy control-socket client: BUILT and tested — scrcpy's own injection ALSO fails here.** Decompiled scrcpy-server v4 with jadx (`/tmp/jadx`): confirmed INJECT_KEYCODE wire format is `type(1) action(1) keycode(4BE) repeat(4BE) metaState(4BE)` = 14 bytes (my client was byte-correct). Started server standalone (`CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 4.0 scid=... video=false control=true tunnel_forward=true`), adb-forwarded `tcp:PORT localabstract:scrcpy_<scid>`, Node client connected and received the handshake (1 dummy byte `00` + 64-byte device name "redroid1..."). `Controller.supportsInputEvents` IS true (displayId=0 default, Android 13 SDK33). BUT both INJECT_KEYCODE (APP_SWITCH) AND INJECT_TOUCH (tap country dropdown) produced **NO effect** — recents didn't open, picker didn't open. So redroid's `InputManager.injectInputEvent` silently no-ops scrcpy's events too. Client+scripts: `_scrcpy-inject2.mjs`, `_wa-scrcpy-v2.sh`, `_scrcpy-test-touch.sh`, `_scrcpy-server-start.sh`.

**DEFINITIVE WALL:** On this redroid 13 + custom WSL kernel, the ONLY input method that affects the UI is raw `sendevent` to `/dev/input/event0` (vinput). That does TAPS reliably (EULA, country picker, focus) but cannot type, and the soft keyboard never renders headless. ALL programmatic text/key/touch injection via the Android input APIs (input, keyevent, ADBKeyboard, clipboard, scrcpy/InputManager.injectInputEvent) is rejected/no-op. **WhatsApp number entry is not achievable on redroid in this env.** Realistic path: Android Studio AVD (Google Play image) on Windows host — real touchscreen + soft keyboard renders + adb input reliable; keep redroid for fleet management. (User-chosen scrcpy path is exhausted.)
- See also [[whatsapp-rpa]], [[three-redroid-phones]].
