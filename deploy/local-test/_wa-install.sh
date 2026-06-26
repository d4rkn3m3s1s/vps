#!/usr/bin/env bash
# Install the downloaded official WhatsApp APK on all 3 phones.
# -r reinstall, -g grant all runtime perms, -d allow downgrade.
APK=/tmp/wa/whatsapp.apk
[ -f "$APK" ] || { echo "apk missing"; exit 1; }
echo "apk: $(wc -c < "$APK") bytes"

declare -A NAME=( [5555]=phone-01 [5556]=phone-02 [5557]=phone-03 )
for port in 5555 5556 5557; do
  adb connect 127.0.0.1:$port >/dev/null 2>&1
  echo "=== ${NAME[$port]} (:$port) installing WhatsApp ==="
  out=$(adb -s 127.0.0.1:$port install -r -g -d "$APK" 2>&1 | tail -3)
  echo "  $out"
  has=$(adb -s 127.0.0.1:$port shell pm list packages com.whatsapp 2>/dev/null | tr -d '\r')
  echo "  -> ${has:-NOT INSTALLED}"
done
