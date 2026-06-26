#!/usr/bin/env bash
# Restore loopback routing broken by dockerd restart under mirrored WSL net.
set -u
P="$SUDO_PASS"
S() { echo "$P" | sudo -S "$@" 2>/dev/null; }

# Bring lo down/up to let the kernel re-add its automatic local routes.
S ip link set lo down
S ip link set lo up
# Ensure the loopback local route exists in the main table too.
S ip route add 127.0.0.0/8 dev lo scope host 2>/dev/null || true
S ip route add local 127.0.0.0/8 dev lo table local scope host 2>/dev/null || true

echo "=== route get 127.0.0.1 ==="
ip route get 127.0.0.1 2>&1 | head -1
echo "=== tcp test 5432 ==="
timeout 4 bash -c 'cat < /dev/null > /dev/tcp/127.0.0.1/5432' 2>&1 && echo "5432 OK" || echo "5432 still unreachable"
