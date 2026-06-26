#!/usr/bin/env bash
# scrcpy v4 with UHID keyboard, headless (--no-window). UHID simulates a real
# physical keyboard on the device, bypassing WhatsApp's InputConnection text
# filter. Runs scrcpy in the background, then types via... (see notes). This
# script just STARTS scrcpy uhid and verifies the HID device registers.
SC=/tmp/scrcpy-v4/scrcpy-linux-x86_64-v4.0
export ANDROID_SERIAL=127.0.0.1:5555

echo "=== redroid /dev/uhid? ==="
"$SC/adb" -s 127.0.0.1:5555 shell 'ls -la /dev/uhid 2>&1' | tr -d '\r' | head -1

echo "=== run scrcpy v4 uhid 12s (diagnostic) ==="
cd "$SC" || exit 1
timeout 12 ./scrcpy --serial 127.0.0.1:5555 --no-window --no-audio --keyboard=uhid --verbosity=info >/tmp/scv4.log 2>&1
echo "exit=$?"
echo "=== log ==="
tail -25 /tmp/scv4.log | tr -d '\r'
