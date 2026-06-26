#!/usr/bin/env bash
# Wider WhatsApp number rent: try many countries by id until one has stock.
TOKEN=5c597c5f569144a88b42595c333f52b9
BASE=https://sms-bus.com/api/control
# Broad set of country_ids from the catalog (cheap/common WA stock countries).
CIDS="7 8 10 1 14 195 5 6 4 11 88 80 48 25 158 191 232 184 224 212 213 226 231 234 254 220 222 185 186 187 193 196 197 198 199 200 201 202 203 204 205 206 207 208 209 210 211 214 215 216 217 218 219 221 223 225 227 228 229 230 233 235 236"
for cid in $CIDS; do
  resp=$(curl -s "$BASE/get/number?token=$TOKEN&country_id=$cid&project_id=5")
  if echo "$resp" | grep -q '"code":200'; then
    echo ">>> RENTED country_id=$cid"
    echo "$resp"
    exit 0
  fi
done
echo "no stock across all tried countries"
echo "last response: $resp"
