#!/usr/bin/env bash
# Start the host agent detached, bound to host local-wsl2 / Local Phone 01.
export FLEET_API_URL="http://localhost:4000"
export FLEET_API_KEY="f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9"
export FLEET_HOST_KEY="host_6bbbbfe1fd292aa80f2aa1b7ab1a0326"
export FLEET_ADB="adb"
export FLEET_POLL_MS=3000
# kill stale agent
pkill -f "agent/agent.mjs" >/dev/null 2>&1 || true
sleep 1
cd "/mnt/c/Yeni klasör/vps/deploy/kvm-host/agent" || exit 1
nohup setsid node agent.mjs >/tmp/agent.log 2>&1 < /dev/null &
echo "agent launched, pid group $!"
sleep 6
echo "=== agent.log tail 20 ==="
tail -20 /tmp/agent.log
