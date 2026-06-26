#!/usr/bin/env bash
# Headless scrcpy text injection: run scrcpy inside Xvfb so it gets a real
# control channel to phone-01, focus the scrcpy window, and use xdotool to type
# the number. scrcpy forwards keystrokes via InputManager's trusted path, which
# WhatsApp accepts (unlike `input text` / ADBKeyboard).
# Args: $1 = digits to type (e.g. 5457438530)
export ANDROID_SERIAL=127.0.0.1:5555
NUM="${1:-5457438530}"
export DISPLAY=:99

# start Xvfb if not running
pgrep -f "Xvfb :99" >/dev/null || { Xvfb :99 -screen 0 720x1400x24 >/tmp/xvfb.log 2>&1 & sleep 2; }
echo "Xvfb: $(pgrep -f 'Xvfb :99' | head -1)"

# kill any old scrcpy
pkill -f "scrcpy" >/dev/null 2>&1; sleep 1

# start scrcpy headless (mirrors into Xvfb). --prefer-text injects chars as text.
scrcpy --serial 127.0.0.1:5555 --window-title scrcpywin --prefer-text --stay-awake >/tmp/scrcpy.log 2>&1 &
SCRPID=$!
echo "scrcpy pid: $SCRPID — waiting for window..."
for i in $(seq 1 20); do
  WID=$(xdotool search --name scrcpywin 2>/dev/null | head -1)
  [ -n "$WID" ] && break
  sleep 1
done
echo "window id: ${WID:-NONE}"
[ -z "$WID" ] && { echo "scrcpy window not found"; tail -8 /tmp/scrcpy.log; exit 1; }

# focus the scrcpy window and type the number
xdotool windowactivate "$WID" 2>/dev/null; sleep 1
xdotool windowfocus "$WID" 2>/dev/null; sleep 1
# click into the phone field region (scrcpy window maps to device coords scaled)
# then type. We type slowly so each char registers.
xdotool type --window "$WID" --delay 200 "$NUM"
sleep 2
echo "typed $NUM into scrcpy window"

# verify on device
adb shell uiautomator dump /sdcard/sc.xml >/dev/null 2>&1; adb pull /sdcard/sc.xml /tmp/sc.xml >/dev/null 2>&1
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/sc.xml | grep -oE 'enabled="[a-z]+"' | head -1)
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/sc.xml | grep -oE 'text="[^"]*"' | head -1)
echo "phone=[$PHTXT]  NEXT=[$NEXT]"
bash "/mnt/c/Yeni klasör/vps/deploy/local-test/_wa-shot.sh" 5555 >/dev/null 2>&1
