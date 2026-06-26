#!/usr/bin/env bash
# Drive WhatsApp registration from the current screen with WORKING touch:
# dismiss notif dialog -> on RegisterPhone, tap cc field, type CC, tap phone
# field, type number via ADBKeyboard, verify NEXT enabled, submit, confirm.
# Args: $1=CC (e.g. 62)  $2=national number (e.g. 8811874862)
S=127.0.0.1:5555
CC="${1:-62}"
NUM="${2:-8811874862}"
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"
adb disconnect emulator-5554 >/dev/null 2>&1; adb connect "$S" >/dev/null 2>&1
adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

dump(){ adb -s "$S" shell uiautomator dump /sdcard/d.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/d.xml /tmp/d.xml >/dev/null 2>&1; }
center(){ grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/d.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'; }
taptext(){ dump; local b n; b=$(grep -oE "text=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/d.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1); [ -z "$b" ] && return 1; n=($(echo "$b" | grep -oE '[0-9]+')); adb -s "$S" shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 )); }

# dismiss notification permission dialog if present
taptext 'ALLOW' >/dev/null 2>&1; sleep 2

dump
# if companion/link screen, go overflow -> Register new account
if grep -qiE 'companion|Link a device|Use WhatsApp on another' /tmp/d.xml; then
  adb -s "$S" shell input tap 567 78 >/dev/null 2>&1; sleep 2
  taptext 'Register new account' >/dev/null 2>&1; sleep 3
fi

dump
PH=$(center 'com.whatsapp:id/registration_phone')
CCF=$(center 'com.whatsapp:id/registration_cc')
echo "cc=[$CCF] phone=[$PH]"
if [ -z "$PH" ]; then echo "NOT on RegisterPhone:"; grep -oE 'text="[^"]+"' /tmp/d.xml | head -8 | tr '\n' '|'; echo ""; exit 3; fi

# country code
adb -s "$S" shell input tap $CCF; sleep 1
adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$CC" >/dev/null 2>&1; sleep 1
# national number
adb -s "$S" shell input tap $PH; sleep 1
adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$NUM" >/dev/null 2>&1; sleep 2

dump
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/d.xml | grep -oE 'text="[^"]*"' | head -1)
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/d.xml | grep -oE 'enabled="[a-z]+"' | head -1)
echo "phone text=[$PHTXT]  NEXT=[$NEXT]"
adb -s "$S" exec-out screencap -p > "$OUT/wa_filled.png" 2>/dev/null

if [ "$NEXT" != 'enabled="true"' ]; then echo "RESULT: number not accepted — NOT submitting"; exit 1; fi

echo "=== SUBMIT ==="
SUB=$(center 'com.whatsapp:id/registration_submit')
adb -s "$S" shell input tap $SUB; sleep 3
taptext 'OK' >/dev/null 2>&1; sleep 5   # "You entered ... Is this correct?"
adb -s "$S" exec-out screencap -p > "$OUT/wa_submitted.png" 2>/dev/null
echo "activity: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r')"
dump
grep -oE 'text="[^"]+"' /tmp/d.xml | head -8 | tr '\n' '|'; echo ""
echo "SUBMITTED — see wa_submitted.png"
