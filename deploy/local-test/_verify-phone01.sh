#!/usr/bin/env bash
# Verify phone-01 after WSL restart: boot, internet, touch device, ADBKeyboard.
# uinput must be loaded for the touchscreen; reload it (the restart cleared it,
# but the container is already running so touch may be absent until reload+...).
SUDO_PASS=163244
S=127.0.0.1:5555
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_verify01.txt"
: > "$OUT"
SU(){ echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }

SU modprobe uinput 2>/dev/null; SU modprobe evdev 2>/dev/null

adb connect "$S" >/dev/null 2>&1
for i in $(seq 1 30); do
  [ "$(adb -s "$S" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && { echo "booted ($i)" >> "$OUT"; break; }
  sleep 2
done

echo "input_devices=$(adb -s "$S" shell ls /dev/input/ 2>&1 | tr -d '\r')" >> "$OUT"
echo "net_state=$(adb -s "$S" shell dumpsys connectivity 2>/dev/null | grep -oE 'Validated|NO_INTERNET' | head -1 | tr -d '\r')" >> "$OUT"

# ADBKeyboard install + set
adb -s "$S" install -r "/mnt/c/Yeni klasör/vps/deploy/local-test/apks/ADBKeyboard.apk" >/dev/null 2>&1
adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

# test tap-focus + ADBKeyboard type in Contacts
adb -s "$S" shell am force-stop com.android.contacts >/dev/null 2>&1
adb -s "$S" shell am start -a android.intent.action.INSERT -t vnd.android.cursor.dir/contact >/dev/null 2>&1
sleep 4
adb -s "$S" shell input tap 309 547; sleep 2
echo "focus_shown=$(adb -s "$S" shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=[a-z]+' | head -1 | tr -d '\r')" >> "$OUT"
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "OK123" >/dev/null 2>&1
sleep 1
adb -s "$S" shell uiautomator dump /sdcard/v.xml >/dev/null 2>&1
adb -s "$S" pull /sdcard/v.xml "/mnt/c/Yeni klasör/vps/deploy/local-test/_v01.xml" >/dev/null 2>&1
echo "OK123_landed=$(grep -c 'OK123' '/mnt/c/Yeni klasör/vps/deploy/local-test/_v01.xml' 2>/dev/null)" >> "$OUT"
adb -s "$S" shell am force-stop com.android.contacts >/dev/null 2>&1
echo "=== RESULT ==="
cat "$OUT"
