#!/usr/bin/env bash
# Session bring-up: binderfs + dockerd + db + redroid. Run inside Ubuntu WSL.
# Usage: SUDO_PASS=xxx bash _session-up.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S() { echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }

# 1. binderfs
S mkdir -p /dev/binderfs
mount | grep -q /dev/binderfs || S mount -t binder binder /dev/binderfs
echo "binder: $(ls /dev/binderfs 2>/dev/null | tr '\n' ' ')"

# 2. dockerd (detached, survives this shell)
if S docker info >/dev/null 2>&1; then
  echo "docker: already up"
else
  echo "$SUDO_PASS" | sudo -S nohup setsid dockerd >/tmp/dockerd.log 2>&1 < /dev/null &
  for i in $(seq 1 40); do S docker info >/dev/null 2>&1 && break; sleep 1; done
  S docker info >/dev/null 2>&1 && echo "docker: UP" || { echo "docker: FAILED"; S tail -15 /tmp/dockerd.log; exit 1; }
fi

# 2b. Loopback fix — under mirrored WSL networking + custom kernel, starting
# dockerd wipes the policy rule that routes 127.0.0.0/8 to table 127, which
# makes localhost (Postgres/Redis/API) unreachable. Re-add it (idempotent).
if ! ip route get 127.0.0.1 >/dev/null 2>&1; then
  S ip rule add to 127.0.0.0/8 lookup 127 2>/dev/null || true
  S ip rule add from 127.0.0.0/8 lookup 127 2>/dev/null || true
fi
ip route get 127.0.0.1 >/dev/null 2>&1 && echo "loopback: ok" || echo "loopback: STILL BROKEN"

# 3. Postgres + Redis
S docker compose -f "$HERE/db-hostnet.yml" up -d >/dev/null 2>&1
for i in $(seq 1 30); do S docker exec fleet-local-postgres pg_isready -U postgres >/dev/null 2>&1 && { echo "postgres: ready"; break; }; sleep 1; done

# 4. redroid phones
S docker compose -f "$HERE/docker-compose.hostnet.yml" up -d >/dev/null 2>&1
echo "redroid: started"

# 5. adb + wait boot
adb start-server >/dev/null 2>&1 || true
adb connect 127.0.0.1:5555 >/dev/null 2>&1 || true
for i in $(seq 1 60); do
  st=$(adb -s 127.0.0.1:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  [ "$st" = "1" ] && { echo "phone-01: booted"; break; }
  sleep 2
done
echo "=== adb devices ==="
adb devices
