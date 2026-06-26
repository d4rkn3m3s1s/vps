#!/usr/bin/env bash
# Bring up ONLY the data + app services (no redroid phones): dockerd, postgres,
# redis. Then report readiness. API + dashboard are started separately as
# persistent processes. This is the redroid-free stack for the Windows AVD path.
SUDO_PASS=163244
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_svc.out"
HERE="/mnt/c/Yeni klasör/vps/deploy/local-test"
SU(){ echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }
: > "$OUT"

# binderfs not needed (no redroid). Just docker for DB/redis.
if SU docker info >/dev/null 2>&1; then
  echo "docker=already-up" >> "$OUT"
else
  echo "$SUDO_PASS" | sudo -S nohup setsid dockerd >/tmp/dockerd.log 2>&1 </dev/null &
  for i in $(seq 1 40); do SU docker info >/dev/null 2>&1 && break; sleep 1; done
  echo "docker=$(SU docker info >/dev/null 2>&1 && echo up || echo FAIL)" >> "$OUT"
fi

# loopback policy rule (dockerd can wipe lo routing)
ip route get 127.0.0.1 >/dev/null 2>&1 || { SU ip rule add to 127.0.0.0/8 lookup 127 2>/dev/null; SU ip rule add from 127.0.0.0/8 lookup 127 2>/dev/null; }

SU docker compose -f "$HERE/db-hostnet.yml" up -d >/dev/null 2>&1
for i in $(seq 1 30); do SU docker exec fleet-local-postgres pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
echo "postgres=$(SU docker exec fleet-local-postgres pg_isready -U postgres 2>&1 | tr -d '\r')" >> "$OUT"
echo "redis=$(SU docker exec fleet-local-redis redis-cli ping 2>&1 | tr -d '\r')" >> "$OUT"
echo "db_exists=$(SU docker exec fleet-local-postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='vps_emulator'" 2>&1 | tr -d '\r')" >> "$OUT"

echo "=== RESULT ==="; cat "$OUT"
