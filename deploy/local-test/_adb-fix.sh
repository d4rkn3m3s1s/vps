#!/usr/bin/env bash
# Force a single clean adb server and connect to redroid phones.
set -u
P="$SUDO_PASS"
S() { echo "$P" | sudo -S "$@" 2>/dev/null; }

# Kill everything adb-ish, hard.
S pkill -9 -x adb
pkill -9 -x adb 2>/dev/null
# Wait for 5037 to free.
for i in $(seq 1 15); do
  if ! S ss -tlnp | grep -q ':5037 '; then echo "5037 free after ${i}s"; break; fi
  sleep 1
done
if S ss -tlnp | grep -q ':5037 '; then echo "STILL HELD:"; S ss -tlnp | grep ':5037 '; exit 1; fi

# Start ONE detached server that survives shell exit.
setsid nohup adb -L tcp:5037 fork-server server >/tmp/adbsrv.log 2>&1 < /dev/null &
disown 2>/dev/null || true
sleep 3
adb connect 127.0.0.1:5555 >/dev/null 2>&1
adb connect 127.0.0.1:5565 >/dev/null 2>&1
sleep 2
echo "=== devices ==="
adb devices
