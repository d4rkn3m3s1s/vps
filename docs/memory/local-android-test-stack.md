---
name: local-android-test-stack
description: "How the local redroid Android test stack runs on Kali WSL2 (bridge net, custom kernel modules, bring-up order)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2081351c-b595-4abe-a7a4-8341d8fdd198
---

Local Android test infra runs redroid containers on **Kali WSL2** with a hand-compiled custom kernel (`6.6.123.2-microsoft-standard-WSL2+`, build tree at `/home/kali/wsl-kernel`, bzImage at `C:\wsl-kernel\bzImage` via `.wslconfig`).

**Working architecture (after 2026-06-20 debugging):**
- **Networking: BRIDGE mode, not host-net.** Host-net made two redroid instances collide on ADB port 5555 (redroid_adbd_port boot arg is ignored on host-net) → phone-01 crash-looped (exit 129). Bridge mode gives each phone its own netns/IP, publish to distinct host ports.
- **WSL `.wslconfig`: `networkingMode=mirrored` + `dnsTunneling=true`** — NAT mode kept losing the default route; mirrored is stable. resolv.conf pinned to 1.1.1.1/8.8.8.8 with `generateResolvConf=false` (mirrored DNS proxy 10.255.255.254 isn't reachable from the docker bridge).
- **Custom kernel ships bridge/netfilter as LOADABLE modules but doesn't auto-load them.** Must `modprobe` before dockerd or it dies ("Table does not exist" / "addrtype ... missing kernel module"). Also force **legacy** iptables (`update-alternatives --set iptables /usr/sbin/iptables-legacy`) — modules are legacy ip_tables, not nft. The bring-up script `deploy/local-test/net-up.sh` does all of this + `iptables -P FORWARD ACCEPT`.

**Bring-up order (each fresh WSL session):**
1. `sudo bash deploy/local-test/net-up.sh` (modules + legacy iptables + FORWARD ACCEPT + start docker + container-egress sanity)
2. `sudo docker compose -f deploy/local-test/docker-compose.db.yml up -d` (postgres+redis, bridge, published 5432/6379)
3. `sudo docker compose -f deploy/local-test/docker-compose.bridge.yml up -d` (phones; first boot reads 600x1280 boot args — wipe volume with `down -v` to change res)
4. `adb connect 127.0.0.1:5555 ; adb connect 127.0.0.1:5556`
5. API: `cd apps/api && setsid npx tsx src/index.ts >/tmp/api.log 2>&1 </dev/null &` (NO `tsx watch` = EBADF; NO `env $(...)` = .env has spaces, dotenv loads it itself; first compile ~20s on /mnt/c)
6. register: `node deploy/local-test/register.mjs admin@local.dev 'Admin2026!'` with FLEET_API_KEY=DEFAULT_API_KEY — prints a fresh FLEET_HOST_KEY (shown once)
7. agent: `setsid env FLEET_API_URL=... FLEET_API_KEY=... FLEET_HOST_KEY=... node deploy/kvm-host/agent/agent.mjs >/tmp/agent.log 2>&1 </dev/null & disown` (start in a SEPARATE block from pkill or it catches its own signal)

**Local creds (test only):** admin@local.dev / Admin2026! ; DEFAULT_API_KEY in apps/api/.env.

**Verified working 2026-06-20:** 2 phones online+synced, internet on both, APK install (Success), proxy set/clear, RPA_RUN on both phones concurrently, full dashboard→API→job→agent→device→COMPLETED loop. Known open: stream still raw-PNG ~3fps (user chose scrcpy bridge — not built yet). See [[scrcpy-stream-bridge-decision]].