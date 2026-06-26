#!/usr/bin/env bash
PORT="${1:-5557}"
S="127.0.0.1:$PORT"
adb connect "$S" >/dev/null 2>&1
echo "=== clear logcat, launch WA, capture crash ==="
adb -s "$S" logcat -c 2>/dev/null
adb -s "$S" shell am start -n com.whatsapp/com.whatsapp.Main >/dev/null 2>&1 || \
  adb -s "$S" shell monkey -p com.whatsapp -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 7
echo "=== crash / native / ARM lines ==="
adb -s "$S" logcat -d 2>/dev/null | grep -iE 'whatsapp|libndk|native_bridge|ndk_translation|AndroidRuntime|FATAL|SIGSEGV|dlopen|UnsatisfiedLink|abort' | tail -25
echo "=== is WA still alive after 7s? ==="
adb -s "$S" shell pidof com.whatsapp 2>/dev/null | tr -d '\r' && echo "(alive)" || echo "DEAD (crashed)"
echo "=== focused activity ==="
adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -iE 'mResumedActivity' | head -1 | tr -d '\r'
