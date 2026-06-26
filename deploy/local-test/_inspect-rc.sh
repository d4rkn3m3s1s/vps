#!/usr/bin/env bash
# Inspect redroid's init rc files to find where /dev/input is wiped, and find
# its input HAL / touch setup.
echo "163244" | sudo -S true 2>/dev/null
S="127.0.0.1:5555"

echo "=== find rc files mentioning /dev/input ==="
adb -s "$S" shell 'grep -rn "dev/input" /*.rc /vendor/*.rc /system/etc/init/*.rc 2>/dev/null' | tr -d '\r' | head -20

echo "=== redroid.common.rc / redroid.rc content (input parts) ==="
for f in /redroid.common.rc /redroid.rc /init.redroid.rc /vendor/etc/init/redroid.rc; do
  echo "--- $f ---"
  adb -s "$S" shell "cat $f 2>/dev/null | grep -iE 'input|uinput|touch|event'" | tr -d '\r' | head -15
done

echo "=== is there a redroid input injector binder/service? ==="
adb -s "$S" shell 'getprop | grep -iE "input|touch"' 2>/dev/null | tr -d '\r' | head

echo "=== EventHub: what devices does Android see? ==="
adb -s "$S" shell 'dumpsys input | grep -iE "Device |Touch|Cursor|InputDevice" | head -20' 2>/dev/null | tr -d '\r'
