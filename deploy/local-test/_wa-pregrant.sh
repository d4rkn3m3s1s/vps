#!/usr/bin/env bash
# Pre-grant WhatsApp's runtime permissions so the notification/contacts dialogs
# never appear during registration (they were overlaying registration_phone).
S="127.0.0.1:5555"
adb connect "$S" >/dev/null 2>&1
for p in android.permission.POST_NOTIFICATIONS android.permission.READ_CONTACTS \
         android.permission.WRITE_CONTACTS android.permission.GET_ACCOUNTS \
         android.permission.READ_PHONE_STATE android.permission.CAMERA \
         android.permission.RECORD_AUDIO android.permission.ACCESS_FINE_LOCATION; do
  out=$(adb -s "$S" shell pm grant com.whatsapp "$p" 2>&1 | tr -d '\r')
  [ -n "$out" ] && echo "  $p -> $out" || echo "  $p -> granted"
done
echo "=== dismiss any current ALLOW dialog (center 300,663) ==="
adb -s "$S" shell input tap 300 663 2>/dev/null
sleep 2
echo "=== focused activity ==="
adb -s "$S" shell dumpsys activity activities 2>/dev/null | grep -iE 'topResumedActivity' | head -1 | tr -d '\r'
