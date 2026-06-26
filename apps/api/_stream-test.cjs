// Connect to /ws/stream as a viewer for Phone 01 and count frames/sec for ~6s.
// Proves the H.264 fast path delivers high fps end-to-end.
const http = require('http');

const API = 'http://localhost:4000';
const API_KEY = 'f185cb2df56900c9b2a2cdc350ee5cc0db2ceff9';
const DEVICE = 'cmqlrf4ni000gj50fjimgvk4u';

function login() {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ email: 'admin@local.dev', password: 'Admin2026!' });
    const req = http.request(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': API_KEY } }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d).data.accessToken));
    });
    req.on('error', reject); req.write(body); req.end();
  });
}
function streamToken(token) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${API}/stream/${DEVICE}/token`, { method: 'POST', headers: { 'x-api-key': API_KEY, 'authorization': `Bearer ${token}` } }, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d).data));
    });
    req.on('error', reject); req.end();
  });
}

(async () => {
  const token = await login();
  const st = await streamToken(token);
  console.log('stream token ok, online:', st.online);
  const wsUrl = `ws://localhost:4000/ws/stream?token=${encodeURIComponent(st.token)}&deviceId=${encodeURIComponent(DEVICE)}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  let frames = 0, bytes = 0;
  const t0 = Date.now();
  ws.onopen = () => console.log('viewer connected');
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') { console.log('msg:', ev.data.slice(0, 120)); return; }
    frames++; bytes += ev.data.byteLength;
  };
  ws.onerror = (e) => console.log('ws err', e.message || e);
  setTimeout(() => {
    const secs = (Date.now() - t0) / 1000;
    console.log(`RESULT: ${frames} frames in ${secs.toFixed(1)}s = ${(frames/secs).toFixed(1)} fps, avg ${(bytes/frames/1024||0).toFixed(0)} KB/frame`);
    process.exit(0);
  }, 8000);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
