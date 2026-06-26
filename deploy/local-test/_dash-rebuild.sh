#!/usr/bin/env bash
# Rebuild the dashboard (picks up the new platinum theme) and restart the
# standalone production server on :3000.
set -u
D='/mnt/c/Yeni klasör/vps/apps/dashboard'
cd "$D" || exit 1
echo "=== next build ==="
npm run build 2>&1 | tail -25
RC=${PIPESTATUS[0]}
echo "build_exit=$RC"
[ "$RC" != "0" ] && { echo "BUILD FAILED"; exit 1; }

SA="$D/.next/standalone/apps/dashboard"
# refresh static + public into standalone
rm -rf "$SA/.next/static" 2>/dev/null
cp -r "$D/.next/static" "$SA/.next/static"
[ -d "$D/public" ] && cp -r "$D/public" "$SA/public" 2>/dev/null

# restart server
fuser -k 3000/tcp >/dev/null 2>&1 || true
sleep 1
cd "$SA" || exit 1
PORT=3000 HOSTNAME=0.0.0.0 nohup setsid node server.js >/tmp/dash.log 2>&1 < /dev/null &
echo "dash restarted pid group $!"
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login 2>/dev/null)
  [ "$code" = "200" ] && { echo "DASH UP /login=200 (try $i)"; break; }
  sleep 1
done
tail -6 /tmp/dash.log
