#!/usr/bin/env bash
# Verify EditText focus works (the real requirement). Use a guaranteed EditText:
# the Contacts app "create contact" name field, OR Settings search. Tap it and
# check focused=true + IME shown. This decides if touch is reliable enough.
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

echo "=== open Contacts new-contact (has a clear EditText) ==="
adb -s "$S" shell am start -a android.intent.action.INSERT -t vnd.android.cursor.dir/contact >/dev/null 2>&1
sleep 4
adb -s "$S" shell uiautomator dump /sdcard/e.xml >/dev/null 2>&1
adb -s "$S" pull /sdcard/e.xml /tmp/e.xml >/dev/null 2>&1
ET=$(grep -oE 'class="android.widget.EditText"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/e.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ')
echo "first EditText bounds nums: $ET"
if [ -n "$ET" ]; then
  CX=$(echo $ET | awk '{print int(($1+$3)/2)}'); CY=$(echo $ET | awk '{print int(($2+$4)/2)}')
  echo "tap EditText at $CX $CY"
  adb -s "$S" shell input tap $CX $CY; sleep 2
  adb -s "$S" shell uiautomator dump /sdcard/e2.xml >/dev/null 2>&1
  adb -s "$S" pull /sdcard/e2.xml /tmp/e2.xml >/dev/null 2>&1
  echo "EditText focused: $(grep -oE 'class="android.widget.EditText"[^>]*focused="[^"]*"' /tmp/e2.xml | grep -oE 'focused="[^"]*"' | head -3 | tr '\n' ' ')"
  echo "IME shown: $(adb -s "$S" shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=[a-z]*' | head -1 | tr -d '\r')"
  echo "=== type test via ADBKeyboard ==="
  adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "TESTNAME" 2>&1 | grep -i result
  sleep 1
  adb -s "$S" shell uiautomator dump /sdcard/e3.xml >/dev/null 2>&1
  adb -s "$S" pull /sdcard/e3.xml /tmp/e3.xml >/dev/null 2>&1
  echo "any field now contains TESTNAME: $(grep -c 'TESTNAME' /tmp/e3.xml)"
fi
echo "VERDICT: if focused=true + TESTNAME present -> touch+IME RELIABLE"
