// Replicate the agent's exact spawn+pipe in Node and count JPEG frames, while
// generating screen motion. Isolates whether the Node pipe wiring works.
import { spawn } from 'node:child_process';

const ADB = process.env.LOCALAPPDATA + '\\Android\\Sdk\\platform-tools\\adb.exe';
const FFMPEG = 'C:\\scrcpy\\ffmpeg.exe';
const S = 'emulator-5584';

// motion generator
const motion = setInterval(() => {
  spawn(ADB, ['-s', S, 'shell', 'input', 'swipe', '300', '1000', '300', '400', '150']);
}, 350);

const rec = spawn(ADB, ['-s', S, 'exec-out',
  'screenrecord --output-format=h264 --size 540x1200 --bit-rate 4000000 --time-limit=8 -'
], { windowsHide: true });
const ff = spawn(FFMPEG, [
  '-loglevel', 'error',
  '-f', 'h264', '-i', 'pipe:0',
  '-an', '-c:v', 'mjpeg', '-q:v', '7', '-pix_fmt', 'yuvj420p',
  '-f', 'mjpeg', 'pipe:1'
], { windowsHide: true });

let recBytes = 0;
rec.stdout.on('data', d => { recBytes += d.length; try { ff.stdin.write(d); } catch {} });
rec.stderr.on('data', d => console.log('[rec]', d.toString().trim().slice(0,150)));
rec.on('close', () => { try { ff.stdin.end(); } catch {} });

const SOI = Buffer.from([0xff,0xd8]), EOI = Buffer.from([0xff,0xd9]);
let buf = Buffer.alloc(0), frames = 0, bytes = 0, gotFirst = false;
ff.stdout.on('data', chunk => {
  if (!gotFirst) { gotFirst = true; console.log('first ffmpeg chunk', chunk.length, 'B'); }
  bytes += chunk.length;
  buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
  let s = buf.indexOf(SOI);
  while (s !== -1) {
    const e = buf.indexOf(EOI, s+2);
    if (e === -1) break;
    frames++;
    buf = buf.subarray(e+2);
    s = buf.indexOf(SOI);
  }
});
ff.stderr.on('data', d => console.log('[ff]', d.toString().trim().slice(0,150)));
ff.on('close', c => { console.log(`ffmpeg closed code=${c}`); clearInterval(motion); console.log(`RESULT: ${frames} frames, ${(bytes/1024).toFixed(0)} KB ffmpeg-out, ${(recBytes/1024).toFixed(0)} KB screenrecord-in`); process.exit(0); });

setTimeout(() => { clearInterval(motion); try { rec.kill(); ff.kill(); } catch {} }, 10000);
