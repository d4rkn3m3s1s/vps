#!/usr/bin/env bash
D=/tmp/scrdec/out/sources/com/genymobile/scrcpy
echo "=== DesktopConnection.java (socket handshake) ==="
find "$D" -name "DesktopConnection.java" -exec sed -n '1,160p' {} \; 2>/dev/null
