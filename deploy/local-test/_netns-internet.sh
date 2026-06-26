#!/usr/bin/env bash
# Give the --network none redroid phones (phone-02, phone-03) outbound internet
# so WhatsApp can reach its servers. We create a veth pair per phone: one end in
# the host netns, the other inside the container's netns (via nsenter), assign a
# /30, set the container's default route to the host end, and MASQUERADE its
# subnet out eth0. DNS is set to 1.1.1.1 inside the phone.
#
# Idempotent-ish: removes prior veths for these phones first.
set -u
echo "163244" | sudo -S true 2>/dev/null

# Load the netfilter modules this custom kernel ships but doesn't auto-load.
# Without these, iptables nat/filter tables are absent and MASQUERADE fails.
for m in nf_conntrack nf_nat ip_tables iptable_nat iptable_filter iptable_mangle xt_MASQUERADE xt_conntrack; do
  echo "163244" | sudo -S modprobe "$m" 2>/dev/null || true
done
# Make sure FORWARD default doesn't drop our traffic.
sudo iptables -P FORWARD ACCEPT 2>/dev/null || true

setup() {  # $1=container  $2=hostIP  $3=nsIP  $4=vethHost  $5=vethNs  $6=subnet
  local c="$1" hip="$2" nip="$3" vh="$4" vn="$5" sub="$6"
  local pid; pid=$(sudo docker inspect "$c" --format '{{.State.Pid}}' 2>/dev/null)
  [ -z "$pid" ] && { echo "  $c: no pid"; return 1; }
  echo "=== $c (pid $pid): $hip <-> $nip ==="

  # clean any prior veth
  sudo ip link del "$vh" 2>/dev/null

  # make the container netns visible to `ip netns`
  sudo mkdir -p /var/run/netns
  sudo ln -sf "/proc/$pid/ns/net" "/var/run/netns/$c" 2>/dev/null

  # veth pair: vh stays in host, vn goes into the container netns
  sudo ip link add "$vh" type veth peer name "$vn"
  sudo ip addr add "$hip/30" dev "$vh"
  sudo ip link set "$vh" up
  sudo ip link set "$vn" netns "$c"
  sudo ip netns exec "$c" ip addr add "$nip/30" dev "$vn"
  sudo ip netns exec "$c" ip link set "$vn" up
  sudo ip netns exec "$c" ip link set lo up
  sudo ip netns exec "$c" ip route replace default via "$hip" dev "$vn"

  # NAT this subnet out the host's eth0
  sudo iptables -t nat -C POSTROUTING -s "$sub" -o eth0 -j MASQUERADE 2>/dev/null \
    || sudo iptables -t nat -A POSTROUTING -s "$sub" -o eth0 -j MASQUERADE
  sudo iptables -C FORWARD -i "$vh" -j ACCEPT 2>/dev/null || sudo iptables -A FORWARD -i "$vh" -j ACCEPT
  sudo iptables -C FORWARD -o "$vh" -j ACCEPT 2>/dev/null || sudo iptables -A FORWARD -o "$vh" -j ACCEPT

  # DNS inside the phone (redroid honors net.dns1 + /etc/resolv via getprop)
  sudo docker exec "$c" sh -c 'setprop net.dns1 1.1.1.1; setprop net.dns2 8.8.8.8' 2>/dev/null || true

  # test from inside the phone
  echo -n "  ping 1.1.1.1: "
  sudo docker exec "$c" ping -c 1 -W 3 1.1.1.1 >/dev/null 2>&1 && echo OK || echo FAIL
}

# enable ip forwarding on the host
sudo sysctl -w net.ipv4.ip_forward=1 >/dev/null 2>&1

setup fleet-local-phone-02 10.77.2.1 10.77.2.2 vphone02h vphone02n 10.77.2.0/30
setup fleet-local-phone-03 10.77.3.1 10.77.3.2 vphone03h vphone03n 10.77.3.0/30

echo "=== verify DNS resolution inside phones ==="
for c in fleet-local-phone-02 fleet-local-phone-03; do
  echo -n "  $c v.whatsapp.net: "
  sudo docker exec "$c" ping -c 1 -W 3 v.whatsapp.net >/dev/null 2>&1 && echo "REACH" || echo "FAIL"
done
