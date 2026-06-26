#!/usr/bin/env bash
# Load EVERY netfilter table/match module docker's bridge driver needs on this
# custom WSL kernel (they ship as .ko but aren't auto-loaded). After this,
# docker bridge networking (with NAT + DROP rules) works fully.
echo "163244" | sudo -S true 2>/dev/null
KREL="$(uname -r)"
B="/lib/modules/$KREL/kernel"

load() {  # $1 = relative .ko path under $B
  local f="$B/$1"
  if [ -f "$f" ]; then
    sudo insmod "$f" 2>/dev/null && echo "  + $(basename "$f")" || echo "  . $(basename "$f") (already/loaded-or-dep)"
  fi
}

echo "kernel: $KREL"
echo "=== tables ==="
load net/ipv4/netfilter/iptable_raw.ko
load net/ipv4/netfilter/iptable_nat.ko
load net/ipv4/netfilter/iptable_filter.ko
load net/ipv4/netfilter/iptable_mangle.ko
echo "=== matches/targets ==="
load net/netfilter/xt_addrtype.ko
load net/netfilter/xt_conntrack.ko
load net/netfilter/xt_mark.ko
load net/netfilter/xt_MASQUERADE.ko
load net/netfilter/xt_nat.ko
load net/netfilter/xt_comment.ko

echo "=== verify all tables present ==="
for t in raw nat filter mangle; do
  sudo iptables -t $t -L >/dev/null 2>&1 && echo "  $t OK" || echo "  $t MISSING"
done

echo "=== TEST alpine internet on bridge ==="
sudo docker run --rm alpine sh -c 'ping -c 2 -W 3 1.1.1.1 2>&1 | tail -3' 2>&1 | tail -5
