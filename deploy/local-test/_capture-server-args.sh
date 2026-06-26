#!/usr/bin/env bash
SC=/tmp/scrcpy-v4/scrcpy-linux-x86_64-v4.0
export ANDROID_SERIAL=127.0.0.1:5555
cd "$SC" || exit 1
# start scrcpy in background, then grab the app_process cmdline on the device
nohup ./scrcpy --serial 127.0.0.1:5555 --no-window --no-audio --keyboard=sdk >/tmp/scvbg.log 2>&1 &
sleep 6
echo "=== device app_process (scrcpy server) cmdline ==="
./adb -s 127.0.0.1:5555 shell 'ps -A -o CMDLINE 2>/dev/null | grep -i scrcpy' | tr -d '\r' | head -2
./adb -s 127.0.0.1:5555 shell 'for p in $(pgrep -f app_process); do cat /proc/$p/cmdline 2>/dev/null | tr "\0" " "; echo; done' 2>/dev/null | grep -i scrcpy | tr -d '\r' | head -2
echo "=== adb forwards scrcpy set up ==="
./adb -s 127.0.0.1:5555 forward --list | tr -d '\r'
pkill -f scrcpy-linux >/dev/null 2>&1; pkill -f "$SC/scrcpy" >/dev/null 2>&1
