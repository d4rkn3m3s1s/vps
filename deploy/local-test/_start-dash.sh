#!/usr/bin/env bash
# Start the dashboard standalone production server detached on :3000.
D='/mnt/c/Yeni klasör/vps/apps/dashboard'
SA="$D/.next/standalone/apps/dashboard"

# Copy public/ in if present and not already there (favicon, static assets).
if [ -d "$D/public" ] && [ ! -d "$SA/public" ]; then
  cp -r "$D/public" "$SA/public" 2>/dev/null || true
  echo "public/ copied into standalone"
fi

# free port 3000
fuser -k 3000/tcp >/dev/null 2>&1 || true
sleep 1

cd "$SA" || exit 1
PORT=3000 HOSTNAME=0.0.0.0 nohup setsid node server.js >/tmp/dash.log 2>&1 < /dev/null &
echo "dashboard launched, pid group $!"

for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login 2>/dev/null)
  if [ "$code" = "200" ]; then echo "DASHBOARD: UP /login=200 (try $i)"; break; fi
  sleep 1
done
echo "=== dash.log tail 15 ==="
tail -15 /tmp/dash.log
