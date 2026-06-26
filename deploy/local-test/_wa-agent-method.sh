#!/usr/bin/env bash
# Replicate the AGENT's exact typing method (which worked yesterday): use
# `input tap` (NOT sendevent) to focus the field, then ADBKeyboard broadcast.
# Launches WA fresh, drives EULA->phone screen via input tap, types CC+number.
export ANDROID_SERIAL=127.0.0.1:5555
CC="${1:-90}"
NUM="${2:-5457438530}"
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"

adb shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

dump(){ adb shell uiautomator dump /sdcard/am.xml >/dev/null 2>&1; adb pull /sdcard/am.xml /tmp/am.xml >/dev/null 2>&1; }
# tap element center by resource-id using input tap (the agent's tapNode)
tapId(){ dump; local b n; b=$(grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/am.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1); [ -z "$b" ] && return 1; n=($(echo "$b" | grep -oE '[0-9]+')); adb shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 )); }
tapTxt(){ dump; local b n; b=$(grep -oE "text=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/am.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1); [ -z "$b" ] && return 1; n=($(echo "$b" | grep -oE '[0-9]+')); adb shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 )); }

echo "=== launch WA fresh ==="
adb shell pm clear com.whatsapp >/dev/null 2>&1
adb shell monkey -p com.whatsapp -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 9
tapTxt 'OK' >/dev/null 2>&1; sleep 2                 # custom-ROM alert
tapTxt 'Agree and continue' >/dev/null 2>&1; sleep 5 # EULA
dump
if grep -qiE 'companion|Link a device|Use WhatsApp on another' /tmp/am.xml; then
  adb shell input tap 567 78 >/dev/null 2>&1; sleep 2
  tapTxt 'Register new account' >/dev/null 2>&1; sleep 3
fi
# pre-grant + dismiss notif dialog
for p in POST_NOTIFICATIONS READ_CONTACTS; do adb shell pm grant com.whatsapp android.permission.$p >/dev/null 2>&1; done
tapTxt 'ALLOW' >/dev/null 2>&1; sleep 1
tapId 'com.android.permissioncontroller:id/permission_allow_button' >/dev/null 2>&1; sleep 1

echo "=== on RegisterPhone? type via agent method (input tap + ADBKeyboard) ==="
dump
if ! grep -q 'registration_phone' /tmp/am.xml; then echo "NOT on RegisterPhone:"; grep -oE 'text="[^"]+"' /tmp/am.xml | head -6 | tr '\n' '|'; echo ""; exit 3; fi

# country code: tap (input tap) + clear + broadcast
tapId 'com.whatsapp:id/registration_cc'; sleep 1
adb shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1
adb shell am broadcast -a ADB_INPUT_TEXT --es msg "$CC" >/dev/null 2>&1; sleep 1
# phone: tap + clear + broadcast
tapId 'com.whatsapp:id/registration_phone'; sleep 1
adb shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1
adb shell am broadcast -a ADB_INPUT_TEXT --es msg "$NUM" >/dev/null 2>&1; sleep 2

dump
CCTXT=$(grep -oE 'registration_cc"[^>]*text="[^"]*"' /tmp/am.xml | grep -oE 'text="[^"]*"' | head -1)
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/am.xml | grep -oE 'text="[^"]*"' | head -1)
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/am.xml | grep -oE 'enabled="[a-z]+"' | head -1)
ADBON=$(grep -oE 'ADB Keyboard.{0,6}' /tmp/am.xml | head -1)
echo "cc=[$CCTXT] phone=[$PHTXT] NEXT=[$NEXT] adbkb=[$ADBON]"
adb exec-out screencap -p > "$OUT/wa_agentmethod.png" 2>/dev/null
[ "$NEXT" = 'enabled="true"' ] && echo "SUCCESS ✓ number landed (agent method)!" || echo "not landed"
