#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null
echo "=== container state ==="
sudo docker inspect fleet-local-phone-01 --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}' 2>/dev/null
adb connect 127.0.0.1:5555 >/dev/null 2>&1
for i in $(seq 1 20); do
  b=$(adb -s 127.0.0.1:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  [ "$b" = "1" ] && { echo "booted (try $i)"; break; }
  sleep 2
done
echo "boot=$(adb -s 127.0.0.1:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
echo "WA: $(adb -s 127.0.0.1:5555 shell pm list packages com.whatsapp 2>/dev/null | tr -d '\r')"
echo "=== logs tail ==="
sudo docker logs --tail 10 fleet-local-phone-01 2>&1 | tail -10
