#!/usr/bin/env bash
# Launch WhatsApp on a phone, walk the first-run far enough to see whether it
# reaches the EULA / phone-entry screen or hits an integrity/device wall.
# Arg: adb port (default 5557 = phone-03 ARM).
PORT="${1:-5557}"
S="127.0.0.1:$PORT"
adb connect "$S" >/dev/null 2>&1

echo "=== force-stop + clear is NOT done (keep state). launching WA on $S ==="
adb -s "$S" shell monkey -p com.whatsapp -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 9

dump() { adb -s "$S" exec-out uiautomator dump /dev/tty 2>/dev/null | tr '>' '>\n'; }
echo "=== visible texts on first screen ==="
adb -s "$S" exec-out uiautomator dump /sdcard/u.xml >/dev/null 2>&1
adb -s "$S" shell cat /sdcard/u.xml 2>/dev/null \
  | grep -oE 'text="[^"]+"' | sed 's/text="//;s/"$//' | grep -v '^$' | head -40
echo "=== ABI / arch WhatsApp is running as ==="
adb -s "$S" shell getprop ro.product.cpu.abilist 2>/dev/null | tr -d '\r'
echo "=== is WA process alive? ==="
adb -s "$S" shell pidof com.whatsapp 2>/dev/null | tr -d '\r' && echo " (running)" || echo "NOT RUNNING (may have crashed on ARM)"
