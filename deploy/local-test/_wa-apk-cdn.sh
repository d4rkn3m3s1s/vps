#!/usr/bin/env bash
# Download the official Meta-signed WhatsApp APK from its own CDN (resolved from
# whatsapp.com/android). This is the canonical signed package.
set -u
TMP=/tmp/wa; mkdir -p "$TMP"
APK="$TMP/whatsapp.apk"
UA='Mozilla/5.0 (Linux; Android 13; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36'
URL='https://scontent.whatsapp.net/v/t61.25591-34/10000000_2430247564156629_2881077823961533628_n.apk/WhatsApp.apk?ccb=1-7&_nc_sid=c49adc&_nc_ohc=RBkmLRx2nZQQ7kNvwHWbtEx&_nc_oc=AdpzauAWMNJdd49gCbutFD27zYVHZ7c8_lIXzfbxICA_193vyS89xJHg5jgW9aC70EY&_nc_zt=3&_nc_ht=scontent.whatsapp.net&_nc_gid=2ug-U6_TVAk1qXJNhz8cMw&_nc_ss=7b20f&oh=01_Q5Aa4wF9C8vWpQ_EEntm15DA1BB5psQ-rIvl6qwpwy-q-XWKjw&oe=6A62D083'

echo "=== downloading official WhatsApp apk from scontent.whatsapp.net ==="
timeout 240 curl -sL -A "$UA" -o "$APK" "$URL" 2>/dev/null
sz=$(wc -c < "$APK" 2>/dev/null || echo 0)
echo "size: $sz bytes"
if [ "$sz" -gt 10000000 ] && head -c2 "$APK" | grep -q 'PK'; then
  echo "OK signed apk ready"
  file "$APK" 2>/dev/null || true
else
  echo "FAILED — first bytes:"; head -c 200 "$APK"; echo ""
  exit 2
fi
