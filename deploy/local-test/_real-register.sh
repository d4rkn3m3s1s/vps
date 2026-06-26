#!/usr/bin/env bash
# Real registration: dispatch REGISTER_WHATSAPP with the user's number, run the
# agent BLOCKING so it enters the number + submits (reaches "Connecting" → WA
# texts the user). Tolerates the agent's post-submit "id yok" (number is already
# in). Captures the final screen state. Args: $1=number (E164 no +) $2=name
API=http://localhost:4000
KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
NUM="${1:-905457438530}"
NAME="${2:-Furkan}"
SUDO_PASS=163244
S=127.0.0.1:5555
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_real-register.out"
: > "$OUT"
export ANDROID_SERIAL=127.0.0.1:5555

# fresh WA + ADBKeyboard
adb shell pm clear com.whatsapp >/dev/null 2>&1
adb shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
echo "$SUDO_PASS" | sudo -S true 2>/dev/null

# login + dispatch
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -H "x-api-key: $KEY" -d '{"email":"admin@local.dev","password":"Admin2026!"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
DID=$(echo "$SUDO_PASS" | sudo -S docker exec fleet-local-postgres psql -U postgres -d vps_emulator -tAc "SELECT id FROM \"Device\" WHERE name='Local Phone 01';" 2>/dev/null | tr -d '[:space:]')
RESP=$(curl -s -X POST "$API/jobs" -H 'Content-Type: application/json' -H "x-api-key: $KEY" -H "Authorization: Bearer $TOKEN" -d "{\"type\":\"REGISTER_WHATSAPP\",\"emulatorId\":\"$DID\",\"payload\":{\"phoneNumber\":\"$NUM\",\"fullName\":\"$NAME\"}}")
JOBID=$(echo "$RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
echo "device=$DID number=$NUM job=$JOBID" >> "$OUT"

# run agent BLOCKING (it claims + drives; exits after job or 150s)
echo "$SUDO_PASS" | sudo -S pkill -9 -f 'node agent.mjs' 2>/dev/null; sleep 1
cd "/mnt/c/Yeni klasör/vps/deploy/kvm-host/agent" || exit 1
export FLEET_API_URL=http://localhost:4000 FLEET_API_KEY=$KEY FLEET_HOST_KEY=host_6bbbbfe1fd292aa80f2aa1b7ab1a0326 FLEET_ADB=adb
timeout 150 node agent.mjs >>"$OUT" 2>&1

# capture final screen
adb shell uiautomator dump /sdcard/r.xml >/dev/null 2>&1
adb pull /sdcard/r.xml "/mnt/c/Yeni klasör/vps/deploy/local-test/_realscreen.xml" >/dev/null 2>&1
adb exec-out screencap -p > "/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad/wa_real.png" 2>/dev/null
echo "=== screen texts ===" >> "$OUT"
grep -oE 'text="[^"]+"' "/mnt/c/Yeni klasör/vps/deploy/local-test/_realscreen.xml" 2>/dev/null | head -10 | tr '\n' '|' >> "$OUT"
echo "" >> "$OUT"
echo "=== OUT ==="
cat "$OUT"
