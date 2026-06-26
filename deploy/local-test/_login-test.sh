#!/usr/bin/env bash
# Verify the full auth chain: dashboard login route -> apiClient -> API -> DB,
# then fetch a protected page WITH the session cookie and confirm it renders 200.
JAR=/tmp/fleet-cookies.txt
rm -f "$JAR"

echo "--- POST /api/auth/login (dashboard route) ---"
LOGIN=$(curl -s -c "$JAR" -w '\nHTTP %{http_code}' \
  -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.dev","password":"Admin2026!"}')
echo "$LOGIN" | tail -3

echo "--- cookies set ---"
grep -E 'fleet_' "$JAR" | awk '{print "  "$6}' || echo "  (none)"

echo "--- GET / (overview) WITH session cookie ---"
curl -s -b "$JAR" -o /tmp/home.html -w 'HTTP %{http_code}  bytes=%{size_download}\n' http://localhost:3000/

echo "--- does home render HUD/CommandDeck markup? ---"
grep -oE 'holo-|command-deck|CommandDeck|Genel Bakış|telemetry' /tmp/home.html 2>/dev/null | sort | uniq -c | head

echo "--- GET /profiles WITH session ---"
curl -s -b "$JAR" -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:3000/profiles
