#!/usr/bin/env node
// VPS Fleet — LOCAL TEST registration
//
// Wires the local redroid phones into the control plane so the host agent can
// drive them: logs in, registers a "local-wsl2" host (returns a one-time agent
// key), creates one Device per ADB endpoint, and assigns each device to the host.
// Finally it prints the exact command to start the host agent against localhost.
//
// Zero npm deps — Node 18+ built-ins only (global fetch).
//
// Config via env (all optional except credentials):
//   FLEET_API_URL    API base url            (default http://localhost:4000)
//   FLEET_API_KEY    an x-api-key from the dashboard (Admin → API anahtarları)
//   FLEET_EMAIL      operator email          (or pass as 1st CLI arg)
//   FLEET_PASSWORD   operator password       (or pass as 2nd CLI arg)
//   FLEET_ADB_HOST   how the agent reaches ADB (default 127.0.0.1)
//   FLEET_ADB_PORTS  comma list of ADB ports  (default 5555,5556)
//   FLEET_HOST_NAME  host display name        (default local-wsl2)

const API = (process.env.FLEET_API_URL || 'http://localhost:4000').replace(/\/+$/, '');
const API_KEY = process.env.FLEET_API_KEY || '';
const EMAIL = process.env.FLEET_EMAIL || process.argv[2] || '';
const PASSWORD = process.env.FLEET_PASSWORD || process.argv[3] || '';
const ADB_HOST = process.env.FLEET_ADB_HOST || '127.0.0.1';
const ADB_PORTS = (process.env.FLEET_ADB_PORTS || '5555,5556')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const HOST_NAME = process.env.FLEET_HOST_NAME || 'local-wsl2';

const c = { cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', dim: '\x1b[2m', reset: '\x1b[0m', bold: '\x1b[1m' };
const log = (...a) => console.log(`${c.cyan}[register]${c.reset}`, ...a);
const ok = (...a) => console.log(`${c.green}[ok]${c.reset}`, ...a);
const die = (m) => { console.error(`${c.red}[fail]${c.reset} ${m}`); process.exit(1); };

if (!API_KEY) die('FLEET_API_KEY is required. Create one in the dashboard: Admin → API anahtarları, then export FLEET_API_KEY=...');
if (!EMAIL || !PASSWORD) die('Operator credentials required. Pass them: node register.mjs <email> <password>  (or set FLEET_EMAIL / FLEET_PASSWORD).');
if (ADB_PORTS.length === 0) die('No valid FLEET_ADB_PORTS.');

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'content-type': 'application/json', 'x-api-key': API_KEY };
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch (e) {
    die(`Cannot reach API at ${API} — is it running? (${e.message})`);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    die(`${method} ${path} → ${res.status} ${json?.message || json?.error || JSON.stringify(json)}`);
  }
  return json.data ?? json;
}

async function main() {
  log(`API ${API} · ${ADB_PORTS.length} phone(s) at ${ADB_HOST}:${ADB_PORTS.join('/')}`);

  // 1. Log in for a JWT (host/device writes need api-key + JWT).
  const auth = await api('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  if (auth.twoFactorRequired) die('Account has 2FA enabled — use an operator account without 2FA for the test bootstrap.');
  const token = auth.accessToken;
  if (!token) die('Login succeeded but no accessToken returned.');
  ok(`logged in as ${EMAIL}${auth.workspace ? ` (workspace ${auth.workspace.id})` : ''}`);

  // 2. Register the host (idempotent-ish: reuse one with the same name if present).
  const hosts = await api('/hosts', { token }).catch(() => []);
  let host = Array.isArray(hosts) ? hosts.find((h) => h.name === HOST_NAME) : null;
  let agentKey = null;
  if (host) {
    log(`host "${HOST_NAME}" already exists (${host.id}) — reusing. (agent key was shown only at first creation)`);
  } else {
    host = await api('/hosts', {
      method: 'POST',
      token,
      body: { name: HOST_NAME, address: ADB_HOST, region: 'local', capacity: ADB_PORTS.length, kvm: true }
    });
    agentKey = host.agentKey; // shown exactly once
    ok(`registered host ${host.id}`);
  }

  // 3. Create one device per ADB port and assign it to the host.
  const existing = await api('/devices', { token }).catch(() => []);
  const existingByEndpoint = new Map(
    (Array.isArray(existing) ? existing : []).map((d) => [`${d.ipAddress}:${d.adbPort}`, d])
  );

  const devices = [];
  for (let i = 0; i < ADB_PORTS.length; i++) {
    const port = ADB_PORTS[i];
    const endpoint = `${ADB_HOST}:${port}`;
    let dev = existingByEndpoint.get(endpoint);
    if (dev) {
      log(`device for ${endpoint} exists (${dev.id}) — ensuring host assignment`);
    } else {
      dev = await api('/devices', {
        method: 'POST',
        token,
        body: { name: `Local Phone ${String(i + 1).padStart(2, '0')}`, ipAddress: ADB_HOST, adbPort: port, androidVersion: '13' }
      });
      ok(`created device ${dev.id} → ${endpoint}`);
    }
    // Assign to the host (create endpoint doesn't accept hostId).
    await api(`/devices/${dev.id}`, { method: 'PUT', token, body: { hostId: host.id } });
    devices.push({ ...dev, endpoint });
  }
  ok(`assigned ${devices.length} device(s) to host ${host.name}`);

  // 4. Print the agent run command.
  const wsBase = API.replace(/^http/, 'ws');
  console.log(`\n${c.bold}────────────────────────────────────────────────────────────────${c.reset}`);
  console.log(`${c.green}${c.bold} Phones registered.${c.reset} Start the host agent:\n`);
  if (agentKey) {
    console.log(`${c.dim}# one-time agent key (save it — shown only now):${c.reset}`);
    console.log(
      `FLEET_API_URL=${API} \\\n` +
      `FLEET_API_KEY=${API_KEY} \\\n` +
      `FLEET_HOST_KEY=${agentKey} \\\n` +
      `node deploy/kvm-host/agent/agent.mjs\n`
    );
  } else {
    console.log(`${c.yellow}This host already existed, so its agent key isn't reprintable.${c.reset}`);
    console.log(`If you don't have it saved, delete the host in the dashboard and re-run this script,`);
    console.log(`then use the freshly printed FLEET_HOST_KEY.\n`);
    console.log(`${c.dim}# command (fill in FLEET_HOST_KEY you saved earlier):${c.reset}`);
    console.log(
      `FLEET_API_URL=${API} \\\n` +
      `FLEET_API_KEY=${API_KEY} \\\n` +
      `FLEET_HOST_KEY=<saved-agent-key> \\\n` +
      `node deploy/kvm-host/agent/agent.mjs\n`
    );
  }
  console.log(`${c.dim}Streaming (live screen / wall) needs Node 21+ for the agent. WS base: ${wsBase}${c.reset}`);
  console.log(`${c.dim}Then open the dashboard → Profiller to see "${devices.map((d) => d.name).join(', ')}".${c.reset}`);
  console.log(`${c.bold}────────────────────────────────────────────────────────────────${c.reset}\n`);
}

main();
