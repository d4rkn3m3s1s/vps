#!/usr/bin/env bash
# Reach a --network none redroid's adbd (listening inside its netns on :5555)
# from the host by forwarding host 127.0.0.1:HOSTPORT -> container-netns :5555
# with socat run INSIDE the container's network namespace via nsenter.
# This sidesteps the broken docker bridge/veth entirely.
echo "163244" | sudo -S true 2>/dev/null

have_socat=$(command -v socat || echo "")
if [ -z "$have_socat" ]; then
  echo "installing socat..."
  sudo apt-get update -qq >/dev/null 2>&1
  sudo apt-get install -y -qq socat >/dev/null 2>&1
fi
echo "socat: $(command -v socat)"

forward() {  # $1=container  $2=hostport
  local c="$1" hp="$2"
  local pid; pid=$(sudo docker inspect "$c" --format '{{.State.Pid}}' 2>/dev/null)
  [ -z "$pid" ] && { echo "  $c: no pid"; return 1; }
  # kill any prior forwarder for this hostport
  sudo pkill -f "socat.*TCP-LISTEN:$hp," >/dev/null 2>&1
  sleep 1
  # Host-side socat listens on hostport; connects to the container netns loopback:5555
  # by entering the netns for the *connect* side via nsenter.
  sudo bash -c "nohup setsid socat TCP-LISTEN:$hp,bind=127.0.0.1,reuseaddr,fork \
    EXEC:'nsenter -t $pid -n socat STDIO TCP\:127.0.0.1\:5555' \
    >/tmp/socat-$hp.log 2>&1 < /dev/null &"
  echo "  $c -> 127.0.0.1:$hp (netns pid $pid)"
}

echo "=== set up forwarders ==="
forward fleet-local-phone-02 5556
forward fleet-local-phone-03 5557
sleep 2

echo "=== host listeners now ==="
ss -ltn 2>/dev/null | grep -E ':(5556|5557)\b' || echo "  none yet"

echo "=== adb connect through forwarders ==="
adb connect 127.0.0.1:5556 2>&1
adb connect 127.0.0.1:5557 2>&1
sleep 3
echo "=== adb devices ==="
adb devices
