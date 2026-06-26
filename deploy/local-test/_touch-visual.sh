#!/usr/bin/env bash
# Visual touch test: on the launcher, swipe up to open app drawer. Screenshot
# before/after. If the drawer opens, touch WORKS and earlier failures were
# coordinate/state issues, not a dead touch device.
S="127.0.0.1:5555"
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"
adb connect "$S" >/dev/null 2>&1

adb -s "$S" shell input keyevent KEYCODE_HOME; sleep 2
adb -s "$S" exec-out screencap -p > "$OUT/touch_before.png" 2>/dev/null
echo "before: $(wc -c < "$OUT/touch_before.png") bytes"

echo "=== swipe up from bottom (open app drawer) ==="
adb -s "$S" shell input swipe 300 1100 300 300 200
sleep 2
adb -s "$S" exec-out screencap -p > "$OUT/touch_after.png" 2>/dev/null
echo "after: $(wc -c < "$OUT/touch_after.png") bytes"
echo "activity: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r')"

echo "=== also test: long-press on screen center (should show context/wobble) ==="
adb -s "$S" shell input swipe 300 640 300 640 800
sleep 1
adb -s "$S" exec-out screencap -p > "$OUT/touch_longpress.png" 2>/dev/null
echo "longpress shot saved"
