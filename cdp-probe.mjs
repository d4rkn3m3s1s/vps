// CDP probe: for each route, navigate with the fleet_session cookie, capture a
// screenshot AND collect console errors + failed (4xx/5xx) network responses.
// Surfaces real "dangling / broken" features that a plain HTTP crawl can't see.
//
// Usage: node cdp-probe.mjs <cdpWsUrl> <cookie> <outDir> <route1> [route2 ...]
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const [, , wsUrl, cookieVal, outDir, ...routes] = process.argv;
const BASE = 'http://localhost:3000';
const ws = new WebSocket(wsUrl, { headers: { Origin: 'http://localhost:9222' } });
let id = 0; const pending = new Map();
const send = (method, params = {}, sessionId) =>
  new Promise((res) => { const m = ++id; pending.set(m, res); ws.send(JSON.stringify({ id: m, method, params, sessionId })); });

const evHandlers = [];
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  else if (msg.method) evHandlers.forEach((h) => h(msg));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.on('open', async () => {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  await send('Network.setCookie', { name: 'fleet_session', value: cookieVal, domain: 'localhost', path: '/' }, sessionId);

  const report = [];
  let cur = { consoleErrors: [], netFails: [] };
  evHandlers.push((msg) => {
    if (msg.params?.sessionId && msg.params.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      cur.consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      cur.consoleErrors.push('EXC ' + (msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || '').slice(0, 200));
    }
    if (msg.method === 'Network.responseReceived') {
      const s = msg.params.response.status;
      if (s >= 400) cur.netFails.push(`${s} ${msg.params.response.url.replace(BASE, '')}`);
    }
  });

  for (const route of routes) {
    cur = { consoleErrors: [], netFails: [] };
    await send('Page.navigate', { url: BASE + route }, sessionId);
    await sleep(4200);
    const safe = route === '/' ? 'home' : route.replace(/\//g, '_').replace(/^_/, '');
    try {
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
      writeFileSync(`${outDir}/shot_${safe}.png`, Buffer.from(data, 'base64'));
    } catch {}
    report.push({ route, consoleErrors: cur.consoleErrors.slice(0, 6), netFails: [...new Set(cur.netFails)].slice(0, 10) });
  }
  writeFileSync(`${outDir}/_report.json`, JSON.stringify(report, null, 2));
  // compact console summary
  for (const r of report) {
    const flags = [];
    if (r.netFails.length) flags.push('NET:' + r.netFails.join(','));
    if (r.consoleErrors.length) flags.push('JS:' + r.consoleErrors.length);
    console.log(`${r.route.padEnd(16)} ${flags.length ? flags.join(' | ') : 'ok'}`);
  }
  ws.close(); process.exit(0);
});
ws.on('error', (e) => { console.error('WS error', e.message); process.exit(1); });
