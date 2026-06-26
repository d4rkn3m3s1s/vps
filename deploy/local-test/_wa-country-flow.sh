#!/usr/bin/env bash
# Proper WhatsApp number entry: tap "Choose a country" -> in the picker, type the
# country name to filter -> tap the result. WhatsApp then fills the cc and focuses
# the phone field. Then type the national number via ADBKeyboard, verify NEXT,
# submit. Args: $1=country name to search (e.g. Turkey)  $2=national number
S=127.0.0.1:5555
COUNTRY="${1:-Turkey}"
NUM="${2:-5457438530}"
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"
adb disconnect emulator-5554 >/dev/null 2>&1; adb connect "$S" >/dev/null 2>&1
adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

dump(){ adb -s "$S" shell uiautomator dump /sdcard/cf.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/cf.xml /tmp/cf.xml >/dev/null 2>&1; }
center(){ grep -oE "resource-id=\"$1\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/cf.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}'; }
taptext(){ local t="$1"; dump; local b n; b=$(grep -oE "text=\"$t\"[^>]*bounds=\"\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]\"" /tmp/cf.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1); [ -z "$b" ] && return 1; n=($(echo "$b" | grep -oE '[0-9]+')); adb -s "$S" shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 )); }

echo "=== tap 'Choose a country' ==="
dump
CC_BTN=$(center 'com.whatsapp:id/registration_country')
[ -z "$CC_BTN" ] && CC_BTN="300 327"
adb -s "$S" shell input tap $CC_BTN; sleep 3

echo "=== in country picker: tap search, type country ==="
dump
# search icon in the picker action bar (usually a magnifier at top-right)
SEARCH=$(grep -oE 'resource-id="com.whatsapp:id/menuitem_search"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/cf.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}')
if [ -n "$SEARCH" ]; then
  adb -s "$S" shell input tap $SEARCH; sleep 1
  adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$COUNTRY" >/dev/null 2>&1; sleep 2
fi
dump
adb -s "$S" exec-out screencap -p > "$OUT/wa_country.png" 2>/dev/null
# tap the country row (first matching text)
taptext "$COUNTRY" >/dev/null 2>&1; sleep 2

echo "=== back on RegisterPhone — type national number ==="
dump
PH=$(center 'com.whatsapp:id/registration_phone')
echo "phone field: [$PH]"
if [ -z "$PH" ]; then echo "lost RegisterPhone:"; grep -oE 'text="[^"]+"' /tmp/cf.xml | head -8 | tr '\n' '|'; echo ""; exit 3; fi
adb -s "$S" shell input tap $PH; sleep 1
adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$NUM" >/dev/null 2>&1; sleep 2

dump
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/cf.xml | grep -oE 'text="[^"]*"' | head -1)
CCTXT=$(grep -oE 'registration_cc"[^>]*text="[^"]*"' /tmp/cf.xml | grep -oE 'text="[^"]*"' | head -1)
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/cf.xml | grep -oE 'enabled="[a-z]+"' | head -1)
echo "cc=[$CCTXT] phone=[$PHTXT] NEXT=[$NEXT]"
adb -s "$S" exec-out screencap -p > "$OUT/wa_filled.png" 2>/dev/null
[ "$NEXT" = 'enabled="true"' ] && echo "READY: number landed, NEXT enabled" || echo "FAIL: number not accepted"
