#!/bin/bash
# wd-proxy.sh <instance> <cc> <user> <pass> <host> <port> — route an instance's
# traffic through a country-matched residential proxy (thordata) via redsocks +
# transparent iptables REDIRECT. WhatsApp shows "Login not available" when the
# number's country != the exit-IP country, so the exit IP must match the number.
#
# Waydroid has no WiFi UI (ethernet only), so we can't set an in-Android proxy;
# instead we transparently REDIRECT the instance's subnet TCP to a local redsocks
# that speaks http-connect to the upstream proxy. One redsocks per country is
# enough — instances sharing a country share the redsocks on port 12345.
#
# thordata username format: <user>-cc-<CC>  (CC = ISO country, e.g. AL/US/BG).
set -u
INSTANCE="${1:?instance}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUBNET_ID="$(sh "$HERE/net-head.sh" "$INSTANCE")"
SUBNET="192.168.$SUBNET_ID.0/24"

# ★PER-COUNTRY PORT (was a single shared 12345 → only ONE country could run at a
# time; a TR device's proxy killed every AL/BG redsocks). Each country now gets its
# OWN redsocks port so AL+BG+TR run concurrently. Ports are deterministic per CC so
# reboots/re-applies land on the same one. clear-mode computes it from the CC arg too.
rs_port_for() {
  case "$(echo "$1" | tr '[:lower:]' '[:upper:]')" in
    AL) echo 12345 ;;
    BG) echo 12346 ;;
    TR) echo 12347 ;;
    US) echo 12348 ;;
    *)  echo 12349 ;; # any other country shares one fallback port
  esac
}

log(){ echo "[wd-proxy:$INSTANCE] $*"; }

# `wd-proxy.sh <instance> clear` removes this instance's REDIRECT rules so its
# traffic exits directly again (used when a device's proxy is unassigned).
if [ "${2:-}" = "clear" ]; then
  modprobe xt_REDIRECT 2>/dev/null || true
  while iptables -t nat -L PREROUTING -n --line-numbers 2>/dev/null | grep -q "$SUBNET"; do
    N=$(iptables -t nat -L PREROUTING -n --line-numbers | grep "$SUBNET" | awk '{print $1}' | sort -rn | head -1)
    [ -n "$N" ] && iptables -t nat -D PREROUTING "$N" 2>/dev/null || break
  done
  log "iptables REDIRECT rules cleared for $SUBNET"
  echo "PROXY_RESULT instance=$INSTANCE cc=- subnet=$SUBNET_ID redsocks=cleared"
  exit 0
fi

CC="${2:?country code}"
PUSER="${3:?proxy user}"
PPASS="${4:?proxy pass}"
PHOST="${5:?proxy host}"
PPORT="${6:?proxy port}"
CONF="/etc/redsocks-$CC.conf"
RS_PORT="$(rs_port_for "$CC")"  # per-country local port (concurrent countries)

# resolve upstream host to an IP (redsocks wants an IP, and we must RETURN it)
PIP="$(getent hosts "$PHOST" | awk '{print $1; exit}')"
[ -z "$PIP" ] && PIP="$PHOST"
log "cc=$CC upstream=$PHOST($PIP):$PPORT subnet=$SUBNET"

# The thordata sticky-country username is "<user>-cc-<CC>". Some proxy providers
# (and some of our stored usernames) ALREADY embed the country as "-cc-XX" or
# "-country-xx" — in that case we must NOT append another "-cc-XX" (it produces an
# invalid login and auth fails). Only append the country tag when it's absent.
case "$PUSER" in
  *-cc-*|*-country-*) LOGIN="$PUSER" ;;
  *)                  LOGIN="$PUSER-cc-$CC" ;;
esac

# ── 1) redsocks config (one per country) + (re)start ─────────────────────────
cat > "$CONF" <<EOF
base {
    log_debug = off;
    log_info = on;
    log = "file:/var/log/redsocks-$CC.log";
    daemon = on;
    redirector = iptables;
}
redsocks {
    local_ip = 0.0.0.0;
    local_port = $RS_PORT;
    ip = $PIP;
    port = $PPORT;
    type = http-connect;
    login = "$LOGIN";
    password = "$PPASS";
}
EOF
# Each country has its OWN port + config, so we ONLY manage THIS country's redsocks —
# we must NOT kill other countries' daemons (that was the tek-port bug: applying TR
# killed AL/BG). If a redsocks is already up for THIS config, reuse it. Otherwise
# start ours on RS_PORT. Only free RS_PORT if a STALE process (not our current config)
# holds it — never touch other ports.
if pgrep -f "redsocks -c $CONF" >/dev/null 2>&1; then
  log "redsocks already up for $CC on $RS_PORT (reusing)"
else
  # If something ELSE holds THIS country's port (a stale redsocks with an old config),
  # free just that port. Other countries' ports are untouched.
  if ss -tlnp 2>/dev/null | grep -q ":$RS_PORT "; then
    fuser -k "$RS_PORT/tcp" 2>/dev/null || true
    for _i in 1 2 3 4 5 6 7 8 9 10; do
      ss -tlnp 2>/dev/null | grep -q ":$RS_PORT " || break
      sleep 0.5
    done
  fi
  if ss -tlnp 2>/dev/null | grep -q ":$RS_PORT "; then
    log "redsocks port $RS_PORT still busy after kill — cannot start"; exit 1
  fi
  redsocks -c "$CONF" && log "redsocks started ($CC on $RS_PORT)" || { log "redsocks FAILED (start)"; exit 1; }
  for _i in 1 2 3 4 5 6; do
    ss -tlnp 2>/dev/null | grep -q ":$RS_PORT " && break
    sleep 0.5
  done
fi
ss -tlnp 2>/dev/null | grep -q ":$RS_PORT " || { log "redsocks not listening on $RS_PORT"; exit 1; }

# ── 2) iptables: transparent REDIRECT for THIS instance's subnet ─────────────
# iptables writes need root. If we're not root the REDIRECT inserts below fail
# silently (no `set -e`) and the script would still print PROXY_RESULT — a false
# "APPLIED" that leaves the device on the host's datacenter IP (the exact bug that
# let a TR number register on a US exit and hit "Login not available"). Fail loud.
if [ "$(id -u)" != "0" ]; then
  log "ERROR: not root — cannot install iptables REDIRECT for $SUBNET"
  echo "PROXY_FAIL instance=$INSTANCE reason=need-root"
  exit 1
fi
modprobe xt_REDIRECT 2>/dev/null || true
# clean prior rules for this subnet (idempotent)
while iptables -t nat -L PREROUTING -n --line-numbers 2>/dev/null | grep -q "$SUBNET"; do
  N=$(iptables -t nat -L PREROUTING -n --line-numbers | grep "$SUBNET" | awk '{print $1}' | sort -rn | head -1)
  [ -n "$N" ] && iptables -t nat -D PREROUTING "$N" 2>/dev/null || break
done
# do not proxy local/reserved nets or the upstream proxy itself (avoid loop)
for NET in 0.0.0.0/8 10.0.0.0/8 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4 "$PIP/32"; do
  iptables -t nat -A PREROUTING -s "$SUBNET" -p tcp -d "$NET" -j RETURN
done
iptables -t nat -A PREROUTING -s "$SUBNET" -p tcp -j REDIRECT --to-ports "$RS_PORT"
# VERIFY the REDIRECT rule actually landed before declaring success — a failed insert
# (missing xt_REDIRECT module, table full, etc.) must NOT report APPLIED. Only print
# the PROXY_RESULT marker the agent keys on when the rule is really present.
if ! iptables -t nat -S PREROUTING 2>/dev/null | grep -F -- "-s ${SUBNET}" | grep -F -- "REDIRECT --to-ports ${RS_PORT}" >/dev/null 2>&1; then
  log "ERROR: REDIRECT rule for $SUBNET NOT present after insert"
  echo "PROXY_FAIL instance=$INSTANCE reason=redirect-not-installed"
  exit 1
fi
log "iptables REDIRECT active for $SUBNET -> redsocks:$RS_PORT"
echo "PROXY_RESULT instance=$INSTANCE cc=$CC subnet=$SUBNET_ID redsocks=$RS_PORT"
