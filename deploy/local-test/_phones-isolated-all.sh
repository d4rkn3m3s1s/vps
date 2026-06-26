#!/usr/bin/env bash
# Bring up ALL THREE phones, each with its OWN isolated binderfs instance.
# This eliminates the binder-contention exit-129 crash entirely: no phone uses
# the shared default /dev/binderfs; each gets a private mount bound to
# /dev/binderfs inside its container.
#
#   phone-01  binderfs1  adbd 5555 (host net)   redroid 13 x86_64
#   phone-02  binderfs2  adbd 5556 (host net)   redroid 13 x86_64
#   phone-03  binderfs3  5557->5555 (bridge)    redroid 11 ndk (ARM)
S() { echo "163244" | sudo -S "$@" 2>/dev/null; }

echo "=== tear down all three (keep data volumes) ==="
S docker rm -f fleet-local-phone-01 fleet-local-phone-02 fleet-local-phone-03 >/dev/null 2>&1
sleep 1

echo "=== create 3 isolated binderfs instances ==="
for n in 1 2 3; do
  S mkdir -p /dev/binderfs$n
  if ! mountpoint -q /dev/binderfs$n; then
    S mount -t binder binder /dev/binderfs$n
  fi
  echo "  binderfs$n: $(S ls /dev/binderfs$n 2>/dev/null | tr '\n' ' ')"
done

echo "=== phone-01 (binderfs1, host net, adbd 5555) ==="
S docker run -d --name fleet-local-phone-01 \
  --privileged --network host \
  -v /dev/binderfs1:/dev/binderfs \
  -v fleet-local_phone01-data:/data \
  --restart unless-stopped \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_fps=30 \
  androidboot.redroid_gpu_mode=guest androidboot.redroid_adbd_port=5555 >/dev/null 2>&1

echo "=== phone-02 (binderfs2, host net, adbd 5556) ==="
S docker run -d --name fleet-local-phone-02 \
  --privileged --network host \
  -v /dev/binderfs2:/dev/binderfs \
  -v fleet-local_phone02-data:/data \
  --restart unless-stopped \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_fps=30 \
  androidboot.redroid_gpu_mode=guest androidboot.redroid_adbd_port=5556 >/dev/null 2>&1

echo "=== phone-03 (binderfs3, bridge 5557->5555, ARM ndk) ==="
S docker run -d --name fleet-local-phone-03 \
  --privileged \
  -p 127.0.0.1:5557:5555 \
  -v /dev/binderfs3:/dev/binderfs \
  -v fleet-local_phone03-data:/data \
  --restart unless-stopped \
  redroid/redroid:11.0.0_ndk \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_fps=30 \
  androidboot.redroid_gpu_mode=guest \
  androidboot.redroid_enable_native_bridge=1 \
  ro.product.cpu.abilist=x86_64,arm64-v8a,x86,armeabi-v7a,armeabi \
  ro.dalvik.vm.native.bridge=libndk_translation.so \
  ro.enable.native.bridge.exec=1 \
  ro.dalvik.vm.isa.arm64=x86_64 >/dev/null 2>&1

echo "=== wait 14s, then status ==="
sleep 14
for p in 01 02 03; do
  echo "phone-$p: $(S docker inspect fleet-local-phone-$p --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}')"
done
