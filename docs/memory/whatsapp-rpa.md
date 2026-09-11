---
name: whatsapp-rpa
description: WhatsApp RPA (register/send/read) added to agent.mjs + API + dashboard; real first-run flow mapped on redroid
metadata: 
  node_type: memory
  type: project
  originSessionId: 27407aa3-afb1-4b1b-8795-dc7f23a050e8
---

Added WhatsApp automation alongside the existing Instagram registrar. Job types `REGISTER_WHATSAPP`, `WHATSAPP_SEND`, `WHATSAPP_READ` (in `job.types.ts`, Prisma `JobType` enum, migration `20260623000000_whatsapp_jobtypes`). Agent handlers in `deploy/kvm-host/agent/agent.mjs` (`registerWhatsApp`/`whatsappSend`/`whatsappRead` + shared `waHelpers` factory). API: `batchService.registerAccount` now branches on platform; `sendWhatsApp`/`readWhatsApp` + controller + routes `/accounts/batch/accounts/:id/whatsapp/{send,read}`. Dashboard: messaging modal in `BatchPanel.tsx`.

**Real WhatsApp first-run flow, mapped live on redroid13_x86_64 (WhatsApp 2.25.x):**
1. `Alert: custom ROM installed … OK` (emulator detection — only a warning, dismissable)
2. `Welcome to WhatsApp → AGREE AND CONTINUE` (caps)
3. `Link as companion device` (QR screen is the DEFAULT now) → overflow `⋮` (top-right ~565,78) → **`Register new account`**
4. Phone screen — fields by resource-id: `com.whatsapp:id/registration_cc` (country code), `com.whatsapp:id/registration_phone` (number), `com.whatsapp:id/registration_submit`. Handler drives these by id, splitting E.164 via `splitE164`.

**Verified end-to-end (2026-06-24):** real register driven via REGISTER_WHATSAPP reached **status `OTP_WAIT`** on phone-01 — i.e. agent grants perms → EULA → bypass companion → enters number → submits → WhatsApp sends SMS. The number-entry screen now also pops a runtime **"Allow WhatsApp notifications?" permission dialog** (`com.android.permissioncontroller:id/permission_allow_button`, text "ALLOW") that OVERLAYS `registration_phone` and stalled the flow ("id yok: registration_phone"). FIX (in agent `registerWhatsApp`): **`pm grant` the runtime perms BEFORE launching** (POST_NOTIFICATIONS, READ/WRITE_CONTACTS, GET_ACCOUNTS, READ_PHONE_STATE, CAMERA, RECORD_AUDIO) + a permission-dialog dismiss loop. After that the flow runs clean to OTP_WAIT.

**sms-bus OTP timing is tight:** rented WhatsApp numbers (project_id=5, country_id=7 Indonesia had stock; balance was $15) expire in ~minutes. Poll `/get/sms?request_id=...` IMMEDIATELY and run the whole register in one shot — a slow run gets `50102 Number released/timeout` before the code (`50101 = not received yet` means still alive). Endpoint `/get/prices` 404s; just rent.

**`pm clear com.whatsapp`** for a fresh first-run between attempts. send/read need a REGISTERED account first.

**TWO redroid blockers that made WhatsApp number entry impossible — both now FIXED:**
1. **No touchscreen / `input tap` ignored:** `/dev/input/` was EMPTY, so `input tap`/`input swipe` reached nothing (only `keyevent` worked → every field tap left `focused=false`). Root cause: redroid builds its touchscreen via `/dev/uinput`, but this custom WSL kernel ships `uinput`+`evdev` as modules that aren't auto-loaded, so `/dev/uinput` was absent at boot. FIX: `modprobe uinput evdev` on the host THEN (re)start the phones — now tap/swipe work (swipe opens the app drawer, tapping the WhatsApp icon opens it). Baked into `up-3phones.sh` (step 4b).
2. **`input text` dropped into WA fields:** even with focus, the stock LatinIME doesn't deliver `input text` to WhatsApp's EditTexts. FIX: **ADBKeyboard** (`com.android.adbkeyboard/.AdbIME`, ~18KB, GitHub senzhk/ADBKeyBoard release `keyboardservice-debug.apk` — saved at `deploy/local-test/apks/ADBKeyboard.apk`). Install + `ime set` as default, then inject with `am broadcast -a ADB_INPUT_TEXT --es msg "..."` / `ADB_CLEAR_TEXT`. Agent `waHelpers` now has `ensureAdbKeyboard()` + `typeText`/`clearField` that prefer the broadcast; `registerWhatsApp` calls ensureAdbKeyboard after pre-grant. up-3phones.sh step 9b installs+sets it on all 3 phones.

**Proven (2026-06-24):** with both fixes, a dummy-number register run drove WA to **"Connecting…"** with `+62 / 812-3456-7890` filled and NEXT green — i.e. number entry + submit fully work; only a live sms-bus number + OTP remained (stock was temporarily empty). The "custom ROM installed" Alert at first launch is just a dismissable warning (tap OK), NOT a ban.

**redroid has ARM translation** (abilist includes arm64-v8a) so the real WhatsApp APK installs/runs on x86 redroid. APK: `whatsapp.com/android/current/WhatsApp.apk` 404s now — resolve the real signed APK URL from `scontent.whatsapp.net` (whatsapp.com/android page link); ~142MB.

**3-device internet caveat:** only the ONE host-net phone (phone-01) has internet. The `--network none` phones (phone-02/03, needed to avoid binder/host-net collision — see [[three-redroid-phones]]) have NO outbound net: docker bridge + manual veth+MASQUERADE both fail because this custom WSL kernel can't L3-forward out of an isolated netns (pure same-subnet L2 bridging works; routing/NAT to eth0 does not). So WhatsApp register only works on phone-01 in this WSL test env; a real KVM host (normal kernel) won't have this limit.

Related: [[wsl-nat-networking-fix]], [[local-android-test-stack]].
