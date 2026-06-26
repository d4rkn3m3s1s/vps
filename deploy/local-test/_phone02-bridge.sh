#!/usr/bin/env bash
# phone-02 was the only one on a SECOND host-net stack; two host-net redroids
# collide on fixed internal host sockets (not binder). Move phone-02 to its own
# network namespace (bridge) with adb published 5556->5555, mirroring phone-03.
S() { echo "163244" | sudo -S "$@" 2>/dev/null; }

S docker rm -f fleet-local-phone-02 >/dev/null 2>&1
sleep 1
S docker run -d --name fleet-local-phone-02 \
  --privileged \
  -p 127.0.0.1:5556:5555 \
  -v /dev/binderfs2:/dev/binderfs \
  -v fleet-local_phone02-data:/data \
  --restart unless-stopped \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_fps=30 \
  androidboot.redroid_gpu_mode=guest >/dev/null 2>&1

sleep 14
for p in 01 02 03; do
  echo "phone-$p: $(S docker inspect fleet-local-phone-$p --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}')"
done
