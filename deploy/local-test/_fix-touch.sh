#!/usr/bin/env bash
# THE touch fix: redroid creates its touchscreen via /dev/uinput, but this
# custom WSL kernel ships uinput+evdev as modules that aren't auto-loaded, so
# /dev/uinput was absent and redroid made NO input device (/dev/input empty →
# tap/swipe never reach views; only keyevents worked). Load the modules, then
# recreate phone-01 so its init picks up uinput and registers a touchscreen.
echo "163244" | sudo -S true 2>/dev/null
KREL="$(uname -r)"

echo "=== load input modules ==="
sudo modprobe uinput 2>/dev/null
sudo modprobe evdev 2>/dev/null || sudo insmod "/lib/modules/$KREL/kernel/drivers/input/evdev.ko" 2>/dev/null
ls -la /dev/uinput 2>&1 | head -1

echo "=== recreate phone-01 (guest gpu, host net) so it builds the touchscreen ==="
sudo docker rm -f fleet-local-phone-01 >/dev/null 2>&1
sleep 1
sudo mkdir -p /dev/binderfs1; mountpoint -q /dev/binderfs1 || sudo mount -t binder binder /dev/binderfs1
sudo docker run -d --name fleet-local-phone-01 --privileged --network host \
  -v /dev/binderfs1:/dev/binderfs -v fleet-local_phone01-data:/data \
  --restart unless-stopped \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_fps=30 \
  androidboot.redroid_gpu_mode=guest androidboot.redroid_adbd_port=5555 >/dev/null 2>&1

echo "=== wait boot ==="
adb connect 127.0.0.1:5555 >/dev/null 2>&1
for i in $(seq 1 40); do
  [ "$(adb -s 127.0.0.1:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && { echo "booted (try $i)"; break; }
  sleep 2
done

echo "=== NOW are there input devices? ==="
adb -s 127.0.0.1:5555 shell ls -la /dev/input/ 2>&1 | tr -d '\r'
echo "=== getevent device list ==="
adb -s 127.0.0.1:5555 shell getevent -p 2>/dev/null | grep -iE 'add device|name:' | head -10 | tr -d '\r'
