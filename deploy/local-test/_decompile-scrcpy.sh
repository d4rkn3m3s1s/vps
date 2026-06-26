#!/usr/bin/env bash
SC=/tmp/scrcpy-v4/scrcpy-linux-x86_64-v4.0
cd /tmp && rm -rf scrdec && mkdir scrdec && cd scrdec
cp "$SC/scrcpy-server" server.jar
echo "=== jar contents ==="
unzip -l server.jar 2>/dev/null | grep -E "\.dex|ControlMessage" | head
unzip -o server.jar >/dev/null 2>&1
ls -la *.dex 2>/dev/null
echo "=== disassemble with baksmali if available, else androguard ==="
command -v baksmali >/dev/null 2>&1 && echo "baksmali present" || echo "no baksmali"
# try python androguard / dexdump from android sdk
command -v dexdump >/dev/null 2>&1 && echo "dexdump present" || echo "no dexdump"
