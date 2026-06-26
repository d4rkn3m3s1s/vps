#!/usr/bin/env bash
# Check sms-bus balance + whether WhatsApp (project 5) numbers are available.
TOKEN=5c597c5f569144a88b42595c333f52b9
BASE=https://sms-bus.com/api/control
echo "=== balance ==="
curl -s "$BASE/get/balance?token=$TOKEN"; echo ""
echo "=== price/stock for WhatsApp (project_id=5) in Turkey (country_id=195) ==="
curl -s "$BASE/get/prices?token=$TOKEN&country_id=195&project_id=5" 2>&1 | head -c 600; echo ""
echo "=== price for US (country_id=5) ==="
curl -s "$BASE/get/prices?token=$TOKEN&country_id=5&project_id=5" 2>&1 | head -c 600; echo ""
