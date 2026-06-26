#!/usr/bin/env bash
# Bring up ONLY the data services needed for the frontend: binderfs (so docker
# is happy), dockerd, Postgres + Redis (host-net). Skips redroid phones.
SUDO_PASS=163244
S(){ echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }
HERE="/mnt/c/Yeni klasör/vps/deploy/local-test"

S mkdir -p /dev/binderfs
mount | grep -q /dev/binderfs || S mount -t binder binder /dev/binderfs

if S docker info >/dev/null 2>&1; then
  echo "docker: already up"
else
  echo "$SUDO_PASS" | sudo -S nohup setsid dockerd >/tmp/dockerd.log 2>&1 </dev/null &
  for i in $(seq 1 40); do S docker info >/dev/null 2>&1 && break; sleep 1; done
  S docker info >/dev/null 2>&1 && echo "docker: UP" || { echo "docker: FAILED"; S tail -15 /tmp/dockerd.log; exit 1; }
fi

# loopback policy rule (dockerd wipes it on this kernel)
if ! ip route get 127.0.0.1 >/dev/null 2>&1; then
  S ip rule add to 127.0.0.0/8 lookup 127 2>/dev/null || true
  S ip rule add from 127.0.0.0/8 lookup 127 2>/dev/null || true
fi
ip route get 127.0.0.1 >/dev/null 2>&1 && echo "loopback: ok" || echo "loopback: BROKEN"

S docker compose -f "$HERE/db-hostnet.yml" up -d 2>&1 | tail -4
for i in $(seq 1 30); do
  S docker exec fleet-local-postgres pg_isready -U postgres >/dev/null 2>&1 && { echo "postgres: ready"; break; }
  sleep 1
done
S docker exec fleet-local-redis redis-cli ping 2>/dev/null | tr -d '\r' | sed 's/^/redis: /'
echo "=== containers ==="
S docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null
