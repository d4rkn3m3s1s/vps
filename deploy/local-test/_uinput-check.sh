#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null
S="127.0.0.1:5555"
echo "=== /dev/uinput inside container? ==="
adb -s "$S" shell 'ls -la /dev/uinput 2>&1' | tr -d '\r'
echo "=== /dev/input contents inside container ==="
adb -s "$S" shell 'ls -la /dev/input/ 2>&1' | tr -d '\r'
echo "=== redroid version / input-related props ==="
adb -s "$S" shell 'getprop | grep -iE "redroid|qemu.hw|virtio"' 2>/dev/null | tr -d '\r' | head
echo "=== does redroid image have a touch input? check its init.rc for uinput/input ==="
echo "163244" | sudo -S docker logs fleet-local-phone-01 2>&1 | grep -iE 'input|uinput|touch|EventHub|evdev' | tail -12
echo "=== host /dev/uinput perms (redroid needs rw) ==="
ls -la /dev/uinput 2>&1
