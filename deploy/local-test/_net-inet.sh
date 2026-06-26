#!/usr/bin/env bash
# Restore outbound internet route wiped by dockerd under mirrored WSL net.
set -u
P="$SUDO_PASS"
S() { echo "$P" | sudo -S "$@" 2>/dev/null; }

echo "--- eth0 state before ---"; ip -br addr show eth0 2>&1
# Bring eth0 up; mirrored mode assigns it the host-mirrored IP via DHCP-like.
S ip link set eth0 up
sleep 2
echo "--- eth0 after up ---"; ip -br addr show eth0 2>&1

# If eth0 has no IPv4, the WSL mirror daemon needs a kick — try the known WSL
# default gateway range. Find any eth with an inet addr.
GW=$(ip route show table all 2>/dev/null | grep -oE 'via [0-9.]+' | head -1 | awk '{print $2}')
echo "discovered gw candidate: ${GW:-none}"
[ -n "${GW:-}" ] && S ip route add default via "$GW" 2>/dev/null || true

echo "--- route get 1.1.1.1 ---"; ip route get 1.1.1.1 2>&1 | head -1
echo "--- ping test ---"; timeout 5 ping -c1 -W2 1.1.1.1 2>&1 | grep -E "bytes from|unreachable|loss" | head -2
