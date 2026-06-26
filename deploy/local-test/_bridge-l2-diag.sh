#!/usr/bin/env bash
# Deep-diagnose WHY docker0 bridge L2 forwarding fails on this kernel, BEFORE
# considering a kernel rebuild. Tests a minimal manual bridge with two veths to
# isolate whether the problem is docker, iptables, br_netfilter, or core bridge.
echo "163244" | sudo -S true 2>/dev/null

echo "=== 1. kernel bridge config (if readable) ==="
zcat /proc/config.gz 2>/dev/null | grep -iE 'CONFIG_BRIDGE|CONFIG_VETH|CONFIG_BRIDGE_NETFILTER|CONFIG_NF_CONNTRACK' | head || echo "(no /proc/config.gz)"

echo "=== 2. start dockerd (bridge-none restored) so we have a clean host ==="
sudo docker info >/dev/null 2>&1 || { sudo nohup setsid dockerd >/tmp/dockerd.log 2>&1 </dev/null & sleep 6; }

echo "=== 3. MINIMAL manual bridge test (no docker, no iptables) ==="
# Two netns connected to one bridge; can they ping each other? This isolates
# CORE bridge L2 forwarding from all docker/iptables complexity.
sudo ip netns add nsA 2>/dev/null
sudo ip netns add nsB 2>/dev/null
sudo ip link add brtest type bridge 2>/dev/null
sudo ip link set brtest up
# disable iptables on bridge for a pure L2 test
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0 >/dev/null 2>&1

sudo ip link add vA type veth peer name vAbr 2>/dev/null
sudo ip link add vB type veth peer name vBbr 2>/dev/null
sudo ip link set vAbr master brtest; sudo ip link set vAbr up
sudo ip link set vBbr master brtest; sudo ip link set vBbr up
sudo ip link set vA netns nsA; sudo ip link set vB netns nsB
sudo ip netns exec nsA ip addr add 10.99.0.1/24 dev vA
sudo ip netns exec nsA ip link set vA up
sudo ip netns exec nsB ip addr add 10.99.0.2/24 dev vB
sudo ip netns exec nsB ip link set vB up

echo "--- nsA ping nsB over brtest (pure L2) ---"
sudo ip netns exec nsA ping -c 2 -W 2 10.99.0.2 2>&1 | tail -2

echo "=== 4. bridge fdb / forwarding state ==="
sudo bridge fdb show br brtest 2>&1 | head -5
echo "stp/forward_delay:"; cat /sys/class/net/brtest/bridge/stp_state /sys/class/net/brtest/bridge/forward_delay 2>/dev/null

echo "=== cleanup ==="
sudo ip netns del nsA 2>/dev/null; sudo ip netns del nsB 2>/dev/null
sudo ip link del brtest 2>/dev/null
echo "done"
