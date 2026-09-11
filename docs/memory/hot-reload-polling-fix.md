---
name: hot-reload-polling-fix
description: "Hot-reload/HMR did not fire on /mnt/c (WSL inotify can't see Windows-mount changes) — fixed with file-watch POLLING + Turbopack. Edits now apply without restart."
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

**Problem (2026-06-29):** Dashboard + API edits did NOT hot-reload — had to manually
stop/start ("ac kapa") every time. Root cause: source lives on `/mnt/c` (Windows
filesystem) but dev servers run in WSL Ubuntu; **WSL cannot receive inotify events
for 9p Windows-mount files**, so native file watching never fires.

**Fix (applied + verified — log grows + recompiles instantly on edit):**
- **Dashboard** `apps/dashboard/package.json` dev script →
  `WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=true CHOKIDAR_INTERVAL=800 next dev --turbopack`
  (added `--turbopack` too — faster + better on WSL; `dev:webpack` kept as fallback).
  Also `next.config.mjs` got `webpack: (cfg,{dev}) => { if(dev) cfg.watchOptions={poll:800,aggregateTimeout:250}; return cfg }`
  (covers the webpack dev path; Turbopack reads the env vars not the config fn).
- **API** `apps/api/package.json` dev script →
  `CHOKIDAR_USEPOLLING=true CHOKIDAR_INTERVAL=800 tsx watch src/index.ts`
  (tsx watch uses chokidar → CHOKIDAR_USEPOLLING fixes its stale-code problem too,
  which previously forced manual API restarts — see [[session-state-profiles-fixes]]).

**How to (re)start so they SURVIVE the launching shell:** plain `nohup ... &` inside
`wsl -d Ubuntu bash -lc '...'` DIES when that cmd session ends, AND `setsid nohup`
was flaky. Most reliable here: launch each via the Bash tool's **run_in_background**
with `wsl -d Ubuntu bash -lc 'cd "/mnt/c/Yeni klasör/vps/apps/<api|dashboard>" && exec npm run dev'`.
Turbopack first boot ~15-20s; API ~12s. Verify: API `curl /health`→200, web→307.
Kill stale first by PID (pkill patterns miss next-server) and free :3000/:4000.

Trade-off: polling uses a bit more CPU than inotify, but it's the only thing that
works on /mnt/c. Long-term better: move repo into the WSL filesystem (~/...) — then
native watching works and builds are much faster. Not done yet (repo is on C:).

**RELATED FIX (2026-06-29) — offline FONTS.** Same no-internet-in-WSL cause: the
dashboard used `next/font/google` (Space_Grotesk, IBM_Plex_Mono) + external <link>
to fonts.googleapis.com (Inter/Manrope) + onlinewebfonts (PODIUM). ALL failed to
load offline → whole UI fell back to Trebuchet/monospace and looked cheap/broken
(log spammed "Error while requesting resource"). FIX: removed all next/font + <link>
font imports from app/layout.tsx; defined `--font-sans`/`--font-mono` in globals.css
:root as SYSTEM font stacks (Segoe UI Variable / ui-monospace). CSS that named
'Inter'/'Manrope' falls through to var(--font-sans). After editing layout, MUST clear
`.next` (Turbopack cached the old next/font module) — `rm -rf apps/dashboard/.next`
from the Windows side then restart. Verified: 0 font errors, all pages 200.

**Audit conclusion (2026-06-29):** ran full sweep — all 48 routes return 200 (no
crashes), grep found ZERO "yakında/TODO/mock/coming-soon" stubs. The dashboard is
essentially fully implemented. Only intentional disabled feature: settings/page.tsx
"Tehlikeli bölge" (workspace reset/delete) — disabled on purpose pending a backup
policy; no backend endpoint exists. Left as-is (would be a large, risky addition).