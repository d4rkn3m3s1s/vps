import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';
const [, , wsUrl, targetUrl, cookieVal, outPath, w, h] = process.argv;
const width = Number(w), height = Number(h);
const ws = new WebSocket(wsUrl);
let id = 0; const pending = new Map();
function send(method, params = {}, sessionId) {
  return new Promise((resolve) => { const m = ++id; pending.set(m, resolve); ws.send(JSON.stringify({ id: m, method, params, sessionId })); });
}
ws.on('message', (data) => { const msg = JSON.parse(data.toString()); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); } });
ws.on('open', async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 }, sessionId);
  await send('Network.setCookie', { name: 'fleet_session', value: cookieVal, domain: 'localhost', path: '/' }, sessionId);
  await send('Page.navigate', { url: targetUrl }, sessionId);
  await new Promise((r) => setTimeout(r, 5000));
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  writeFileSync(outPath, Buffer.from(data, 'base64'));
  console.log('saved', outPath); ws.close(); process.exit(0);
});
