#!/usr/bin/env bash
API=http://localhost:4000; KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
JOB="${1:?job id required}"
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' -H "x-api-key: $KEY" \
  -d '{"email":"admin@local.dev","password":"Admin2026!"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
echo "=== job $JOB ==="
curl -s -H "x-api-key: $KEY" -H "Authorization: Bearer $TOKEN" "$API/jobs/$JOB"
echo ""
