#!/usr/bin/env bash
echo "163244" | sudo -S pkill -9 -f 'node agent.mjs' 2>/dev/null
sleep 1
cd "/mnt/c/Yeni klasör/vps/deploy/kvm-host/agent" || { echo "CD FAILED"; exit 1; }
export FLEET_API_URL=http://localhost:4000
export FLEET_API_KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
export FLEET_HOST_KEY=host_6bbbbfe1fd292aa80f2aa1b7ab1a0326
export FLEET_ADB=adb
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_agent-fg.out"
echo "starting node at $(date)" > "$OUT"
timeout 30 node agent.mjs >> "$OUT" 2>&1
echo "EXITED code=$? at $(date)" >> "$OUT"
