#!/bin/bash
# wd-adb.sh <instance> — cihaza ADB auth key yaz + insecure adbd (boot sonrası)
INST="${1:?instance}"
LXCP=/var/lib/waydroid.$INST/lxc
ADBK=$(cat /opt/fleet-agent/waydroid/host-adbkey.pub 2>/dev/null)
[ "$(lxc-info -n waydroid -P $LXCP -sH 2>/dev/null)" = "FROZEN" ] && lxc-unfreeze -n waydroid -P $LXCP 2>/dev/null
timeout 8 lxc-attach -n waydroid -P $LXCP -- /system/bin/sh -c "mkdir -p /data/misc/adb; printf '%s\n' \"$ADBK\" > /data/misc/adb/adb_keys; chown 1000:2000 /data/misc/adb/adb_keys; chmod 640 /data/misc/adb/adb_keys" 2>/dev/null
timeout 8 lxc-attach -n waydroid -P $LXCP -- setprop ro.adb.secure 0 2>/dev/null
timeout 8 lxc-attach -n waydroid -P $LXCP -- setprop persist.adb.tcp.port 5555 2>/dev/null
timeout 8 lxc-attach -n waydroid -P $LXCP -- setprop service.adb.tcp.port 5555 2>/dev/null
timeout 8 lxc-attach -n waydroid -P $LXCP -- stop adbd 2>/dev/null; sleep 1
timeout 8 lxc-attach -n waydroid -P $LXCP -- start adbd 2>/dev/null
echo "ADB_READY $INST"
