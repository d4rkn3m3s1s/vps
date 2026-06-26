#!/usr/bin/env bash
# Recreate phone-01 with uinput loaded (so redroid builds a real touchscreen),
# then restore the default route by trying candidate gateways until ping works.
# Verifies /dev/input/event* appears. Run with internet already up.
echo "163244" | sudo -S true 2>/dev/null
S=127.0.0.1:5555

echo "=== ensure uinput/evdev loaded ==="
sudo modprobe uinput 2>/dev/null; sudo modprobe evdev 2>/dev/null
ls -la /dev/uinput 2>&1 | head -1

echo "=== recreate phone-01 ==="
sudo docker rm -f fleet-local-phone-01 >/dev/null 2>&1
sleep 1
sudo mkdir -p /dev/binderfs1; mountpoint -q /dev/binderfs1 || sudo mount -t binder binder /dev/binderfs1
sudo docker run -d --name fleet-local-phone-01 --privileged --network host \
  -v /dev/binderfs1:/dev/binderfs -v fleet-local_phone01-data:/data \
  --restart unless-stopped \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_fps=30 \
  androidboot.redroid_gpu_mode=guest androidboot.redroid_adbd_port=5555 androidboot.use_redroid_stream=1 >/dev/null 2>&1

echo "=== restore route (try candidates) ==="
CUR=$(ip -4 -o addr show eth0 | grep -oE '172\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
O1=$(echo "$CUR" | cut -d. -f1); O2=$(echo "$CUR" | cut -d. -f2); O3=$(echo "$CUR" | cut -d. -f3)
sudo ip route del default 2>/dev/null
for gw in "${O1}.${O2}.${O3}.1" "${O1}.${O2}.0.1" "${O1}.${O2}.1.1"; do
  sudo ip route replace default via "$gw" dev eth0 2>/dev/null
  timeout 5 ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && { echo "  route OK via $gw"; break; }
  sudo ip route del default 2>/dev/null
done
timeout 5 ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && echo "  host internet: OK" || echo "  host internet: FAIL"

echo "=== wait boot ==="
adb connect "$S" >/dev/null 2>&1
for i in $(seq 1 45); do
  [ "$(adb -s "$S" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && { echo "  booted (try $i)"; break; }
  sleep 2
done

echo "=== /dev/input now ==="
adb -s "$S" shell ls -la /dev/input/ 2>&1 | tr -d '\r'
echo "=== getevent device list ==="
adb -s "$S" shell getevent -p 2>/dev/null | grep -iE 'add device|name:' | head -12 | tr -d '\r'
echo "=== phone-01 internet ==="
adb -s "$S" shell ping -c1 -W3 v.whatsapp.net 2>/dev/null | grep -qE '1 received|bytes from' && echo "  phone-01 WA: OK" || echo "  phone-01 WA: FAIL"
