#!/usr/bin/env bash
# Start the API dev server detached, survives the launching shell.
cd "/mnt/c/Yeni klasör/vps/apps/api" || exit 1
# kill any stale API on 4000
fuser -k 4000/tcp >/dev/null 2>&1 || true
sleep 1
nohup setsid npm run dev >/tmp/api.log 2>&1 < /dev/null &
echo "api launching, pid group $!"
# wait for /health
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/health 2>/dev/null)
  if [ "$code" = "200" ]; then echo "API: UP (try $i)"; break; fi
  sleep 1
done
echo "=== /health ==="
curl -s http://localhost:4000/health 2>&1
echo ""
echo "=== last 12 log lines ==="
tail -12 /tmp/api.log
