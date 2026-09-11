---
name: local-stack-startup
description: "ONE command to bring up the full local stack + the WSL↔Windows bridge gotcha that causes \"bilinmiyor\" services"
metadata: 
  node_type: memory
  type: project
  originSessionId: f759a3b2-5af6-41bc-84c4-481e3e98ff97
---

Bring the whole local stack up with ONE command: `up.cmd` in repo root (or `wsl -d Ubuntu bash -lc 'bash "/mnt/c/Yeni klasör/vps/deploy/local-test/up.sh"'`).

**Architecture that works:** BOTH the API (:4000) and the dashboard (:3000) run INSIDE WSL (Ubuntu distro, user `kali`) so the dashboard→API call goes over WSL-internal localhost (the NAT localhost bridge is unreliable here). The browser on Windows reaches them via a **Windows portproxy** (`netsh interface portproxy ... 127.0.0.1:300X → <wsl-ip>:300X`), which `up.cmd` sets up dynamically from `wsl hostname -I`.

**up.sh does 5 gated steps:** data layer (binderfs+dockerd+Postgres+Redis), **env preflight** (verifies API/dashboard `.env` ADMIN_PASSWORD+EMAIL+API_KEY MATCH — a mismatch makes every dashboard page show "bilinmiyor"), API /health, dashboard /login, end-to-end service-identity login + /system/overview health.

**The recurring "Servisler: bilinmiyor / bağlı değil" bug has TWO root causes** — both now guarded:
1. **dockerd wipes WSL's default route AND loopback policy rule** on this custom binder kernel → Windows↔WSL bridge dies. up.sh captures `ip route show default` BEFORE dockerd and restores it after (plus the `ip rule ... lookup 127` loopback fix). If still broken: `wsl --shutdown` resets the network cleanly, then re-run up.sh.
2. **Password mismatch:** dashboard `.env` had `Admin2026!`, API/DB had `Admin2026`. The dashboard logs in as a service identity (`apiClient.serviceLogin`, `x-service-auth:1`) to fetch page data; wrong password → all `serverFetch` returns null → every KPI/service shows 0/"bilinmiyor". Source of truth = `apps/api/.env` (must match the DB). See [[run-commands-on-kali-host]] and [[wsl-nat-networking-fix]].

Login: admin@local.dev / Admin2026. Dashboard http://localhost:3000, API http://localhost:4000.
