#!/usr/bin/env bash
# Poll sms-bus for the OTP WhatsApp texted to the rented number.
TOKEN=5c597c5f569144a88b42595c333f52b9
BASE=https://sms-bus.com/api/control
REQ="${1:-260624133433333624320}"
echo "polling request_id=$REQ for OTP..."
for i in $(seq 1 20); do
  resp=$(curl -s "$BASE/get/sms?token=$TOKEN&request_id=$REQ")
  echo "  [$i] $resp"
  # code arrives in data
  code=$(echo "$resp" | grep -oE '"data":"?[0-9]{4,8}"?' | grep -oE '[0-9]{4,8}' | head -1)
  if [ -n "$code" ]; then echo ">>> OTP = $code"; exit 0; fi
  sleep 6
done
echo "no OTP yet after polling"
