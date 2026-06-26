#!/usr/bin/env bash
# WhatsApp is on RegisterPhone with perms granted. Enter the rented number
# (Indonesia +62, local 85165139215) into the cc + phone fields and submit.
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
dump() { adb -s "$S" shell uiautomator dump /sdcard/n.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/n.xml /tmp/n.xml >/dev/null 2>&1; }

centerOf() { # $1=resource-id -> echoes "X Y"
  grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/n.xml 2>/dev/null \
    | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 \
    | grep -oE '[0-9]+' | paste -sd' ' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'
}

dump
CC=$(centerOf 'com.whatsapp:id/registration_cc')
PH=$(centerOf 'com.whatsapp:id/registration_phone')
echo "cc field center: $CC ; phone field center: $PH"

# Fill country code = 62
if [ -n "$CC" ]; then
  adb -s "$S" shell input tap $CC; sleep 1
  adb -s "$S" shell input keyevent KEYCODE_MOVE_END; for i in $(seq 1 6); do adb -s "$S" shell input keyevent 67; done
  adb -s "$S" shell input text 62; sleep 1
fi
# Fill phone number = 85165139215
if [ -n "$PH" ]; then
  adb -s "$S" shell input tap $PH; sleep 1
  adb -s "$S" shell input text 85165139215; sleep 1
fi
echo "=== submit (registration_submit) ==="
dump
SUB=$(centerOf 'com.whatsapp:id/registration_submit')
echo "submit center: $SUB"
[ -n "$SUB" ] && adb -s "$S" shell input tap $SUB
sleep 4
echo "=== screen after submit ==="
adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -iE 'topResumedActivity' | head -1 | tr -d '\r'
