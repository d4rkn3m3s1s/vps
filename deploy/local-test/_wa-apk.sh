#!/usr/bin/env bash
# Fetch WhatsApp APK and install on all 3 phones. Tries a few mirrors; the ARM
# phone (phone-03, :5557) is the one with a real shot at passing WA integrity.
set -u
TMP=/tmp/wa
mkdir -p "$TMP"
APK="$TMP/whatsapp.apk"

echo "=== DNS / internet ==="
timeout 8 curl -sI https://www.google.com 2>&1 | head -1 || echo "no internet"

echo "=== resolve mirrors ==="
for h in d.apkpure.com apkpure.net www.apkmirror.com download.cnet.com; do
  getent hosts "$h" >/dev/null 2>&1 && echo "  $h OK" || echo "  $h UNRESOLVED"
done

# APKPure direct download endpoint for WhatsApp Messenger.
echo "=== downloading WhatsApp apk (apkpure) ==="
URLS=(
  "https://d.apkpure.com/b/APK/com.whatsapp?version=latest"
  "https://d.apkpure.net/b/APK/com.whatsapp?version=latest"
)
ok=0
for u in "${URLS[@]}"; do
  echo "  try: $u"
  if timeout 120 curl -sL -A 'Mozilla/5.0 (Linux; Android 13)' -o "$APK" "$u" 2>/dev/null; then
    sz=$(wc -c < "$APK" 2>/dev/null || echo 0)
    echo "  got $sz bytes"
    # a real apk is a zip starting with PK and > 10MB
    if [ "$sz" -gt 10000000 ] && head -c2 "$APK" | grep -q 'PK'; then ok=1; break; fi
  fi
done
[ "$ok" != "1" ] && { echo "DOWNLOAD FAILED — need manual apk"; exit 2; }
echo "apk ready: $(wc -c < "$APK") bytes"
file "$APK" 2>/dev/null || true
