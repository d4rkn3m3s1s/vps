#!/usr/bin/env bash
D=/tmp/scrdec/out/sources/com/genymobile/scrcpy
echo "=== where supportsInputEvents is set ==="
grep -rnE "supportsInputEvents" "$D" 2>/dev/null | head
echo "=== Controller constructor / init context ==="
find "$D" -name "Controller.java" -exec grep -nE "supportsInputEvents *=|Controller\(|this.displayId *=|actionDisplayId" {} \; 2>/dev/null | head
