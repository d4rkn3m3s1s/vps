#!/usr/bin/env bash
# Launch agent with log on /mnt/c (persists across WSL invocations), setsid-detached.
echo "163244" | sudo -S pkill -9 -f 'node agent.mjs' 2>/dev/null
sleep 2
cd "/mnt/c/Yeni klasör/vps/deploy/kvm-host/agent" || exit 1
export FLEET_API_URL=http://localhost:4000
export FLEET_API_KEY="${FLEET_API_KEY:?set FLEET_API_KEY}"
export FLEET_HOST_KEY="${FLEET_HOST_KEY:?set FLEET_HOST_KEY}"
export FLEET_ADB=adb
LOG="/mnt/c/Yeni klasör/vps/deploy/local-test/_agent-live.log"
: > "$LOG"
setsid nohup node agent.mjs >"$LOG" 2>&1 < /dev/null &
echo "agent launched, log: $LOG"
