#!/usr/bin/env bash
# Atomic ADBKeyboard attempt: set ADBKeyboard as IME, sendevent-tap the phone
# field to focus it (so ADBKeyboard binds to THIS field's input connection),
# then immediately broadcast the text. Serial pinned. Verifies result.
export ANDROID_SERIAL=127.0.0.1:5555
NUM="${1:-5457438530}"
DEV=/dev/input/event0
setap(){ adb shell "sendevent $DEV 3 47 0; sendevent $DEV 3 57 1; sendevent $DEV 1 330 1; sendevent $DEV 3 53 $1; sendevent $DEV 3 54 $2; sendevent $DEV 0 0 0; sendevent $DEV 3 57 -1; sendevent $DEV 1 330 0; sendevent $DEV 0 0 0" 2>/dev/null; }

# make ADBKeyboard the IME and give it a moment to become the active connection
adb shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
sleep 2

# focus the phone field via real touch
setap 359 386; sleep 2
echo "IME=$(adb shell settings get secure default_input_method 2>/dev/null | tr -d '\r')"
echo "focused=$(adb shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=[a-z]+' | head -1 | tr -d '\r')"

# clear then input via ADBKeyboard; check broadcast result explicitly
adb shell am broadcast -a ADB_CLEAR_TEXT 2>&1 | grep -i result | tr -d '\r'
echo "--- typing $NUM ---"
adb shell am broadcast -a ADB_INPUT_TEXT --es msg "$NUM" 2>&1 | grep -i result | tr -d '\r'
sleep 2

adb shell uiautomator dump /sdcard/ak.xml >/dev/null 2>&1; adb pull /sdcard/ak.xml /tmp/ak.xml >/dev/null 2>&1
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/ak.xml | grep -oE 'enabled="[a-z]+"' | head -1)
echo "NEXT=[$NEXT]"
bash "/mnt/c/Yeni klasör/vps/deploy/local-test/_wa-shot.sh" 5555 >/dev/null 2>&1
[ "$NEXT" = 'enabled="true"' ] && echo "READY ✓" || echo "still blocked"
