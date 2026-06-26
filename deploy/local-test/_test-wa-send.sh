#!/usr/bin/env bash
# End-to-end test: dispatch a WHATSAPP_SEND job to the online device and watch it
# run on the redroid phone. Uses the API directly (login → create job).
set -u
API=http://localhost:4000
KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
DEVICE=cmqlrf4ni000gj50fjimgvk4u
TO="${1:-905551234567}"
MSG="${2:-Merhaba, bu bir test mesajidir}"

# 1) Login as admin → JWT
JWT=$(curl -s -X POST "$API/auth/login" -H 'content-type: application/json' \
  -H "x-api-key: $KEY" \
  -d '{"email":"admin@local.dev","password":"Admin2026!"}' \
  | grep -oE '"(accessToken|token)":"[^"]+"' | head -1 | sed 's/.*:"//;s/"//')
if [ -z "$JWT" ]; then echo "LOGIN FAILED"; exit 1; fi
echo "got JWT (${#JWT} chars)"

# 2) Create a WHATSAPP_SEND job for the online device
BODY=$(printf '{"type":"WHATSAPP_SEND","emulatorId":"%s","payload":{"to":"%s","message":"%s"}}' "$DEVICE" "$TO" "$MSG")
RES=$(curl -s -X POST "$API/jobs" -H 'content-type: application/json' \
  -H "x-api-key: $KEY" -H "authorization: Bearer $JWT" -d "$BODY")
echo "job create response: $RES"
JOBID=$(echo "$RES" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/.*:"//;s/"//')
echo "JOB_ID=$JOBID"

# 3) Poll the job for completion
for i in $(seq 1 20); do
  sleep 3
  J=$(curl -s "$API/jobs/$JOBID" -H "x-api-key: $KEY" -H "authorization: Bearer $JWT")
  ST=$(echo "$J" | grep -oE '"status":"[^"]+"' | head -1 | sed 's/.*:"//;s/"//')
  echo "[$i] status=$ST"
  if [ "$ST" = "COMPLETED" ] || [ "$ST" = "FAILED" ]; then echo "RESULT: $J"; break; fi
done
