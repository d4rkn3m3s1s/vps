#!/usr/bin/env bash
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
echo "=== default IME ==="
adb -s "$S" shell settings get secure default_input_method 2>/dev/null | tr -d '\r'
echo "=== ADBKeyboard installed + enabled? ==="
adb -s "$S" shell ime list -s 2>/dev/null | tr -d '\r'
echo "=== force re-set ADBKeyboard ==="
adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME 2>&1 | tr -d '\r'
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME 2>&1 | tr -d '\r'
echo "default now: $(adb -s "$S" shell settings get secure default_input_method 2>/dev/null | tr -d '\r')"
echo "=== tap phone field, check focus + IME shown ==="
adb -s "$S" shell uiautomator dump /sdcard/t.xml >/dev/null 2>&1
adb -s "$S" pull /sdcard/t.xml /tmp/t.xml >/dev/null 2>&1
PH=$(grep -oE 'registration_phone"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/t.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ')
CX=$(echo $PH | awk '{print int(($1+$3)/2)}'); CY=$(echo $PH | awk '{print int(($2+$4)/2)}')
echo "tap phone at $CX $CY"
adb -s "$S" shell input tap $CX $CY; sleep 2
adb -s "$S" shell uiautomator dump /sdcard/t2.xml >/dev/null 2>&1
adb -s "$S" pull /sdcard/t2.xml /tmp/t2.xml >/dev/null 2>&1
echo "phone focused: $(grep -oE 'registration_phone"[^>]*focused="[^"]*"' /tmp/t2.xml | grep -oE 'focused="[^"]*"' | head -1)"
echo "IME shown: $(adb -s "$S" shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=[a-z]*' | head -1 | tr -d '\r')"
echo "=== now type via ADBKeyboard ==="
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "5457438530" 2>&1 | grep -i result
sleep 2
adb -s "$S" shell uiautomator dump /sdcard/t3.xml >/dev/null 2>&1
adb -s "$S" pull /sdcard/t3.xml /tmp/t3.xml >/dev/null 2>&1
echo "phone text after: $(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/t3.xml | grep -oE 'text="[^"]*"' | head -1)"
adb -s "$S" exec-out screencap -p > "/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad/wa_ime2.png" 2>/dev/null
