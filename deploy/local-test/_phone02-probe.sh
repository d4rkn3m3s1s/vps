#!/usr/bin/env bash
S() { echo "163244" | sudo -S "$@" 2>/dev/null; }
echo "--- remove restart-looping phone-02 ---"
S docker rm -f fleet-local-phone-02 >/dev/null 2>&1

echo "--- run phone-02 ONE-SHOT (no restart, capture real stderr) ---"
# Same boot args as compose, host net, but no restart policy so we see the crash.
S docker run --rm --name fleet-local-phone-02-probe \
  --privileged --network host \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 \
  androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 \
  androidboot.redroid_gpu_mode=guest \
  androidboot.redroid_adbd_port=5556 2>&1 | head -30 &
PROBE=$!
sleep 10
echo "--- kill probe ---"
S docker rm -f fleet-local-phone-02-probe >/dev/null 2>&1
wait $PROBE 2>/dev/null
echo "--- done ---"
