#!/usr/bin/env bash
# Start the dashboard in DEV mode (next dev) on :3000 — hot-reload for design work.
D='/mnt/c/Yeni klasör/vps/apps/dashboard'
cd "$D" || exit 1
fuser -k 3000/tcp >/dev/null 2>&1 || true
sleep 1
PORT=3000 HOSTNAME=0.0.0.0 nohup setsid npm run dev >/tmp/dash.log 2>&1 < /dev/null &
echo "dashboard dev launched, pid group $!"
