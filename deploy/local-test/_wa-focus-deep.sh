#!/usr/bin/env bash
# Deep focus test: does tapping the phone EditText actually focus it + open the
# IME? Try several focus strategies and report focused state + IME visibility.
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
dump() { adb -s "$S" shell uiautomator dump /sdcard/d.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/d.xml /tmp/d.xml >/dev/null 2>&1; }
phNode() { grep -oE '<node[^>]*registration_phone[^>]*' /tmp/d.xml 2>/dev/null | head -1; }
imeShown() { adb -s "$S" shell dumpsys input_method 2>/dev/null | grep -iE 'mInputShown|isInputViewShown' | head -2 | tr -d '\r'; }

dump
PH=$(grep -oE 'resource-id="com.whatsapp:id/registration_phone"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/d.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
echo "phone bounds: $PH"
X=$(echo "$PH" | grep -oE '[0-9]+' | sed -n '1p'); Y=$(echo "$PH" | grep -oE '[0-9]+' | sed -n '2p')
X2=$(echo "$PH" | grep -oE '[0-9]+' | sed -n '3p'); Y2=$(echo "$PH" | grep -oE '[0-9]+' | sed -n '4p')
CX=$(( (X+X2)/2 )); CY=$(( (Y+Y2)/2 ))
echo "tap center: $CX $CY"

echo "=== strategy 1: single tap ==="
adb -s "$S" shell input tap $CX $CY; sleep 1; dump
echo "  focused: $(phNode | grep -oE 'focused="[^"]*"')"
echo "  $(imeShown)"

echo "=== strategy 2: double tap ==="
adb -s "$S" shell input tap $CX $CY; sleep 0.3; adb -s "$S" shell input tap $CX $CY; sleep 1; dump
echo "  focused: $(phNode | grep -oE 'focused="[^"]*"')"
echo "  $(imeShown)"

echo "=== strategy 3: tap + KEYCODE digits directly (no field text needed) ==="
adb -s "$S" shell input tap $CX $CY; sleep 1
adb -s "$S" shell input keyevent KEYCODE_8 KEYCODE_2 KEYCODE_1 2>/dev/null
sleep 1; dump
echo "  phone text: $(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/d.xml | grep -oE 'text="[^"]*"' | head -1)"
echo "  submit enabled: $(grep -oE 'registration_submit"[^>]*' /tmp/d.xml | grep -oE 'enabled="[^"]*"' | head -1)"
echo "=== current default IME ==="
adb -s "$S" shell settings get secure default_input_method 2>/dev/null | tr -d '\r'
