#!/usr/bin/env bash
# Field is focused + ADBKeyboard shown. Fix cc to 90, type the national number,
# verify NEXT enables. Cleans stale emulator entries so -s is unambiguous.
S=127.0.0.1:5555
CC="${1:-90}"
NUM="${2:-5457438530}"
DEV=/dev/input/event0
adb disconnect emulator-5554 >/dev/null 2>&1
adb disconnect emulator-5556 >/dev/null 2>&1
adb connect "$S" >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

setap(){ adb -s "$S" shell "sendevent $DEV 3 47 0; sendevent $DEV 3 57 1; sendevent $DEV 1 330 1; sendevent $DEV 3 53 $1; sendevent $DEV 3 54 $2; sendevent $DEV 0 0 0; sendevent $DEV 3 57 -1; sendevent $DEV 1 330 0; sendevent $DEV 0 0 0" 2>/dev/null; }

# cc field
setap 160 386; sleep 1
adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$CC" >/dev/null 2>&1; sleep 1
# phone field
setap 359 386; sleep 1
adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$NUM" >/dev/null 2>&1; sleep 2

adb -s "$S" shell uiautomator dump /sdcard/tn.xml >/dev/null 2>&1
adb -s "$S" pull /sdcard/tn.xml /tmp/tn.xml >/dev/null 2>&1
CCTXT=$(grep -oE 'registration_cc"[^>]*text="[^"]*"' /tmp/tn.xml | grep -oE 'text="[^"]*"' | head -1)
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/tn.xml | grep -oE 'text="[^"]*"' | head -1)
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/tn.xml | grep -oE 'enabled="[a-z]+"' | head -1)
echo "cc=[$CCTXT]  phone=[$PHTXT]  NEXT=[$NEXT]"
bash "/mnt/c/Yeni klasör/vps/deploy/local-test/_wa-shot.sh" 5555 >/dev/null 2>&1
[ "$NEXT" = 'enabled="true"' ] && echo "READY ✓" || echo "not ready"
