#!/bin/bash
# wd-run.sh <instance> — phoenixNAP: çözülen 8-adım setsid multi-instance boot.
# Agent hostShDetached ile çağırır (fire-and-forget). Boot sonrası ADB tcp açar.
INST="${1:?instance}"
exec >> /var/log/wd-$INST-run.log 2>&1
set -x
XRD=/run/xdg-$INST
MI=/opt/waydroid-mi2
LXCP=/var/lib/waydroid.$INST/lxc
export PYTHONPATH=$MI
SUBNET=$(sh /opt/fleet-agent/waydroid/net-head.sh $INST)

# 1 temizle
pkill -9 -f "wayland-$INST" 2>/dev/null; pkill -9 -f "instance $INST" 2>/dev/null
rm -rf /run/wd-$INST /run/xdg-$INST 2>/dev/null; sleep 1
# netfix: stale network_up marker bridge yeniden kurulmasini engeller (KOK NEDEN)
rm -f /run/waydroid-$INST-lxc/network_up 2>/dev/null  # netfix
pkill -9 -f "dnsmasq.*waydroid-$INST" 2>/dev/null  # netfix orphan-dnsmasq (subnet cakismasi onler)
touch /var/lib/waydroid-subnets.map 2>/dev/null; chmod 666 /var/lib/waydroid-subnets.map 2>/dev/null  # netfix
# 2 hazırla
mkdir -p $XRD/pulse; chmod 700 $XRD; : > $XRD/pulse/native
# 3 binder
bash /opt/fleet-agent/waydroid/wd-binder.sh $INST
# 4 weston
setsid env XDG_RUNTIME_DIR=$XRD weston --backend=headless --socket=wayland-$INST --width=1080 --height=2400 >/var/log/weston-$INST.log 2>&1 < /dev/null &
for i in $(seq 1 20); do [ -S $XRD/wayland-$INST ] && break; sleep 0.5; done
# 5 container
setsid env XDG_RUNTIME_DIR=$XRD PYTHONPATH=$MI python3 $MI/waydroid.py --instance $INST container start >/var/log/$INST-ct.log 2>&1 < /dev/null &
for i in $(seq 1 25); do dbus-send --system --dest=org.freedesktop.DBus --print-reply /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null | grep -q "id.waydro.Container.$INST" && break; sleep 1; done
# 6 session bus
[ -S $XRD/bus ] || { setsid dbus-daemon --session --address=unix:path=$XRD/bus --nofork --nopidfile >/var/log/$INST-sbus.log 2>&1 < /dev/null & sleep 2; }
# 7 session start
setsid env XDG_RUNTIME_DIR=$XRD WAYLAND_DISPLAY=wayland-$INST DBUS_SESSION_BUS_ADDRESS=unix:path=$XRD/bus PYTHONPATH=$MI python3 $MI/waydroid.py --instance $INST session start >/var/log/$INST-sess.log 2>&1 < /dev/null &
# 8 boot bekle + ekran + ADB tcp
for i in $(seq 1 30); do
  st=$(lxc-info -n waydroid -P $LXCP -sH 2>/dev/null)
  [ "$st" = "FROZEN" ] && lxc-unfreeze -n waydroid -P $LXCP 2>/dev/null
  if [ "$st" = "RUNNING" ]; then
    bc=$(timeout 5 lxc-attach -n waydroid -P $LXCP -- getprop sys.boot_completed 2>/dev/null | tr -d "\r" | head -1)
    [ "$bc" = "1" ] && break
  fi
  sleep 3
done
# ekran sabitle + ADB tcp aç (agent 192.168.SUBNET.112:5555 e bağlanacak)
timeout 8 lxc-attach -n waydroid -P $LXCP -- wm size 1080x2400 2>/dev/null
timeout 8 lxc-attach -n waydroid -P $LXCP -- wm density 421 2>/dev/null
timeout 8 lxc-attach -n waydroid -P $LXCP -- setprop service.adb.tcp.port 5555 2>/dev/null
bash /opt/fleet-agent/waydroid/wd-adb.sh $INST
timeout 8 lxc-attach -n waydroid -P $LXCP -- start adbd 2>/dev/null
echo "BOOT_DONE $INST subnet=$SUBNET boot=$(timeout 5 lxc-attach -n waydroid -P $LXCP -- getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
# session i canlı tut (agent detached bekliyor)
sleep infinity
