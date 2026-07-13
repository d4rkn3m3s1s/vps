#!/usr/bin/env bash
API=http://localhost:4000
KEY="${FLEET_API_KEY:?set FLEET_API_KEY}"
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -H "x-api-key: $KEY" \
  -d '{"email":"admin@local.dev","password":"Admin2026!"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
echo "token: ${TOKEN:0:16}..."
AUTH=(-H "x-api-key: $KEY" -H "Authorization: Bearer $TOKEN")

echo "=== /accounts/sms/countries ==="
curl -s -w '\nHTTP %{http_code}\n' "${AUTH[@]}" "$API/accounts/sms/countries" | head -20
echo "=== /accounts/sms/projects ==="
curl -s -w '\nHTTP %{http_code}\n' "${AUTH[@]}" "$API/accounts/sms/projects" | head -20

echo "=== recent API error log ==="
tail -25 "/mnt/c/Yeni klasör/vps/apps/api/storage/logs/error.log" 2>/dev/null
