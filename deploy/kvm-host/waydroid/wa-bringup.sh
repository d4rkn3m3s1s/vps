#!/system/bin/sh
# wa-bringup — one-shot stabilizer for WhatsApp automation on Waydroid.
# Restores BOTH layers that WhatsApp needs and that are volatile across
# reboots / `stop && start`:
#   1) integrity spoof (resetprop -> look like a real, locked Samsung device)
#   2) uinput virtual touchscreen (vtouch) + its /dev/input node
# Run as root after boot. Idempotent — safe to run repeatedly.
#
# The spoof identity is PARAMETRIC via env vars so each fleet device gets a
# UNIQUE fingerprint (WhatsApp must not link them). The API decrypts a per-device
# fingerprint and passes it in. Falls back to a Galaxy S21 if unset.

log() { echo "[wa-bringup] $*"; }

# ── 1) integrity spoof (unique per device via env) ───────────────────────────
WA_MODEL="${WA_MODEL:-SM-G991B}"
WA_BRAND="${WA_BRAND:-samsung}"
WA_MANUFACTURER="${WA_MANUFACTURER:-samsung}"
WA_DEVICE="${WA_DEVICE:-o1s}"
WA_NAME="${WA_NAME:-o1seea}"
WA_FINGERPRINT="${WA_FINGERPRINT:-samsung/o1seea/o1s:13/TP1A.220624.014/G991BXXU5CVK1:user/release-keys}"
WA_DESCRIPTION="${WA_DESCRIPTION:-o1seea-user 13 TP1A.220624.014 G991BXXU5CVK1 release-keys}"

spoof() { resetprop -n "$1" "$2"; }
spoof ro.build.fingerprint    "$WA_FINGERPRINT"
spoof ro.build.tags           release-keys
spoof ro.build.type           user
spoof ro.build.description     "$WA_DESCRIPTION"
spoof ro.product.model         "$WA_MODEL"
spoof ro.product.manufacturer  "$WA_MANUFACTURER"
spoof ro.product.brand         "$WA_BRAND"
spoof ro.product.name          "$WA_NAME"
spoof ro.product.device        "$WA_DEVICE"
spoof ro.debuggable            0
spoof ro.secure                1
spoof ro.boot.verifiedbootstate green
spoof ro.boot.flash.locked     1
spoof ro.boot.veritymode       enforcing
# Optional identifiers — only set when provided (unique per device).
[ -n "${WA_SERIAL:-}" ]     && spoof ro.serialno       "$WA_SERIAL"
[ -n "${WA_ANDROID_ID:-}" ] && settings put secure android_id "$WA_ANDROID_ID" 2>/dev/null
log "integrity props applied (model=$(getprop ro.product.model) tags=$(getprop ro.build.tags))"

# ── 2) uinput virtual touchscreen ───────────────────────────────────────────
VT=/data/local/tmp/vtouch
[ -x "$VT" ] || VT=/data/adb/vtouch
FIFO=/data/local/tmp/vt.fifo

pkill vtouch 2>/dev/null
rm -f "$FIFO"; mknod "$FIFO" p
nohup sh -c "tail -f $FIFO | $VT hold" >/data/local/tmp/vt.log 2>&1 &
sleep 2

EV=""
for e in /sys/class/input/event*; do
  [ "$(cat "$e/device/name" 2>/dev/null)" = "vtouch" ] && EV="$e" && break
done
if [ -z "$EV" ]; then log "ERROR: vtouch not in sysfs"; exit 1; fi
IDX=$(basename "$EV" | sed 's/event//')
DEV=$(cat "$EV/dev"); MAJ=${DEV%:*}; MIN=${DEV#*:}

NODE=/dev/input/event$IDX
rm -f "$NODE"; umask 0
mknod -m 666 "$NODE" c "$MAJ" "$MIN"
chown root:input "$NODE"
log "vtouch node ready: $NODE ($MAJ:$MIN)"

sleep 1
if dumpsys input 2>/dev/null | grep -qi vtouch; then
  log "OK — InputReader sees vtouch (TOUCHSCREEN active)"
else
  log "WARN — InputReader has not registered vtouch yet"
fi
