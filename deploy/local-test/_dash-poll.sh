#!/usr/bin/env bash
code=000
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login 2>/dev/null)
  if [ "$code" = "200" ] || [ "$code" = "307" ] || [ "$code" = "302" ]; then echo "DASH UP ($code) poll $i"; break; fi
  sleep 5
done
echo "final=$code"
