#!/usr/bin/env bash
S() { echo "163244" | sudo -S "$@" 2>/dev/null; }
echo "=== containers still up? ==="
for p in 01 02 03; do
  echo "phone-$p: $(S docker inspect fleet-local-phone-$p --format 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}} ip={{.NetworkSettings.IPAddress}}')"
done

echo "=== published ports (docker port) ==="
for p in 02 03; do echo "phone-$p:"; S docker port fleet-local-phone-$p 2>&1; done

echo "=== are 5556/5557 actually listening on host? ==="
ss -ltn 2>/dev/null | grep -E ':(5556|5557)\b' || echo "  NOT listening on host (bridge publish not routing)"

echo "=== can we reach phone-02 by its CONTAINER IP directly? ==="
IP2=$(S docker inspect fleet-local-phone-02 --format '{{.NetworkSettings.IPAddress}}')
IP3=$(S docker inspect fleet-local-phone-03 --format '{{.NetworkSettings.IPAddress}}')
echo "phone-02 container IP: $IP2 ; phone-03 container IP: $IP3"
adb connect "$IP2:5555" 2>&1
adb connect "$IP3:5555" 2>&1
sleep 2
echo "=== boot_completed via container IP ==="
echo "phone-02: $(adb -s $IP2:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
echo "phone-03: $(adb -s $IP3:5555 shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
echo "=== docker bridge / iptables nat present? ==="
S iptables -t nat -L DOCKER -n 2>&1 | head -6 || echo "  no nat table (expected on this kernel)"
