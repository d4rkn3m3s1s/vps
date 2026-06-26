#!/usr/bin/env bash
S() { echo "163244" | sudo -S "$@" 2>/dev/null; }
echo "==================== STACK HEALTH ===================="

echo "--- 1. docker containers ---"
S docker ps --format '{{.Names}}  {{.Status}}'

echo "--- 2. adb devices ---"
adb devices | grep -v "^List"

echo "--- 3. API /health ---"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:4000/health
curl -s http://localhost:4000/health; echo ""

echo "--- 4. Dashboard pages (server-side fetch through API) ---"
for p in /login / /profiles /accounts /farm; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000$p" 2>/dev/null)
  echo "  $p -> $code"
done

echo "--- 5. Agent heartbeat (host ONLINE, recent) ---"
S docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc \
  "SELECT name||' '||status||' last='||COALESCE(\"lastSeenAt\"::text,'never') FROM \"Host\" WHERE name='local-wsl2';"

echo "--- 6. Phone-01 device row ---"
S docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc \
  "SELECT name||' '||status||' '||COALESCE(\"ipAddress\",'')||':'||COALESCE(\"adbPort\"::text,'') FROM \"Device\" WHERE name='Local Phone 01';"

echo "--- 7. listening ports ---"
ss -ltn 2>/dev/null | grep -E ':(3000|4000|5037|5555|5432|6379)\b' | awk '{print $4}'

echo "--- 8. recent agent log ---"
tail -3 /tmp/agent.log
echo "====================================================="
