#!/usr/bin/env bash
# Cleanly (re)start the host agent with the latest agent.mjs.
echo "163244" | sudo -S pkill -9 -f 'node agent.mjs' 2>/dev/null
sleep 2
cd "/mnt/c/Yeni klasör/vps/deploy/kvm-host/agent" || exit 1
export FLEET_API_URL=http://localhost:4000
export FLEET_API_KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
export FLEET_HOST_KEY=host_6bbbbfe1fd292aa80f2aa1b7ab1a0326
export FLEET_ADB=adb
nohup setsid node agent.mjs >/tmp/agent.log 2>&1 </dev/null &
sleep 5
echo "=== agent processes ==="
pgrep -af 'node agent.mjs' | grep -v pgrep | head -2
echo "=== log ==="
tail -3 /tmp/agent.log
