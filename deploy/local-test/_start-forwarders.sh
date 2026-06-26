#!/usr/bin/env bash
# Launch the Node netns-forwarder for phone-02 (5556) and phone-03 (5557),
# detached. Needs to run as root (nsenter into container netns).
echo "163244" | sudo -S true 2>/dev/null

PID2=$(sudo docker inspect fleet-local-phone-02 --format '{{.State.Pid}}' 2>/dev/null)
PID3=$(sudo docker inspect fleet-local-phone-03 --format '{{.State.Pid}}' 2>/dev/null)
echo "phone-02 pid=$PID2  phone-03 pid=$PID3"

# kill any prior forwarder
sudo pkill -f netns-forward.mjs >/dev/null 2>&1
sleep 1

sudo bash -c "nohup setsid node '/mnt/c/Yeni klasör/vps/deploy/local-test/netns-forward.mjs' 5556:$PID2 5557:$PID3 >/tmp/forwarders.log 2>&1 < /dev/null &"
sleep 2
echo "=== forwarder log ==="
cat /tmp/forwarders.log 2>&1
echo "=== host listeners ==="
ss -ltn 2>/dev/null | grep -E ':(5556|5557)\b' || echo "  none"
echo "=== adb connect ==="
adb start-server >/dev/null 2>&1
adb connect 127.0.0.1:5556 2>&1
adb connect 127.0.0.1:5557 2>&1
sleep 3
echo "=== adb devices ==="
adb devices
