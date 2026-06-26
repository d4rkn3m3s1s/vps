// scrcpy v4 control-socket client: connect to the forwarded port, perform the
// minimal handshake, and inject KEYCODE down/up events to type a digit string.
// scrcpy injects via InputManager.injectInputEvent (the trusted path WhatsApp
// accepts), unlike `input text`/ADBKeyboard.
//
// Usage: node _scrcpy-inject.mjs <port> <digits>
import net from 'node:net';

const PORT = parseInt(process.argv[2] || '27184', 10);
const DIGITS = (process.argv[3] || '5457438530').replace(/\D/g, '');

// Android KEYCODE: 0-9 => 7..16
const keycodeFor = (ch) => 7 + (ch.charCodeAt(0) - 48);

// scrcpy control message: INJECT_KEYCODE
//   type(1)=0, action(1), keycode(4 BE), repeat(4 BE), metaState(4 BE)
const CONTROL_MSG_TYPE_INJECT_KEYCODE = 0;
const AKEY_EVENT_ACTION_DOWN = 0;
const AKEY_EVENT_ACTION_UP = 1;

function keyMsg(action, keycode) {
  const b = Buffer.alloc(14);
  let o = 0;
  b.writeUInt8(CONTROL_MSG_TYPE_INJECT_KEYCODE, o); o += 1;
  b.writeUInt8(action, o); o += 1;
  b.writeUInt32BE(keycode, o); o += 4;
  b.writeUInt32BE(0, o); o += 4;      // repeat
  b.writeUInt32BE(0, o); o += 4;      // metaState
  return b;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sock = net.connect(PORT, '127.0.0.1', async () => {
  console.log('connected to control socket');
  // scrcpy v4 with send_device_meta (default): the FIRST socket receives a
  // 64-byte device name. In control-only tunnel_forward, this is our socket.
  // We read+discard whatever arrives, then start sending.
  await sleep(400);

  for (const ch of DIGITS) {
    const kc = keycodeFor(ch);
    sock.write(keyMsg(AKEY_EVENT_ACTION_DOWN, kc));
    await sleep(40);
    sock.write(keyMsg(AKEY_EVENT_ACTION_UP, kc));
    await sleep(120);
    process.stdout.write(ch);
  }
  console.log('\nsent all digits');
  await sleep(600);
  sock.end();
  process.exit(0);
});

let rx = Buffer.alloc(0);
sock.on('data', (d) => { rx = Buffer.concat([rx, d]); });
sock.on('error', (e) => { console.error('socket error:', e.message); process.exit(1); });
sock.on('close', () => { console.log('socket closed'); });
setTimeout(() => { console.error('timeout'); process.exit(2); }, 15000);
