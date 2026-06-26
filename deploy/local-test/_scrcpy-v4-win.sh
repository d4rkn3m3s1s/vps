#!/usr/bin/env bash
# scrcpy v4 windowed in Xvfb, SDK keyboard (uses injectInputEvent — different
# path than `input`, scrcpy injects KeyEvents directly). Then xdotool types into
# the window. Tests whether scrcpy's injection path is accepted by WhatsApp.
SC=/tmp/scrcpy-v4/scrcpy-linux-x86_64-v4.0
export ANDROID_SERIAL=127.0.0.1:5555
export DISPLAY=:99
pgrep -f "Xvfb :99" >/dev/null || { Xvfb :99 -screen 0 800x1600x24 >/tmp/xvfb.log 2>&1 & sleep 2; }
pkill -f "scrcpy-v4" >/dev/null 2>&1; pkill -f "scrcpy-linux" >/dev/null 2>&1; sleep 1
cd "$SC" || exit 1
nohup ./scrcpy --serial 127.0.0.1:5555 --window-title scv4 --keyboard=sdk --max-fps 5 --video-bit-rate 1M >/tmp/scv4win.log 2>&1 &
echo "launched pid $!"
sleep 10
echo "=== window? ==="
DISPLAY=:99 xdotool search --name scv4 2>/dev/null | head -1
echo "=== log tail ==="
tail -12 /tmp/scv4win.log | tr -d '\r'
