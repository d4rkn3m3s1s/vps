---
name: wsl-nat-networking-fix
description: WSL stack networking — switched from mirrored to NAT mode because dockerd wiped loopback+default routes under the custom binder kernel
metadata: 
  node_type: memory
  type: project
  originSessionId: 27407aa3-afb1-4b1b-8795-dc7f23a050e8
---

The local Android test stack runs in WSL distro **Ubuntu** (user `kali`, sudo password `163244`), NOT a "Kali" distro despite the SETUP-KALI.md naming. Custom binder kernel at `C:\wsl-kernel\bzImage`.

**Root problem (June 2026):** `.wslconfig` had `networkingMode=mirrored`, which is incompatible with the custom kernel + native dockerd. Every time `dockerd` started it wiped the policy route for `127.0.0.0/8` (table 127) AND the default route — making both `localhost` (Postgres/Redis/API) and the internet unreachable (`ip route get 127.0.0.1` → "Network is unreachable", `eth0` stuck DOWN).

**Fix applied:** switched `.wslconfig` to `networkingMode=nat` (WSL2 default). NAT isolates docker's networking from WSL's, so dockerd no longer breaks host routing. Verified: loopback + internet both survive a dockerd start. Old config saved at `C:\Users\furka\.wslconfig.bak-mirrored`.

**Also:** `deploy/local-test/daemon.json` MUST be `{ "iptables": false, "ip6tables": false, "bridge": "none" }` — something had flipped it to `iptables:true, bridge:docker0` which made dockerd fail to start (no nat iptables table in the custom kernel).

Bring-up is now a one-shot: `SUDO_PASS=163244 bash deploy/local-test/_session-up.sh` (binder→dockerd→db→redroid + a loopback-route guard). Then adb server via background `adb -a -P 5037 nodaemon server`, then API `npm run dev`, then register.mjs + agent. See [[run-commands-on-kali-host]] and [[local-android-test-stack]].

**adb gotcha:** in `wsl -d Ubuntu bash -lc '...'`, assigning `SER=127.0.0.1:5555` then using `$SER` breaks (var expands empty → `adb -s "" shell echo` → "unknown command"). Use the literal serial inline, or put logic in a script FILE invoked with a single-quoted absolute path (the repo has `_ui.sh`, `_session-up.sh` etc. for this).
