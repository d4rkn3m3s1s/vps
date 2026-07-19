#!/bin/bash
# wd-destroy.sh <instance> — fully remove a Waydroid instance and reclaim its disk.
# Used to clean up a half-built instance after a FAILED provision — otherwise the instance
# dir (~2.3GB under /var/lib/waydroid.<inst>) + its userdata, systemd unit, dbus policy and
# subnet-map line leak permanently, since nothing else ever removes them. Also invocable by
# the operator "delete device" / cancel path.
#
# Removes: the container (via wd-stop), the instance's /var/lib/waydroid.<inst> tree, its
# userdata (/root/.local/share/waydroid.<inst>), its systemd unit, its D-Bus policy, and
# its subnet-map line. (The live wd-provision uses a SHARED GApps image via `init -i`, so
# there's no separate multi-GB userdata clone — just these instance-scoped paths.)
#
# ★INVARIANT (matches wd-provision.sh's warning): does NOT delete the shared waydroid
# bridge — waydroid-net.sh creates it once and won't recreate it if removed, which would
# break EVERY subsequent provision. We only stop THIS instance's session, never the bridge.
#
# Idempotent + defensive: every step is best-effort so a partially-provisioned instance
# (any subset of these paths present) is cleaned without erroring. Refuses empty/unsafe
# names so a bad arg can never `rm -rf` a wrong path.
set -u
INSTANCE="${1:?instance name required}"
# Guard: only [A-Za-z0-9_-], non-empty, not a path — never let a stray value nuke /var/lib.
case "$INSTANCE" in
  ''|*[!A-Za-z0-9_-]*) echo "DESTROY_RESULT instance=$INSTANCE status=refused reason=bad_name"; exit 1;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="/var/lib/waydroid.$INSTANCE"
# ★VERIFIED against the LIVE host layout: userdata lives at share/waydroid.<inst>
# (NOT share-<inst>). The live wd-provision.sh uses `waydroid.py init -i` with a SHARED
# GApps image, so there is no separate ~4GB userdata clone to remove — just this dir.
DATA_HOME="/root/.local/share/waydroid.$INSTANCE"
UNIT="/etc/systemd/system/waydroid-$INSTANCE.service"
DBUS_CONF="/usr/share/dbus-1/system.d/id.waydro.Container.$INSTANCE.conf"
LEASES="/var/lib/misc/dnsmasq.waydroid-$INSTANCE.leases"
SUBNET_MAP="/var/lib/waydroid-subnets.map"

log(){ echo "[wd-destroy:$INSTANCE] $*"; }

# 1) Stop the session/container first (reuse wd-stop's scoped teardown).
if [ -x "$HERE/wd-stop.sh" ]; then
  bash "$HERE/wd-stop.sh" "$INSTANCE" >/dev/null 2>&1 || true
  log "session stopped"
fi

# 2) Disable + remove the per-instance systemd unit.
if [ -f "$UNIT" ]; then
  systemctl disable --now "waydroid-$INSTANCE.service" >/dev/null 2>&1 || true
  rm -f "$UNIT" && log "systemd unit removed"
fi

# 3) Remove the D-Bus own policy + reload so the bus forgets the name.
if [ -f "$DBUS_CONF" ]; then
  rm -f "$DBUS_CONF" && log "dbus policy removed"
  systemctl reload dbus >/dev/null 2>&1 || true
fi

# 4) Remove the instance's on-disk trees (the big ones — ~4.4GB). rm -rf is bounded to
#    the instance-scoped paths validated above; nothing else is touched.
[ -d "$WORK" ]      && rm -rf "$WORK"      && log "removed $WORK (images/lxc/overlay)"
[ -d "$DATA_HOME" ] && rm -rf "$DATA_HOME" && log "removed $DATA_HOME (userdata ~2GB)"
rm -f "$LEASES" 2>/dev/null || true

# 5) Free the subnet-map line so net-head.sh can reuse the subnet (else the 2..239 range
#    slowly fills with dead entries from failed provisions and eventually runs out).
if [ -f "$SUBNET_MAP" ]; then
  # Lines look like "<instance> <subnetId>"; drop the one for THIS instance.
  tmp="$(mktemp 2>/dev/null || echo "$SUBNET_MAP.tmp")"
  grep -vE "^$INSTANCE([[:space:]]|$)" "$SUBNET_MAP" > "$tmp" 2>/dev/null && cat "$tmp" > "$SUBNET_MAP" 2>/dev/null || true
  rm -f "$tmp" 2>/dev/null || true
  log "subnet-map entry freed"
fi

log "destroyed"
echo "DESTROY_RESULT instance=$INSTANCE status=destroyed"
