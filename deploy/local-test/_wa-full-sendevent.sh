#!/usr/bin/env bash
# Complete WhatsApp number entry using RAW sendevent taps (reliable on redroid
# vinput) + ADBKeyboard. Assumes we're in the country picker OR on RegisterPhone.
# Flow: search Turkey -> tap result -> type national number -> verify NEXT.
# Args: $1=search term  $2=cc digits  $3=national number
S=127.0.0.1:5555
TERM="${1:-Turkey}"
CC="${2:-90}"
NUM="${3:-5457438530}"
DEV=/dev/input/event0
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"
adb disconnect emulator-5554 >/dev/null 2>&1; adb connect "$S" >/dev/null 2>&1
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME >/dev/null 2>&1

# raw multitouch tap at $1,$2
setap(){
  adb -s "$S" shell "sendevent $DEV 3 47 0; sendevent $DEV 3 57 1; sendevent $DEV 1 330 1; sendevent $DEV 3 53 $1; sendevent $DEV 3 54 $2; sendevent $DEV 0 0 0; sendevent $DEV 3 57 -1; sendevent $DEV 1 330 0; sendevent $DEV 0 0 0" 2>/dev/null
}
dump(){ adb -s "$S" shell uiautomator dump /sdcard/fe.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/fe.xml /tmp/fe.xml >/dev/null 2>&1; }
shot(){ bash "/mnt/c/Yeni klasör/vps/deploy/local-test/_wa-shot.sh" 5555 >/dev/null 2>&1; }

# Are we in the picker? (has "Choose a country" title). If so, search.
dump
if grep -q 'Choose a country' /tmp/fe.xml 2>/dev/null; then
  echo "in picker -> tap search + type"
  setap 565 78; sleep 2
  adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$TERM" >/dev/null 2>&1; sleep 2
  shot
  dump
  # tap the FIRST result row (just below the search bar, ~y=160)
  setap 200 162; sleep 3
fi

# Now should be back on RegisterPhone with cc filled. Type national number.
dump
PHX=$(grep -oE 'resource-id="com.whatsapp:id/registration_phone"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/fe.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1 | grep -oE '[0-9]+' | paste -sd' ' | awk '{print int(($1+$3)/2), int(($2+$4)/2)}')
echo "phone field center: [$PHX]"
if [ -n "$PHX" ]; then
  setap $PHX; sleep 1
  adb -s "$S" shell am broadcast -a ADB_CLEAR_TEXT >/dev/null 2>&1; sleep 1
  adb -s "$S" shell am broadcast -a ADB_INPUT_TEXT --es msg "$NUM" >/dev/null 2>&1; sleep 2
fi

dump
CCTXT=$(grep -oE 'registration_cc"[^>]*text="[^"]*"' /tmp/fe.xml | grep -oE 'text="[^"]*"' | head -1)
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/fe.xml | grep -oE 'text="[^"]*"' | head -1)
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/fe.xml | grep -oE 'enabled="[a-z]+"' | head -1)
echo "cc=[$CCTXT] phone=[$PHTXT] NEXT=[$NEXT]"
shot
[ "$NEXT" = 'enabled="true"' ] && echo "READY: NEXT enabled" || echo "NOT ready"
