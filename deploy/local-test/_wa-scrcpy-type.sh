#!/usr/bin/env bash
# Full flow: focus WA phone field (sendevent) -> start scrcpy-server control-only
# -> forward port -> run Node client that injects KEYCODE digits via scrcpy's
# trusted path -> verify NEXT enables.
# Args: $1=national digits (e.g. 5457438530)
SC=/tmp/scrcpy-v4/scrcpy-linux-x86_64-v4.0
ADB="$SC/adb"
export ANDROID_SERIAL=127.0.0.1:5555
NUM="${1:-5457438530}"
SCID=42424242
PORT=27184
DEV=/dev/input/event0

# focus the phone field via raw touch
"$ADB" -s 127.0.0.1:5555 shell "sendevent $DEV 3 47 0; sendevent $DEV 3 57 1; sendevent $DEV 1 330 1; sendevent $DEV 3 53 359; sendevent $DEV 3 54 386; sendevent $DEV 0 0 0; sendevent $DEV 3 57 -1; sendevent $DEV 1 330 0; sendevent $DEV 0 0 0" 2>/dev/null
sleep 2
echo "focused: $("$ADB" -s 127.0.0.1:5555 shell dumpsys input_method 2>/dev/null | grep -oE 'mInputShown=[a-z]+' | head -1 | tr -d '\r')"

# (re)start server
"$ADB" -s 127.0.0.1:5555 push "$SC/scrcpy-server" /data/local/tmp/scrcpy-server.jar >/dev/null 2>&1
"$ADB" -s 127.0.0.1:5555 shell "pkill -f com.genymobile.scrcpy.Server" >/dev/null 2>&1
sleep 1
"$ADB" -s 127.0.0.1:5555 shell "CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 4.0 scid=$SCID log_level=verbose video=false audio=false control=true tunnel_forward=true cleanup=false send_device_meta=false send_dummy_byte=false send_frame_meta=false" >/tmp/scrcpy-server.log 2>&1 &
sleep 3
"$ADB" -s 127.0.0.1:5555 forward tcp:$PORT localabstract:scrcpy_$SCID >/dev/null 2>&1
echo "server: $(grep -i 'Device:' /tmp/scrcpy-server.log | head -1 | tr -d '\r')"

# run the inject client
echo "=== inject $NUM via scrcpy control socket ==="
node "/mnt/c/Yeni klasör/vps/deploy/local-test/_scrcpy-inject.mjs" $PORT "$NUM" 2>&1 | tr -d '\r'

sleep 2
"$ADB" -s 127.0.0.1:5555 shell uiautomator dump /sdcard/sct.xml >/dev/null 2>&1
"$ADB" -s 127.0.0.1:5555 pull /sdcard/sct.xml /tmp/sct.xml >/dev/null 2>&1
NEXT=$(grep -oE 'registration_submit"[^>]*enabled="[a-z]+"' /tmp/sct.xml | grep -oE 'enabled="[a-z]+"' | head -1)
PHTXT=$(grep -oE 'registration_phone"[^>]*text="[^"]*"' /tmp/sct.xml | grep -oE 'text="[^"]*"' | head -1)
echo "phone=[$PHTXT]  NEXT=[$NEXT]"
bash "/mnt/c/Yeni klasör/vps/deploy/local-test/_wa-shot.sh" 5555 >/dev/null 2>&1
[ "$NEXT" = 'enabled="true"' ] && echo "SUCCESS ✓ number landed via scrcpy!" || echo "still not landed"
