#!/usr/bin/env bash
# Start scrcpy-server v4 standalone in control-only mode (no video/audio) with
# tunnel_forward, and adb-forward a local TCP port to its socket. The Node client
# (_scrcpy-inject.mjs) then connects and sends INJECT_KEYCODE messages.
SC=/tmp/scrcpy-v4/scrcpy-linux-x86_64-v4.0
ADB="$SC/adb"
export ANDROID_SERIAL=127.0.0.1:5555
SCID=42424242
PORT=27184

# ensure server jar present
"$ADB" -s 127.0.0.1:5555 push "$SC/scrcpy-server" /data/local/tmp/scrcpy-server.jar >/dev/null 2>&1

# kill old
pkill -f "com.genymobile.scrcpy.Server" >/dev/null 2>&1
"$ADB" -s 127.0.0.1:5555 shell "pkill -f com.genymobile.scrcpy.Server" >/dev/null 2>&1
sleep 1

# start server: control only, tunnel_forward so client connects to forwarded port
"$ADB" -s 127.0.0.1:5555 shell "CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 4.0 scid=$SCID log_level=verbose video=false audio=false control=true tunnel_forward=true cleanup=false" >/tmp/scrcpy-server.log 2>&1 &
echo "server launching (scid=$SCID)..."
sleep 3

# forward local port -> server abstract socket: localabstract:scrcpy_<scid>
"$ADB" -s 127.0.0.1:5555 forward tcp:$PORT localabstract:scrcpy_$SCID 2>&1 | tr -d '\r'
echo "forward tcp:$PORT -> localabstract:scrcpy_$SCID"
echo "=== server log ==="
tail -8 /tmp/scrcpy-server.log 2>/dev/null | tr -d '\r'
echo "PORT=$PORT"
