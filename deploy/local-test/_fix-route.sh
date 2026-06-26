#!/usr/bin/env bash
# Restore the default route dockerd wiped (the recurring NAT-mode issue).
# eth0 is 172.28.6.252/20 -> gateway 172.28.0.1.
echo "163244" | sudo -S true 2>/dev/null

# Derive gateway from eth0 subnet (first host addr).
GW=$(ip -4 route show dev eth0 | grep -oE '172\.[0-9]+\.[0-9]+\.0/' | head -1 | sed 's#0/#1#')
[ -z "$GW" ] && GW=172.28.0.1
echo "gateway: $GW"

sudo ip route add default via "$GW" dev eth0 2>&1 || sudo ip route replace default via "$GW" dev eth0 2>&1
echo "=== routes ==="
ip route
echo "=== ping test ==="
timeout 8 ping -c 2 "$GW" 2>&1 | tail -2
timeout 8 ping -c 2 1.1.1.1 2>&1 | tail -2
echo "=== DNS resolve ==="
getent hosts sms-bus.com 2>&1 || echo "DNS still failing"
echo "=== https test ==="
timeout 12 curl -s -o /dev/null -w 'sms-bus=%{http_code}\n' "https://sms-bus.com/api/control/get/balance?token=5c597c5f569144a88b42595c333f52b9" 2>&1
