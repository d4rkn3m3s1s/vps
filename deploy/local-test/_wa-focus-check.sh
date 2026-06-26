#!/usr/bin/env bash
# Verify whether typing reaches the field by checking (a) the field's focused
# state and (b) whether NEXT/registration_submit becomes enabled after typing.
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
dump() { adb -s "$S" shell uiautomator dump /sdcard/f.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/f.xml /tmp/f.xml >/dev/null 2>&1; }
centerOf() {
  grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/f.xml 2>/dev/null \
    | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 | grep -oE '[0-9]+' | paste -sd' ' \
    | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'
}

dump
CC=$(centerOf 'com.whatsapp:id/registration_cc')
PH=$(centerOf 'com.whatsapp:id/registration_phone')
echo "cc=$CC ph=$PH"

# tap phone field and check focused=true
adb -s "$S" shell input tap $PH; sleep 1; dump
echo "=== phone field node (focused?) ==="
grep -oE 'resource-id="com.whatsapp:id/registration_phone"[^>]*' /tmp/f.xml 2>/dev/null | grep -oE 'focused="[^"]*"|focusable="[^"]*"|class="[^"]*"' | tr '\n' ' '; echo ""

# type with plain input text and recheck NEXT enabled
adb -s "$S" shell input text "82173367465"; sleep 1; dump
echo "=== after input text: registration_submit enabled? + clickable? ==="
grep -oE 'resource-id="com.whatsapp:id/registration_submit"[^>]*' /tmp/f.xml 2>/dev/null | grep -oE 'enabled="[^"]*"|clickable="[^"]*"|text="[^"]*"' | tr '\n' ' '; echo ""
echo "=== any node now showing the typed digits? ==="
grep -oE 'text="[^"]*82173[^"]*"' /tmp/f.xml 2>/dev/null | head -2
echo "=== full phone-field line ==="
grep -oE '<node[^>]*registration_phone[^>]*/?>' /tmp/f.xml 2>/dev/null | head -1 | cut -c1-300
