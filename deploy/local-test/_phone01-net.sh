#!/usr/bin/env bash
echo "163244" | sudo -S true 2>/dev/null
S="127.0.0.1:5555"
echo "host route: $(ip route | grep '^default')"
echo "host internet: $(timeout 6 ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && echo OK || echo FAIL)"
echo "phone-01 ping 8.8.8.8:"
adb -s "$S" shell ping -c 2 -W 3 8.8.8.8 2>/dev/null | grep -E 'received|bytes from' | tr -d '\r'
echo "phone-01 resolve v.whatsapp.net:"
adb -s "$S" shell ping -c 1 -W 3 v.whatsapp.net 2>/dev/null | grep -E 'bytes from|received|PING' | head -1 | tr -d '\r'
