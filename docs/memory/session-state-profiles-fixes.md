---
name: session-state-profiles-fixes
description: "WIP snapshot (2026-06-29): live-stack debugging + UI/agent fix requests. Rate-limit bug fixed; stream→canvas; pending design+agent+rpa+synchronizer+geohub+wall work."
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

**Live stack state (2026-06-29):** Full stack UP and verified. API :4000 (200), dashboard :3000 (200),
3 AVD devices ONLINE (wa01=127.0.0.1:5585), host agent running on **PNG screencap path**
(FLEET_FFMPEG/H264_RAW both OFF — ffmpeg pipeline was broken: "Output file does not contain any stream").
Agent started via Bash background with env FLEET_API_URL=http://localhost:4000,
FLEET_API_KEY=<API_KEY>, FLEET_HOST_KEY=host_6bbbbfe1fd292aa80f2aa1b7ab1a0326,
FLEET_ADB=$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe, FLEET_POLL_MS=2000, FLEET_STREAM_FPS=15.
Stack brought up via up.cmd→up.sh (WSL Ubuntu); migrations applied via `prisma migrate deploy`. See [[local-stack-startup]].

**FIXED this session (all tsc-clean):**
1. **Rate-limit 429 (THE big bug that made everything look broken):** `apps/api/src/middleware/rateLimit.ts`
   global limiter was 120/min for ALL of localhost/WSL (one IP). Agent polling + dashboard apiClient +
   stream flooded it → agent got 429 on /agent/jobs/next → NO jobs ran → shell/AI/console all dead.
   Fix: added `skip:` exempting `/health`, `/agent*`, `/stream*`; raised RATE_LIMIT_MAX to 2000 in apps/api/.env.
   ALSO: multiple stale tsx/next processes had piled up holding :4000/:3000 — must `pkill -9 -f index.ts`
   and `-f next` then start ONE clean instance (stale process held OLD code so fixes didn't apply).
2. **Stream black-screen + flicker:** ffmpeg→MJPEG path broken on this AVD. Switched agent to PNG path.
   Rewrote rendering to **canvas + createImageBitmap** (atomic paint, no `<img>.src` blank flicker) in
   BOTH apps/dashboard/src/app/wall/useDeviceStream.ts (now takes canvasRef) AND
   apps/dashboard/src/app/profiles/[id]/LiveScreen.tsx (single canvas, removed <img>+usingH264 toggle).
3. **Logo:** new apps/dashboard/src/components/BrandLogo.tsx (red-noir cloud-phone + orbit SVG) wired into
   Sidebar, Preloader, + new app/icon.svg favicon.
4. **Profiles design:** .create-card-btn CSS, .card-avatar badge, .select-check (was 36px grey box→18px),
   live 5s device polling (tab-hidden guard), fingerprint "Cihaza uygula" button + /api/fingerprints/[deviceId]/apply.
5. Known noise: `generateIdentity` in accounts/identity.provider.ts throws "fetch failed" repeatedly
   (external identity SaaS unreachable) — floods logs; relevant to "hesap fabrikası kimlik üretmiyor".

**DONE 2026-06-29 (big batch — all 8 items, both apps tsc-clean):**
1. **Account farm identity gen FIXED + verified.** identity.provider.ts rewritten **offline-first**:
   curated per-country (US/GB/TR/DE) name+address+phone+password pools, deterministic xorshift rng
   (no Math.random — unavailable). `generateIdentity` only hits network if IDENTITY_BASE_URL differs
   from default randomuser.me, and falls back to offline on any error → NEVER "fetch failed" again.
   FakeIdentity gained `password` + `source:'offline'|'network'`. Verified: TR→"Elif Şahin/Antalya",
   US→"Harper Garcia/Seattle", source:offline. (mail makeAddress already worked offline; batch mints
   inbox separately so identity.email's trailing "@" is harmless.)
2. **Wall (/wall) zoom/single-open/drag/focus DONE.** WallView.tsx: FocusOverlay (büyüt/odak — expand
   btn or double-click → large single device, physical keyboard via onKeyDown→text/keycode, nav bar);
   HTML5 drag-to-reorder cells (.wall-cell-drag wrapper owns draggable+drop; order persisted to
   localStorage 'wall.order.v1'). hud.tsx Holo3D got an onDoubleClick prop (NOT drag props — framer
   overloads onDragStart). New CSS: .wall-cell-grip/-expand/-dragover/-drag + .focus-overlay/-shell/etc.
3. **"Broken design" ROOT CAUSE = undefined CSS classes** (Explore agent found them). Added to globals.css:
   `.holo-card` + .holo-card-top/-ico/-body/-title/-meta (FleetHub /geehub cards were unstyled gray boxes),
   `.modal-body` (RPA+Farm modals), `.holo-page` (farm wrapper), `.farm-dist-label`. THIS fixed /geehub,
   /rpa, /synchronizer, farm "tasarım bozuk" — components+other CSS were already fine.
4. **/rpa improved:** Hızlı şablonlar (3 templates: IG/TikTok/launch) seed editor; "Çoğalt" duplicate btn;
   .rpa-template* CSS.
5. **AI device agent improved** (modules/device-agent/device-agent.service.ts): loop-breaker (same action
   sig 3x→hard nudge via tool_result, 4x→abort), no-change streak (4 unchanged screens→graceful abort),
   swipe added to unchanged-detection, stronger system prompt (scroll-to-find, self-correct, don't loop).
6. **Perf:** new lib/usePolling.ts (visibility-aware — skips ticks when tab hidden, catches up on focus).
   Applied to JobsView(4s), HealthView(15s), AiAgentView(2s). AccountsView OTP poll left as-is (on-demand).

**GOTCHA HIT THIS SESSION:** `tsx watch` on /mnt/c (Windows mount) MISSES file changes (9p inotify
unreliable) → API ran STALE code, identity still threw old "fetch failed" at old line 71. FIX: must
RESTART the API to pick up apps/api edits. Launch detached so it survives the WSL cmd session:
`cd /mnt/c/.../apps/api && setsid nohup npm run dev > /tmp/api.log 2>&1 < /dev/null & disown`
(plain `nohup ... &` DIES when the wsl -d Ubuntu bash -lc session ends). Next.js dev DOES hot-reload fine.
Login for tests: POST /auth/login with x-api-key + body, NO x-service-auth header (that header breaks it).
