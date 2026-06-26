#!/usr/bin/env bash
# One-shot status of the whole local stack: route, host+phone internet, docker
# phones, adb, API health, agent, and device ONLINE state in the DB.
SUDO_PASS=163244
S(){ echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }

echo "=== route + keeper ==="
ip route show default 2>/dev/null | sed 's/^/  /'
pgrep -f "_route-keeper.sh" >/dev/null && echo "  route-keeper: RUNNING" || echo "  route-keeper: NOT running"
timeout 6 ping -c1 -W2 1.1.1.1 >/dev/null 2>&1 && echo "  host internet: OK" || echo "  host internet: FAIL"

echo "=== docker phones ==="
S docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null | grep phone | sed 's/^/  /'

echo "=== adb devices ==="
adb devices 2>/dev/null | grep -E ':555[567]' | sed 's/^/  /'

echo "=== phone internet (each) ==="
for p in 5555 5556 5557; do
  ok=$(adb -s 127.0.0.1:$p shell ping -c1 -W3 v.whatsapp.net 2>/dev/null | grep -cE 'bytes from|received, [^0]')
  if adb -s 127.0.0.1:$p shell ping -c1 -W3 v.whatsapp.net 2>/dev/null | grep -qE '1 (packets )?received|bytes from'; then
    echo "  phone $p: INTERNET OK"
  else
    echo "  phone $p: NO NET"
  fi
done

echo "=== API health ==="
curl -s -o /dev/null -w "  /health=%{http_code}\n" http://localhost:4000/health 2>/dev/null

echo "=== agent ==="
pgrep -f "node agent.mjs" >/dev/null && echo "  agent: RUNNING" || echo "  agent: NOT running"
