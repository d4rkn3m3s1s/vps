#!/usr/bin/env bash
# VPS Fleet — LOCAL TEST one-shot boot for Kali WSL2 (custom binder kernel)
#
# Run this in Kali after a Windows restart to bring the whole local test stack
# back up, in order:
#   1. mount binderfs (redroid needs it; it doesn't survive a restart)
#   2. start the native Docker daemon in the background (bridge disabled)
#   3. bring up Postgres + Redis (host network)
#   4. bring up the two redroid phones (host network)
#   5. wait for Android to finish booting, print adb devices
#
# It is idempotent — safe to re-run. It does NOT install packages (no internet
# needed). Run with:  bash deploy/local-test/boot-kali.sh
#
# After it finishes: run the API (npm run dev in apps/api), then register.mjs.

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log()  { printf '\033[1;36m[boot]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ok]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }

# 1. binderfs ----------------------------------------------------------------
log "Mounting binderfs…"
sudo mkdir -p /dev/binderfs
if ! mount | grep -q '/dev/binderfs'; then
  sudo mount -t binder binder /dev/binderfs 2>/dev/null \
    && ok "binderfs mounted" \
    || warn "binderfs mount failed — is the custom kernel active? (uname -r should end in +)"
else
  ok "binderfs already mounted"
fi
ls /dev/binderfs/ 2>/dev/null | tr '\n' ' '; echo

# 2. Docker daemon -----------------------------------------------------------
if sudo docker info >/dev/null 2>&1; then
  ok "Docker daemon already running"
else
  log "Starting Docker daemon in background (bridge disabled)…"
  # daemon.json was written earlier with { iptables:false, ip6tables:false, bridge:"none" }
  sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
  for i in $(seq 1 30); do
    if sudo docker info >/dev/null 2>&1; then ok "Docker daemon up"; break; fi
    sleep 1
  done
  sudo docker info >/dev/null 2>&1 || { warn "Docker still not up — check /tmp/dockerd.log"; tail -15 /tmp/dockerd.log; exit 1; }
fi

# 3. Postgres + Redis --------------------------------------------------------
log "Bringing up Postgres + Redis (host network)…"
sudo docker compose -f "$HERE/db-hostnet.yml" up -d
log "Waiting for Postgres to accept connections…"
for i in $(seq 1 30); do
  if sudo docker exec fleet-local-postgres pg_isready -U postgres >/dev/null 2>&1; then ok "Postgres ready"; break; fi
  sleep 1
done

# 4. redroid phones ----------------------------------------------------------
log "Bringing up redroid phones (host network)…"
sudo docker compose -f "$HERE/docker-compose.hostnet.yml" up -d

# 5. Wait for Android + adb --------------------------------------------------
log "Connecting adb + waiting for Android to boot (first boot ~30–90s)…"
adb start-server >/dev/null 2>&1 || true
adb connect 127.0.0.1:5555 >/dev/null 2>&1 || true
for i in $(seq 1 60); do
  state=$(adb -s 127.0.0.1:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  if [ "$state" = "1" ]; then ok "phone-01 boot completed"; break; fi
  sleep 2
done
echo
log "Devices:"
adb devices

cat <<'EOF'

──────────────────────────────────────────────────────────────────────────────
 Stack is up. Next:
   1. Start the API:        cd "/mnt/c/Yeni klasör/vps/apps/api" && npm run dev
   2. (first time only) migrate + seed — see SETUP-KALI.md
   3. Register the phone:   see SETUP-KALI.md  (register.mjs)
   4. Start the host agent: command printed by register.mjs
──────────────────────────────────────────────────────────────────────────────
EOF
