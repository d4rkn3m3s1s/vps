#!/bin/bash
# wd-provision.sh <instance> — phoenixNAP: izole instance init (GApps paylaşımlı).
# Agent PROVISION_DEVICE bunu çağırır, PROVISION_RESULT satırı bekler.
set -u
INSTANCE="${1:?instance name required}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUBNET_ID="$(sh "$HERE/net-head.sh" "$INSTANCE")"
DEV_IP="192.168.$SUBNET_ID.112"
log(){ echo "[wd-provision:$INSTANCE] $*"; }
MI=/opt/waydroid-mi2

[ "$INSTANCE" = "default" ] && { log "FATAL: instance == default"; exit 1; }

# init (yoksa) — GApps imajını PAYLAŞ (-i), ayrı indirme yok
if [ ! -f "/var/lib/waydroid.$INSTANCE/waydroid.cfg" ]; then
  log "init (GApps paylaşımlı)…"
  PYTHONPATH="$MI" python3 "$MI/waydroid.py" --instance "$INSTANCE" init -f -i /var/lib/waydroid/images >/var/log/wd-$INSTANCE-init.log 2>&1
  [ -f "/var/lib/waydroid.$INSTANCE/waydroid.cfg" ] || { log "FATAL: init failed"; tail -5 /var/log/wd-$INSTANCE-init.log; exit 1; }
fi
# suspend_action=none — idle-freeze pm install'i yarida keser (kok neden). Kapat.
if grep -q "^suspend_action = freeze" "/var/lib/waydroid.$INSTANCE/waydroid.cfg" 2>/dev/null; then
  sed -i "s/^suspend_action = .*/suspend_action = none/" "/var/lib/waydroid.$INSTANCE/waydroid.cfg"
  log "suspend_action=none (idle-freeze kapatildi)"
fi
log "instance hazır subnet=$SUBNET_ID ip=$DEV_IP"
echo "PROVISION_RESULT subnet=$SUBNET_ID ip=$DEV_IP port=5555 instance=$INSTANCE"
