#!/usr/bin/env bash
# Diagnose WHY the WhatsApp phone field won't accept input. Checks active IME,
# taps the field, verifies focus + IME-shown, tries each input method, and
# reports exactly which step fails.
S=127.0.0.1:5555
adb connect "$S" >/dev/null 2>&1

echo "=== active IME ==="
adb -s "$S" shell settings get secure default_input_method 2>/dev/null | tr -d '\r'
adb -s "$S" shell dumpsys input_method 2>/dev/null | grep -oE 'mCurMethodId=[^ ]*' | head -1 | tr -d '\r'

dump(){ adb -s "$S" shell uiautomator dump /sdcard/d.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/d.xml /tmp/d.xml >/dev/null 2>&1; }
phxy(){ grep -oE 'resource-id="com.whatsapp:id/registration_phone"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/d.xml 2>/dev/null | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'; }

dump
PH=$(phxy)
echo "=== phone field center: [$PH] ==="
[ -z "$PH" ] && { echo "not on RegisterPhone"; exit 2; }

echo "=== tap field, check focus ==="
adb -s "$S" shell input tap $PH; sleep 2
dump
echo "phone focused: $(grep -oE 'registration_phone"[^>]*focused="[a-z]+"' /tmp/d.xml | grep -oE 'focused="[a-z]+"' | head -1)"
echo "IME shown: $(adb -s "$S" shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=[a-z]+' | head -1 | tr -d '\r')"

echo "=== METHOD A: ADBKeyboard broadcast ==="
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "8811874862" 2>&1 | grep -i result | tr -d '\r'
sleep 1; dump
echo "  field after A: [$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/d.xml | grep -oE 'text="[^"]*"' | head -1)]"

echo "=== METHOD B: input text (direct) ==="
adb -s "$S" shell input tap $PH; sleep 1
adb -s "$S" shell input text "8811874862" 2>/dev/null
sleep 1; dump
echo "  field after B: [$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/d.xml | grep -oE 'text="[^"]*"' | head -1)]"

echo "=== METHOD C: per-digit keyevent ==="
adb -s "$S" shell input tap $PH; sleep 1
for d in 8 8 1 1 8 7 4 8 6 2; do adb -s "$S" shell input keyevent KEYCODE_$d >/dev/null 2>&1; done
sleep 1; dump
echo "  field after C: [$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/d.xml | grep -oE 'text="[^"]*"' | head -1)]"
echo "  NEXT enabled: $(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/d.xml | grep -oE 'enabled="[a-z]+"' | head -1)"
