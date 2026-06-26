#!/usr/bin/env bash
# Report current stack state: listening ports, docker phones, and DB host/device rows.
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_stack.out"
SUDO_PASS=163244
SU(){ echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }
: > "$OUT"

echo "=== listening ports ===" >> "$OUT"
ss -tlnp 2>/dev/null | grep -E ':(4000|3000|5432|6379)\b' >> "$OUT" 2>&1 || echo "(none of 4000/3000/5432/6379)" >> "$OUT"

echo "=== docker containers ===" >> "$OUT"
SU docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' >> "$OUT" 2>&1 || echo "(docker not up)" >> "$OUT"

echo "=== DB hosts ===" >> "$OUT"
SU docker exec fleet-local-postgres psql -U postgres -d fleet -t -c 'SELECT id, name, status, "agentKeyHash" IS NOT NULL AS has_key FROM "Host";' >> "$OUT" 2>&1 || echo "(db query failed)" >> "$OUT"

echo "=== DB devices ===" >> "$OUT"
SU docker exec fleet-local-postgres psql -U postgres -d fleet -t -c 'SELECT id, name, status, "hostId", serial FROM "Device" LIMIT 20;' >> "$OUT" 2>&1 || echo "(db query failed)" >> "$OUT"

echo "=== RESULT ==="; cat "$OUT"
