#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null

echo "=== restart phone-02 on a docker bridge network (own netns) ==="
sudo docker rm -f fleet-local-phone-02 >/dev/null 2>&1
sleep 1
# Ensure a user bridge network exists (more reliable than default for inspect).
sudo docker network create fleetnet >/dev/null 2>&1 || true
sudo docker run -d --name fleet-local-phone-02 \
  --privileged --network fleetnet \
  -v /dev/binderfs2:/dev/binderfs \
  -v fleet-local_phone02-data:/data \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_gpu_mode=guest >/dev/null 2>&1

sleep 10
ST=$(sudo docker inspect fleet-local-phone-02 --format 'status={{.State.Status}} exit={{.State.ExitCode}}' 2>/dev/null)
IP=$(sudo docker inspect fleet-local-phone-02 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null)
echo "phone-02: $ST  container-IP=$IP"

echo "=== host route to container IP? ==="
ip route get "$IP" 2>&1 | head -1
echo "=== ping container IP from host ==="
ping -c 2 -W 2 "$IP" 2>&1 | tail -3
echo "=== adb connect by container IP ==="
adb connect "$IP:5555" 2>&1
sleep 3
echo "boot_completed: $(adb -s $IP:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
echo "=== docker0 / bridge ifaces on host ==="
ip -4 addr show 2>/dev/null | grep -E 'docker|br-|fleet' | head
