#!/usr/bin/env bash
# Is the input subsystem working at all? Test keyevents (HOME/BACK) and check
# for input devices. Then test a swipe (notification pull) which is visible.
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1

echo "=== input devices present? ==="
adb -s "$S" shell getevent -p 2>/dev/null | grep -iE 'add device|name:|touch|EV_ABS' | head -15 | tr -d '\r'

echo "=== keyevent test: HOME then check launcher ==="
adb -s "$S" shell input keyevent KEYCODE_HOME; sleep 1
echo "after HOME: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^ ]* [^ ]* [^ }]*' | head -1 | tr -d '\r')"

echo "=== open app drawer via keyevent, then settings via intent works (am) ==="
adb -s "$S" shell input keyevent KEYCODE_APP_SWITCH; sleep 1
echo "after APP_SWITCH: $(adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^ ]* [^ ]* [^ }]*' | head -1 | tr -d '\r')"

echo "=== swipe test: pull notification shade (visible state change) ==="
adb -s "$S" shell input keyevent KEYCODE_HOME; sleep 1
adb -s "$S" shell input swipe 300 5 300 600 300; sleep 1
echo "shade state: $(adb -s "$S" shell dumpsys window 2>/dev/null | grep -iE 'NotificationShade|StatusBar' | head -1 | tr -d '\r')"

echo "=== getevent: are there touch input device nodes? ==="
adb -s "$S" shell ls -la /dev/input/ 2>/dev/null | tr -d '\r'
