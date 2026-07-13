#!/usr/bin/env bash
cd "/mnt/c/Yeni klasör/vps"
export FLEET_API_URL=http://localhost:4000
export FLEET_API_KEY="${FLEET_API_KEY:?set FLEET_API_KEY}"
export FLEET_ADB_PORTS=5555
node deploy/local-test/register.mjs admin@local.dev "Admin2026!" 2>&1
