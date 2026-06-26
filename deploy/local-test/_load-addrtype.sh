#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null
KREL="$(uname -r)"
MODDIR="/lib/modules/$KREL/kernel/net/netfilter"
echo "kernel: $KREL"
echo "=== insmod deps then xt_addrtype ==="
# addrtype may need nf_conntrack/x_tables loaded first (usually builtin)
sudo insmod "$MODDIR/xt_addrtype.ko" 2>&1 && echo "addrtype insmod OK" || echo "addrtype insmod msg above"
echo "=== also load common docker-needed matches ==="
for ko in xt_mark xt_MASQUERADE xt_nat nft_compat; do
  [ -f "$MODDIR/$ko.ko" ] && sudo insmod "$MODDIR/$ko.ko" 2>/dev/null
done
echo "=== verify addrtype ==="
if sudo iptables -t nat -A PREROUTING -m addrtype --dst-type LOCAL -j ACCEPT 2>/dev/null; then
  echo "ADDRTYPE WORKS"
  sudo iptables -t nat -D PREROUTING -m addrtype --dst-type LOCAL -j ACCEPT 2>/dev/null
else
  echo "addrtype STILL missing"
fi
lsmod | grep -E 'addrtype' || echo "(addrtype not in lsmod)"
