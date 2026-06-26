#!/usr/bin/env bash
# Try focusing the WA phone field with RAW sendevent (different layer than
# `input tap` — worked for EULA earlier). Needs the vinput touch device. If
# /dev/input/event0 is absent, this can't work and we must recreate with the
# stream flag. Then type via ADBKeyboard.
export ANDROID_SERIAL=127.0.0.1:5555
NUM="${1:-5457438530}"
CC="${2:-90}"
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_se-focus.out"
DUMP="/mnt/c/Yeni klasör/vps/deploy/local-test/_se.xml"
DEV=/dev/input/event0
: > "$OUT"

echo "input_devices=$(adb shell ls /dev/input/ 2>&1 | tr -d '\r')" >> "$OUT"
adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
dump(){ adb shell uiautomator dump /sdcard/s.xml >/dev/null 2>&1; adb pull /sdcard/s.xml "$DUMP" >/dev/null 2>&1; }
setap(){ adb shell "sendevent $DEV 3 47 0; sendevent $DEV 3 57 1; sendevent $DEV 1 330 1; sendevent $DEV 3 53 $1; sendevent $DEV 3 54 $2; sendevent $DEV 0 0 0; sendevent $DEV 3 57 -1; sendevent $DEV 1 330 0; sendevent $DEV 0 0 0" 2>/dev/null; }
phf(){ grep -oE 'registration_phone"[^>]*focused="[a-z]+"' "$DUMP" | grep -oE 'focused="[a-z]+"' | head -1; }
ccf(){ grep -oE 'registration_cc"[^>]*focused="[a-z]+"' "$DUMP" | grep -oE 'focused="[a-z]+"' | head -1; }

# cc field via sendevent
for t in 1 2 3; do setap 160 386; sleep 1; dump; [ "$(ccf)" = 'focused="true"' ] && break; done
echo "cc focused (sendevent)=$(ccf)" >> "$OUT"
if [ "$(ccf)" = 'focused="true"' ]; then
  adb shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
  adb shell am broadcast -a ADB_INPUT_TEXT --es msg "$CC" >/dev/null 2>&1; sleep 1
fi
# phone field via sendevent
for t in 1 2 3; do setap 359 386; sleep 1; dump; [ "$(phf)" = 'focused="true"' ] && break; done
echo "phone focused (sendevent)=$(phf)" >> "$OUT"
if [ "$(phf)" = 'focused="true"' ]; then
  adb shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
  adb shell am broadcast -a ADB_INPUT_TEXT --es msg "$NUM" >/dev/null 2>&1; sleep 2
fi
dump
echo "cc=$(grep -oE 'registration_cc"[^>]*text="[^"]*"' "$DUMP" | grep -oE 'text="[^"]*"' | head -1)" >> "$OUT"
echo "phone=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' "$DUMP" | grep -oE 'text="[^"]*"' | head -1)" >> "$OUT"
echo "NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' "$DUMP" | grep -oE 'enabled="[a-z]+"' | head -1)" >> "$OUT"
echo "=== RESULT ==="; cat "$OUT"
