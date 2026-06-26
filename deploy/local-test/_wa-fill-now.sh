#!/usr/bin/env bash
# WhatsApp is on RegisterPhone with empty fields. Fill the real number via
# ADBKeyboard (touch+IME both work now) and submit. cc=90, local=5457438530.
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
dump(){ adb -s "$S" shell uiautomator dump /sdcard/n.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/n.xml /tmp/n.xml >/dev/null 2>&1; }
centerOf(){
  grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/n.xml 2>/dev/null \
    | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' \
    | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'
}

dump
CC=$(centerOf 'com.whatsapp:id/registration_cc')
PH=$(centerOf 'com.whatsapp:id/registration_phone')
echo "cc field=$CC phone field=$PH"

echo "=== country code: tap + clear + type 90 ==="
adb -s "$S" shell input tap $CC; sleep 1
adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "90" 2>&1 | grep -i result
sleep 1

echo "=== phone: tap + type 5457438530 ==="
adb -s "$S" shell input tap $PH; sleep 1
adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "5457438530" 2>&1 | grep -i result
sleep 2

dump
echo "=== fields now ==="
echo "cc: $(grep -oE 'registration_cc"[^>]*text="[^"]*"' /tmp/n.xml | grep -oE 'text="[^"]*"' | head -1)"
echo "phone: $(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/n.xml | grep -oE 'text="[^"]*"' | head -1)"
echo "NEXT enabled: $(grep -oE 'registration_submit"[^>]*enabled="[^"]*"' /tmp/n.xml | head -1)"
adb -s "$S" exec-out screencap -p > "/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad/wa_filled.png" 2>/dev/null
echo "screenshot saved (NOT submitted yet)"
