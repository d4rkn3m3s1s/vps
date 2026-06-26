#!/usr/bin/env bash
# Recreate phone-01 with a different gpu_mode to fix the redroid touch/hit-test
# failure on WhatsApp. Keeps the phone01-data volume (WhatsApp stays installed).
# Arg: gpu mode (swiftshader|host|guest|angle). Default swiftshader.
GPU="${1:-swiftshader}"
echo "163244" | sudo -S true 2>/dev/null
echo "=== recreate phone-01 with gpu_mode=$GPU (host net, binderfs1) ==="
sudo docker rm -f fleet-local-phone-01 >/dev/null 2>&1
sleep 1
sudo mkdir -p /dev/binderfs1
mountpoint -q /dev/binderfs1 || sudo mount -t binder binder /dev/binderfs1
sudo docker run -d --name fleet-local-phone-01 --privileged --network host \
  -v /dev/binderfs1:/dev/binderfs -v fleet-local_phone01-data:/data \
  --restart unless-stopped \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_fps=30 \
  androidboot.redroid_gpu_mode=$GPU \
  androidboot.redroid_adbd_port=5555 >/dev/null 2>&1

echo "=== wait for boot ==="
for i in $(seq 1 45); do
  [ "$(sudo docker exec fleet-local-phone-01 getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && { echo "booted (try $i)"; break; }
  sleep 2
done
adb connect 127.0.0.1:5555 >/dev/null 2>&1
echo "gpu_mode now: $(adb -s 127.0.0.1:5555 shell getprop ro.hardware.gralloc 2>/dev/null | tr -d '\r') / boot=$(adb -s 127.0.0.1:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
echo "WA installed: $(adb -s 127.0.0.1:5555 shell pm list packages com.whatsapp 2>/dev/null | tr -d '\r')"
