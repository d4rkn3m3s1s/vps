#!/usr/bin/env bash
# Download official (Meta-signed) WhatsApp APK. User approved APKMirror as the
# source. APKMirror serves the real signed packages; we fetch via its download
# CDN. The ARM phone (phone-03) is the realistic target for passing WA integrity.
set -u
TMP=/tmp/wa; mkdir -p "$TMP"
APK="$TMP/whatsapp.apk"
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

echo "=== internet check ==="
curl -s -o /dev/null -w 'google=%{http_code}\n' https://www.google.com

# WhatsApp's OWN canonical APK distribution (whatsapp.com/android serves the
# official signed APK directly — this is the most trustworthy source).
echo "=== downloading from whatsapp.com (official) ==="
if timeout 180 curl -sL -A "$UA" -o "$APK" "https://www.whatsapp.com/android/current/WhatsApp.apk" 2>/dev/null; then
  sz=$(wc -c < "$APK" 2>/dev/null || echo 0)
  echo "  got $sz bytes"
  if [ "$sz" -gt 10000000 ] && head -c2 "$APK" | grep -q 'PK'; then
    echo "OK official apk: $sz bytes"
    file "$APK" 2>/dev/null || true
    exit 0
  fi
fi
echo "official endpoint failed; size=$(wc -c < "$APK" 2>/dev/null || echo 0)"
head -c 200 "$APK" 2>/dev/null; echo ""
exit 2
