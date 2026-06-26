#!/usr/bin/env bash
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login 2>/dev/null)
  if [ "$code" = "200" ] || [ "$code" = "307" ] || [ "$code" = "302" ]; then echo "DASH UP ($code) after ~$((i*3))s"; exit 0; fi
  sleep 3
done
echo "dashboard not ready after 120s"
