#!/usr/bin/env bash
# Installs the VPS Fleet host agent as a systemd service.
# Run as root from this directory AFTER you've registered the host in the
# dashboard and have your agent key.
#
#   sudo ./install-agent.sh
#
set -euo pipefail

log()  { printf '\033[1;36m[fleet]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (sudo)."
command -v node >/dev/null 2>&1 || die "Node.js 18+ is required (apt-get install -y nodejs or use nvm)."
command -v adb  >/dev/null 2>&1 || die "adb is required (apt-get install -y android-tools-adb)."

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log "Installing agent to /opt/fleet-agent…"
install -d /opt/fleet-agent
install -m 0644 "$SRC_DIR/agent.mjs" /opt/fleet-agent/agent.mjs

if [ ! -f /etc/fleet-agent.env ]; then
  log "Creating /etc/fleet-agent.env from template — EDIT IT before the agent will work."
  install -m 0600 "$SRC_DIR/fleet-agent.env.example" /etc/fleet-agent.env
else
  log "/etc/fleet-agent.env already exists, leaving it untouched."
fi

log "Installing systemd unit…"
install -m 0644 "$SRC_DIR/fleet-agent.service" /etc/systemd/system/fleet-agent.service
systemctl daemon-reload
systemctl enable fleet-agent.service

log "Done."
log "1. Edit /etc/fleet-agent.env  (FLEET_API_URL, FLEET_API_KEY, FLEET_HOST_KEY)"
log "2. systemctl start fleet-agent  &&  journalctl -u fleet-agent -f"
