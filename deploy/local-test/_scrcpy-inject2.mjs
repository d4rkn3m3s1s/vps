// scrcpy v4 control client WITH video enabled (so Controller.supportsInputEvents
// becomes true — input injection is gated on having a displayId != -1).
// Server started with video=true audio=false control=true tunnel_forward=true
// send_dummy_byte=true send_device_meta=true send_frame_meta=true.
// Socket accept order on server = video, (audio), control. We open TWO client
// connections to the same forwarded port: 1st = video (drain), 2nd = control.
//
// Usage: node _scrcpy-inject2.mjs <port> <digits>
import net from 'node:net';

const PORT = parseInt(process.argv[2] || '27184', 10);
const DIGITS = (process.argv[3] || '5457438530').replace(/\D/g, '');
const keycodeFor = (ch) => 7 + (ch.charCodeAt(0) - 48); // '0'..'9' -> 7..16
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function keyMsg(action, keycode) {
  const b = Buffer.alloc(14);
  b.writeUInt8(0, 0);            // TYPE_INJECT_KEYCODE
  b.writeUInt8(action, 1);      // 0=down 1=up
  b.writeUInt32BE(keycode, 2);
  b.writeUInt32BE(0, 6);        // repeat
  b.writeUInt32BE(0, 10);      // metaState
  return b;
}

function connectOnce(label) {
  return new Promise((resolve, reject) => {
    const s = net.connect(PORT, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
    s.label = label;
  });
}

(async () => {
  // 1st connection = VIDEO socket. Server writes 1 dummy byte + 64-byte device
  // name + codec metadata here. We just keep it open and drain it.
  const video = await connectOnce('video');
  video.on('data', () => {});      // drain frames silently
  video.on('error', () => {});
  console.log('video socket connected (drains)');
  await sleep(800);

  // 2nd connection = CONTROL socket.
  const control = await connectOnce('control');
  control.on('data', () => {});
  control.on('error', (e) => console.log('control err', e.message));
  console.log('control socket connected');
  await sleep(600);

  for (const ch of DIGITS) {
    const kc = keycodeFor(ch);
    control.write(keyMsg(0, kc));
    await sleep(50);
    control.write(keyMsg(1, kc));
    await sleep(140);
    process.stdout.write(ch);
  }
  console.log('\nsent all digits');
  await sleep(800);
  control.end();
  video.end();
  process.exit(0);
})().catch((e) => { console.error('fatal', e.message); process.exit(1); });

setTimeout(() => { console.error('timeout'); process.exit(2); }, 20000);
