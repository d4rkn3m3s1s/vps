#!/usr/bin/env bash
# VPS Fleet — KVM Android host installer
# Run on a fresh Ubuntu 22.04/24.04 bare-metal server WITH /dev/kvm available
# (Hetzner AX-line, OVH Advance, or any host that exposes hardware virtualization).
#
#   curl -fsSL https://your-host/install.sh | sudo bash
#
# It installs Docker, verifies KVM, and brings up the redroid-based Android
# emulator stack that the VPS Fleet control plane drives over ADB.

set -euo pipefail

log()  { printf '\033[1;36m[fleet]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (sudo)."

# 1. Verify hardware virtualization — emulators CANNOT run without it.
log "Checking KVM support…"
if [ ! -e /dev/kvm ]; then
  die "/dev/kvm not found. This server lacks hardware virtualization. Use a bare-metal / KVM-enabled host (e.g. Hetzner AX42), not a standard container VPS."
fi
if ! grep -Eq 'vmx|svm' /proc/cpuinfo; then
  warn "CPU virtualization flags not detected in /proc/cpuinfo — emulators may be slow."
fi
log "KVM OK."

# 2. Install Docker + compose plugin if missing.
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin missing."

# 3. Load the binder/ashmem kernel modules redroid needs.
log "Loading Android kernel modules (binder_linux, ashmem_linux)…"
modprobe binder_linux devices="binder,hwbinder,vndbinder" 2>/dev/null || warn "binder_linux not available; install linux-modules-extra-$(uname -r)."
modprobe ashmem_linux 2>/dev/null || true

# 4. Install ADB (host-side control).
if ! command -v adb >/dev/null 2>&1; then
  log "Installing android-tools-adb…"
  apt-get update -qq && apt-get install -y -qq android-tools-adb
fi

# 5. Bring up the emulator stack.
COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log "Starting Android emulator stack from ${COMPOSE_DIR}…"
cd "$COMPOSE_DIR"
docker compose up -d

log "Done. Cloud phones are reachable over ADB on ports 5555+."
log "Next: set FLEET_HOST_ADB_HOST and register this host in the dashboard Settings."
