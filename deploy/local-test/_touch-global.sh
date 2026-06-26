#!/usr/bin/env bash
# Is touch globally broken or WhatsApp-specific? Open Settings, tap an item,
# see if it navigates. Also test a tap on the launcher.
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1

echo "=== open Settings ==="
adb -s "$S" shell am start -a android.settings.SETTINGS >/dev/null 2>&1
sleep 3
adb -s "$S" shell uiautomator dump /sdcard/s1.xml >/dev/null 2>&1
adb -s "$S" pull /sdcard/s1.xml /tmp/s1.xml >/dev/null 2>&1
echo "activity: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -iE 'topResumedActivity' | head -1 | tr -d '\r')"
echo "first few clickable items:"
grep -oE 'text="[^"]+"[^>]*clickable="true"|clickable="true"[^>]*text="[^"]+"' /tmp/s1.xml 2>/dev/null | grep -oE 'text="[^"]+"' | head -5

# tap the first list item (search or a settings row) — pick a known coordinate mid-list
echo "=== tap middle of screen (a settings row ~ 300,400) ==="
adb -s "$S" shell input tap 300 400
sleep 2
echo "activity after tap: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -iE 'topResumedActivity' | head -1 | tr -d '\r')"

echo "=== test EditText focus in Settings search ==="
# open settings search which has a real EditText
adb -s "$S" shell am start -a com.android.settings.action.SETTINGS_SEARCH >/dev/null 2>&1
sleep 2
adb -s "$S" shell uiautomator dump /sdcard/s2.xml >/dev/null 2>&1
adb -s "$S" pull /sdcard/s2.xml /tmp/s2.xml >/dev/null 2>&1
ET=$(grep -oE 'class="android.widget.EditText"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/s2.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
echo "settings EditText bounds: $ET"
if [ -n "$ET" ]; then
  X=$(echo "$ET" | grep -oE '[0-9]+' | sed -n '1p'); Y=$(echo "$ET" | grep -oE '[0-9]+' | sed -n '2p')
  X2=$(echo "$ET" | grep -oE '[0-9]+' | sed -n '3p'); Y2=$(echo "$ET" | grep -oE '[0-9]+' | sed -n '4p')
  adb -s "$S" shell input tap $(( (X+X2)/2 )) $(( (Y+Y2)/2 )); sleep 1
  adb -s "$S" shell uiautomator dump /sdcard/s3.xml >/dev/null 2>&1
  adb -s "$S" pull /sdcard/s3.xml /tmp/s3.xml >/dev/null 2>&1
  echo "settings EditText focused after tap: $(grep -oE 'class="android.widget.EditText"[^>]*focused="[^"]*"' /tmp/s3.xml | grep -oE 'focused="[^"]*"' | head -1)"
  echo "IME shown: $(adb -s "$S" shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=[a-z]*' | head -1 | tr -d '\r')"
fi
