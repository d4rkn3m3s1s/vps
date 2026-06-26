#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null
echo "==================== FINAL 3-PHONE STACK CHECK ===================="

echo "--- containers ---"
sudo docker ps --format '{{.Names}}  {{.Status}}' | grep -E 'phone|postgres|redis'

echo "--- adb devices ---"
adb devices | grep -v '^List'

echo "--- API /health ---"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:4000/health

echo "--- forwarders alive ---"
sudo pgrep -af netns-forward.mjs | head -1 || echo "  FORWARDER DOWN"

echo "--- devices via API (server-side, through dashboard session) ---"
JAR=/tmp/fleet-cookies.txt; rm -f "$JAR"
curl -s -c "$JAR" -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.dev","password":"Admin2026!"}' >/dev/null
# device status summary the overview uses
echo -n "  summary: "
curl -s -b "$JAR" http://localhost:3000/api/devices/status/summary 2>/dev/null
echo ""
echo -n "  device list count: "
curl -s -b "$JAR" http://localhost:3000/api/devices 2>/dev/null | grep -o '"id"' | wc -l

echo "--- DB device states ---"
sudo docker exec fleet-local-postgres psql -U postgres -d vps_emulator -F $'\t' -A -c \
"SELECT name, status, COALESCE(\"ipAddress\",'')||':'||\"adbPort\" FROM \"Device\" ORDER BY name;"

echo "--- live screencap test on each phone (proves adb path works now) ---"
for port in 5555 5556 5557; do
  sz=$(adb -s 127.0.0.1:$port exec-out screencap -p 2>/dev/null | wc -c)
  echo "  :$port screencap bytes=$sz"
done

echo "--- agent heartbeat (host) ---"
sudo docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc \
"SELECT name||' '||status||' last='||\"lastSeenAt\"::text FROM \"Host\" WHERE name='local-wsl2';"
echo "=================================================================="
