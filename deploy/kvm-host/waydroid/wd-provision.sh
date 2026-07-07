#!/bin/bash
# wd-provision.sh <instance> — build a fully isolated Waydroid instance next to
# the existing ones. Idempotent. NEVER touches the default instance
# (/var/lib/waydroid) or the clone source (SRC_INSTANCE, default "work").
#
# Clones the SOURCE instance's proven layout (lxc config, images, userdata =
# WhatsApp/GApps/Magisk/vtouch ready) and retargets every path/bridge/binder
# reference to the new instance. Subnet is derived deterministically from the
# instance name (net-head.sh). On success prints, as the LAST line:
#
#     PROVISION_RESULT subnet=<n> ip=192.168.<n>.112 port=5555 instance=<name>
#
# so the caller (host agent) can parse the ADB serial. The .112 host address is
# the DHCP lease the container reliably picks up (same as #1/#2/#3).
set -u

INSTANCE="${1:?instance name required}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC_INSTANCE="${SRC_INSTANCE:-work}"          # clone source (has all config)
PREFIX_SRC="/var/lib/waydroid.$SRC_INSTANCE"
WORK="/var/lib/waydroid.$INSTANCE"
DATA_SRC="/root/.local/share-$SRC_INSTANCE/waydroid/data"
DATA_DST_HOME="/root/.local/share-$INSTANCE"
DATA_DST="$DATA_DST_HOME/waydroid/data"
IFACE="waydroid-$INSTANCE"
SUBNET_ID="$(sh "$HERE/net-head.sh" "$INSTANCE")"
BR_ADDR="192.168.$SUBNET_ID.1"
DEV_IP="192.168.$SUBNET_ID.112"

log(){ echo "[wd-provision:$INSTANCE] $*"; }

# Deterministic-but-unique MAC from the instance name (avoid DHCP collision).
MAC_TAIL="$(printf '%s' "$INSTANCE" | md5sum | cut -c1-6 | sed 's/\(..\)\(..\)\(..\)/\1:\2:\3/')"
HWADDR="00:16:3e:$MAC_TAIL"

# ── 0) guards: source must exist, target must not be the source ──────────────
[ "$INSTANCE" = "$SRC_INSTANCE" ] && { log "FATAL: instance == source"; exit 1; }
[ -d "$PREFIX_SRC/lxc" ] || { log "FATAL: source $PREFIX_SRC missing"; exit 1; }
log "source=$SRC_INSTANCE subnet=$SUBNET_ID iface=$IFACE mac=$HWADDR"

# ── 1) lxc layout: clone source, retarget every reference ────────────────────
log "prepare $WORK (clone lxc layout from $PREFIX_SRC)"
mkdir -p "$WORK"
if [ ! -d "$WORK/lxc" ]; then
  cp -a "$PREFIX_SRC/lxc" "$WORK/lxc"
  grep -rl "waydroid\.$SRC_INSTANCE\|waydroid-$SRC_INSTANCE\|binder-$SRC_INSTANCE\|vndbinder-$SRC_INSTANCE\|hwbinder-$SRC_INSTANCE" "$WORK/lxc" 2>/dev/null | while read -r f; do
    sed -i \
      -e "s#/var/lib/waydroid\.$SRC_INSTANCE#/var/lib/waydroid.$INSTANCE#g" \
      -e "s#waydroid-$SRC_INSTANCE#waydroid-$INSTANCE#g" \
      -e "s#binder-$SRC_INSTANCE#binder-$INSTANCE#g" \
      -e "s#vndbinder-$SRC_INSTANCE#vndbinder-$INSTANCE#g" \
      -e "s#hwbinder-$SRC_INSTANCE#hwbinder-$INSTANCE#g" \
      "$f"
  done
  sed -i "s#lxc.net.0.hwaddr = .*#lxc.net.0.hwaddr = $HWADDR#" "$WORK/lxc/waydroid/config"
  log "lxc layout retargeted $SRC_INSTANCE->$INSTANCE"
else
  log "lxc layout already present, skip"
fi

# ── 1b) overlay + rootfs mount-point (init-created dirs the clone must have) ──
# Waydroid's init creates these; a bare cfg-copy leaves the session "not
# initialized". `overlay` carries the Magisk boot hook (root!) so it MUST be
# cloned. `rootfs` is just the container's mount point — recreate it EMPTY (its
# 2.3G content is bind-mounted from system.img at runtime, never copied).
for D in overlay overlay_rw overlay_work host-permissions; do
  if [ -d "$PREFIX_SRC/$D" ] && [ ! -d "$WORK/$D" ]; then
    cp -a "$PREFIX_SRC/$D" "$WORK/$D"
    log "cloned $D ($(du -sh "$WORK/$D" 2>/dev/null | cut -f1))"
  fi
done
mkdir -p "$WORK/rootfs" "$WORK/cache_http"

# ── 2) images: copy source's (do NOT symlink — instance owns its own) ────────
log "prepare images"
mkdir -p "$WORK/images"
if [ ! -f "$WORK/images/system.img" ]; then
  log "copying system.img+vendor.img from $PREFIX_SRC (~2.3GB, one-time)"
  cp -f "$PREFIX_SRC/images/system.img" "$WORK/images/system.img"
  cp -f "$PREFIX_SRC/images/vendor.img" "$WORK/images/vendor.img"
else
  log "images already present, skip"
fi

# ── 3) waydroid.cfg (retarget images_path + binder nodes) ────────────────────
if [ ! -f "$WORK/waydroid.cfg" ]; then
  sed \
    -e "s#/var/lib/waydroid\.$SRC_INSTANCE#/var/lib/waydroid.$INSTANCE#g" \
    -e "s#binder = binder-$SRC_INSTANCE#binder = binder-$INSTANCE#" \
    -e "s#vndbinder = vndbinder-$SRC_INSTANCE#vndbinder = vndbinder-$INSTANCE#" \
    -e "s#hwbinder = hwbinder-$SRC_INSTANCE#hwbinder = hwbinder-$INSTANCE#" \
    "$PREFIX_SRC/waydroid.cfg" > "$WORK/waydroid.cfg"
  # host_data_path must point at THIS instance's userdata
  if grep -q 'host_data_path' "$WORK/waydroid.cfg"; then
    sed -i "s#host_data_path = .*#host_data_path = $DATA_DST#" "$WORK/waydroid.cfg"
  fi
  log "waydroid.cfg written"
else
  log "waydroid.cfg already present, skip"
fi

# waydroid.prop / waydroid_base.prop (retarget host_data_path, keep nobootanim)
for P in waydroid.prop waydroid_base.prop; do
  if [ -f "$PREFIX_SRC/$P" ] && [ ! -f "$WORK/$P" ]; then
    sed -e "s#/root/.local/share-$SRC_INSTANCE#/root/.local/share-$INSTANCE#g" \
        "$PREFIX_SRC/$P" > "$WORK/$P"
  fi
done

# ── 4) binderfs: mount + create -<inst> nodes + symlink into /dev ────────────
log "binderfs-$INSTANCE setup"
bash "$HERE/wd-binder.sh" "$INSTANCE"
ls -la "/dev/binder-$INSTANCE" "/dev/vndbinder-$INSTANCE" "/dev/hwbinder-$INSTANCE" 2>&1 | sed 's/^/  /'

# ── 5) network: bridge waydroid-<inst> + NAT + own dnsmasq ───────────────────
log "network $IFACE ($BR_ADDR)"
if ! ip link show "$IFACE" >/dev/null 2>&1; then
  ip link add "$IFACE" type bridge
  ip link set "$IFACE" address "00:16:3e:00:00:$(printf '%02x' "$((SUBNET_ID & 0xff))")"
fi
ip addr replace "$BR_ADDR/24" dev "$IFACE"
ip link set "$IFACE" up
echo 1 > /proc/sys/net/ipv4/ip_forward
iptables -t nat -C POSTROUTING -s "192.168.$SUBNET_ID.0/24" ! -d "192.168.$SUBNET_ID.0/24" -j MASQUERADE 2>/dev/null || \
  iptables -t nat -A POSTROUTING -s "192.168.$SUBNET_ID.0/24" ! -d "192.168.$SUBNET_ID.0/24" -j MASQUERADE
iptables -C FORWARD -i "$IFACE" -j ACCEPT 2>/dev/null || iptables -I FORWARD -i "$IFACE" -j ACCEPT
iptables -C FORWARD -o "$IFACE" -j ACCEPT 2>/dev/null || iptables -I FORWARD -o "$IFACE" -j ACCEPT
for p in "udp 67" "tcp 67" "udp 53" "tcp 53"; do
  set -- $p
  iptables -C INPUT -i "$IFACE" -p $1 --dport $2 -j ACCEPT 2>/dev/null || iptables -I INPUT -i "$IFACE" -p $1 --dport $2 -j ACCEPT
done
mkdir -p "/run/waydroid-$INSTANCE-lxc" /var/lib/misc
if ! pgrep -f "dnsmasq.*$IFACE" >/dev/null 2>&1; then
  dnsmasq --conf-file=/dev/null --strict-order --bind-interfaces \
    --pid-file="/run/waydroid-$INSTANCE-lxc/dnsmasq.pid" \
    --listen-address "$BR_ADDR" \
    --dhcp-range "192.168.$SUBNET_ID.16,192.168.$SUBNET_ID.254" \
    --dhcp-lease-max=253 --dhcp-no-override \
    --except-interface=lo --interface="$IFACE" \
    --dhcp-leasefile="/var/lib/misc/dnsmasq.$IFACE.leases" \
    --dhcp-authoritative && log "dnsmasq started on $IFACE" || log "dnsmasq FAILED"
else
  log "dnsmasq for $IFACE already running"
fi

# ── 6) userdata clone (source's 2.1G data: WhatsApp+GApps+Magisk+vtouch) ─────
log "userdata clone -> $DATA_DST"
mkdir -p "$DATA_DST_HOME/waydroid"
if [ ! -d "$DATA_DST/data" ] && [ ! -f "$DATA_DST/system/build.prop" ]; then
  cp -a "$DATA_SRC" "$DATA_DST"
  log "userdata cloned ($(du -sh "$DATA_DST" 2>/dev/null | cut -f1))"
else
  log "userdata already present, skip"
fi

# ── 7) systemd unit + D-Bus own policy ───────────────────────────────────────
UNIT="/etc/systemd/system/waydroid-$INSTANCE.service"
if [ ! -f "$UNIT" ]; then
  cat > "$UNIT" <<EOF
[Unit]
Description=Waydroid instance "$INSTANCE" (fleet cloud phone)
After=network.target dbus.service
Wants=dbus.service
StartLimitIntervalSec=0

[Service]
Type=simple
UMask=0022
ExecStart=/bin/bash $HERE/wd-run.sh $INSTANCE
RemainAfterExit=yes
Restart=on-failure
RestartSec=10
TimeoutStartSec=180

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  log "systemd unit written: $UNIT"
fi

DBUS_CONF="/usr/share/dbus-1/system.d/id.waydro.Container.$INSTANCE.conf"
if [ ! -f "$DBUS_CONF" ]; then
  cat > "$DBUS_CONF" <<EOF
<!DOCTYPE busconfig PUBLIC
 "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
    <policy user="root">
        <allow own="id.waydro.Container.$INSTANCE"/>
    </policy>
    <policy context="default">
        <allow send_destination="id.waydro.Container.$INSTANCE"/>
        <allow receive_sender="id.waydro.Container.$INSTANCE"/>
    </policy>
</busconfig>
EOF
  # reload dbus config so the container can own its bus name
  dbus-send --system --type=method_call --dest=org.freedesktop.DBus \
    /org/freedesktop/DBus org.freedesktop.DBus.ReloadConfig 2>/dev/null || true
  log "D-Bus own policy written: $DBUS_CONF"
fi

log "isolation ready"
echo "PROVISION_RESULT subnet=$SUBNET_ID ip=$DEV_IP port=5555 instance=$INSTANCE"
