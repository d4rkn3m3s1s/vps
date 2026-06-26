#!/usr/bin/env bash
# Manually drive number entry on the CURRENT RegisterPhone screen (no agent):
# tap country picker, type "Turkey", select it, then type the national number
# via ADBKeyboard, verify NEXT, submit, tap OK on confirmation.
# Uses input tap (proven to focus) + ADBKeyboard (proven OK123_landed=1).
export ANDROID_SERIAL=127.0.0.1:5555
CC_SEARCH="${1:-Turkey}"
NUM="${2:-5457438530}"
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_manual-real.out"
SCR="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"
: > "$OUT"
adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

dump(){ adb shell uiautomator dump /sdcard/x.xml >/dev/null 2>&1; adb pull /sdcard/x.xml "/mnt/c/Yeni klasör/vps/deploy/local-test/_mx.xml" >/dev/null 2>&1; }
F=/mnt/c/Yeni\ klasör/vps/deploy/local-test/_mx.xml
ctr(){ grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" "/mnt/c/Yeni klasör/vps/deploy/local-test/_mx.xml" | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'; }
txtr(){ grep -oE "text=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" "/mnt/c/Yeni klasör/vps/deploy/local-test/_mx.xml" | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'; }

dump
# 1. open country picker
CB=$(ctr 'com.whatsapp:id/registration_country'); [ -z "$CB" ] && CB="300 327"
adb shell input tap $CB; sleep 3
# 2. tap search icon (top-right), type country
adb shell input tap 565 78; sleep 1
adb shell am broadcast -a ADB_INPUT_TEXT --es msg "$CC_SEARCH" >/dev/null 2>&1; sleep 2
dump
# tap first result row (just under search bar ~y162)
adb shell input tap 200 162; sleep 3
echo "after country pick:" >> "$OUT"
dump
echo "  cc=$(grep -oE 'registration_cc"[^>]*text="[^"]*"' "/mnt/c/Yeni klasör/vps/deploy/local-test/_mx.xml" | grep -oE 'text="[^"]*"' | head -1)" >> "$OUT"

# 3. type national number into phone field
PH=$(ctr 'com.whatsapp:id/registration_phone'); [ -z "$PH" ] && PH="359 386"
adb shell input tap $PH; sleep 1
adb shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb shell am broadcast -a ADB_INPUT_TEXT --es msg "$NUM" >/dev/null 2>&1; sleep 2

dump
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' "/mnt/c/Yeni klasör/vps/deploy/local-test/_mx.xml" | grep -oE 'enabled="[a-z]+"' | head -1)
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' "/mnt/c/Yeni klasör/vps/deploy/local-test/_mx.xml" | grep -oE 'text="[^"]*"' | head -1)
echo "phone=$PHTXT NEXT=$NEXT" >> "$OUT"
adb exec-out screencap -p > "$SCR/wa_real.png" 2>/dev/null

if [ "$NEXT" != 'enabled="true"' ]; then echo "NOT READY — not submitting" >> "$OUT"; cat "$OUT"; exit 1; fi

# 4. submit + confirm
SUB=$(ctr 'com.whatsapp:id/registration_submit')
adb shell input tap $SUB; sleep 3
dump
OK=$(txtr 'OK'); [ -n "$OK" ] && { adb shell input tap $OK; echo "tapped OK confirm" >> "$OUT"; }
sleep 5
adb exec-out screencap -p > "$SCR/wa_real_submitted.png" 2>/dev/null
echo "SUBMITTED — OTP should arrive on the real phone" >> "$OUT"
cat "$OUT"
