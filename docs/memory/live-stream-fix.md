---
name: live-stream-fix
description: "Canlı ekran görüntü gelmiyor — root cause: stale viewers + agent not re-issued stream.start on (re)connect, AND host agent hung after API restarts. Fixed in stream.hub.ts; verified frames flow."
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

**Symptom (2026-06-29):** Live screen (LiveScreen / wall) showed nothing — viewer
connected, got `stream.connected hasHost:true`, but **0 frames**.

**Root causes (two):**
1. **stream.hub.ts viewer→agent gap.** stream.start was sent ONLY when
   `viewers.get(deviceId).size === 1`. Stale viewers (crashed tabs, or viewers
   that connected while NO agent was attached) stayed in the map → size never 1 →
   new viewer never triggered stream.start → black forever. ALSO: when the host
   agent (re)connected, the hub did NOT re-issue stream.start for devices that
   already had viewers → restarting the agent left every viewer black.
2. **Host agent hung after repeated API restarts.** During the API's tsx-watch
   restarts the agent got "fetch failed" and got stuck (process alive, log frozen,
   never reconnected its /ws/agent-stream). Needed a clean kill + restart.

**Fix (apps/api/src/modules/stream/stream.hub.ts — verified: 10 frames @ ~1.38MB
PNG, ~15fps flowing for Local Phone 01):**
- Viewer join now sends stream.start on EVERY join (not just size===1). Agent's
  startCapture does stopCapture→start, so it's idempotent — safe to re-send.
- New `resumeStreamsForHost(hostId)`: on agent (re)connect, look up every watched
  device on that host (from DB for serial) and re-issue stream.start. Called from
  the agent-connect handler.

**How to (re)start the host agent cleanly** (Windows-side node, NOT WSL):
PowerShell: kill `node.exe` whose CommandLine has `agent.mjs`, then
`Start-Process node.exe -ArgumentList '"C:\Yeni klasör\vps\deploy\kvm-host\agent\agent.mjs"'`
with env FLEET_API_URL=http://localhost:4000, FLEET_API_KEY=<API_KEY>,
FLEET_HOST_KEY=host_6bbbbfe1fd292aa80f2aa1b7ab1a0326, FLEET_ADB=$LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe,
FLEET_STREAM_FPS=15, FLEET_STREAM_W=540, FLEET_POLL_MS=2000 — REDIRECT stdout/stderr to a
log file (-RedirectStandardOutput). Do NOT use restart-agent.ps1 — it sets FLEET_FFMPEG=C:\scrcpy\ffmpeg.exe
which uses the BROKEN ffmpeg→MJPEG path (black screen on this AVD). Omit FLEET_FFMPEG → PNG path (works).
GOTCHA: avoid running MULTIPLE agent.mjs — 5 had piled up and conflicted; kill ALL, run ONE.
Agent good-start log: "starting — polling..." then "stream channel connected"; on viewer
connect: "stream start <deviceId> @ 20fps cap". Host key validity: POST /agent/heartbeat
with x-api-key + x-agent-key → 200 + host id. Only the RUNNING emulator streams: ADB must
list its `ip:adbPort` serial (e.g. 127.0.0.1:5585). Phones whose emulator isn't booted → 0 frames (expected).

**WALL TOUCH NOT WORKING — FIXED (2026-06-29).** Symptom: couldn't tap/swipe the live
screen from /wall (profil detayı LiveScreen worked fine). Cause: the drag-to-reorder
feature I added wrapped each cell in `<div className="wall-cell-drag" draggable>` — a
cell-wide `draggable=true` makes the browser treat every press on the canvas as the start
of a native drag, swallowing onPointerDown/Up so taps never fire. Backend was 100% fine
(verified: adb shell input tap → exit 0; stream.hub relays tap→input.tap correctly).
FIX (WallView.tsx): `draggable` is now ARMED ONLY while grabbing the grip handle —
`const [dragArmed,setDragArmed]=useState(false)`, wrapper `draggable={dragArmed}`, grip
span `onPointerDown=()=>setDragArmed(true)` / `onPointerUp=()=>setDragArmed(false)`, and
onDragEnd resets it. So canvas taps work AND you can still reorder by dragging the grip.
LESSON: never put `draggable` on an element that also needs pointer/touch interaction.