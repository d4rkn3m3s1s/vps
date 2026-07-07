#!/bin/bash
# wd-run.sh <instance> — boot orchestrator for a Waydroid instance.
# Orders the fragile steps that separate systemd units race on:
#   1) isolated binder nodes + runtime dirs
#   2) weston headless compositor (own wayland socket)
#   3) container dbus daemon (wait for its bus name)
#   4) session dbus + session start (boots Android, keeps the unit alive)
#   5) after boot, run wa-bringup (integrity spoof + vtouch) — idempotent
# Parametric clone of the proven wd3-run.sh. $1 = instance name.
set -u
INSTANCE="${1:?instance name required}"
HERE="$(cd "$(dirname "$0")" && pwd)"
MI="${FLEET_WAYDROID_PY:-/opt/waydroid-mi2}"      # waydroid multi-instance python tree
export PYTHONPATH="$MI"
export XDG_RUNTIME_DIR="/run/xdg-$INSTANCE"
export XDG_DATA_HOME="/root/.local/share-$INSTANCE"
export WAYLAND_DISPLAY="wayland-$INSTANCE"
BUS="id.waydro.Container.$INSTANCE"
LXCP="/var/lib/waydroid.$INSTANCE/lxc"

log(){ echo "[wd-run:$INSTANCE] $*"; }

# ── 1) runtime dirs + binder nodes ───────────────────────────────────────────
mkdir -p "$XDG_RUNTIME_DIR/pulse" "$XDG_DATA_HOME" "$XDG_DATA_HOME/waydroid/data"
chmod 700 "$XDG_RUNTIME_DIR"
[ -e "$XDG_RUNTIME_DIR/pulse/native" ] || : > "$XDG_RUNTIME_DIR/pulse/native"
bash "$HERE/wd-binder.sh" "$INSTANCE"

# ── 2) weston (own socket) — robust start ────────────────────────────────────
weston_alive(){ pgrep -f "weston .*--socket=wayland-$INSTANCE( |$)" >/dev/null 2>&1; }
if ! weston_alive; then
    rm -f "$XDG_RUNTIME_DIR/wayland-$INSTANCE" "$XDG_RUNTIME_DIR/wayland-$INSTANCE.lock" 2>/dev/null
    weston --backend=headless-backend.so --socket="wayland-$INSTANCE" --width=1080 --height=2400 \
        >"/var/log/weston-$INSTANCE.log" 2>&1 &
    log "started weston (wayland-$INSTANCE 1080x2400)"
fi
for i in $(seq 1 20); do
    [ -S "$XDG_RUNTIME_DIR/wayland-$INSTANCE" ] && break
    sleep 0.5
done
if [ ! -S "$XDG_RUNTIME_DIR/wayland-$INSTANCE" ]; then
    log "FATAL: wayland-$INSTANCE socket never appeared — weston failed"
    tail -5 "/var/log/weston-$INSTANCE.log" 2>/dev/null | sed 's/^/[weston] /'
fi

# ── 3) container dbus daemon (background) ────────────────────────────────────
pkill -f "instance $INSTANCE container start" 2>/dev/null || true
sleep 1
python3 "$MI/waydroid.py" --instance "$INSTANCE" container start \
    >"/var/log/waydroid-$INSTANCE-container.log" 2>&1 &
CONTAINER_PID=$!
log "container daemon PID=$CONTAINER_PID, waiting for bus name $BUS..."
for i in $(seq 1 30); do
    if dbus-send --system --dest=org.freedesktop.DBus --type=method_call --print-reply \
        /org/freedesktop/DBus org.freedesktop.DBus.ListNames 2>/dev/null | grep -q "$BUS"; then
        log "bus name $BUS is up"
        break
    fi
    kill -0 "$CONTAINER_PID" 2>/dev/null || { log "container daemon exited early"; break; }
    sleep 1
done

# ── 4) session dbus ──────────────────────────────────────────────────────────
if [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]; then
    if [ ! -S "$XDG_RUNTIME_DIR/bus" ]; then
        dbus-daemon --session --address="unix:path=$XDG_RUNTIME_DIR/bus" --nofork --nopidfile \
            >"/var/log/waydroid-$INSTANCE-sessionbus.log" 2>&1 &
        sleep 1
    fi
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
    log "session bus at $DBUS_SESSION_BUS_ADDRESS"
fi

# ── 5) session start (background) — boots Android ────────────────────────────
log "starting session (boots Android)..."
python3 "$MI/waydroid.py" --instance "$INSTANCE" session start \
    >"/var/log/waydroid-$INSTANCE-session.log" 2>&1 &
SESSION_PID=$!

# ── 6) wait for a REAL boot (boot_completed + hwcomposer + SurfaceFlinger) ───
bc=0; sf_up=0
for i in $(seq 1 60); do
    st=$(lxc-info -P "$LXCP" -n waydroid -sH 2>/dev/null)
    [ "$st" = "FROZEN" ] && lxc-unfreeze -P "$LXCP" -n waydroid 2>/dev/null
    bc=$(timeout 5 lxc-attach -P "$LXCP" -n waydroid -- getprop sys.boot_completed 2>/dev/null | tr -d '\r' | head -1)
    hwc=$(timeout 5 lxc-attach -P "$LXCP" -n waydroid -- getprop init.svc.vendor.hwcomposer-2-1 2>/dev/null | tr -d '\r' | head -1)
    if [ "$bc" = "1" ] && [ "$hwc" = "running" ]; then
        if timeout 8 lxc-attach -P "$LXCP" -n waydroid -- /system/bin/sh -c 'service check SurfaceFlinger 2>/dev/null | grep -q "found"'; then
            sf_up=1; break
        fi
    fi
    [ $((i % 5)) -eq 0 ] && log "boot wait ${i}: boot=$bc hwcomposer=$hwc"
    sleep 3
done
[ "$sf_up" = "1" ] && bc=1 || bc=0

# ── 7) wa-bringup (spoof + vtouch), best-effort ──────────────────────────────
if [ "$bc" = "1" ]; then
    log "boot complete — running wa-bringup (spoof + vtouch)"
    timeout 40 lxc-attach -P "$LXCP" -n waydroid -- /system/bin/sh -c \
        'su -c "sh /data/local/tmp/wa-bringup.sh" >/data/local/tmp/bringup.log 2>&1 || su -c "sh /data/adb/wa-bringup.sh" >/data/local/tmp/bringup.log 2>&1' 2>/dev/null || \
        log "wa-bringup returned nonzero (may be backgrounded vtouch)"
    log "model=$(lxc-attach -P "$LXCP" -n waydroid -- getprop ro.product.model 2>/dev/null | tr -d '\r')"
else
    log "WARN: boot_completed not reached; wa-bringup skipped"
fi

# ── 8) keep the unit alive on the session process ────────────────────────────
wait "$SESSION_PID"
