#!/usr/bin/env bash
# Focus the WhatsApp phone field WITHOUT touch — use keyboard focus traversal
# (KEYCODE_TAB / DPAD), which reaches WhatsApp's hw-accelerated screen where
# synthetic taps don't. Then type the number and verify NEXT enables.
S=127.0.0.1:5555
CC="${1:-62}"
NUM="${2:-8811874862}"
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"
adb connect "$S" >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

dump(){ adb -s "$S" shell uiautomator dump /sdcard/k.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/k.xml /tmp/k.xml >/dev/null 2>&1; }
phfoc(){ grep -oE 'registration_phone"[^>]*focused="[a-z]+"' /tmp/k.xml | grep -oE 'focused="[a-z]+"' | head -1; }
ccfoc(){ grep -oE 'registration_cc"[^>]*focused="[a-z]+"' /tmp/k.xml | grep -oE 'focused="[a-z]+"' | head -1; }

echo "=== try TAB traversal to reach an input field ==="
for i in 1 2 3 4 5 6; do
  dump
  pf=$(phfoc); cf=$(ccfoc)
  echo "  step $i: cc=$cf phone=$pf"
  if [ "$pf" = 'focused="true"' ]; then echo "  -> phone field focused via TAB"; break; fi
  adb -s "$S" shell input keyevent KEYCODE_TAB >/dev/null 2>&1
  sleep 1
done

dump
if [ "$(phfoc)" != 'focused="true"' ]; then
  echo "=== TAB didn't land on phone; try DPAD_DOWN from top ==="
  for i in 1 2 3 4; do
    adb -s "$S" shell input keyevent KEYCODE_DPAD_DOWN >/dev/null 2>&1; sleep 1
    dump; [ "$(phfoc)" = 'focused="true"' ] && { echo "  -> phone focused via DPAD"; break; }
  done
fi

dump
echo "=== focus now: cc=$(ccfoc) phone=$(phfoc) ==="

# If CC is focused, type cc then TAB to phone
if [ "$(ccfoc)" = 'focused="true"' ]; then
  adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1
  adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$CC" >/dev/null 2>&1; sleep 1
  adb -s "$S" shell input keyevent KEYCODE_TAB >/dev/null 2>&1; sleep 1
  dump
fi

if [ "$(phfoc)" = 'focused="true"' ]; then
  adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1
  adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$NUM" >/dev/null 2>&1; sleep 2
fi

dump
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/k.xml | grep -oE 'text="[^"]*"' | head -1)
NEXT_EN=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/k.xml | grep -oE 'enabled="[a-z]+"' | head -1)
echo "=== RESULT: phone text=[$PHTXT]  NEXT=[$NEXT_EN] ==="
adb -s "$S" exec-out screencap -p > "$OUT/wa_keynav.png" 2>/dev/null
[ "$NEXT_EN" = 'enabled="true"' ] && echo "SUCCESS: number landed via keyboard nav" || echo "FAIL: still not entered"
