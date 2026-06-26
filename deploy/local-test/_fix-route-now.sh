#!/usr/bin/env bash
# Find and install a WORKING default gateway. dockerd/recreate wiped it; the
# correct gateway varies (.0.1 for the /20, or .6.1 matching the IP's /24).
# Try candidates until ping works.
echo "163244" | sudo -S true 2>/dev/null
CUR=$(ip -4 -o addr show eth0 | grep -oE '172\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
O1=$(echo "$CUR" | cut -d. -f1)
O2=$(echo "$CUR" | cut -d. -f2)
O3=$(echo "$CUR" | cut -d. -f3)
echo "eth0 ip: $CUR"

sudo ip route del default 2>/dev/null

# candidate gateways, most-likely first
CANDS="${O1}.${O2}.${O3}.1 ${O1}.${O2}.0.1 ${O1}.${O2}.1.1"
for gw in $CANDS; do
  sudo ip route replace default via "$gw" dev eth0 2>/dev/null
  if timeout 5 ping -c1 -W2 1.1.1.1 >/dev/null 2>&1; then
    echo ">>> WORKS via $gw"
    ip route show default
    exit 0
  fi
  echo "  fail via $gw"
  sudo ip route del default 2>/dev/null
done
echo "NO candidate worked — NAT may need wsl --shutdown"
exit 1
