#!/usr/bin/env bash
# Check each phone's outbound internet + DNS (WhatsApp needs both).
declare -A NAME=( [5555]=phone-01-hostnet [5556]=phone-02-netnsnone [5557]=phone-03-netnsnone )
for port in 5555 5556 5557; do
  S="127.0.0.1:$port"
  adb connect "$S" >/dev/null 2>&1
  echo "=== ${NAME[$port]} ($S) ==="
  echo -n "  ping 1.1.1.1: "
  adb -s "$S" shell ping -c 1 -W 2 1.1.1.1 2>/dev/null | grep -oE '[0-9]+ received' | head -1 || echo "FAIL"
  echo -n "  dns (v.whatsapp.net): "
  adb -s "$S" shell ping -c 1 -W 2 v.whatsapp.net 2>/dev/null | grep -qE '1 received|bytes from' && echo "RESOLVES+REACH" || echo "FAIL"
  echo -n "  default route in phone: "
  adb -s "$S" shell ip route 2>/dev/null | grep -oE 'default[^\n]*' | head -1 | tr -d '\r' || echo "none"
  echo -n "  dns prop: "
  adb -s "$S" shell getprop net.dns1 2>/dev/null | tr -d '\r'; echo ""
done
