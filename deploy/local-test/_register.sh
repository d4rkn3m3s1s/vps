#!/usr/bin/env bash
cd "/mnt/c/Yeni klasör/vps"
export FLEET_API_URL=http://localhost:4000
export FLEET_API_KEY=f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9
export FLEET_ADB_PORTS=5555
node deploy/local-test/register.mjs admin@local.dev "Admin2026!" 2>&1
