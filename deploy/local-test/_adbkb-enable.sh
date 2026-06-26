#!/usr/bin/env bash
# Retry enabling ADBKeyboard IME (it can take a moment after install for the
# system to register the IME service). Then verify it injects text into
# WhatsApp's registration_phone via ADB_INPUT_TEXT broadcast.
S="${1:-127.0.0.1:5555}"
adb connect "$S" >/dev/null 2>&1

echo "=== wait for IME service to register ==="
for i in $(seq 1 10); do
  list=$(adb -s "$S" shell ime list -a -s 2>/dev/null | tr -d '\r')
  if echo "$list" | grep -q adbkeyboard; then echo "  IME found (try $i)"; break; fi
  sleep 2
done
echo "available IMEs:"; adb -s "$S" shell ime list -a -s 2>/dev/null | tr -d '\r'

echo "=== enable + set ==="
adb -s "$S" shell ime enable com.android.adbkeyboard/.AdbIME 2>&1 | tr -d '\r'
adb -s "$S" shell ime set com.android.adbkeyboard/.AdbIME 2>&1 | tr -d '\r'
echo "default IME: $(adb -s "$S" shell settings get secure default_input_method 2>/dev/null | tr -d '\r')"
