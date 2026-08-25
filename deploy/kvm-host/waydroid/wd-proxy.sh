#!/bin/bash
# wd-proxy.sh <instance> <cc> <user> <pass> <host> <port> — route an instance's
# traffic through a country-matched thordata proxy via redsocks + transparent iptables
# REDIRECT. WhatsApp shows "Login not available" when the number's country != the
# exit-IP country, so the exit IP must match the number.
#
# ★PER-INSTANCE STICKY IP (2026-07-21): thordata's mobile pool ROTATES the exit IP on
# every request by default. WhatsApp reads that as one account connecting from a dozen
# different IPs within seconds — impossible for a real phone → bot flag → ban. Fix:
#   1) append thordata's sticky-session tag `-sessid-<instance>` to the login, so this
#      instance keeps ONE exit IP for the session's lifetime (verified: same IP across
#      requests), and
#   2) give each INSTANCE its OWN redsocks (config + port), not one shared per-country
#      daemon — because the sticky IP is baked into the login, a shared daemon could only
#      ever hold ONE session. Per-instance redsocks = each device its own stable IP =
#      each account looks like its own real phone.
#
# Waydroid has no WiFi UI (ethernet only), so we can't set an in-Android proxy; instead
# we transparently REDIRECT the instance's subnet TCP to a local redsocks that speaks
# http-connect to the upstream proxy.
set -u
INSTANCE="${1:?instance}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUBNET_ID="$(sh "$HERE/net-head.sh" "$INSTANCE")"
SUBNET="192.168.$SUBNET_ID.0/24"

# ★PER-INSTANCE PORT: each instance gets its OWN redsocks port, derived deterministically
# from its subnet id (2..239) so reboots/re-applies always land on the same port and two
# instances never collide. Range 12500..12739 is clear of the old per-country ports.
rs_port_for_subnet() { echo $(( 12500 + $1 )); }
RS_PORT="$(rs_port_for_subnet "$SUBNET_ID")"

log(){ echo "[wd-proxy:$INSTANCE] $*"; }

# `wd-proxy.sh <instance> clear` removes this instance's REDIRECT rules + stops its
# redsocks so its traffic exits directly again (used when a device's proxy is unassigned).
if [ "${2:-}" = "clear" ]; then
  modprobe xt_REDIRECT 2>/dev/null || true
  while iptables -t nat -L PREROUTING -n --line-numbers 2>/dev/null | grep -q "$SUBNET"; do
    N=$(iptables -t nat -L PREROUTING -n --line-numbers | grep "$SUBNET" | awk '{print $1}' | sort -rn | head -1)
    [ -n "$N" ] && iptables -t nat -D PREROUTING "$N" 2>/dev/null || break
  done
  # ★2026-07-24: also remove the FORWARD UDP-DROP rule (added on apply) so a cleared
  # device's UDP exits directly again (correct — no proxy means no leak protection to keep).
  while iptables -C FORWARD -s "$SUBNET" -p udp ! --dport 53 -j DROP 2>/dev/null; do
    iptables -D FORWARD -s "$SUBNET" -p udp ! --dport 53 -j DROP 2>/dev/null || break
  done
  # Stop THIS instance's redsocks (its config is instance-scoped, so this can't touch
  # another device's daemon).
  pkill -f "redsocks -c /etc/redsocks-inst-$INSTANCE.conf" 2>/dev/null || true
  log "iptables REDIRECT rules + redsocks cleared for $SUBNET"
  echo "PROXY_RESULT instance=$INSTANCE cc=- subnet=$SUBNET_ID redsocks=cleared"
  exit 0
fi

CC="${2:?country code}"
PUSER="${3:?proxy user}"
PPASS="${4:?proxy pass}"
PHOST="${5:?proxy host}"
PPORT="${6:?proxy port}"
CONF="/etc/redsocks-inst-$INSTANCE.conf"   # ★per-instance config (was per-country)

# resolve upstream host to an IP (redsocks wants an IP, and we must RETURN it)
PIP="$(getent hosts "$PHOST" | awk '{print $1; exit}')"
[ -z "$PIP" ] && PIP="$PHOST"
log "cc=$CC upstream=$PHOST($PIP):$PPORT subnet=$SUBNET port=$RS_PORT sessid=$INSTANCE"

# Build the thordata login. Country tag: some stored usernames ALREADY embed the country
# ("-cc-XX"/"-country-xx") — don't append a second one (invalid login → auth fails).
case "$PUSER" in
  *-cc-*|*-country-*) LOGIN="$PUSER" ;;
  *)                  LOGIN="$PUSER-country-$CC" ;;
esac
# ★STICKY SESSION: pin this instance to ONE exit IP. thordata keys the sticky IP off the
# `-sessid-<id>` username tag (verified live). Use the instance name as the id so the SAME
# device always gets the SAME IP across re-applies/reboots, and DIFFERENT devices get
# DIFFERENT (but each individually stable) IPs. Don't double-append if already present.
#
# ★-sesstime-<min>: sessid ALONE only pins the IP briefly — after a short window (or on a
# reused/aged sessid) thordata rotates the exit IP even though the sessid is unchanged, so
# a device would drift across 2-3 IPs (VERIFIED LIVE: sessid-only → 3 IPs; sessid+sesstime
# → 1 IP). WhatsApp reads that drift as one account hopping IPs → ban risk. Add sesstime to
# hold the SAME IP for the whole window (WA session length). Configurable via env; 30 min
# default. Only append when absent.
#
# ★★COUNTRY IN THE SESSID (2026-07-28): the sessid MUST include the country code.
# thordata pins the sticky IP to the sessid ALONE — the `-country-XX` tag is ignored for
# an already-live session. So re-applying the same instance with a DIFFERENT country kept
# returning the OLD country's IP (VERIFIED LIVE: mi35 re-applied as DE → still exited TR;
# same login with a fresh sessid → DE immediately). That silently breaks country switching
# and, worse, hands WhatsApp a number/IP country MISMATCH → "Login not available"/ban.
# Keying the sessid on <instance>-<cc> keeps stickiness per (device,country) while letting
# a country change start a genuinely new session.
STICKY_MIN="${FLEET_PROXY_STICKY_MIN:-30}"
SESSID="$(echo "$INSTANCE$CC" | tr -cd 'A-Za-z0-9')"   # thordata: alnum-only session id
case "$LOGIN" in
  *-sessid-*) : ;;                                  # already has a session id — leave it
  *)          LOGIN="$LOGIN-sessid-$SESSID" ;;
esac
case "$LOGIN" in
  *-sesstime-*) : ;;                                # session lifetime already set
  *)            LOGIN="$LOGIN-sesstime-$STICKY_MIN" ;;
esac

# ★★★2026-08-21 KATMANLI SAVUNMA: redsocks yalnizca KENDI koprusune baglanir.
# Onceden local_ip = 0.0.0.0 idi: ~142 proxy portu TUM arayuzlerde dinliyordu.
# ufw koruyordu (12500:12600 yalniz 192.168.0.0/16) ama ufw duserse 142 ACIK PROXY
# internete acilir. Koprunun ag gecidi IP'si = 192.168.<subnet>.1 (canli dogrulandi).
# iptables REDIRECT zaten bu arayuzun adresine yonlendirdigi icin islevsel esdeger.
#
# ⚠️GEREKLILIK: net.ipv4.ip_nonlocal_bind=1 (/etc/sysctl.d/99-fleet-redsocks.conf).
# wd-proxy-restore boot+90sn'de calisir ama boot-gate cihazlari ~18 dk'ya yayar;
# cogu kopru henuz YOKken bind "Cannot assign requested address" ile patlardi.
# CANLI KANIT (mi98): kopru silinmisken nonlocal_bind=0 -> HATA, =1 -> basarili;
# kopru sonradan gelince trafik akti.
#
# ⚠️⚠️YORUMLAR HEREDOC'UN DISINDA DURMALI: `cat > "$CONF" <<EOF` TIRNAKSIZ heredoc'tur,
# icindeki TERS TIRNAK komut ikamesi tetikler. Bu yorum bir kez iceri konunca
# "local_ip: command not found" verip 138 cihazin redsocks'unu dusurdu.
# ── 1) redsocks config (one per INSTANCE) + (re)start ────────────────────────
cat > "$CONF" <<EOF
base {
    log_debug = off;
    log_info = on;
    log = "file:/var/log/redsocks-inst-$INSTANCE.log";
    daemon = on;
    redirector = iptables;
}
redsocks {
    local_ip = 192.168.$SUBNET_ID.1;
    local_port = $RS_PORT;
    ip = $PIP;
    port = $PPORT;
    type = http-connect;
    login = "$LOGIN";
    password = "$PPASS";
}
EOF
# ★ALWAYS (re)start this instance's redsocks so a CONFIG CONTENT change actually takes
# effect. The old logic keyed only on "is a daemon running for this CONF path?" and
# REUSED it — but the CONF PATH is per-instance and stable, while its CONTENTS (the
# login: country + sessid) change when a device is re-homed to a different country
# (e.g. an AL number registered on a device that previously had a TR sticky login).
# Result: the file said AL but the still-running daemon kept exiting on the OLD TR IP →
# "APPLIED" but exit=TR match=false → the exact country-mismatch ban the panel warned
# about. Killing + starting fresh every apply guarantees the running daemon matches the
# file we just wrote. (Cost is trivial: one redsocks per instance, sub-second restart.)
pkill -f "redsocks -c $CONF" 2>/dev/null && sleep 1 || true
# Free the port if anything ELSE (a stale process) still holds it.
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
redsocks -c "$CONF" && log "redsocks started ($INSTANCE on $RS_PORT, login refreshed)" || { log "redsocks FAILED (start)"; exit 1; }
for _i in 1 2 3 4 5 6; do
  ss -tlnp 2>/dev/null | grep -q ":$RS_PORT " && break
  sleep 0.5
done
ss -tlnp 2>/dev/null | grep -q ":$RS_PORT " || { log "redsocks not listening on $RS_PORT"; exit 1; }

# ── 2) iptables: transparent REDIRECT for THIS instance's subnet ─────────────
# iptables writes need root. If we're not root the REDIRECT inserts fail silently and we
# would still print PROXY_RESULT — a false "APPLIED" that leaves the device on the host's
# datacenter IP. Fail loud instead.
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
# ★2026-07-24: DROP the instance's UDP (except DNS 53) so QUIC / HTTP-3 (UDP 443) can't
# bypass redsocks and exit from the DATACENTER IP — the #1 WhatsApp ban cause. iptables
# only REDIRECTs TCP; UDP was leaving directly. WhatsApp/Chrome fall back to TCP when QUIC
# is blocked, so this closes the leak without breaking connectivity. DNS stays (dnsmasq).
# Idempotent: remove any prior copy for this subnet first, then add. filter/FORWARD chain.
while iptables -C FORWARD -s "$SUBNET" -p udp ! --dport 53 -j DROP 2>/dev/null; do
  iptables -D FORWARD -s "$SUBNET" -p udp ! --dport 53 -j DROP 2>/dev/null || break
done
iptables -A FORWARD -s "$SUBNET" -p udp ! --dport 53 -j DROP 2>/dev/null \
  && log "UDP (non-DNS) DROP active for $SUBNET (QUIC leak closed)" \
  || log "WARN: UDP DROP rule for $SUBNET could not be added (non-fatal)"
# VERIFY the REDIRECT rule actually landed before declaring success.
if ! iptables -t nat -S PREROUTING 2>/dev/null | grep -F -- "-s ${SUBNET}" | grep -F -- "REDIRECT --to-ports ${RS_PORT}" >/dev/null 2>&1; then
  log "ERROR: REDIRECT rule for $SUBNET NOT present after insert"
  echo "PROXY_FAIL instance=$INSTANCE reason=redirect-not-installed"
  exit 1
fi
log "iptables REDIRECT active for $SUBNET -> redsocks:$RS_PORT (sticky sessid=$INSTANCE)"
echo "PROXY_RESULT instance=$INSTANCE cc=$CC subnet=$SUBNET_ID redsocks=$RS_PORT"
