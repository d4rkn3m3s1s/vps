#!/usr/bin/env bash
# ANDROID_SERIAL pinned so every adb cmd hits phone-01. Field is focused with
# LatinIME. Fix cc->90 then type the national number via `input text` (commits
# to the focused EditText). Verify NEXT. Args: $1=cc $2=national.
export ANDROID_SERIAL=127.0.0.1:5555
CC="${1:-90}"
NUM="${2:-5457438530}"
DEV=/dev/input/event0

setap(){ adb shell "sendevent $DEV 3 47 0; sendevent $DEV 3 57 1; sendevent $DEV 1 330 1; sendevent $DEV 3 53 $1; sendevent $DEV 3 54 $2; sendevent $DEV 0 0 0; sendevent $DEV 3 57 -1; sendevent $DEV 1 330 0; sendevent $DEV 0 0 0" 2>/dev/null; }

# cc field: tap, select-all+delete, type cc
setap 160 386; sleep 1
adb shell input keyevent KEYCODE_MOVE_END >/dev/null 2>&1
for i in 1 2 3 4 5; do adb shell input keyevent KEYCODE_DEL >/dev/null 2>&1; done
adb shell input text "$CC" >/dev/null 2>&1; sleep 1

# phone field: tap, clear, type national number
setap 359 386; sleep 1
adb shell input keyevent KEYCODE_MOVE_END >/dev/null 2>&1
for i in $(seq 1 15); do adb shell input keyevent KEYCODE_DEL >/dev/null 2>&1; done
adb shell input text "$NUM" >/dev/null 2>&1; sleep 2

adb shell uiautomator dump /sdcard/ft.xml >/dev/null 2>&1
adb pull /sdcard/ft.xml /tmp/ft.xml >/dev/null 2>&1
CCTXT=$(grep -oE 'registration_cc"[^>]*text="[^"]*"' /tmp/ft.xml | grep -oE 'text="[^"]*"' | head -1)
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/ft.xml | grep -oE 'text="[^"]*"' | head -1)
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/ft.xml | grep -oE 'enabled="[a-z]+"' | head -1)
echo "cc=[$CCTXT]  phone=[$PHTXT]  NEXT=[$NEXT]"
bash "/mnt/c/Yeni klasör/vps/deploy/local-test/_wa-shot.sh" 5555 >/dev/null 2>&1
[ "$NEXT" = 'enabled="true"' ] && echo "READY ✓ — number landed" || echo "still not landed"
