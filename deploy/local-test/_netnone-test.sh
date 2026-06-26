#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null
echo "=== phone-02 with --network none + isolated binderfs2 ==="
sudo docker rm -f fleet-local-phone-02 >/dev/null 2>&1
sleep 1
sudo docker run -d --name fleet-local-phone-02 \
  --privileged --network none \
  -v /dev/binderfs2:/dev/binderfs \
  -v fleet-local_phone02-data:/data \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_gpu_mode=guest >/dev/null 2>&1
echo "wait 30s for first boot..."
sleep 30
echo "phone-02: $(sudo docker inspect fleet-local-phone-02 --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}' 2>/dev/null)"
echo "=== boot_completed via docker exec (inside its own netns) ==="
sudo docker exec fleet-local-phone-02 getprop sys.boot_completed 2>&1 | tr -d '\r'
echo "=== adbd listening inside container? ==="
PID=$(sudo docker inspect fleet-local-phone-02 --format '{{.State.Pid}}' 2>/dev/null)
echo "container init pid: $PID"
sudo nsenter -t "$PID" -n ss -ltn 2>/dev/null | grep 5555 || echo "  (adbd not on tcp yet, or netns empty)"
echo "=== phone-01 + phone-03 still alive? ==="
for p in 01 03; do echo "phone-$p: $(sudo docker inspect fleet-local-phone-$p --format 'status={{.State.Status}} exit={{.State.ExitCode}}' 2>/dev/null)"; done
