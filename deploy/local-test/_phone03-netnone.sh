#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null
echo "=== recreate phone-03 (ARM ndk) with --network none + binderfs3 ==="
sudo docker rm -f fleet-local-phone-03 >/dev/null 2>&1
sleep 1
sudo docker run -d --name fleet-local-phone-03 \
  --privileged --network none \
  -v /dev/binderfs3:/dev/binderfs \
  -v fleet-local_phone03-data:/data \
  redroid/redroid:11.0.0_ndk \
  androidboot.redroid_width=600 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=240 androidboot.redroid_gpu_mode=guest \
  androidboot.redroid_enable_native_bridge=1 \
  ro.product.cpu.abilist=x86_64,arm64-v8a,x86,armeabi-v7a,armeabi \
  ro.dalvik.vm.native.bridge=libndk_translation.so \
  ro.enable.native.bridge.exec=1 \
  ro.dalvik.vm.isa.arm64=x86_64 >/dev/null 2>&1
echo "wait 35s for ARM-translation first boot..."
sleep 35
echo "phone-03: $(sudo docker inspect fleet-local-phone-03 --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}' 2>/dev/null)"
echo "boot_completed: $(sudo docker exec fleet-local-phone-03 getprop sys.boot_completed 2>&1 | tr -d '\r')"
echo "abilist: $(sudo docker exec fleet-local-phone-03 getprop ro.product.cpu.abilist 2>&1 | tr -d '\r')"
