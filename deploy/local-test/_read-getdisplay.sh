#!/usr/bin/env bash
D=/tmp/scrdec/out/sources/com/genymobile/scrcpy
echo "=== Device.supportsInputEvents ==="
find "$D" -name "Device.java" -exec sed -n '40,60p' {} \; 2>/dev/null
echo "=== getActionDisplayId (what display events go to) ==="
find "$D" -name "Controller.java" -exec sed -n '/getActionDisplayId/,+12p' {} \; 2>/dev/null | head -16
