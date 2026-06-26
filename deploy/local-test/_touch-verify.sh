#!/usr/bin/env bash
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
adb -s "$S" shell input keyevent KEYCODE_HOME
sleep 2
A1=$(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r')
echo "before: $A1"
adb -s "$S" shell input swipe 300 1100 300 350 200
sleep 2
A2=$(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r')
echo "after swipe: $A2"
# screenshot to confirm
adb -s "$S" exec-out screencap -p > "/mnt/c/Users/furka/AppData/Local/Temp/claude/c--Yeni-klas-r-vps/27407aa3-afb1-4b1b-8795-dc7f23a050e8/scratchpad/touch_verify.png" 2>/dev/null
echo "screenshot saved"
