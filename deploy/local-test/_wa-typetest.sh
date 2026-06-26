#!/usr/bin/env bash
# Diagnose WHY typing into registration_phone fails. WhatsApp is on the phone
# screen. Try the agent's exact approach (tap field by id center, then input
# text) and verify the field actually receives the digits.
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
dump() { adb -s "$S" shell uiautomator dump /sdcard/t.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/t.xml /tmp/t.xml >/dev/null 2>&1; }
centerOf() {
  grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/t.xml 2>/dev/null \
    | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1 | grep -oE '[0-9]+' | paste -sd' ' \
    | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'
}
fieldText() { # show current text of a resource-id
  grep -oE "resource-id=\"$1\"[^>]*text=\"[^\"]*\"|text=\"[^\"]*\"[^>]*resource-id=\"$1\"" /tmp/t.xml 2>/dev/null | head -1
}

dump
CC=$(centerOf 'com.whatsapp:id/registration_cc')
PH=$(centerOf 'com.whatsapp:id/registration_phone')
echo "cc=$CC  ph=$PH"

echo "=== approach A: tap cc, type 62 ==="
adb -s "$S" shell input tap $CC; sleep 1
adb -s "$S" shell input text "62"; sleep 1
dump; echo "  cc now: $(fieldText 'com.whatsapp:id/registration_cc')"

echo "=== approach B: tap phone, type digits ==="
adb -s "$S" shell input tap $PH; sleep 1
adb -s "$S" shell input text "82173367465"; sleep 1
dump; echo "  phone now: $(fieldText 'com.whatsapp:id/registration_phone')"

echo "=== is NEXT/submit enabled now? ==="
grep -oE 'resource-id="com.whatsapp:id/registration_submit"[^>]*enabled="[^"]*"' /tmp/t.xml 2>/dev/null | head -1
echo "=== screenshot ==="
adb -s "$S" exec-out screencap -p > "/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad/wa_typetest.png" 2>/dev/null
echo saved
