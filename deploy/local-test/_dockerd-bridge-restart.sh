#!/usr/bin/env bash
# Restart dockerd with bridge networking enabled (now possible: netfilter
# modules are loaded so iptables nat/filter work). Then verify a bridge
# container gets internet. This replaces the --network none + manual-veth hacks.
set -u
echo "163244" | sudo -S true 2>/dev/null
S() { sudo "$@"; }

echo "=== load netfilter modules (idempotent) ==="
for m in nf_conntrack nf_nat ip_tables iptable_nat iptable_filter iptable_mangle xt_MASQUERADE xt_conntrack br_netfilter; do
  sudo modprobe "$m" 2>/dev/null || true
done

echo "=== stop containers + dockerd ==="
sudo docker stop fleet-local-phone-01 fleet-local-phone-02 fleet-local-phone-03 fleet-local-postgres fleet-local-redis 2>/dev/null
sudo pkill -x dockerd 2>/dev/null
sleep 3

echo "=== ensure default route survives (re-add) ==="
GW=$(ip -4 route show dev eth0 | grep -oE '172\.[0-9]+\.[0-9]+\.0/' | head -1 | sed 's#0/#1#'); [ -z "$GW" ] && GW=172.28.0.1

echo "=== start dockerd (bridge enabled via daemon.json) ==="
sudo nohup setsid dockerd >/tmp/dockerd.log 2>&1 </dev/null &
for i in $(seq 1 40); do sudo docker info >/dev/null 2>&1 && break; sleep 1; done
sudo docker info >/dev/null 2>&1 || { echo "DOCKERD FAILED"; sudo tail -20 /tmp/dockerd.log; exit 1; }
echo "dockerd up"

# dockerd may wipe default route again — re-add
ip route | grep -q '^default' || sudo ip route add default via "$GW" dev eth0 2>/dev/null || true
echo "default route: $(ip route | grep '^default' || echo MISSING)"

echo "=== does docker0 bridge exist now? ==="
ip -4 addr show docker0 2>/dev/null | grep inet || echo "no docker0"

echo "=== TEST: alpine on default bridge gets internet? ==="
sudo docker run --rm alpine sh -c 'ping -c 2 -W 3 1.1.1.1 2>&1 | tail -3' 2>&1 | tail -4
