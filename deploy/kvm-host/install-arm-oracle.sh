#!/usr/bin/env bash
# VPS Fleet — ARM cloud-phone host installer for Oracle Cloud Ampere A1
# (also works on any ARM64 bare-metal: Scaleway EM-A, OVH ARM, Hetzner RX).
#
# Ampere A1 is REAL ARM silicon, so redroid runs Android NATIVELY — no /dev/kvm,
# no emulation. This is exactly why WhatsApp/Instagram (which block x86 emulators)
# should work here. That's the whole point of this test.
#
# Usage on a fresh Ubuntu 22.04 (aarch64) instance:
#   sudo FLEET_API_URL=https://your-api \
#        FLEET_API_KEY=xxx \
#        FLEET_HOST_KEY=xxx \
#        PHONES=3 \
#        bash install-arm-oracle.sh
#
set -euo pipefail

log()  { printf '\033[1;36m[fleet]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (sudo)."

ARCH="$(uname -m)"
[ "$ARCH" = "aarch64" ] || warn "Expected aarch64 (ARM64); got '$ARCH'. redroid ARM image assumes ARM silicon."

PHONES="${PHONES:-3}"
FLEET_API_URL="${FLEET_API_URL:-}"
FLEET_API_KEY="${FLEET_API_KEY:-}"
FLEET_HOST_KEY="${FLEET_HOST_KEY:-}"

# ── 1. Base packages ────────────────────────────────────────────────────────
log "Installing base packages (docker, adb, kernel modules)…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl android-tools-adb "linux-modules-extra-$(uname -r)" || \
  apt-get install -y -qq ca-certificates curl android-tools-adb || warn "some packages missing; continuing"

# ── 2. Docker ───────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ── 3. Android (binder) kernel modules — redroid needs these ────────────────
# On Oracle's Ubuntu the binder module ships in linux-modules-extra.
log "Loading binder_linux…"
if modprobe binder_linux devices="binder,hwbinder,vndbinder" 2>/dev/null; then
  log "binder_linux loaded."
  echo 'binder_linux' > /etc/modules-load.d/redroid.conf
  echo 'options binder_linux devices=binder,hwbinder,vndbinder' > /etc/modprobe.d/redroid.conf
else
  warn "binder_linux not available in this kernel. Trying binderfs mount…"
  mkdir -p /dev/binderfs
  mount -t binder binder /dev/binderfs 2>/dev/null || \
    die "No binder support. Oracle's stock kernel usually has it in linux-modules-extra-\$(uname -r). Reboot after installing that package, then re-run."
fi
modprobe ashmem_linux 2>/dev/null || true  # newer kernels use memfd instead; optional.

# ── 4. Firewall — Oracle blocks everything by default via iptables ──────────
# Open ADB ports locally (agent connects to 127.0.0.1, so this is host-internal).
log "Ensuring local ADB ports are reachable…"
iptables -I INPUT -i lo -j ACCEPT 2>/dev/null || true

# ── 5. Launch redroid ARM phones ────────────────────────────────────────────
# ARM redroid image (a12 = Android 12; good app compatibility). Native ARM, no KVM.
IMAGE="redroid/redroid:12.0.0-latest"
log "Pulling ${IMAGE} (ARM Android)…"
docker pull "$IMAGE"

for i in $(seq 1 "$PHONES"); do
  n=$(printf '%02d' "$i")
  port=$((5554 + i))          # 5555, 5556, 5557…
  name="fleet-phone-$n"
  if docker ps -a --format '{{.Names}}' | grep -q "^${name}$"; then
    log "$name already exists; (re)starting."
    docker start "$name" >/dev/null || true
    continue
  fi
  log "Starting $name on ADB port $port…"
  docker run -d --privileged \
    --name "$name" \
    -p "127.0.0.1:${port}:5555" \
    -v "${name}-data:/data" \
    "$IMAGE" \
    androidboot.redroid_width=1080 \
    androidboot.redroid_height=2400 \
    androidboot.redroid_dpi=420 \
    androidboot.redroid_fps=30 \
    androidboot.redroid_gpu_mode=guest
done

# ── 6. Wait for boot + connect ADB ──────────────────────────────────────────
log "Waiting for Android to boot (first boot ~60-90s)…"
sleep 20
for i in $(seq 1 "$PHONES"); do
  port=$((5554 + i))
  adb connect "127.0.0.1:${port}" >/dev/null 2>&1 || true
done
sleep 5
log "ADB devices:"
adb devices

# ── 7. Install + start the host agent (dependency-free Node) ────────────────
if [ -n "$FLEET_API_URL" ] && [ -n "$FLEET_API_KEY" ] && [ -n "$FLEET_HOST_KEY" ]; then
  if ! command -v node >/dev/null 2>&1; then
    log "Installing Node.js 20 (for the host agent)…"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs
  fi
  AGENT_DIR="/opt/fleet-agent"
  mkdir -p "$AGENT_DIR"
  if [ -f "$(dirname "$0")/agent/agent.mjs" ]; then
    cp "$(dirname "$0")/agent/agent.mjs" "$AGENT_DIR/agent.mjs"
  else
    warn "agent.mjs not found next to this script; copy it to $AGENT_DIR/agent.mjs manually."
  fi
  # Waydroid provisioning engine (one-click device flow — parametric host scripts).
  if [ -d "$(dirname "$0")/waydroid" ]; then
    mkdir -p "$AGENT_DIR/waydroid"
    cp "$(dirname "$0")/waydroid/"*.sh "$AGENT_DIR/waydroid/"
    chmod 0755 "$AGENT_DIR/waydroid/"*.sh
  fi
  cat > /etc/systemd/system/fleet-agent.service <<EOF
[Unit]
Description=VPS Fleet Host Agent
After=docker.service network-online.target
Wants=network-online.target

[Service]
Environment=FLEET_API_URL=${FLEET_API_URL}
Environment=FLEET_API_KEY=${FLEET_API_KEY}
Environment=FLEET_HOST_KEY=${FLEET_HOST_KEY}
Environment=FLEET_ADB=/usr/bin/adb
Environment=FLEET_POLL_MS=2000
ExecStart=/usr/bin/node ${AGENT_DIR}/agent.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now fleet-agent
  log "Host agent installed as systemd service (fleet-agent). Logs: journalctl -u fleet-agent -f"
else
  warn "FLEET_API_URL/KEY/HOST_KEY not set — skipped agent install. Phones are up on ADB; set the vars and re-run to attach the agent."
fi

log "Done. ${PHONES} ARM cloud phone(s) running. Next: verify they show ONLINE in the dashboard, then test WhatsApp."
