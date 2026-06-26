#!/usr/bin/env bash
# Proof test: give phone-02 its OWN isolated binderfs instance while phone-01
# keeps the default /dev/binderfs. If both stay up, the per-container binderfs
# mount is the fix for the binder-contention exit-129 crash.
S() { echo "163244" | sudo -S "$@" 2>/dev/null; }

echo "=== ensure phone-01 is up on default /dev/binderfs ==="
S docker start fleet-local-phone-01 >/dev/null 2>&1
sleep 6
echo "phone-01: $(S docker inspect fleet-local-phone-01 --format 'status={{.State.Status}} exit={{.State.ExitCode}}')"

echo "=== create isolated binderfs #2 for phone-02 ==="
S mkdir -p /dev/binderfs2
# mount a SEPARATE binder instance (idempotent: skip if already mounted)
if ! mountpoint -q /dev/binderfs2; then
  S mount -t binder binder /dev/binderfs2
fi
echo "binderfs2 nodes: $(S ls /dev/binderfs2 2>/dev/null | tr '\n' ' ')"

echo "=== run phone-02 with its own binderfs bound to /dev/binderfs ==="
S docker rm -f fleet-local-phone-02 >/dev/null 2>&1
sleep 1
S docker run -d --name fleet-local-phone-02 \
  --privileged --network host \
  -v /dev/binderfs2:/dev/binderfs \
  -v fleet-local_phone02-data:/data \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_gpu_mode=guest \
  androidboot.redroid_adbd_port=5556 >/dev/null 2>&1

sleep 12
echo "--- RESULTS ---"
echo "phone-01: $(S docker inspect fleet-local-phone-01 --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}')"
echo "phone-02: $(S docker inspect fleet-local-phone-02 --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}')"
