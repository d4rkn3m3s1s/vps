#!/bin/bash
# wd-stop.sh <instance> — cleanly stop a running Waydroid instance without
# touching any other instance. Kills the session/container/compositor this
# instance owns and clears lingering mounts. Idempotent (safe if already down).
set -u
INSTANCE="${1:?instance name required}"
LXCP="/var/lib/waydroid.$INSTANCE/lxc"

log(){ echo "[wd-stop:$INSTANCE] $*"; }

# 1) stop the container (Android) — -k kills it immediately.
if lxc-info -P "$LXCP" -n waydroid -sH 2>/dev/null | grep -q RUNNING; then
  lxc-stop -P "$LXCP" -n waydroid -k 2>/dev/null && log "container stopped" || log "lxc-stop returned nonzero"
else
  log "container already stopped"
fi

# 2) kill this instance's session daemon + compositor (scoped by instance name so
#    we never hit another instance's processes).
pkill -f "waydroid.py --instance $INSTANCE" 2>/dev/null && log "session daemon killed" || true
pkill -f "weston .*--socket=wayland-$INSTANCE( |$)" 2>/dev/null && log "weston killed" || true

# 3) clear lingering bind mounts the container left behind (umount -l = lazy).
for m in $(mount 2>/dev/null | awk -v p="/var/lib/waydroid.$INSTANCE" '$3 ~ p {print $3}' | sort -r); do
  umount -l "$m" 2>/dev/null && log "unmounted $m" || true
done

log "stopped"
echo "STOP_RESULT instance=$INSTANCE status=stopped"
