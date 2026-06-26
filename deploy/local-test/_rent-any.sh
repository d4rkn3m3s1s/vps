#!/usr/bin/env bash
# Try renting a WhatsApp number across several countries until one succeeds.
# Prints the winning NUMBER + REQUEST_ID + COUNTRY.
TOKEN=5c597c5f569144a88b42595c333f52b9
BASE=https://sms-bus.com/api/control
# Indonesia, Turkey, US, Philippines, Vietnam, Russia, India, Malaysia, Kenya
for CID in 7 195 5 4 10 1 14 6 86; do
  resp=$(timeout 12 curl -s "${BASE}/get/number?token=${TOKEN}&country_id=${CID}&project_id=5")
  num=$(echo "$resp" | grep -oE '"number":"[0-9]+"' | grep -oE '[0-9]+' | head -1)
  req=$(echo "$resp" | grep -oE '"request_id":"[0-9]+"' | grep -oE '[0-9]+' | head -1)
  area=$(echo "$resp" | grep -oE '"area_code":"[0-9]+"' | grep -oE '[0-9]+' | head -1)
  if [ -n "$num" ] && [ -n "$req" ]; then
    echo "COUNTRY=$CID"
    echo "AREA_CODE=$area"
    echo "NUMBER=$num"
    echo "REQUEST_ID=$req"
    exit 0
  fi
  echo "  country $CID: no stock"
done
echo "NO STOCK in any country"
exit 1
