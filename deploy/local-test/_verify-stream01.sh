#!/usr/bin/env bash
# After WSL restart: verify phone-01 has the stream-flag config (touch device),
# booted, and internet. uinput must be reloaded (cleared on restart) BUT the
# container already started — if event0 is missing, we note it.
SUDO_PASS=163244
S=127.0.0.1:5555
OUT="/mnt/c/Yeni klasör/vps/deploy/local-test/_vstream.out"
: > "$OUT"
SU(){ echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }

SU modprobe uinput 2>/dev/null; SU modprobe evdev 2>/dev/null
echo "config=$(SU docker inspect fleet-local-phone-01 --format '{{.Args}}' 2>/dev/null | tr ' ' '\n' | grep -iE 'stream' | tr '\n' ' ')" >> "$OUT"

adb connect "$S" >/dev/null 2>&1
for i in $(seq 1 35); do
  [ "$(adb -s "$S" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && { echo "booted ($i)" >> "$OUT"; break; }
  sleep 2
done
echo "input_devices=$(adb -s "$S" shell ls /dev/input/ 2>&1 | tr -d '\r')" >> "$OUT"
echo "net=$(adb -s "$S" shell dumpsys connectivity 2>/dev/null | grep -oE 'Validated|NO_INTERNET' | head -1 | tr -d '\r')" >> "$OUT"
echo "host_route=$(ip route show default | head -1)" >> "$OUT"
echo "=== RESULT ==="; cat "$OUT"
