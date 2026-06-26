#!/usr/bin/env bash
# Full manual WA flow with touch WORKING + ADBKeyboard, using a DUMMY number to
# prove number-entry now succeeds (NEXT becomes enabled). No SMS spent. Steps:
# launch → OK custom-ROM alert → Agree → bypass companion → pre-grant perms →
# tap phone field → ADB_INPUT_TEXT → check NEXT enabled.
S="127.0.0.1:5555"
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"
adb connect "$S" >/dev/null 2>&1
dump(){ adb -s "$S" shell uiautomator dump /sdcard/f.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/f.xml /tmp/f.xml >/dev/null 2>&1; }
tapId(){ # tap center of a resource-id
  dump
  local b=$(grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/f.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
  [ -z "$b" ] && return 1
  local n=($(echo "$b" | grep -oE '[0-9]+'))
  adb -s "$S" shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 ))
}
tapText(){ # tap a node by visible text
  dump
  local b=$(grep -oE "text=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/f.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
  [ -z "$b" ] && return 1
  local n=($(echo "$b" | grep -oE '[0-9]+'))
  adb -s "$S" shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 ))
}

echo "=== pre-grant perms ==="
for p in POST_NOTIFICATIONS READ_CONTACTS WRITE_CONTACTS GET_ACCOUNTS READ_PHONE_STATE CAMERA RECORD_AUDIO; do
  adb -s "$S" shell pm grant com.whatsapp android.permission.$p 2>/dev/null
done
echo "=== launch WA ==="
adb -s "$S" shell monkey -p com.whatsapp -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 7
echo "=== OK custom-ROM alert ==="; tapText "OK"; sleep 2
echo "=== Agree and continue ==="; tapText "Agree and continue" || tapText "AGREE AND CONTINUE"; sleep 5
echo "act: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r')"
echo "=== if companion screen: overflow -> Register new account ==="
dump
if grep -qiE 'companion|Link a device' /tmp/f.xml; then
  adb -s "$S" shell input tap 567 78; sleep 2   # overflow ⋮
  tapText "Register new account"; sleep 3
fi
echo "=== should be on phone screen now ==="
echo "act: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r')"
# dismiss any perm dialog
tapText "ALLOW" 2>/dev/null; sleep 1
echo "=== tap phone field + ADBKeyboard type dummy 81234567890 ==="
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME 2>/dev/null
tapId "com.whatsapp:id/registration_phone"; sleep 1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "81234567890" 2>&1 | grep -i result
sleep 2
dump
echo "=== phone field text + NEXT enabled? ==="
grep -oE 'resource-id="com.whatsapp:id/registration_phone"[^>]*text="[^"]*"' /tmp/f.xml | grep -oE 'text="[^"]*"' | head -1
grep -oE 'resource-id="com.whatsapp:id/registration_submit"[^>]*enabled="[^"]*"' /tmp/f.xml | head -1
adb -s "$S" exec-out screencap -p > "$OUT/wa_manual.png" 2>/dev/null
echo "screenshot saved"
