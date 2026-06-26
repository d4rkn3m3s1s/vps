#!/usr/bin/env bash
# Pinpoint exactly which WA screen touch fails on. Launch, screenshot each step,
# try the tap, screenshot again.
S="127.0.0.1:5555"
OUT="/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad"
adb -s "$S" shell pm clear com.whatsapp >/dev/null 2>&1
adb -s "$S" shell monkey -p com.whatsapp -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 9
echo "=== step1 activity: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r')"
adb -s "$S" exec-out screencap -p > "$OUT/step1.png" 2>/dev/null
adb -s "$S" shell uiautomator dump /sdcard/s.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/s.xml /tmp/s.xml >/dev/null 2>&1
echo "step1 texts: $(grep -oE 'text="[^"]+"' /tmp/s.xml 2>/dev/null | sed 's/text="//;s/"$//' | grep -v '^$' | head -6 | tr '\n' '|')"

# Try tapping OK (custom rom alert) by its bounds
OK=$(grep -oE 'text="OK"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/s.xml | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
echo "=== OK button bounds: $OK"
if [ -n "$OK" ]; then
  n=($(echo "$OK" | grep -oE '[0-9]+'))
  adb -s "$S" shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 ))
  sleep 3
  echo "after OK tap activity: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r')"
  adb -s "$S" exec-out screencap -p > "$OUT/step2.png" 2>/dev/null
  adb -s "$S" shell uiautomator dump /sdcard/s2.xml >/dev/null 2>&1; adb -s "$S" pull /sdcard/s2.xml /tmp/s2.xml >/dev/null 2>&1
  echo "step2 still has OK alert? $(grep -c 'custom ROM' /tmp/s2.xml)"
fi

# Now try Agree and continue
AG=$(grep -oE '(text|content-desc)="[Aa]gree[^"]*"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' /tmp/s2.xml 2>/dev/null | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -1)
echo "=== Agree bounds: $AG"
if [ -n "$AG" ]; then
  n=($(echo "$AG" | grep -oE '[0-9]+'))
  adb -s "$S" shell input tap $(( (${n[0]}+${n[2]})/2 )) $(( (${n[1]}+${n[3]})/2 ))
  sleep 5
  echo "after Agree activity: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r')"
  adb -s "$S" exec-out screencap -p > "$OUT/step3.png" 2>/dev/null
fi
