#!/usr/bin/env bash
# Does touch work AT ALL on this WA screen? Tap "Choose a country" — if the
# country picker opens, touch reaches views but EditText focus is the issue.
# If nothing opens, touch is globally broken (input driver / gpu_mode).
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
dump() { adb -s "$S" shell uiautomator dump /sdcard/c.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/c.xml /tmp/c.xml >/dev/null 2>&1; }

dump
echo "=== current activity ==="
adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -iE 'topResumedActivity' | head -1 | tr -d '\r'

CC=$(grep -oE 'resource-id="com.whatsapp:id/registration_country"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/c.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
echo "country selector bounds: $CC"
X=$(echo "$CC" | grep -oE '[0-9]+' | sed -n '1p'); Y=$(echo "$CC" | grep -oE '[0-9]+' | sed -n '2p')
X2=$(echo "$CC" | grep -oE '[0-9]+' | sed -n '3p'); Y2=$(echo "$CC" | grep -oE '[0-9]+' | sed -n '4p')
CX=$(( (X+X2)/2 )); CY=$(( (Y+Y2)/2 ))
echo "tap country selector at $CX $CY"
adb -s "$S" shell input tap $CX $CY
sleep 2
dump
echo "=== activity after tap (did country picker open?) ==="
adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -iE 'topResumedActivity' | head -1 | tr -d '\r'
echo "=== screen texts (country list = touch works) ==="
grep -oE 'text="[^"]+"' /tmp/c.xml 2>/dev/null | sed 's/text="//;s/"$//' | grep -v '^$' | head -10
