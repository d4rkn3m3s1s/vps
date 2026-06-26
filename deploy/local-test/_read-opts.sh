#!/usr/bin/env bash
D=/tmp/scrdec/out/sources/com/genymobile/scrcpy
echo "=== Options: display_id and how displayId reaches Controller ==="
grep -rnE "display_id|displayId|DISPLAY" "$D/Options.java" 2>/dev/null | head -10
echo "=== Server.java: how Controller gets displayId (video vs option) ==="
find "$D" -name "Server.java" -exec grep -nE "Controller\(|displayId|getDisplayId|new Controller|controller =" {} \; 2>/dev/null | head
echo "=== Controller ctor lines 79-105 ==="
find "$D" -name "Controller.java" -exec sed -n '79,108p' {} \; 2>/dev/null
