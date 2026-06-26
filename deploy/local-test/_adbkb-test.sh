#!/usr/bin/env bash
# Decisive test: with ADBKeyboard as default IME, type into WhatsApp's phone
# field via ADB_INPUT_TEXT broadcast and check NEXT becomes enabled.
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
dump() { adb -s "$S" shell uiautomator dump /sdcard/k.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/k.xml /tmp/k.xml >/dev/null 2>&1; }
centerOf() {
  grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/k.xml 2>/dev/null \
    | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 | grep -oE '[0-9]+' | paste -sd' ' \
    | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'
}

dump
CC=$(centerOf 'com.whatsapp:id/registration_cc')
PH=$(centerOf 'com.whatsapp:id/registration_phone')
echo "cc=$CC ph=$PH (screen: $(adb -s "$S" shell wm size 2>/dev/null | tr -d '\r'))"
[ -z "$PH" ] && { echo "not on phone screen — relaunch WA register first"; exit 1; }

echo "=== country code field: tap + ADB_INPUT_TEXT 62 ==="
adb -s "$S" shell input tap $CC; sleep 1
adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "62" 2>&1 | grep -i result | head -1
sleep 1

echo "=== phone field: tap + ADB_INPUT_TEXT ==="
adb -s "$S" shell input tap $PH; sleep 1
adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "82173367465" 2>&1 | grep -i result | head -1
sleep 1

dump
echo "=== did it type? phone field text ==="
grep -oE 'resource-id="com.whatsapp:id/registration_phone"[^>]*text="[^"]*"' /tmp/k.xml 2>/dev/null | grep -oE 'text="[^"]*"'
echo "=== registration_submit enabled now? ==="
grep -oE 'resource-id="com.whatsapp:id/registration_submit"[^>]*' /tmp/k.xml 2>/dev/null | grep -oE 'enabled="[^"]*"' | head -1
echo "=== screenshot ==="
adb -s "$S" exec-out screencap -p > "/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad/wa_adbkb.png" 2>/dev/null
echo saved
