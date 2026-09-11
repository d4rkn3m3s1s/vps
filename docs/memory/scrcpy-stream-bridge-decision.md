---
name: scrcpy-stream-bridge-decision
description: User chose scrcpy/H.264 bridge for smooth live streaming (raw-PNG screencap caps at ~3fps)
metadata: 
  node_type: memory
  type: project
  originSessionId: 2081351c-b595-4abe-a7a4-8341d8fdd198
---

Live screen streaming bottleneck is **device-side PNG encode**, not the WS pipeline. Measured 2026-06-20: raw `adb exec-out screencap -p` tops out at **~3 fps** even at 600x1280 (~550KB/frame). Fixing WS backpressure/fps already done; can't go faster while the agent stays zero-dep (no codec).

**User decision: build a scrcpy/ffmpeg H.264 bridge** for real 30-60fps. Constraint: agent.mjs core must stay zero-dependency (Node built-ins only) — so scrcpy runs as a SEPARATE optional bridge process, NOT an npm import inside agent.mjs. This is what competitors (Multilogin/VMOS/DuoPlus) do.

**Not built yet** — pending after the local test stack feature validation. See [[local-android-test-stack]].

**Recon 2026-06-20:** host has NO scrcpy and NO ffmpeg (must install — host tools, not agent, so no zero-dep violation). redroid `dumpsys media.player` showed no H.264 hardware encoder (software render) — so scrcpy's hardware-encode path may not exist; MJPEG-via-ffmpeg (software) is the safer route the user picked. screencap baseline reconfirmed ~3 fps.

**Why:** raw PNG over WS is the codec-free fallback; fine for occasional screenshots, too slow for smooth live control.
**How to apply:** when implementing, keep the existing raw-PNG path as fallback; add scrcpy bridge as the preferred path when available on the host.