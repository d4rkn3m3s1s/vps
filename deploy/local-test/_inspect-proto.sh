#!/usr/bin/env bash
SC=/tmp/scrcpy-v4/scrcpy-linux-x86_64-v4.0
cd /tmp && rm -rf scrsrv && mkdir scrsrv && cd scrsrv
cp "$SC/scrcpy-server" server.jar
echo "=== jar control classes ==="
unzip -l server.jar 2>/dev/null | grep -iE "control/.*ControlMessage|control/Controller" | head
unzip -o server.jar "com/genymobile/scrcpy/control/*" >/dev/null 2>&1
echo "=== ControlMessageReader bytecode (key parsing) ==="
command -v javap >/dev/null 2>&1 || { echo "163244" | sudo -S apt-get install -y default-jdk-headless >/dev/null 2>&1; }
javap -p -c com/genymobile/scrcpy/control/ControlMessageReader.class 2>/dev/null | grep -iE "parseInjectKeycode|TYPE_INJECT|case |bipush|sipush|readInt|readByte|getInt|get\(" | head -40
