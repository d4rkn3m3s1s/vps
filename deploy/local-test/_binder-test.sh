#!/usr/bin/env bash
S() { echo "163244" | sudo -S "$@" 2>/dev/null; }
echo "=== STEP 1: stop phone-01, run phone-02 ALONE ==="
S docker stop fleet-local-phone-01 >/dev/null 2>&1
S docker rm -f fleet-local-phone-02 >/dev/null 2>&1
sleep 2
S docker run -d --name fleet-local-phone-02 \
  --privileged --network host \
  -v fleet-local_phone02-data:/data \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_gpu_mode=guest \
  androidboot.redroid_adbd_port=5556 >/dev/null 2>&1
sleep 10
echo "phone-02 alone: $(S docker inspect fleet-local-phone-02 --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}')"
echo "--- logs ---"; S docker logs --tail 15 fleet-local-phone-02 2>&1

echo ""
echo "=== STEP 2: check binderfs instances available ==="
echo "binder nodes: $(ls /dev/binderfs 2>/dev/null | tr '\n' ' ')"
echo "max binder devices kernel allows:"
cat /proc/sys/kernel/... 2>/dev/null
S cat /sys/module/binder_linux/parameters/devices 2>/dev/null || echo "(no binder_linux param)"

echo ""
echo "=== STEP 3: restart phone-01 too ==="
S docker start fleet-local-phone-01 >/dev/null 2>&1
sleep 8
echo "phone-01: $(S docker inspect fleet-local-phone-01 --format 'status={{.State.Status}} exit={{.State.ExitCode}}')"
echo "phone-02: $(S docker inspect fleet-local-phone-02 --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}')"
