#!/usr/bin/env bash
# Rent ONE WhatsApp number from sms-bus for the given country (default Indonesia=7).
# Prints request_id + number on success.
TOKEN=5c597c5f569144a88b42595c333f52b9
BASE=https://sms-bus.com/api/control
CID="${1:-7}"
resp=$(timeout 12 curl -s "${BASE}/get/number?token=${TOKEN}&country_id=${CID}&project_id=5")
echo "$resp"
num=$(echo "$resp" | grep -oE '"number":"[0-9]+"' | grep -oE '[0-9]+' | head -1)
req=$(echo "$resp" | grep -oE '"request_id":"[0-9]+"' | grep -oE '[0-9]+' | head -1)
echo "NUMBER=$num"
echo "REQUEST_ID=$req"
