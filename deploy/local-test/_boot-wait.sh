#!/usr/bin/env bash
S() { echo "163244" | sudo -S "$@" 2>/dev/null; }
adb start-server >/dev/null 2>&1
adb connect 127.0.0.1:5555 >/dev/null 2>&1
echo "waiting for phone-01 boot..."
for i in $(seq 1 45); do
  st=$(adb -s 127.0.0.1:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  if [ "$st" = "1" ]; then echo "phone-01: BOOTED (try $i)"; break; fi
  sleep 2
done
echo "=== adb devices ==="
adb devices
echo "=== phone-02 crash log (last 8) ==="
S docker logs --tail 8 fleet-local-phone-02 2>&1
