#!/usr/bin/env bash
for i in $(seq 1 25); do
  body=$(curl -s http://localhost:4000/health 2>/dev/null)
  if [ -n "$body" ]; then echo "API UP: $body"; exit 0; fi
  sleep 2
done
echo "API not responding after 50s"
