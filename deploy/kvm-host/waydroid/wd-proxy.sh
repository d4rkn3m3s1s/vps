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
RS_PORT=12345

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
# redsocks on RS_PORT is shared per country; (re)start only if not already up
# with THIS country's config. If a redsocks is already running with EXACTLY this
# config, reuse it (no-op). Otherwise free the port and start fresh.
if pgrep -f "redsocks -c $CONF" >/dev/null 2>&1; then
  log "redsocks already up for $CC (reusing)"
else
  # Something else may own RS_PORT — a redsocks for a DIFFERENT country, OR a stale
  # redsocks from an older run started with a different config path (e.g. the
  # legacy /etc/redsocks.conf). The old `pkill -f "redsocks -c /etc/redsocks-"`
  # only matched OUR per-country configs, so a legacy redsocks kept the port and
  # `redsocks -c $CONF` died with "Address already in use" (VERIFIED live on mi7).
  # Kill EVERY redsocks (any config path) + whatever holds RS_PORT, then wait for
  # the port to actually free before starting.
  pkill -x redsocks 2>/dev/null || true
  pkill -f "redsocks -c" 2>/dev/null || true
  # Kill any lingering listener on RS_PORT (belt-and-suspenders; fuser handles the
  # case where the process name isn't literally "redsocks").
  fuser -k "$RS_PORT/tcp" 2>/dev/null || true
  # Wait up to ~5s for the port to be released (TIME_WAIT / slow teardown).
  for _i in 1 2 3 4 5 6 7 8 9 10; do
    ss -tlnp 2>/dev/null | grep -q ":$RS_PORT " || break
    sleep 0.5
  done
  if ss -tlnp 2>/dev/null | grep -q ":$RS_PORT "; then
    log "redsocks port $RS_PORT still busy after kill — cannot start"; exit 1
  fi
  redsocks -c "$CONF" && log "redsocks started ($CC)" || { log "redsocks FAILED (start)"; exit 1; }
  # Give the daemon a moment to bind before we assert it's listening.
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
