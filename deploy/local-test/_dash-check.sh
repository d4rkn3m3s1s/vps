#!/usr/bin/env bash
D='/mnt/c/Yeni klasör/vps/apps/dashboard'
echo "=== standalone server.js ==="; ls -la "$D/.next/standalone/apps/dashboard/server.js" 2>&1 | head -1
echo "=== static copied into standalone? ==="; ls -d "$D/.next/standalone/apps/dashboard/.next/static" 2>&1 | head -1
echo "=== public copied? ==="; ls -d "$D/.next/standalone/apps/dashboard/public" 2>&1 | head -1
echo "=== BUILD_ID ==="; cat "$D/.next/BUILD_ID" 2>&1 | head -1
echo "=== source .tsx newer than build? ==="
find "$D/src" -name "*.tsx" -newer "$D/.next/BUILD_ID" 2>/dev/null | head -8
echo "--- (lines above mean source changed since last build) ---"
