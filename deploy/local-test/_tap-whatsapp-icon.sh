#!/usr/bin/env bash
# Touch works (swipe opened the drawer). Now tap the WhatsApp icon by its real
# bounds from the UI dump, to confirm tap navigates, then drive into the phone
# field and tap it to test focus.
S="127.0.0.1:5555"
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"
adb connect "$S" >/dev/null 2>&1
dump(){ adb -s "$S" shell uiautomator dump /sdcard/w.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/w.xml /tmp/w.xml >/dev/null 2>&1; }

dump
echo "=== WhatsApp icon bounds in drawer ==="
WA=$(grep -oE 'text="WhatsApp"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"|content-desc="WhatsApp"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/w.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
echo "  bounds: $WA"
if [ -n "$WA" ]; then
  X=$(echo "$WA" | grep -oE '[0-9]+' | sed -n '1p'); Y=$(echo "$WA" | grep -oE '[0-9]+' | sed -n '2p')
  X2=$(echo "$WA" | grep -oE '[0-9]+' | sed -n '3p'); Y2=$(echo "$WA" | grep -oE '[0-9]+' | sed -n '4p')
  CX=$(( (X+X2)/2 )); CY=$(( (Y+Y2)/2 ))
  echo "=== tap WhatsApp at $CX $CY ==="
  adb -s "$S" shell input tap $CX $CY
  sleep 5
  echo "activity: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r')"
  adb -s "$S" exec-out screencap -p > "$OUT/wa_opened.png" 2>/dev/null
  echo "screenshot saved"
fi
