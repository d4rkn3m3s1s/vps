#!/usr/bin/env bash
set -u
P="$SUDO_PASS"
S() { echo "$P" | sudo -S "$@" 2>/dev/null; }

echo "--- before ---"; ip route show table 127 2>&1 | head -3

# Mirrored mode keeps loopback routes in table 127 reached via loopback0.
# dockerd wiped the rule that sends loopback-destined traffic to table 127.
# Re-add the policy rule + ensure table 127 has the local route.
S ip rule add to 127.0.0.0/8 lookup 127 2>/dev/null || true
S ip rule add from 127.0.0.0/8 lookup 127 2>/dev/null || true
# Also add a plain local loopback route in main as a fallback.
S ip route add 127.0.0.0/8 dev lo 2>/dev/null || true

echo "--- after rule add ---"
ip route get 127.0.0.1 2>&1 | head -1
timeout 4 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/5432' 2>&1 && echo "5432 OK" || echo "5432 FAIL"
