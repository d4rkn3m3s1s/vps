#!/usr/bin/env bash
# Launch WhatsApp clean to RegisterPhone and test whether tapping the phone
# field FOCUSES it (the original blocker). No recreate. Reports focus + IME.
S=127.0.0.1:5555
adb connect "$S" >/dev/null 2>&1
adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

dump(){ adb -s "$S" shell uiautomator dump /sdcard/t.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/t.xml /tmp/t.xml >/dev/null 2>&1; }
taptext(){ dump; local b n; b=$(grep -oE "text=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/t.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1); [ -z "$b" ] && return 1; n=($(echo "$b" | grep -oE '[0-9]+')); adb -s "$S" shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 )); }
center(){ grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/t.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'; }

adb -s "$S" shell pm clear com.whatsapp >/dev/null 2>&1
adb -s "$S" shell monkey -p com.whatsapp -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 9
taptext 'OK' >/dev/null 2>&1; sleep 2
taptext 'Agree and continue' >/dev/null 2>&1; sleep 5
dump
if grep -qiE 'companion|Link a device|Use WhatsApp on' /tmp/t.xml; then
  adb -s "$S" shell input tap 567 78 >/dev/null 2>&1; sleep 2
  taptext 'Register new account' >/dev/null 2>&1; sleep 3
fi
taptext 'ALLOW' >/dev/null 2>&1; sleep 1
adb -s "$S" shell am broadcast -a com.android.permissioncontroller -n com.android.permissioncontroller/.permission.ui.GrantPermissionsActivity >/dev/null 2>&1
# dismiss notification permission dialog
adb -s "$S" shell input tap 300 760 >/dev/null 2>&1

dump
PH=$(center 'com.whatsapp:id/registration_phone')
echo "RegisterPhone field center: [$PH]"
if [ -z "$PH" ]; then
  echo "NOT on RegisterPhone. Screen texts:"
  grep -oE 'text="[^"]+"' /tmp/t.xml | head -8 | tr '\n' '|'; echo ""
  exit 3
fi
adb -s "$S" shell input tap $PH; sleep 2
dump
FOC=$(grep -oE 'registration_phone"[^>]*focused="[a-z]+"' /tmp/t.xml | grep -oE 'focused="[a-z]+"' | head -1)
IME=$(adb -s "$S" shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=[a-z]+' | head -1 | tr -d '\r')
echo "WA FIELD FOCUS: $FOC   IME: $IME"
[ "$FOC" = 'focused="true"' ] && echo "VERDICT: WA TOUCH WORKS ✓" || echo "VERDICT: WA touch still broken"
