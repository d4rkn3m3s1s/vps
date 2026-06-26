#!/usr/bin/env bash
# Dispatch a REGISTER_WHATSAPP job, then run the agent BLOCKING (foreground) so
# it claims + drives it (background agents die in this WSL state). The agent
# exits on its own after the job; we cap with timeout. Args: $1=number $2=name
API=http://localhost:4000
KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
NUM="${1:-905551234567}"
NAME="${2:-Test User}"
SUDO_PASS=163244
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_dispatch-run.out"
: > "$OUT"

# clean WA + set ADBKeyboard
export ANDROID_SERIAL=127.0.0.1:5555
adb shell pm clear com.whatsapp >/dev/null 2>&1
adb shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

# login + dispatch
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -H "x-api-key: $KEY" -d '{"email":"admin@local.dev","password":"Admin2026!"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
DID=$(echo "$SUDO_PASS" | sudo -S docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc "SELECT id FROM \"Device\" WHERE name='Local Phone 01';" 2>/dev/null | tr -d '[:space:]')
echo "device=$DID number=$NUM" >> "$OUT"
RESP=$(curl -s -X POST "$API/jobs" -H 'Content-Type: application/json' -H "x-api-key: $KEY" -H "Authorization: Bearer $TOKEN" -d "{\"type\":\"REGISTER_WHATSAPP\",\"emulatorId\":\"$DID\",\"payload\":{\"phoneNumber\":\"$NUM\",\"fullName\":\"$NAME\"}}")
JOBID=$(echo "$RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
echo "job=$JOBID" >> "$OUT"

# run agent BLOCKING so it claims+drives the job (max 150s)
echo "$SUDO_PASS" | sudo -S pkill -9 -f 'node agent.mjs' 2>/dev/null; sleep 1
cd "/mnt/c/Yeni klasör/vps/deploy/kvm-host/agent" || exit 1
export FLEET_API_URL=http://localhost:4000 FLEET_API_KEY=$KEY FLEET_HOST_KEY=host_6bbbbfe1fd292aa80f2aa1b7ab1a0326 FLEET_ADB=adb
timeout 150 node agent.mjs >>"$OUT" 2>&1

# fetch result
J=$(curl -s -H "x-api-key: $KEY" -H "Authorization: Bearer $TOKEN" "$API/jobs/$JOBID")
echo "=== JOB RESULT ===" >> "$OUT"
echo "$J" | sed -n 's/.*\("result":{[^}]*}\).*/\1/p' >> "$OUT"
echo "=== OUT ==="
cat "$OUT"
