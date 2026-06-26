#!/usr/bin/env bash
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/health 2>/dev/null)
  if [ "$code" = "200" ]; then echo "API UP (try $i)"; break; fi
  sleep 2
done
echo "=== /health ==="
curl -s http://localhost:4000/health
echo ""
echo "=== api.log tail 30 ==="
tail -30 /tmp/api.log
