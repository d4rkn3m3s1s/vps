#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null
echo "=== binder in /proc/filesystems ==="
grep binder /proc/filesystems 2>/dev/null || echo "  no binderfs in /proc/filesystems"
echo "=== ashmem in /proc/misc ==="
grep ashmem /proc/misc 2>/dev/null || echo "  NO ashmem device (redroid will use memfd fallback)"
echo "=== memfd support ==="
grep -i memfd /proc/kallsyms 2>/dev/null | head -1 || echo "  (kallsyms restricted)"
echo "=== loaded modules ==="
lsmod 2>/dev/null | grep -iE 'binder|ashmem' || echo "  (binder/ashmem are builtin, not modules)"
echo "=== kernel version ==="
uname -r
echo ""
echo "=== DECISIVE TEST: two host-net redroids, capture 2nd one's dmesg crash ==="
sudo docker rm -f fleet-local-phone-02 >/dev/null 2>&1
sleep 1
# clear dmesg ring so we catch only the new crash
sudo dmesg -C 2>/dev/null
sudo docker run -d --name fleet-local-phone-02 \
  --privileged --network host \
  -v /dev/binderfs2:/dev/binderfs \
  -v fleet-local_phone02-data:/data \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_gpu_mode=guest \
  androidboot.redroid_adbd_port=5556 >/dev/null 2>&1
sleep 8
echo "phone-02: $(sudo docker inspect fleet-local-phone-02 --format 'status={{.State.Status}} exit={{.State.ExitCode}}' 2>/dev/null)"
echo "--- dmesg since start (redroid/init/binder/property/sigbus) ---"
sudo dmesg 2>/dev/null | grep -iE 'init|binder|property|sigbus|sig|redroid|ashmem|memfd' | tail -25
