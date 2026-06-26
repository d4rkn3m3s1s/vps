#!/usr/bin/env bash
# Core bridge L2 works (manual test passed). The docker0 failure was iptables
# eating bridged frames via br_netfilter. Fix: enable docker bridge + load all
# netfilter modules + set bridge-nf-call-iptables=0 so bridged frames aren't
# dropped. Then verify a container gets internet.
echo "163244" | sudo -S true 2>/dev/null
KREL="$(uname -r)"; B="/lib/modules/$KREL/kernel"

echo "=== stop containers + dockerd ==="
sudo docker stop fleet-local-phone-01 fleet-local-phone-02 fleet-local-phone-03 fleet-local-postgres fleet-local-redis 2>/dev/null
sudo pkill -x dockerd 2>/dev/null; sleep 3

echo "=== load every netfilter module docker needs ==="
sudo modprobe br_netfilter 2>/dev/null
for ko in net/ipv4/netfilter/iptable_raw.ko net/ipv4/netfilter/iptable_nat.ko \
          net/ipv4/netfilter/iptable_filter.ko net/ipv4/netfilter/iptable_mangle.ko \
          net/netfilter/xt_addrtype.ko net/netfilter/xt_conntrack.ko \
          net/netfilter/xt_mark.ko net/netfilter/xt_MASQUERADE.ko net/netfilter/xt_nat.ko \
          net/netfilter/xt_comment.ko; do
  [ -f "$B/$ko" ] && sudo insmod "$B/$ko" 2>/dev/null
done

echo "=== bridge-enabled daemon.json ==="
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "iptables": true,
  "ip6tables": false,
  "dns": ["1.1.1.1", "8.8.8.8"]
}
JSON

echo "=== start dockerd ==="
sudo nohup setsid dockerd >/tmp/dockerd.log 2>&1 </dev/null &
for i in $(seq 1 40); do sudo docker info >/dev/null 2>&1 && break; sleep 1; done
sudo docker info >/dev/null 2>&1 || { echo "DOCKERD FAILED"; sudo tail -15 /tmp/dockerd.log; exit 1; }
echo "dockerd up"

# default route + the CRITICAL bridge-nf bypass (set AFTER dockerd, it may reset it)
ip route | grep -q '^default' || sudo ip route add default via 172.28.0.1 dev eth0 2>/dev/null || true
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 >/dev/null 2>&1
sudo sysctl -w net.bridge.bridge-nf-call-ip6tables=0 >/dev/null 2>&1
sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1

echo "=== TEST: container internet ==="
sudo docker run --rm alpine sh -c 'ping -c1 -W2 172.17.0.1 >/dev/null 2>&1 && echo GW_OK || echo GW_FAIL; ping -c 2 -W 3 1.1.1.1 2>&1 | tail -2; echo ---dns---; nslookup whatsapp.net 2>&1 | tail -2' 2>&1 | tail -8
