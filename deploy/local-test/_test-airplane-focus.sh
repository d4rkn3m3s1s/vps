#!/usr/bin/env bash
# Test the user's hypothesis: does tap-focus on WA phone field work BETTER when
# internet is OFF? Toggle airplane mode on, then try tap-focus + ADBKeyboard type.
export ANDROID_SERIAL=127.0.0.1:5555
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_airplane-test.out"
DUMP="/mnt/c/Yeni klasör/vps/deploy/local-test/_apf.xml"
: > "$OUT"

# cut internet
adb shell cmd connectivity airplane-mode enable >/dev/null 2>&1
adb shell svc wifi disable >/dev/null 2>&1
sleep 2
echo "airplane on" >> "$OUT"

adb shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
dump(){ adb shell uiautomator dump /sdcard/f.xml >/dev/null 2>&1; adb pull /sdcard/f.xml "$DUMP" >/dev/null 2>&1; }
phf(){ grep -oE 'registration_phone"[^>]*focused="[a-z]+"' "$DUMP" | grep -oE 'focused="[a-z]+"' | head -1; }

for t in 1 2 3 4 5; do
  adb shell input tap 359 386; sleep 1; dump
  f=$(phf)
  echo "tap $t: focused=$f" >> "$OUT"
  [ "$f" = 'focused="true"' ] && break
done

# if focused, type the number via ADBKeyboard
if [ "$(phf)" = 'focused="true"' ]; then
  adb shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
  adb shell am broadcast -a ADB_INPUT_TEXT --es msg "5457438530" >/dev/null 2>&1; sleep 2
  dump
  echo "phone_text=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' "$DUMP" | grep -oE 'text="[^"]*"' | head -1)" >> "$OUT"
  echo "NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' "$DUMP" | grep -oE 'enabled="[a-z]+"' | head -1)" >> "$OUT"
fi
echo "=== RESULT ===" ; cat "$OUT"
