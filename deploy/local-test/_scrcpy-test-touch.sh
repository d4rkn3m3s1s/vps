#!/usr/bin/env bash
# Test scrcpy INJECT_TOUCH (type 2) — tap "Choose a country" via scrcpy to see
# if scrcpy injection works at all (touch is visible). Format from decompile:
# type(1) action(1) pointerId(8) x(4) y(4) screenW(2) screenH(2) pressure(2) actionButton(4) buttons(4)
SC=/tmp/scrcpy-v4/scrcpy-linux-x86_64-v4.0
ADB="$SC/adb"
export ANDROID_SERIAL=127.0.0.1:5555
SCID=42424242
PORT=27184
"$ADB" -s 127.0.0.1:5555 shell "pkill -f com.genymobile.scrcpy.Server" >/dev/null 2>&1
sleep 1
"$ADB" -s 127.0.0.1:5555 shell "CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / com.genymobile.scrcpy.Server 4.0 scid=$SCID log_level=debug video=false audio=false control=true tunnel_forward=true cleanup=false" >/tmp/sctt.log 2>&1 &
sleep 3
"$ADB" -s 127.0.0.1:5555 forward tcp:$PORT localabstract:scrcpy_$SCID >/dev/null 2>&1

node - "$PORT" <<'JSEOF'
import net from 'node:net';
const PORT=parseInt(process.argv[2]||'27184',10);
// INJECT_TOUCH: type=2 action(1) pointerId(8) x(4) y(4) w(2) h(2) pressure(2) actionButton(4) buttons(4) = 32 bytes
function touch(action,x,y,pressure){
  const b=Buffer.alloc(32); let o=0;
  b.writeUInt8(2,o);o+=1; b.writeUInt8(action,o);o+=1;
  b.writeBigUInt64BE(0xFFFFFFFFFFFFFFFFn,o);o+=8;  // pointerId -1 (mouse)
  b.writeUInt32BE(x,o);o+=4; b.writeUInt32BE(y,o);o+=4;
  b.writeUInt16BE(600,o);o+=2; b.writeUInt16BE(1280,o);o+=2;   // screen size
  b.writeUInt16BE(pressure,o);o+=2;                              // pressure u16 fixed (0xffff=1.0)
  b.writeUInt32BE(0,o);o+=4;                                     // actionButton
  b.writeUInt32BE(1,o);o+=4;                                     // buttons (primary)
  return b;
}
const s=net.connect(PORT,'127.0.0.1',async()=>{
  s.on('data',()=>{});
  await new Promise(r=>setTimeout(r,700));
  // tap Choose-a-country (300,327): down then up
  s.write(touch(0,300,327,0xffff)); await new Promise(r=>setTimeout(r,80));
  s.write(touch(1,300,327,0)); 
  console.log('sent touch down/up at 300,327');
  await new Promise(r=>setTimeout(r,1000)); s.end(); process.exit(0);
});
s.on('error',e=>{console.log('ERR',e.message);process.exit(1)});
setTimeout(()=>process.exit(2),6000);
JSEOF

sleep 2
echo "=== screen after scrcpy touch ==="
"$ADB" -s 127.0.0.1:5555 shell uiautomator dump /sdcard/st.xml >/dev/null 2>&1
"$ADB" -s 127.0.0.1:5555 pull /sdcard/st.xml /tmp/st.xml >/dev/null 2>&1
grep -oE 'Choose a country|India|Pakistan|United Kingdom' /tmp/st.xml | head -2 | tr '\n' '|'; echo ""
bash "/mnt/c/Yeni klasör/vps/deploy/local-test/_wa-shot.sh" 5555 >/dev/null 2>&1
echo "=== log ==="; tail -5 /tmp/sctt.log | tr -d '\r'
