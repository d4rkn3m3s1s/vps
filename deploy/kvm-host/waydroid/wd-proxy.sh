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
CC="${2:?country code}"
PUSER="${3:?proxy user}"
PPASS="${4:?proxy pass}"
PHOST="${5:?proxy host}"
PPORT="${6:?proxy port}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUBNET_ID="$(sh "$HERE/net-head.sh" "$INSTANCE")"
SUBNET="192.168.$SUBNET_ID.0/24"
RS_PORT=12345
CONF="/etc/redsocks-$CC.conf"

log(){ echo "[wd-proxy:$INSTANCE] $*"; }

# resolve upstream host to an IP (redsocks wants an IP, and we must RETURN it)
PIP="$(getent hosts "$PHOST" | awk '{print $1; exit}')"
[ -z "$PIP" ] && PIP="$PHOST"
log "cc=$CC upstream=$PHOST($PIP):$PPORT subnet=$SUBNET"

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
    login = "$PUSER-cc-$CC";
    password = "$PPASS";
}
EOF
# redsocks on RS_PORT is shared per country; (re)start only if not already up
# with THIS country's config.
if ! pgrep -f "redsocks -c $CONF" >/dev/null 2>&1; then
  # a redsocks may already own RS_PORT for a different country — that's fine only
  # if same port/country; otherwise the operator runs one country at a time.
  pkill -f "redsocks -c /etc/redsocks-" 2>/dev/null || true
  sleep 1
  redsocks -c "$CONF" && log "redsocks started ($CC)" || { log "redsocks FAILED"; exit 1; }
fi
ss -tlnp 2>/dev/null | grep -q ":$RS_PORT " || { log "redsocks not listening on $RS_PORT"; exit 1; }

# ── 2) iptables: transparent REDIRECT for THIS instance's subnet ─────────────
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
log "iptables REDIRECT active for $SUBNET -> redsocks:$RS_PORT"
echo "PROXY_RESULT instance=$INSTANCE cc=$CC subnet=$SUBNET_ID redsocks=$RS_PORT"
