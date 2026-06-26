#!/usr/bin/env bash
chmod +x /tmp/jadx/bin/jadx 2>/dev/null
cd /tmp/scrdec
/tmp/jadx/bin/jadx -d out --no-res server.jar >/tmp/jadx.log 2>&1
echo "jadx exit=$?"
tail -3 /tmp/jadx.log 2>/dev/null
F=$(find /tmp/scrdec/out -name "ControlMessageReader.java" | head -1)
echo "=== file: $F ==="
sed -n '1,140p' "$F" 2>/dev/null
