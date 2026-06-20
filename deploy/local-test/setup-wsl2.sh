#!/usr/bin/env bash
# VPS Fleet — LOCAL TEST setup for WSL2 (Ubuntu)
#
# Run this INSIDE a WSL2 Ubuntu shell (not Windows PowerShell):
#   bash setup-wsl2.sh
#
# It verifies WSL2 has KVM + the binder kernel module redroid needs, installs
# Docker + ADB if missing, and brings up the local redroid Android phones.
# After it finishes, run ./register.mjs from the repo to wire the phones into the
# API, then start the host agent. See ./README.md for the full walkthrough.

set -euo pipefail

log()  { printf '\033[1;36m[fleet]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

# 0. Confirm we're really in WSL2 (redroid needs the WSL2 kernel, not WSL1).
if ! grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
  warn "This doesn't look like WSL. If you're on bare-metal Linux use deploy/kvm-host/install.sh instead."
fi
if grep -qi 'wsl2' /proc/version 2>/dev/null || [ -e /dev/kvm ]; then
  : # likely WSL2
else
  warn "Could not confirm WSL2. Ensure 'wsl --set-version <distro> 2' and a recent Windows 11 build."
fi

# 1. KVM — redroid runs an Android kernel and needs hardware virtualization.
log "Checking /dev/kvm…"
if [ ! -e /dev/kvm ]; then
  die "/dev/kvm missing in WSL2. Enable it: (a) Windows 'Virtual Machine Platform' feature on, (b) update WSL ('wsl --update'), (c) BIOS virtualization (VT-x/AMD-V) enabled. Then reopen WSL."
fi
# Make /dev/kvm group-accessible so non-root docker can use it.
sudo chmod 666 /dev/kvm 2>/dev/null || true
log "KVM OK."

# 2. binder_linux — redroid's Android needs the binder driver.
log "Loading binder_linux kernel module…"
if ! sudo modprobe binder_linux devices="binder,hwbinder,vndbinder" 2>/dev/null; then
  warn "binder_linux modprobe failed. Recent WSL2 kernels include binderfs; checking…"
  if [ ! -d /dev/binderfs ]; then
    sudo mkdir -p /dev/binderfs 2>/dev/null || true
    sudo mount -t binder binder /dev/binderfs 2>/dev/null \
      || warn "binderfs not mountable. You may need a custom WSL2 kernel with CONFIG_ANDROID_BINDERFS=y. See README troubleshooting."
  fi
fi

# 3. Docker — use Docker Desktop's WSL integration OR install docker.io in WSL.
if ! command -v docker >/dev/null 2>&1; then
  warn "docker not found in WSL. Easiest: install Docker Desktop on Windows and enable 'WSL integration' for this distro. Falling back to apt docker.io…"
  sudo apt-get update -qq && sudo apt-get install -y -qq docker.io
  sudo service docker start || true
fi
docker compose version >/dev/null 2>&1 || docker-compose version >/dev/null 2>&1 \
  || die "Docker Compose not available. Enable Docker Desktop WSL integration."

# 4. ADB — host-side control of the phones.
if ! command -v adb >/dev/null 2>&1; then
  log "Installing android-tools-adb…"
  sudo apt-get update -qq && sudo apt-get install -y -qq android-tools-adb
fi

# 5. Bring up the phones.
COMPOSE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log "Starting local redroid phones from ${COMPOSE_DIR}…"
cd "$COMPOSE_DIR"
docker compose up -d

# 6. Wait for ADB to come up and show the devices.
log "Waiting for Android to boot (first boot can take 30–90s)…"
adb start-server >/dev/null 2>&1 || true
for port in 5555 5556; do
  adb connect "127.0.0.1:${port}" >/dev/null 2>&1 || true
done
sleep 5
adb devices

cat <<'EOF'

──────────────────────────────────────────────────────────────────────────────
 Phones are starting. Next steps:

 1. Wait until 'adb devices' shows them as 'device' (not 'offline'):
        watch -n2 adb devices

 2. Register them into the API + get an agent key:
        node deploy/local-test/register.mjs

 3. Start the host agent (prints command at the end of step 2).

 Full guide + troubleshooting: deploy/local-test/README.md
──────────────────────────────────────────────────────────────────────────────
EOF
