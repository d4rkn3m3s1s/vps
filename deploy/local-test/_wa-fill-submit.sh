#!/usr/bin/env bash
# Reliably fill the WhatsApp RegisterPhone screen (cc + national number) via
# verified touch + ADBKeyboard, verify NEXT becomes enabled, then submit and
# confirm the "Is this OK?" dialog. Only submits if the number truly landed.
# Args: $1=country_code (e.g. 62)  $2=national_number (e.g. 8811874862)
S=127.0.0.1:5555
CC="${1:-62}"
NUM="${2:-8811874862}"
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"

adb connect "$S" >/dev/null 2>&1
adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

dump(){ adb -s "$S" shell uiautomator dump /sdcard/f.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/f.xml /tmp/f.xml >/dev/null 2>&1; }
center(){ # $1 = resource-id ; echoes "X Y"
  grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/f.xml 2>/dev/null \
    | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' \
    | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'
}

dump
CCXY=$(center 'com.whatsapp:id/registration_cc')
PHXY=$(center 'com.whatsapp:id/registration_phone')
echo "cc field=[$CCXY]  phone field=[$PHXY]"
[ -z "$PHXY" ] && { echo "ERR: not on RegisterPhone (no phone field)"; exit 2; }

# country code
adb -s "$S" shell input tap $CCXY; sleep 1
adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$CC" >/dev/null 2>&1; sleep 1

# national number
adb -s "$S" shell input tap $PHXY; sleep 1
adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$NUM" >/dev/null 2>&1; sleep 2

dump
PHTXT=$(grep -oE "registration_phone\"[^>]*text=\"[^\"]*\"" /tmp/f.xml | grep -oE 'text="[^"]*"' | head -1)
NEXT_EN=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/f.xml | grep -oE 'enabled="[a-z]+"' | head -1)
echo "phone field text=[$PHTXT]  NEXT=[$NEXT_EN]"
adb -s "$S" exec-out screencap -p > "$OUT/wa_fill.png" 2>/dev/null

if [ "$NEXT_EN" != 'enabled="true"' ]; then
  echo "RESULT: number did NOT land (NEXT disabled) — NOT submitting"
  exit 1
fi

echo "=== SUBMIT (number landed, NEXT enabled) ==="
SUBXY=$(center 'com.whatsapp:id/registration_submit')
adb -s "$S" shell input tap $SUBXY; sleep 3
# "You entered ... Is this correct?" -> OK / EDIT ; tap OK/Continue if present
dump
for t in 'OK' 'Continue' 'CONTINUE' 'Yes'; do
  b=$(grep -oE "text=\"$t\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/f.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
  if [ -n "$b" ]; then n=($(echo "$b" | grep -oE '[0-9]+')); adb -s "$S" shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 )); echo "tapped confirm '$t'"; break; fi
done
sleep 5
adb -s "$S" exec-out screencap -p > "$OUT/wa_submitted.png" 2>/dev/null
echo "=== activity after submit ==="
adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r'
echo "SUBMITTED — check $OUT/wa_submitted.png for OTP/Connecting"
