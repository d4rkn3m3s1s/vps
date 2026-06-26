#!/usr/bin/env bash
# Check internet reachability from inside each phone (ping WhatsApp + DNS).
for p in 5555 5556 5557; do
  echo "--- phone $p ---"
  adb connect 127.0.0.1:$p >/dev/null 2>&1
  # 8.8.8.8 (raw IP) tests routing; v.whatsapp.net tests DNS+routing
  ip_ok=$(adb -s 127.0.0.1:$p shell ping -c1 -W3 8.8.8.8 2>/dev/null | grep -cE '1 received|bytes from')
  wa_ok=$(adb -s 127.0.0.1:$p shell ping -c1 -W3 v.whatsapp.net 2>/dev/null | grep -cE '1 received|bytes from')
  echo "  8.8.8.8:      $([ "$ip_ok" -ge 1 ] 2>/dev/null && echo OK || echo FAIL)"
  echo "  v.whatsapp.net (DNS): $([ "$wa_ok" -ge 1 ] 2>/dev/null && echo OK || echo FAIL)"
done
