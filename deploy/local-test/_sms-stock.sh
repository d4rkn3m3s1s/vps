#!/usr/bin/env bash
# Check sms-bus balance + WhatsApp (project_id=5) number availability per country.
TOKEN=5c597c5f569144a88b42595c333f52b9
BASE=https://sms-bus.com/api/control

echo "=== balance ==="
timeout 12 curl -s "${BASE}/get/balance?token=${TOKEN}"
echo ""
echo "=== WA number stock by country (project_id=5) ==="
# 7=Indonesia 195=Turkey 5=US 16=UK 4=Philippines 22=India 2=Kazakhstan
for c in 7 195 5 16 4 22 2; do
  resp=$(timeout 12 curl -s "${BASE}/get/number?token=${TOKEN}&country_id=${c}&project_id=5")
  echo "country_id=${c}: ${resp:0:170}"
done
