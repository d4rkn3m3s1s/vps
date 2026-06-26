#!/usr/bin/env bash
# Prime sudo once (so later sudo calls don't emit the password prompt to stdout),
# then find WHY two host-net redroids collide.
echo "163244" | sudo -S true 2>/dev/null

echo "=== current container states ==="
for p in 01 02 03; do
  echo "phone-$p: $(sudo docker inspect fleet-local-phone-$p --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}' 2>/dev/null)"
done

echo ""
echo "=== move phone-02 back to HOST net (isolated binderfs2), capture its crash log ==="
sudo docker rm -f fleet-local-phone-02 >/dev/null 2>&1
sleep 1
sudo docker run -d --name fleet-local-phone-02 \
  --privileged --network host \
  -v /dev/binderfs2:/dev/binderfs \
  -v fleet-local_phone02-data:/data \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_gpu_mode=guest \
  androidboot.redroid_adbd_port=5556 >/dev/null 2>&1
sleep 10
echo "phone-02 (host net): $(sudo docker inspect fleet-local-phone-02 --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}' 2>/dev/null)"
echo "--- phone-02 logs (the real crash reason) ---"
sudo docker logs fleet-local-phone-02 2>&1 | tail -40
echo "--- /init exit signal? 129=SIGHUP 137=SIGKILL/OOM ---"
