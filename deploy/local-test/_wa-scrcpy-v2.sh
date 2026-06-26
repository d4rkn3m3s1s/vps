#!/usr/bin/env bash
# Full flow v2: focus WA phone field -> start scrcpy-server WITH VIDEO (so
# Controller.supportsInputEvents=true) -> client connects video+control sockets
# -> injects KEYCODE digits via InputManager (trusted path) -> verify NEXT.
SC=/tmp/scrcpy-v4/scrcpy-linux-x86_64-v4.0
ADB="$SC/adb"
export ANDROID_SERIAL=127.0.0.1:5555
NUM="${1:-5457438530}"
SCID=42424242
PORT=27184
DEV=/dev/input/event0

# focus phone field
"$ADB" -s 127.0.0.1:5555 shell "sendevent $DEV 3 47 0; sendevent $DEV 3 57 1; sendevent $DEV 1 330 1; sendevent $DEV 3 53 359; sendevent $DEV 3 54 386; sendevent $DEV 0 0 0; sendevent $DEV 3 57 -1; sendevent $DEV 1 330 0; sendevent $DEV 0 0 0" 2>/dev/null
sleep 2

# (re)start server WITH video=true (key change), keep meta/dummy defaults
"$ADB" -s 127.0.0.1:5555 push "$SC/scrcpy-server" /data/local/tmp/scrcpy-server.jar >/dev/null 2>&1
"$ADB" -s 127.0.0.1:5555 shell "pkill -f com.genymobile.scrcpy.Server" >/dev/null 2>&1
sleep 1
"$ADB" -s 127.0.0.1:5555 shell "CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 4.0 scid=$SCID log_level=verbose video=true audio=false control=true tunnel_forward=true cleanup=false max_size=480 video_bit_rate=500000 max_fps=2" >/tmp/scrcpy-server.log 2>&1 &
sleep 4
"$ADB" -s 127.0.0.1:5555 forward tcp:$PORT localabstract:scrcpy_$SCID >/dev/null 2>&1
echo "server: $(grep -iE 'Device:|displayId|ERROR' /tmp/scrcpy-server.log | head -2 | tr -d '\r' | tr '\n' ' ')"

echo "=== inject $NUM (video+control sockets) ==="
node "/mnt/c/Yeni klasör/vps/deploy/local-test/_scrcpy-inject2.mjs" $PORT "$NUM" 2>&1 | tr -d '\r'

sleep 2
"$ADB" -s 127.0.0.1:5555 shell uiautomator dump /sdcard/sv.xml >/dev/null 2>&1
"$ADB" -s 127.0.0.1:5555 pull /sdcard/sv.xml /tmp/sv.xml >/dev/null 2>&1
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/sv.xml | grep -oE 'enabled="[a-z]+"' | head -1)
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/sv.xml | grep -oE 'text="[^"]*"' | head -1)
echo "phone=[$PHTXT]  NEXT=[$NEXT]"
bash "/mnt/c/Yeni klasör/vps/deploy/local-test/_wa-shot.sh" 5555 >/dev/null 2>&1
[ "$NEXT" = 'enabled="true"' ] && echo "SUCCESS ✓✓ number landed via scrcpy InputManager!" || echo "still not landed"
echo "=== server log tail ==="
tail -5 /tmp/scrcpy-server.log 2>/dev/null | tr -d '\r'
