#!/usr/bin/env bash
cd /tmp/scrdec
/tmp/jadx/bin/jadx -d out --no-res server.jar >/tmp/jadx.log 2>&1
echo "jadx exit=$?"
echo "=== ControlMessageReader.java (byte parsing) ==="
find /tmp/scrdec/out -name "ControlMessageReader.java" -exec cat {} \; 2>/dev/null | sed -n '1,120p'
