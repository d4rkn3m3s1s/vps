#!/usr/bin/env bash
# VPS Fleet — LOCAL TEST network bring-up (Kali WSL2, custom kernel)
#
# The custom WSL2 kernel ships the bridge/netfilter features as LOADABLE modules
# but WSL doesn't auto-load them before dockerd starts, and the firewall tables
# (filter/nat/raw/mangle) don't exist until their module is inserted. Without them
# dockerd's bridge driver fails ("Table does not exist" / "addrtype ... missing
# kernel module"). This script loads every module dockerd needs, forces the
# legacy iptables backend (the modules are legacy ip_tables, not nft), opens the
# FORWARD policy so bridged containers can egress, then (re)starts docker.
#
# Run once per WSL session BEFORE using docker:  sudo bash deploy/local-test/net-up.sh
# Idempotent — safe to re-run.
set -u

echo "== 1) kernel modules (bridge + netfilter tables) =="
for m in \
  ip_tables iptable_filter iptable_nat iptable_raw iptable_mangle \
  bridge br_netfilter veth \
  xt_addrtype xt_conntrack xt_nat xt_mark xt_MASQUERADE xt_state xt_tcpudp \
  nf_nat nf_conntrack nf_conntrack_netlink nf_reject_ipv4 ; do
  modprobe "$m" 2>/dev/null && echo "  ok  $m" || echo "  --  $m (builtin or n/a)"
done

echo "== 2) legacy iptables backend (modules are legacy, not nft) =="
update-alternatives --set iptables  /usr/sbin/iptables-legacy  >/dev/null 2>&1 || true
update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy >/dev/null 2>&1 || true
iptables --version

echo "== 3) verify firewall tables exist =="
for t in filter nat raw mangle ; do
  iptables -t "$t" -L -n >/dev/null 2>&1 && echo "  ok  table $t" || echo "  !!  table $t MISSING"
done

echo "== 4) open FORWARD for bridged-container egress =="
iptables -P FORWARD ACCEPT

echo "== 5) (re)start docker =="
service docker restart
sleep 5
echo -n "  docker server: "; docker version --format '{{.Server.Version}}' 2>&1 || echo "NOT UP"

echo "== 6) sanity: container egress =="
docker run --rm alpine sh -c 'ping -c1 -W3 8.8.8.8 >/dev/null 2>&1 && echo "  ok  container internet" || echo "  !!  container NO internet"' 2>&1 | tail -1

echo "done."
