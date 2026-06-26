#!/usr/bin/env bash
# Dispatch a real REGISTER_WHATSAPP job on phone-01 via the API, with the rented
# sms-bus number. The agent drives EULA -> Register new account -> number ->
# (stops at OTP_WAIT). We then poll sms-bus for the OTP and re-dispatch with it.
API=http://localhost:4000
KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
NUMBER="${1:-6285165139215}"
NAME="${2:-Aylin Demir}"

TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -H "x-api-key: $KEY" \
  -d '{"email":"admin@local.dev","password":"Admin2026!"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
AUTH=(-H "x-api-key: $KEY" -H "Authorization: Bearer $TOKEN")

# phone-01 device id (the ONLINE Local Phone 01 on local-wsl2)
DID=$(echo "163244" | sudo -S docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc \
  "SELECT id FROM \"Device\" WHERE name='Local Phone 01';" 2>/dev/null | tr -d '[:space:]')
echo "phone-01 device id: $DID"
echo "number: $NUMBER  name: $NAME"

echo "=== dispatch REGISTER_WHATSAPP (no otp yet) ==="
RESP=$(curl -s -X POST "$API/jobs" -H 'Content-Type: application/json' "${AUTH[@]}" \
  -d "{\"type\":\"REGISTER_WHATSAPP\",\"emulatorId\":\"$DID\",\"payload\":{\"phoneNumber\":\"$NUMBER\",\"fullName\":\"$NAME\"}}")
echo "$RESP"
JOBID=$(echo "$RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
echo "job id: $JOBID"

echo "=== wait up to 90s for agent to drive the flow ==="
for i in $(seq 1 30); do
  sleep 3
  J=$(curl -s "${AUTH[@]}" "$API/jobs/$JOBID")
  st=$(echo "$J" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -1)
  echo "  [$i] status=$st"
  if [ "$st" = "COMPLETED" ] || [ "$st" = "FAILED" ]; then
    echo "=== result ==="
    echo "$J" | head -c 1200; echo ""
    break
  fi
done
