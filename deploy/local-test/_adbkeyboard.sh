#!/usr/bin/env bash
# Install ADBKeyBoard (open-source IME for headless/custom Android) and make it
# the default keyboard. It injects text via `am broadcast ADB_INPUT_TEXT` which
# works even where tap-focus + `input text` fail on redroid. Then verify it types
# into WhatsApp's registration_phone.
#
# Source: senzhk/ADBKeyBoard (GitHub release asset ADBKeyboard.apk).
set -u
APK=/tmp/ADBKeyboard.apk
# Real GitHub release asset (the raw/master one is an LFS pointer ~17KB).
URLS=(
  "https://github.com/senzhk/ADBKeyBoard/releases/download/v2.4-dev/keyboardservice-debug.apk"
  "https://github.com/senzhk/ADBKeyBoard/releases/download/v2.5-dev/keyboardservice-debug.apk"
)
echo "=== download ADBKeyboard.apk (release asset) ==="
ok=0
for u in "${URLS[@]}"; do
  echo "  try: $u"
  timeout 90 curl -sL -o "$APK" "$u" 2>/dev/null
  sz=$(wc -c < "$APK" 2>/dev/null || echo 0)
  echo "    size: $sz bytes"
  # ADBKeyboard is a tiny IME (~18KB). Just require a valid zip/APK header.
  if [ "$sz" -gt 10000 ] && head -c2 "$APK" | grep -q 'PK'; then ok=1; break; fi
done
if [ "$ok" != "1" ]; then echo "download failed"; head -c 120 "$APK"; echo ""; exit 2; fi
# sanity: verify it's a real APK (has AndroidManifest)
if ! unzip -l "$APK" 2>/dev/null | grep -q AndroidManifest.xml; then
  echo "not a valid APK (no AndroidManifest)"; exit 2
fi
echo "valid APK: $(unzip -l "$APK" 2>/dev/null | grep -c '\.')"

for S in 127.0.0.1:5555 127.0.0.1:5556 127.0.0.1:5557; do
  adb connect "$S" >/dev/null 2>&1
  echo "=== $S install + enable ADBKeyboard ==="
  adb -s "$S" install -r "$APK" 2>&1 | tail -1
  adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME 2>&1 | tr -d '\r'
  adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME 2>&1 | tr -d '\r'
  echo "  default IME now: $(adb -s "$S" shell settings get secure default_input_method 2>/dev/null | tr -d '\r')"
done
