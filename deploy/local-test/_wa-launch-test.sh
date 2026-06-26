#!/usr/bin/env bash
S="127.0.0.1:5555"
echo "=== WA installed? ==="
adb -s "$S" shell pm list packages com.whatsapp 2>/dev/null | tr -d '\r'
echo "=== resolve launcher activity ==="
adb -s "$S" shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER com.whatsapp 2>/dev/null | tr -d '\r'
echo "=== try am start with explicit component ==="
adb -s "$S" shell am start -n com.whatsapp/com.whatsapp.Main 2>&1 | tr -d '\r' | head -3
sleep 8
echo "=== activity now ==="
adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r'
echo "=== WA process alive? ==="
adb -s "$S" shell pidof com.whatsapp 2>/dev/null | tr -d '\r' && echo "(alive)" || echo "(dead)"
echo "=== logcat: why WA not starting ==="
adb -s "$S" logcat -d 2>/dev/null | grep -iE 'whatsapp.*(FATAL|crash|ANR|died|Force)|ActivityManager.*whatsapp' | tail -6 | tr -d '\r'
