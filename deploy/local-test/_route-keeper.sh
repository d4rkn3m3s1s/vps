#!/usr/bin/env bash
# ROUTE KEEPER — permanent fix for "dockerd wipes the WSL default route".
#
# On this custom-kernel WSL2 + native dockerd setup, (re)starting dockerd
# periodically deletes the default route (and sometimes the 127/8 loopback
# policy rule), which kills outbound internet for the host AND every
# host-net redroid phone — that is the real cause of WhatsApp "Couldn't
# connect". This daemon watches the route table and instantly restores both
# whenever they vanish. Run it detached once per WSL session.
#
# Usage: SUDO_PASS=xxx bash _route-keeper.sh        (foreground, logs to stdout)
#        SUDO_PASS=xxx nohup setsid bash _route-keeper.sh >/tmp/route-keeper.log 2>&1 &
SUDO_PASS="${SUDO_PASS:-163244}"
GW="${GW:-172.28.0.1}"
IFACE="${IFACE:-eth0}"
S(){ echo "$SUDO_PASS" | sudo -S "$@" 2>/dev/null; }

# Derive the real gateway/iface from the current eth0 subnet, so a changed NAT
# subnet (after wsl --shutdown) is handled automatically. Prefer the gateway the
# kernel ALREADY knows (most reliable); otherwise compute the network base from
# the CIDR prefix (WSL uses /20, so gw = network-address + 1, e.g. 172.28.0.1).
detect(){
  local existing cidr ip pfx o1 o2 o3 o4 mask netthird
  # 1. if a default route exists right now, trust its gateway
  existing=$(ip -4 route show default 2>/dev/null | grep -oE 'via [0-9.]+' | awk '{print $2}' | head -1)
  if [ -n "$existing" ]; then GW="$existing"; return; fi
  # 2. else compute from the eth0 CIDR honoring the prefix length
  cidr=$(ip -4 -o addr show "$IFACE" 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+' | head -1)
  [ -z "$cidr" ] && return
  ip=${cidr%/*}; pfx=${cidr#*/}
  IFS=. read -r o1 o2 o3 o4 <<<"$ip"
  if [ "$pfx" -ge 24 ]; then
    GW="${o1}.${o2}.${o3}.1"
  elif [ "$pfx" -ge 16 ]; then
    # mask the third octet to the prefix (e.g. /20 -> & 0xF0)
    mask=$(( 0xFF << (24 - pfx) & 0xFF ))
    netthird=$(( o3 & mask ))
    GW="${o1}.${o2}.${netthird}.1"
  else
    GW="${o1}.${o2}.0.1"
  fi
}

ensure(){
  # default route
  if ! ip route 2>/dev/null | grep -q '^default'; then
    S ip route replace default via "$GW" dev "$IFACE" 2>/dev/null
    echo "$(date '+%H:%M:%S') restored default via $GW dev $IFACE"
  fi
  # 127/8 loopback policy rule (dockerd wipes this too on this kernel)
  if ! ip route get 127.0.0.1 >/dev/null 2>&1; then
    S ip rule add to 127.0.0.0/8 lookup 127 2>/dev/null || true
    S ip rule add from 127.0.0.0/8 lookup 127 2>/dev/null || true
    echo "$(date '+%H:%M:%S') restored 127/8 loopback policy rules"
  fi
}

detect
echo "route-keeper: watching default route + loopback (gw=$GW iface=$IFACE), every 2s"
ensure
while true; do
  ensure
  sleep 2
done
