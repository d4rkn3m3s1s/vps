#!/usr/bin/env bash
echo "163244" | sudo -S pkill -f "_route-keeper.sh" 2>/dev/null
sleep 1
SUDO_PASS=163244 nohup setsid bash "/mnt/c/Yeni klasör/vps/deploy/local-test/_route-keeper.sh" >/tmp/route-keeper.log 2>&1 </dev/null &
disown 2>/dev/null
sleep 3
echo "started; pid(s): $(pgrep -f '_route-keeper.sh' | tr '\n' ' ')"
echo "--- log ---"
head -4 /tmp/route-keeper.log 2>/dev/null
