#!/usr/bin/env bash
# One-shot real WhatsApp registration with per-step verification. Retries the
# WHOLE flow up to 3 times until the phone field actually focuses + fills.
# Number: +90 545 743 85 30. Only submits when the field truly contains digits.
S="127.0.0.1:5555"
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"
PASS=163244
echo "$PASS" | sudo -S true 2>/dev/null

dump(){ adb -s "$S" shell uiautomator dump /sdcard/o.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/o.xml /tmp/o.xml >/dev/null 2>&1; }
boundsCenter(){ grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/o.xml 2>/dev/null | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'; }
tapTextNode(){ dump; local b=$(grep -oE "text=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/o.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1); [ -z "$b" ] && return 1; local n=($(echo "$b" | grep -oE '[0-9]+')); adb -s "$S" shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 )); }

ensure_route(){ ip route | grep -q '^default' || sudo ip route replace default via 172.28.0.1 dev eth0 2>/dev/null; }
ensure_net(){ adb -s "$S" shell ping -c1 -W3 v.whatsapp.net 2>/dev/null | grep -qE 'bytes|received'; }

for attempt in 1 2 3; do
  echo "==================== ATTEMPT $attempt ===================="
  ensure_route
  adb -s "$S" shell pm clear com.whatsapp >/dev/null 2>&1
  adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
  adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
  for p in POST_NOTIFICATIONS READ_CONTACTS WRITE_CONTACTS GET_ACCOUNTS READ_PHONE_STATE CAMERA RECORD_AUDIO; do
    adb -s "$S" shell pm grant com.whatsapp android.permission.$p >/dev/null 2>&1
  done

  echo "-- net check: $(ensure_net && echo OK || echo FAIL)"
  echo "-- close stray apps + launch WA clean"
  adb -s "$S" shell input keyevent KEYCODE_HOME >/dev/null 2>&1; sleep 1
  adb -s "$S" shell am force-stop com.android.contacts >/dev/null 2>&1
  adb -s "$S" shell am force-stop com.whatsapp >/dev/null 2>&1; sleep 1
  adb -s "$S" shell monkey -p com.whatsapp -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 9
  # verify WA actually came to the foreground
  if ! adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -q 'com.whatsapp'; then
    echo "-- WA didn't launch, retry"; continue
  fi
  tapTextNode "OK" >/dev/null 2>&1; sleep 2                 # custom-ROM alert
  tapTextNode "Agree and continue" >/dev/null 2>&1; sleep 5 # EULA
  # companion screen? overflow -> Register new account
  dump
  if grep -qiE 'companion|Link a device' /tmp/o.xml; then
    adb -s "$S" shell input tap 567 78; sleep 2
    tapTextNode "Register new account" >/dev/null 2>&1; sleep 3
  fi
  # dismiss perm dialog if any
  tapTextNode "ALLOW" >/dev/null 2>&1; sleep 1

  # confirm we are on the phone screen
  dump
  if ! grep -q 'registration_phone' /tmp/o.xml; then echo "-- not on phone screen, retry"; continue; fi

  # focus phone field, verify focus
  PH=$(boundsCenter 'com.whatsapp:id/registration_phone')
  adb -s "$S" shell input tap $PH; sleep 2
  dump
  FOCUSED=$(grep -oE 'registration_phone"[^>]*focused="true"' /tmp/o.xml | head -1)
  IME=$(adb -s "$S" shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=true' | head -1)
  echo "-- phone field focused=[$FOCUSED] ime=[$IME]"
  if [ -z "$FOCUSED" ] && [ -z "$IME" ]; then echo "-- field did NOT focus, retry whole flow"; continue; fi

  # type cc + phone via ADBKeyboard
  CC=$(boundsCenter 'com.whatsapp:id/registration_cc')
  adb -s "$S" shell input tap $CC; sleep 1
  adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1
  adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "90" >/dev/null 2>&1; sleep 1
  adb -s "$S" shell input tap $PH; sleep 1
  adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1
  adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "5457438530" >/dev/null 2>&1; sleep 2

  dump
  NEXT_EN=$(grep -oE 'registration_submit"[^>]*enabled="true"' /tmp/o.xml | head -1)
  echo "-- NEXT enabled=[$NEXT_EN]"
  adb -s "$S" exec-out screencap -p > "$OUT/wa_oneshot_$attempt.png" 2>/dev/null
  if [ -z "$NEXT_EN" ]; then echo "-- number not accepted, retry"; continue; fi

  echo "-- SUBMIT (number is in, NEXT enabled)"
  ensure_route
  SUB=$(boundsCenter 'com.whatsapp:id/registration_submit')
  adb -s "$S" shell input tap $SUB; sleep 3
  tapTextNode "OK" >/dev/null 2>&1; sleep 5   # "You entered ... Is this OK?"
  ensure_route
  adb -s "$S" exec-out screencap -p > "$OUT/wa_submitted_$attempt.png" 2>/dev/null
  echo "-- submitted. activity: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r')"
  echo "SUCCESS on attempt $attempt — check screenshot for OTP/Connecting"
  exit 0
done
echo "ALL ATTEMPTS FAILED — touch did not hold on WA"
exit 1
