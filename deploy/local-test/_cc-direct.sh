#!/usr/bin/env bash
# Type cc directly into registration_cc (no country picker), then the national
# number into registration_phone, via input tap + ADBKeyboard. Retries the tap
# until the field focuses (input tap is intermittent on this hw screen).
# Verifies NEXT, submits, taps OK. Args: $1=cc $2=national
export ANDROID_SERIAL=127.0.0.1:5555
CC="${1:-90}"
NUM="${2:-5457438530}"
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_cc-direct.out"
SCR="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"
: > "$OUT"
adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
DUMP="/mnt/c/Yeni klasör/vps/deploy/local-test/_ccd.xml"
dump(){ adb shell uiautomator dump /sdcard/c.xml >/dev/null 2>&1; adb pull /sdcard/c.xml "$DUMP" >/dev/null 2>&1; }
ccfocus(){ grep -oE 'registration_cc"[^>]*focused="[a-z]+"' "$DUMP" | grep -oE 'focused="[a-z]+"' | head -1; }
phfocus(){ grep -oE 'registration_phone"[^>]*focused="[a-z]+"' "$DUMP" | grep -oE 'focused="[a-z]+"' | head -1; }

# focus cc field (retry tap until focused)
for t in 1 2 3 4; do
  adb shell input tap 160 386; sleep 1; dump
  [ "$(ccfocus)" = 'focused="true"' ] && break
done
echo "cc focused=$(ccfocus)" >> "$OUT"
adb shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb shell am broadcast -a ADB_INPUT_TEXT --es msg "$CC" >/dev/null 2>&1; sleep 1

# focus phone field (retry)
for t in 1 2 3 4; do
  adb shell input tap 359 386; sleep 1; dump
  [ "$(phfocus)" = 'focused="true"' ] && break
done
echo "phone focused=$(phfocus)" >> "$OUT"
adb shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb shell am broadcast -a ADB_INPUT_TEXT --es msg "$NUM" >/dev/null 2>&1; sleep 2

dump
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' "$DUMP" | grep -oE 'enabled="[a-z]+"' | head -1)
CCTXT=$(grep -oE 'registration_cc"[^>]*text="[^"]*"' "$DUMP" | grep -oE 'text="[^"]*"' | head -1)
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' "$DUMP" | grep -oE 'text="[^"]*"' | head -1)
echo "cc=$CCTXT phone=$PHTXT NEXT=$NEXT" >> "$OUT"
adb exec-out screencap -p > "$SCR/wa_ccd.png" 2>/dev/null
[ "$NEXT" = 'enabled="true"' ] && echo "READY ✓" >> "$OUT" || echo "not ready" >> "$OUT"
cat "$OUT"
