#!/usr/bin/env bash
# End-to-end proof: queue a SCREENSHOT job on each of the 3 devices through the
# API and confirm the agent (local-wsl2) executes it over adb and reports back.
echo "163244" | sudo -S true 2>/dev/null
API=http://localhost:4000
KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
PSQL='sudo docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc'

# Get a JWT via admin login (the API issues access tokens).
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -H "x-api-key: $KEY" \
  -d '{"email":"admin@local.dev","password":"Admin2026!"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
echo "token: ${TOKEN:0:18}..."

# Device IDs
mapfile -t ROWS < <(eval $PSQL "\"SELECT id||' '||name FROM \\\"Device\\\" WHERE name LIKE 'Local Phone%' ORDER BY name;\"" 2>/dev/null)
for row in "${ROWS[@]}"; do
  DID=$(echo "$row" | awk '{print $1}')
  DNAME=$(echo "$row" | cut -d' ' -f2-)
  [ -z "$DID" ] && continue
  echo "--- queueing SCREENSHOT on $DNAME ($DID) ---"
  RESP=$(curl -s -X POST "$API/jobs" \
    -H 'Content-Type: application/json' \
    -H "x-api-key: $KEY" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"type\":\"EMULATOR_SCREENSHOT\",\"emulatorId\":\"$DID\",\"payload\":{}}")
  echo "  resp: $RESP"
done

echo "=== wait 12s for agent to poll+run ==="
sleep 12
echo "=== recent jobs (status) ==="
eval $PSQL "\"SELECT type||'  '||status||'  dev='||COALESCE((SELECT name FROM \\\"Device\\\" d WHERE d.id=j.\\\"deviceId\\\"),'?') FROM \\\"Job\\\" j ORDER BY \\\"createdAt\\\" DESC LIMIT 6;\"" 2>/dev/null
echo "=== agent log tail ==="
tail -10 /tmp/agent.log
