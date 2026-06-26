#!/usr/bin/env bash
code=000
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/health 2>/dev/null)
  if [ "$code" = "200" ]; then echo "API UP (poll $i)"; break; fi
  sleep 5
done
echo "final health=$code"
echo "=== api.log ($(wc -l </tmp/api.log) lines) ==="
tail -30 /tmp/api.log
