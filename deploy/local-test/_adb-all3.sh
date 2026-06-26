#!/usr/bin/env bash
# Connect adb to all three phones and wait for each to finish booting.
adb start-server >/dev/null 2>&1
for port in 5555 5556 5557; do
  adb connect 127.0.0.1:$port >/dev/null 2>&1
done

declare -A NAME=( [5555]=phone-01 [5556]=phone-02 [5557]=phone-03 )
for port in 5555 5556 5557; do
  echo -n "${NAME[$port]} (:$port) booting"
  ok=0
  for i in $(seq 1 60); do
    adb connect 127.0.0.1:$port >/dev/null 2>&1
    st=$(adb -s 127.0.0.1:$port shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
    if [ "$st" = "1" ]; then echo " -> BOOTED (try $i)"; ok=1; break; fi
    echo -n "."
    sleep 2
  done
  [ "$ok" = "0" ] && echo " -> TIMEOUT"
done

echo ""
echo "=== adb devices ==="
adb devices
echo ""
echo "=== per-phone identity (abi = ARM-capable?) ==="
for port in 5555 5556 5557; do
  abi=$(adb -s 127.0.0.1:$port shell getprop ro.product.cpu.abilist 2>/dev/null | tr -d '\r')
  ver=$(adb -s 127.0.0.1:$port shell getprop ro.build.version.release 2>/dev/null | tr -d '\r')
  echo "  ${NAME[$port]} :$port  android=$ver  abilist=$abi"
done
