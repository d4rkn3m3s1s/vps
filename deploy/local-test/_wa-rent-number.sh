#!/usr/bin/env bash
# Rent a WhatsApp (project_id=5) number from sms-bus. Try a few countries that
# usually have stock. Prints request_id + number for the registration step.
TOKEN=5c597c5f569144a88b42595c333f52b9
BASE=https://sms-bus.com/api/control

# country_id candidates (cheap/stocked for WA): Indonesia 7, Philippines 8,
# Vietnam 10, Russia 1, India 14, US 5, Turkey 195.
for cid in 7 8 10 1 14 195 5; do
  echo "=== try country_id=$cid for WhatsApp (project 5) ==="
  resp=$(curl -s "$BASE/get/number?token=$TOKEN&country_id=$cid&project_id=5")
  echo "  $resp"
  echo "$resp" | grep -q '"code":200' && {
    echo ">>> RENTED on country $cid"
    echo "$resp"
    exit 0
  }
done
echo "no stock in tried countries"
