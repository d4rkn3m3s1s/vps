#!/usr/bin/env bash
# Minimal test: control-only server, send ONE KEYCODE_APP_SWITCH (187) and see if
# recents opens. Isolates whether injection works at all. display_id=0 default.
SC=/tmp/scrcpy-v4/scrcpy-linux-x86_64-v4.0
ADB="$SC/adb"
export ANDROID_SERIAL=127.0.0.1:5555
SCID=42424242
PORT=27184

"$ADB" -s 127.0.0.1:5555 shell "pkill -f com.genymobile.scrcpy.Server" >/dev/null 2>&1
sleep 1
"$ADB" -s 127.0.0.1:5555 shell "CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 4.0 scid=$SCID log_level=debug video=false audio=false control=true tunnel_forward=true cleanup=false send_dummy_byte=true send_device_meta=true" >/tmp/sct1.log 2>&1 &
sleep 3
"$ADB" -s 127.0.0.1:5555 forward tcp:$PORT localabstract:scrcpy_$SCID >/dev/null 2>&1

node - "$PORT" <<'JSEOF'
import net from 'node:net';
const PORT = parseInt(process.argv[2]||'27184',10);
const km=(a,k)=>{const b=Buffer.alloc(14);b.writeUInt8(0,0);b.writeUInt8(a,1);b.writeUInt32BE(k,2);b.writeUInt32BE(0,6);b.writeUInt32BE(0,10);return b;};
const s=net.connect(PORT,'127.0.0.1',async()=>{
  s.on('data',d=>console.log('rx',d.length,'bytes:',d.slice(0,8).toString('hex')));
  await new Promise(r=>setTimeout(r,600));
  console.log('sending APP_SWITCH down/up');
  s.write(km(0,187)); await new Promise(r=>setTimeout(r,60)); s.write(km(1,187));
  await new Promise(r=>setTimeout(r,800)); s.end(); process.exit(0);
});
s.on('error',e=>{console.log('ERR',e.message);process.exit(1)});
setTimeout(()=>process.exit(2),6000);
JSEOF

sleep 2
echo "=== top activity (recents = com.android.launcher3 RecentsActivity or overview) ==="
"$ADB" -s 127.0.0.1:5555 shell dumpsys activity activities 2>/dev/null | grep -oE 'topResumedActivity=ActivityRecord\{[^}]*' | head -1 | tr -d '\r'
echo "=== server log ==="
tail -8 /tmp/sct1.log 2>/dev/null | tr -d '\r'
