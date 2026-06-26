#!/usr/bin/env bash
# Clean-room test: with NO redroid (host-net) running, does docker bridge give
# internet? If yes -> the Android-iptables pollution from host-net phone-01 was
# the blocker, and the fix is "all phones on bridge, none on host-net".
echo "163244" | sudo -S true 2>/dev/null

echo "=== stop ALL redroid (remove host-net Android iptables pollution) ==="
sudo docker stop fleet-local-phone-01 fleet-local-phone-02 fleet-local-phone-03 2>/dev/null

echo "=== restart dockerd FRESH so iptables is clean ==="
sudo pkill -x dockerd 2>/dev/null; sleep 3
sudo nohup setsid dockerd >/tmp/dockerd.log 2>&1 </dev/null &
for i in $(seq 1 40); do sudo docker info >/dev/null 2>&1 && break; sleep 1; done
echo "dockerd: $(sudo docker info >/dev/null 2>&1 && echo up || echo FAIL)"

ip route | grep -q '^default' || sudo ip route add default via 172.28.0.1 dev eth0 2>/dev/null || true
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 >/dev/null 2>&1
sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1

echo "=== are Android chains present in a clean (no-redroid) iptables? ==="
sudo iptables -t raw -L PREROUTING -n 2>&1 | grep -cE 'bw_|tetherctrl|idletimer' | sed 's/^/  android-chains: /'

echo "=== TEST container internet (no redroid running) ==="
sudo timeout 30 docker run --rm alpine sh -c 'ping -c1 -W2 172.17.0.1 >/dev/null 2>&1 && echo GW_OK || echo GW_FAIL; ping -c 2 -W 3 1.1.1.1 2>&1 | tail -2' 2>&1 | tail -4
