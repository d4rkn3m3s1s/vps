#!/usr/bin/env bash
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
echo "=== WA registration / verify lines ==="
adb -s "$S" logcat -d 2>/dev/null | grep -iE 'registration|verifynumber|RegisterPhone|verifysms|WCIRetry|too.many|banned|not.allowed|invalid|otp|sms|VerifyPhoneNumber' | tail -25 | tr -d '\r'
echo ""
echo "=== current WA activity ==="
adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -iE 'topResumedActivity.*whatsapp|ResumedActivity.*whatsapp' | head -1 | tr -d '\r'
echo "=== any error/wall text on screen ==="
adb -s "$S" shell uiautomator dump /sdcard/wl.xml >/dev/null 2>&1
adb -s "$S" pull /sdcard/wl.xml /tmp/wl.xml >/dev/null 2>&1
grep -oE 'text="[^"]+"' /tmp/wl.xml 2>/dev/null | sed 's/text="//;s/"$//' | grep -v '^$' | head -15
