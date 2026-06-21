#!/usr/bin/env node
// VPS Fleet — KVM host agent
//
// Runs ON the KVM bare-metal host. It long-polls the control plane for jobs
// targeting cloud phones assigned to THIS host, executes them over local ADB,
// and reports the result back. Zero npm dependencies — Node 18+ built-ins only
// (global fetch + node:child_process).
//
// Required env:
//   FLEET_API_URL   e.g. https://api.your-domain.com   (no trailing slash)
//   FLEET_API_KEY   the platform x-api-key
//   FLEET_HOST_KEY  the one-time agent key shown when the host was registered
//
// Optional env:
//   FLEET_POLL_MS         idle poll interval (default 3000)
//   FLEET_HEARTBEAT_MS    heartbeat interval (default 30000)
//   FLEET_ADB             path to adb binary (default "adb")

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

const API_URL = (process.env.FLEET_API_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.FLEET_API_KEY || '';
const HOST_KEY = process.env.FLEET_HOST_KEY || '';
const POLL_MS = Number(process.env.FLEET_POLL_MS || 3000);
const HEARTBEAT_MS = Number(process.env.FLEET_HEARTBEAT_MS || 30000);
const ADB = process.env.FLEET_ADB || 'adb';
// Live streaming: convert the API URL to its ws(s) origin. Streaming needs the
// global WebSocket client (Node 21+); on older Node it is silently skipped.
const STREAM_URL = API_URL.replace(/^http/, 'ws') + `/ws/agent-stream?key=${encodeURIComponent(HOST_KEY)}`;
const STREAM_DEFAULT_FPS = Number(process.env.FLEET_STREAM_FPS || 12);

if (!API_URL || !API_KEY || !HOST_KEY) {
  console.error('[agent] FLEET_API_URL, FLEET_API_KEY and FLEET_HOST_KEY are all required.');
  process.exit(1);
}

const headers = { 'x-api-key': API_KEY, 'x-agent-key': HOST_KEY, 'content-type': 'application/json' };
const log = (...a) => console.log(`[agent ${new Date().toISOString()}]`, ...a);

// --- ADB helpers ------------------------------------------------------------

async function adb(serial, args) {
  const full = serial ? ['-s', serial, ...args] : args;
  const { stdout } = await execFileAsync(ADB, full, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

async function ensureConnected(serial) {
  // redroid phones are reachable as host:port; connect is idempotent.
  if (serial.includes(':')) {
    try {
      await execFileAsync(ADB, ['connect', serial], { maxBuffer: 1024 * 1024 });
    } catch {
      /* already connected or will surface on the real command */
    }
  }
}

function p(payload, key, fallback) {
  const v = payload[key];
  return v === undefined || v === null ? fallback : v;
}

// Mirrors apps/api processor.ts job handling, executed locally over ADB.
async function runJob(job) {
  const { type, payload, serial } = job;
  if (!serial && type !== 'NOOP') {
    throw new Error('Job targets a device with no ADB endpoint on this host');
  }
  if (serial) await ensureConnected(serial);

  switch (type) {
    case 'EMULATOR_SHELL':
      return { stdout: await adb(serial, ['shell', String(p(payload, 'command', ''))]) };

    case 'EMULATOR_SCREENSHOT': {
      const buf = await execFileAsync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], {
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024
      });
      return { screenshotBase64: buf.stdout.toString('base64') };
    }

    case 'EMULATOR_INSTALL_APK':
    case 'EMULATOR_INSTALL': {
      const apk = String(p(payload, 'apkPath', p(payload, 'apkUrl', '')));
      if (!apk) throw new Error('apkPath/apkUrl is required');
      const local = apk.startsWith('http') ? await download(apk, 'app.apk') : apk;
      try {
        return { stdout: await adb(serial, ['install', '-r', local]) };
      } finally {
        if (apk.startsWith('http')) await safeRm(local);
      }
    }

    case 'EMULATOR_OPEN_APP': {
      const pkg = String(p(payload, 'packageName', ''));
      if (!pkg) throw new Error('packageName is required');
      const activity = p(payload, 'activity', null);
      return { stdout: await launchApp(serial, pkg, activity) };
    }

    case 'EMULATOR_CLOSE_APP':
      return { stdout: await adb(serial, ['shell', 'am', 'force-stop', String(p(payload, 'packageName', ''))]) };

    case 'EMULATOR_PUSH_FILE': {
      const url = String(p(payload, 'url', ''));
      const fileName = String(p(payload, 'fileName', 'file'));
      if (!url) throw new Error('url is required');
      const local = await download(url, fileName);
      const dest =
        p(payload, 'destination', '') === 'downloads'
          ? `/sdcard/Download/${fileName}`
          : `/sdcard/DCIM/${fileName}`;
      try {
        await adb(serial, ['push', local, dest]);
        await adb(serial, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${dest}`]);
        return { dest };
      } finally {
        await safeRm(local);
      }
    }

    case 'EMULATOR_SET_PROXY': {
      const host = String(p(payload, 'host', ''));
      const port = p(payload, 'port', null);
      if (!host || typeof port !== 'number') throw new Error('host and port are required');
      // Per-user setting visible to most apps; cleared with ":0".
      return { stdout: await adb(serial, ['shell', 'settings', 'put', 'global', 'http_proxy', `${host}:${port}`]) };
    }

    case 'EMULATOR_SNAPSHOT_CREATE': {
      // Capture the device's user storage into a tarball on the host. redroid
      // phones are rootable, so we tar /data/media/0 (the real /sdcard) plus the
      // installed-package list. The artifactRef + size are reported back so the
      // control plane can mark the snapshot READY.
      const snapshotId = String(p(payload, 'snapshotId', ''));
      if (!snapshotId) throw new Error('snapshotId is required');
      const dir = await mkdtemp(join(tmpdir(), 'fleet-snap-'));
      const tarPath = join(dir, `${snapshotId}.tar.gz`);
      // Stream a gzipped tar of /sdcard straight off the device to the host file.
      const tarStream = await execFileAsync(
        ADB,
        ['-s', serial, 'exec-out', 'sh', '-c', 'tar czf - -C /sdcard . 2>/dev/null'],
        { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 }
      );
      await writeFile(tarPath, tarStream.stdout);
      const sizeBytes = tarStream.stdout.length;
      return { artifactRef: tarPath, sizeBytes };
    }

    case 'EMULATOR_SNAPSHOT_RESTORE': {
      const artifactRef = String(p(payload, 'artifactRef', ''));
      if (!artifactRef) throw new Error('artifactRef is required');
      const local = artifactRef.startsWith('http') ? await download(artifactRef, 'snap.tar.gz') : artifactRef;
      try {
        // Push the tarball and extract it back into /sdcard on the device.
        const remote = '/data/local/tmp/fleet-restore.tar.gz';
        await adb(serial, ['push', local, remote]);
        await adb(serial, ['shell', 'sh', '-c', `cd /sdcard && tar xzf ${remote} && rm -f ${remote}`]);
        return { restored: true };
      } finally {
        if (artifactRef.startsWith('http')) await safeRm(local);
      }
    }

    case 'EMULATOR_RESET': {
      // "One-click new device": clear launcher/app data so the phone looks fresh.
      // wipeData=false would skip the heavy clears (only reset settings).
      const wipeData = p(payload, 'wipeData', true) !== false;
      if (wipeData) {
        // Best-effort wipe of user media; package data clears would need per-pkg
        // `pm clear`, left to RPA flows for targeted apps.
        await adb(serial, ['shell', 'sh', '-c', 'rm -rf /sdcard/DCIM/* /sdcard/Download/* /sdcard/Pictures/* 2>/dev/null || true']);
      }
      return { reset: true, wiped: wipeData };
    }

    case 'EMULATOR_PULL_FILE': {
      // Pull a file off the device to the host and return where it landed (the
      // control plane can then offer it as a download / store as a library asset).
      const remote = String(p(payload, 'remotePath', ''));
      if (!remote) throw new Error('remotePath is required');
      const dir = await mkdtemp(join(tmpdir(), 'fleet-pull-'));
      const name = remote.split('/').pop() || 'file';
      const local = join(dir, name);
      await adb(serial, ['pull', remote, local]);
      return { localPath: local, fileName: name };
    }

    case 'EMULATOR_CLIPBOARD_SET': {
      // Requires the clipper/automation helper or API 29+. We use the broadcast
      // approach supported by redroid's clipboard service.
      const text = String(p(payload, 'text', ''));
      await adb(serial, ['shell', 'am', 'broadcast', '-a', 'clipper.set', '-e', 'text', text.replace(/ /g, '%s')]);
      return { set: true };
    }

    case 'EMULATOR_CLIPBOARD_GET': {
      const out = await adb(serial, ['shell', 'am', 'broadcast', '-a', 'clipper.get']);
      return { stdout: out };
    }

    case 'RPA_RUN': {
      const steps = Array.isArray(payload.steps) ? payload.steps : [];
      const results = [];
      for (const step of steps) {
        results.push(await runRpaStep(serial, step));
      }
      return { steps: steps.length, results };
    }

    // Lifecycle jobs (create/start/stop/delete) are handled by docker compose on
    // the host, not ADB; acknowledge so the queue advances.
    case 'EMULATOR_CREATE':
    case 'EMULATOR_START':
    case 'EMULATOR_STOP':
    case 'EMULATOR_DELETE':
      return { acknowledged: true, note: 'lifecycle managed by docker compose on host' };

    case 'REGISTER_INSTAGRAM':
      return registerInstagram(serial, payload);

    default:
      throw new Error(`Unsupported job type: ${type}`);
  }
}

// ── Instagram account registration (UIAutomator, element-based) ─────────────
//
// Drives the IG "Sign up with email" flow that was mapped live on a real device.
// Each screen is identified by a stable anchor text/desc; fields are filled by
// their content-desc, buttons tapped by text. The email confirmation code is
// read from the disposable inbox (catchmail) directly — the agent is zero-dep so
// it just uses fetch.
//
// payload: { email, password, fullName, birthYear?, username?, emailDomainBase? }
// Steps that need money / a human (SMS verify, image captcha) are NOT automated
// here — the flow stops and reports which wall it hit so the operator can act.
async function registerInstagram(serial, payload) {
  const IG = 'com.instagram.android';
  const email = String(p(payload, 'email', ''));
  const password = String(p(payload, 'password', ''));
  const fullName = String(p(payload, 'fullName', ''));
  const birthYear = Number(p(payload, 'birthYear', 1995));
  if (!email || !password || !fullName) throw new Error('email, password, fullName gerekli');

  const dump = async () => parseUiNodes(await uiDumpXml(serial));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tapNode = async (n) => { if (n) await adb(serial, ['shell', 'input', 'tap', String(n.cx), String(n.cy)]); };
  const tapBy = async (q, field = 'any') => { const n = findNode(await dump(), q, field); if (!n) throw new Error(`buton yok: ${q}`); await tapNode(n); };
  const typeInto = async (descQ, text) => {
    const n = findNode(await dump(), descQ, 'desc');
    if (!n) throw new Error(`alan yok: ${descQ}`);
    await tapNode(n); await sleep(800);
    await adb(serial, ['shell', 'input', 'text', String(text).replace(/ /g, '%s')]);
  };
  // Wait until a node matching q appears (timeout → throw).
  const waitFor = async (q, ms = 12000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (findNode(await dump(), q, 'any')) return true;
      await sleep(1000);
    }
    throw new Error(`ekran gelmedi: ${q}`);
  };

  // 0) Launch IG fresh.
  await launchApp(serial, IG, null);
  await sleep(8000);

  // 1) Get started → 2) Sign up with email
  const nodes = await dump();
  if (findNode(nodes, 'Get started', 'any')) { await tapBy('Get started'); await sleep(4000); }
  await waitFor('Sign up with email', 12000);
  await tapBy('Sign up with email'); await sleep(3000);

  // 3) Email
  await waitFor("What's your email", 10000);
  await typeInto('Email,', email); await sleep(800);
  await tapBy('Next'); await sleep(4000);

  // 4) Confirmation code — read from catchmail, enter it.
  await waitFor('confirmation code', 15000);
  const code = await fetchEmailCode(email, 90000);
  if (!code) throw new Error('e-posta kodu gelmedi (catchmail)');
  await typeInto('Code input entry field', code); await sleep(1000);
  await tapBy('Next'); await sleep(5000);

  // 5) Password
  await waitFor('Create a password', 12000);
  await typeInto('Password,', password); await sleep(800);
  await tapBy('Next'); await sleep(4000);

  // 6) Birthday — open the date picker, roll the year back to birthYear, SET.
  await waitFor('birthday', 12000);
  // The picker may need to be opened; if a year column is visible, scroll it.
  const yearNode = (await dump()).find((n) => /^(19|20)\d\d$/.test(n.text));
  if (yearNode) {
    const targetBack = Math.max(0, (2025 - birthYear));
    const rolls = Math.ceil(targetBack / 3);
    for (let i = 0; i < rolls + 2; i++) {
      await adb(serial, ['shell', 'input', 'swipe', String(yearNode.cx), String(yearNode.cy - 120), String(yearNode.cx), String(yearNode.cy + 180), '250']);
      await sleep(350);
    }
    await tapBy('SET'); await sleep(1500);
  }
  await tapBy('Next'); await sleep(4000);

  // 7) Full name
  await waitFor("What's your name", 12000);
  await typeInto('Full name,', fullName); await sleep(800);
  await tapBy('Next'); await sleep(4000);

  // 8) Username (IG pre-fills a valid suggestion) → Next
  await waitFor('Create a username', 12000);
  await tapBy('Next'); await sleep(5000);

  // 9) Terms → I agree (this actually creates the account)
  if (findNode(await dump(), 'I agree', 'any')) { await tapBy('I agree'); await sleep(10000); }

  // 10) Post-create walls we DON'T automate (cost / human): SMS verify + captcha.
  const after = await dump();
  const texts = after.map((n) => n.text).filter(Boolean).join(' | ');
  if (/human/i.test(texts)) return { status: 'CAPTCHA_WALL', note: 'IG insan/captcha doğrulaması istedi (manuel/proxy gerekli)', screenTexts: texts.slice(0, 400) };
  if (/mobile number|confirm.*number/i.test(texts)) return { status: 'SMS_WALL', note: 'IG SMS doğrulaması istedi (numara ücreti gerekli)', screenTexts: texts.slice(0, 400) };

  return { status: 'CREATED', note: 'Hesap oluşturuldu', screenTexts: texts.slice(0, 400) };
}

// Poll a catchmail inbox for the latest 4-8 digit verification code.
async function fetchEmailCode(email, timeoutMs) {
  const base = process.env.FLEET_CATCHMAIL_BASE || 'https://api.catchmail.io';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const list = await (await fetch(`${base}/api/v1/mailbox?address=${encodeURIComponent(email)}`)).json();
      const msgs = Array.isArray(list.messages) ? list.messages : [];
      if (msgs.length > 0) {
        // Subject often contains the code ("637598 is your Instagram code").
        const subj = String(msgs[0].subject || '');
        const fromSubj = subj.match(/\b(\d{4,8})\b/);
        if (fromSubj) return fromSubj[1];
        const full = await (await fetch(`${base}/api/v1/message/${encodeURIComponent(msgs[0].id)}?mailbox=${encodeURIComponent(email)}`)).json();
        const body = (full.body && (full.body.text || full.body.html)) || '';
        const m = String(body).match(/\b(\d{4,8})\b/);
        if (m) return m[1];
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 4000));
  }
  return null;
}

// Launch an app reliably. `monkey -c LAUNCHER` is unreliable on redroid (and
// some emulators) — the intent is accepted but the app never comes to the
// foreground. `am start` is reliable; when no explicit activity is given we ask
// the package manager to resolve the launchable activity, then start it.
async function launchApp(serial, pkg, activity) {
  if (!pkg) throw new Error('packageName is required');
  let comp = activity ? `${pkg}/${activity}` : null;
  if (!comp) {
    try {
      const out = await adb(serial, ['shell', 'cmd', 'package', 'resolve-activity', '--brief', pkg]);
      // Last non-empty line is "pkg/activity"; fall back to monkey only if absent.
      const line = out.split('\n').map((s) => s.trim()).filter(Boolean).pop() || '';
      if (line.includes('/')) comp = line.startsWith(`${pkg}/`) ? line : `${pkg}/${line.split('/').pop()}`;
    } catch {
      /* resolver unavailable — handled below */
    }
  }
  if (comp) return adb(serial, ['shell', 'am', 'start', '-n', comp]);
  // Last resort: ask am to start the package's default launcher intent.
  return adb(serial, ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
}

// ── UIAutomator: read the on-screen element tree ────────────────────────────
//
// `uiautomator dump` writes an XML of every visible node (text, content-desc,
// resource-id, clickable, bounds). We parse it with a small regex pass (zero-dep)
// so RPA flows can READ the screen (e.g. pull WhatsApp messages) and act on
// elements BY TEXT instead of fragile fixed coordinates — robust across screen
// sizes and app updates.

// Returns the raw XML of the current screen.
async function uiDumpXml(serial) {
  // Dump to a file then cat it — `dump /dev/tty` is unreliable on some builds.
  await adb(serial, ['shell', 'uiautomator', 'dump', '/sdcard/uidump.xml']).catch(() => undefined);
  return adb(serial, ['shell', 'cat', '/sdcard/uidump.xml']);
}

// Parse the UIAutomator XML into a flat list of nodes we care about.
// Each: { text, desc, resId, clickable, bounds:[x1,y1,x2,y2], cx, cy }.
function parseUiNodes(xml) {
  const nodes = [];
  const attr = (s, name) => {
    const m = s.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : '';
  };
  // Each <node .../> (self-closing) or <node ...> tag carries the attributes.
  const re = /<node\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const a = m[1];
    const bounds = attr(a, 'bounds'); // "[x1,y1][x2,y2]"
    const bm = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!bm) continue;
    const x1 = +bm[1], y1 = +bm[2], x2 = +bm[3], y2 = +bm[4];
    nodes.push({
      text: attr(a, 'text'),
      desc: attr(a, 'content-desc'),
      resId: attr(a, 'resource-id'),
      clickable: attr(a, 'clickable') === 'true',
      bounds: [x1, y1, x2, y2],
      cx: Math.round((x1 + x2) / 2),
      cy: Math.round((y1 + y2) / 2)
    });
  }
  return nodes;
}

// Find a node whose text/desc/resId matches (substring, case-insensitive).
// `field` picks which attribute(s) to match: 'text' | 'desc' | 'id' | 'any'.
function findNode(nodes, query, field = 'any') {
  const q = String(query).toLowerCase();
  const hit = (v) => v && v.toLowerCase().includes(q);
  return nodes.find((n) => {
    if (field === 'text') return hit(n.text);
    if (field === 'desc') return hit(n.desc);
    if (field === 'id') return hit(n.resId);
    return hit(n.text) || hit(n.desc) || hit(n.resId);
  }) || null;
}

async function runRpaStep(serial, step) {
  const type = String(step.type);
  switch (type) {
    case 'tap':
      return adb(serial, ['shell', 'input', 'tap', String(step.x), String(step.y)]);
    case 'swipe':
      return adb(serial, ['shell', 'input', 'swipe', String(step.x), String(step.y), String(step.x2), String(step.y2)]);
    case 'type':
      return adb(serial, ['shell', 'input', 'text', String(step.text ?? '').replace(/ /g, '%s')]);
    case 'keyevent':
      return adb(serial, ['shell', 'input', 'keyevent', String(step.keycode)]);
    case 'openApp':
      return { stdout: await launchApp(serial, String(step.packageName ?? ''), step.activity ?? null) };
    case 'shell':
      return adb(serial, ['shell', String(step.command ?? '')]);
    case 'wait':
      await new Promise((r) => setTimeout(r, Number(step.ms ?? 1000)));
      return { waited: Number(step.ms ?? 1000) };

    // ── UIAutomator element-based steps ──
    case 'uiDump': {
      // READ the screen → return every visible text + content-desc. Used to pull
      // messages / verify state. `texts` is the human-readable content list.
      const xml = await uiDumpXml(serial);
      const nodes = parseUiNodes(xml);
      const texts = nodes.map((n) => n.text).filter(Boolean);
      const descs = nodes.map((n) => n.desc).filter(Boolean);
      return { texts, descs, nodeCount: nodes.length };
    }
    case 'tapText':
    case 'tapDesc':
    case 'tapId': {
      // Tap an element BY content (text / content-desc / resource-id) — finds its
      // centre from the UIAutomator bounds and taps there.
      const field = type === 'tapText' ? 'text' : type === 'tapDesc' ? 'desc' : 'id';
      const query = String(step.query ?? step.text ?? '');
      const xml = await uiDumpXml(serial);
      const node = findNode(parseUiNodes(xml), query, field);
      if (!node) throw new Error(`tap target not found by ${field}: "${query}"`);
      await adb(serial, ['shell', 'input', 'tap', String(node.cx), String(node.cy)]);
      return { tapped: { query, field, at: [node.cx, node.cy] } };
    }
    case 'waitText': {
      // Poll the screen until an element with the given text/desc appears (or
      // timeout). Lets a flow wait for "the chat opened" before typing.
      const query = String(step.query ?? step.text ?? '');
      const timeoutMs = Number(step.timeoutMs ?? 15000);
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const node = findNode(parseUiNodes(await uiDumpXml(serial)), query, 'any');
        if (node) return { found: query, waitedMs: Date.now() - start };
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`waitText timed out for "${query}"`);
    }
    case 'readMessages': {
      // WhatsApp-aware READ: pull message bubbles from the open chat. WhatsApp
      // tags each bubble's text with resource-id .../message_text; fall back to
      // any node under the conversation list when ids differ across versions.
      const xml = await uiDumpXml(serial);
      const nodes = parseUiNodes(xml);
      const bubbles = nodes
        .filter((n) => n.text && (n.resId.includes('message_text') || n.resId.includes('conversation')))
        .map((n) => n.text);
      const messages = bubbles.length > 0 ? bubbles : nodes.map((n) => n.text).filter(Boolean);
      return { messages };
    }

    default:
      throw new Error(`Unknown RPA step: ${type}`);
  }
}

// --- file helpers -----------------------------------------------------------

async function download(url, name) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const dir = await mkdtemp(join(tmpdir(), 'fleet-'));
  const local = join(dir, name);
  await writeFile(local, Buffer.from(await res.arrayBuffer()));
  return local;
}

async function safeRm(path) {
  try {
    await rm(path, { force: true });
  } catch {
    /* ignore */
  }
}

// --- control-plane I/O ------------------------------------------------------

async function api(path, init) {
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${text}`);
  return body;
}

async function claimNext() {
  const { data } = await api('/agent/jobs/next', { method: 'GET' });
  return data; // job or null
}

async function reportComplete(jobId, status, payload) {
  await api(`/agent/jobs/${jobId}/complete`, { method: 'POST', body: JSON.stringify({ status, ...payload }) });
}

async function runningPhoneCount() {
  // Count adb devices that report "device" (not offline/unauthorized).
  try {
    const out = await adb(null, ['devices']);
    return out
      .split('\n')
      .slice(1)
      .filter((l) => /\tdevice\s*$/.test(l.trim() ? `${l.trim()}` : l) || /\sdevice$/.test(l)).length;
  } catch {
    return 0;
  }
}

// Collect per-device CPU / memory / disk usage over ADB. Uses /proc + df (works
// on any Android, redroid included) wrapped in `sh -c` so the parsing happens on
// the host, not in a fragile adb pipe. Each metric is best-effort: a failure on
// one device just omits it. Returns [{ serial, cpuUsage, memoryUsage, diskUsage }].
async function collectDeviceMetrics() {
  const metrics = [];
  let list;
  try {
    list = await adb(null, ['devices']);
  } catch {
    return metrics;
  }
  const serials = list
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /\sdevice$/.test(l))
    .map((l) => l.split(/\s+/)[0]);

  for (const serial of serials) {
    try {
      // memory: MemTotal/MemAvailable from /proc/meminfo
      const mem = await adb(serial, ['shell', 'cat', '/proc/meminfo']);
      const total = Number((mem.match(/MemTotal:\s+(\d+)/) || [])[1] || 0);
      const avail = Number((mem.match(/MemAvailable:\s+(\d+)/) || [])[1] || 0);
      const memoryUsage = total > 0 ? clampPct(((total - avail) / total) * 100) : 0;

      // disk: /data used% via df. `df /data` returns a single filesystem row;
      // its mount label varies on redroid (it may show /storage/.../obb), so we
      // just take the "Use%" column from the first data row rather than matching
      // the mount path.
      let diskUsage = 0;
      try {
        const df = await adb(serial, ['shell', 'df', '/data']);
        const rows = df.split('\n').map((l) => l.trim()).filter(Boolean);
        const dataRow = rows.find((l) => /\d+%/.test(l) && !/^Filesystem/i.test(l)) || '';
        const pct = (dataRow.match(/(\d+)%/) || [])[1];
        if (pct) diskUsage = clampPct(Number(pct));
      } catch { /* df missing — leave 0 */ }

      // cpu: 1 - idle fraction from two /proc/stat samples (~250ms apart)
      let cpuUsage = 0;
      try {
        cpuUsage = await sampleCpu(serial);
      } catch { /* leave 0 */ }

      metrics.push({ serial, cpuUsage, memoryUsage, diskUsage });
    } catch (err) {
      log(`metrics ${serial} failed:`, err.message);
    }
  }
  return metrics;
}

function clampPct(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10));
}

// CPU% from two /proc/stat aggregate samples: busy = total - idle.
async function sampleCpu(serial) {
  const read = async () => {
    const stat = await adb(serial, ['shell', 'cat', '/proc/stat']);
    const cpu = (stat.split('\n')[0] || '').trim().split(/\s+/).slice(1).map(Number);
    if (cpu.length < 5) return null;
    const idle = (cpu[3] || 0) + (cpu[4] || 0); // idle + iowait
    const total = cpu.reduce((a, b) => a + (b || 0), 0);
    return { idle, total };
  };
  const a = await read();
  await new Promise((r) => setTimeout(r, 250));
  const b = await read();
  if (!a || !b) return 0;
  const dt = b.total - a.total;
  const di = b.idle - a.idle;
  if (dt <= 0) return 0;
  return clampPct((1 - di / dt) * 100);
}

async function heartbeat() {
  try {
    const runningPhones = await runningPhoneCount();
    await api('/agent/heartbeat', { method: 'POST', body: JSON.stringify({ runningPhones }) });
    // Per-device metrics are best-effort and reported separately so a slow
    // collection never delays/blocks the host heartbeat itself.
    const devices = await collectDeviceMetrics();
    if (devices.length > 0) {
      await api('/agent/device-metrics', { method: 'POST', body: JSON.stringify({ devices }) }).catch(() => undefined);
    }
  } catch (err) {
    log('heartbeat failed:', err.message);
  }
}

// --- live streaming + remote control ----------------------------------------
//
// The control plane opens a persistent WS we connect to. It sends JSON control
// messages (start/stop capture, inject tap/swipe/key/text). For each watched
// device we run a capture loop (adb exec-out screencap) and push binary frames
// back, framed as "FRM:" + deviceId(36 chars) + image bytes. Viewer fan-out and
// authorization happen on the control plane, so the agent stays dumb + fast.

const FRAME_PREFIX = Buffer.from('FRM:');
const captures = new Map(); // deviceId -> { serial, timer, busy, fps }

function frameDeviceId(id) {
  // Device ids are cuids (~25 chars); pad/truncate to a fixed 36 so the control
  // plane can slice deterministically.
  return id.padEnd(36, ' ').slice(0, 36);
}

async function captureFrame(serial) {
  const { stdout } = await execFileAsync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024
  });
  return stdout;
}

function startCapture(ws, deviceId, serial, fps) {
  stopCapture(deviceId);
  if (!serial) return;
  // Cap at 30fps; capture frames are raw PNG (large), so the real limiter is how
  // fast a frame serializes over the socket, not the timer.
  const interval = Math.max(33, Math.round(1000 / Math.min(30, Math.max(1, fps || STREAM_DEFAULT_FPS))));
  // Drop a frame whenever the socket already has more than ~1.5 frames queued,
  // so a slow/clogged link never builds an ever-growing backlog (which is what
  // pinned the stream at a few fps). bufferedAmount stays bounded → low latency.
  const MAX_BUFFERED = 1_500_000;
  // Connect once up front, not per frame — ensureConnected spawns an `adb connect`
  // child process, which we don't want on every tick at 20fps.
  void ensureConnected(serial);
  const state = { serial, busy: false, timer: null, fps };
  state.timer = setInterval(async () => {
    if (state.busy || ws.readyState !== 1) return;
    if (ws.bufferedAmount > MAX_BUFFERED) return; // backpressure: skip this tick
    state.busy = true;
    try {
      const img = await captureFrame(serial);
      const framed = Buffer.concat([FRAME_PREFIX, Buffer.from(frameDeviceId(deviceId)), img]);
      if (ws.readyState === 1 && ws.bufferedAmount <= MAX_BUFFERED) ws.send(framed);
    } catch {
      /* a dropped frame is fine; next tick retries */
    } finally {
      state.busy = false;
    }
  }, interval);
  captures.set(deviceId, state);
  log(`stream start ${deviceId} @ ${Math.round(1000 / interval)}fps cap`);
}

function stopCapture(deviceId) {
  const s = captures.get(deviceId);
  if (s) {
    clearInterval(s.timer);
    captures.delete(deviceId);
    log(`stream stop ${deviceId}`);
  }
}

async function handleControl(msg) {
  const serial = msg.serial;
  switch (msg.type) {
    case 'stream.start':
      return; // handled by caller (needs ws ref)
    case 'stream.stop':
      stopCapture(msg.deviceId);
      return;
    case 'input.tap':
      if (serial) await adb(serial, ['shell', 'input', 'tap', String(msg.x), String(msg.y)]);
      return;
    case 'input.swipe':
      if (serial) await adb(serial, ['shell', 'input', 'swipe', String(msg.x), String(msg.y), String(msg.x2), String(msg.y2), String(msg.ms || 120)]);
      return;
    case 'input.key':
      if (serial) await adb(serial, ['shell', 'input', 'keyevent', String(msg.keycode)]);
      return;
    case 'input.text':
      if (serial) await adb(serial, ['shell', 'input', 'text', String(msg.text || '').replace(/ /g, '%s')]);
      return;
    default:
      return;
  }
}

function startStreamClient() {
  if (typeof WebSocket === 'undefined') {
    log('streaming disabled: global WebSocket unavailable (needs Node 21+)');
    return;
  }
  let stream;
  const connect = () => {
    if (stopping) return;
    try {
      stream = new WebSocket(STREAM_URL);
    } catch {
      setTimeout(connect, 5000);
      return;
    }
    stream.binaryType = 'arraybuffer';
    stream.onopen = () => log('stream channel connected');
    stream.onmessage = async (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      } catch {
        return;
      }
      if (msg.type === 'stream.start') startCapture(stream, msg.deviceId, msg.serial, msg.fps);
      else await handleControl(msg).catch(() => undefined);
    };
    stream.onclose = () => {
      for (const id of [...captures.keys()]) stopCapture(id);
      if (!stopping) setTimeout(connect, 5000);
    };
    stream.onerror = () => { try { stream.close(); } catch { /* ignore */ } };
  };
  connect();
}

// --- main loop --------------------------------------------------------------

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function loop() {
  log(`starting — polling ${API_URL} every ${POLL_MS}ms`);
  await heartbeat();
  const hb = setInterval(heartbeat, HEARTBEAT_MS);
  startStreamClient();

  while (!stopping) {
    let job = null;
    try {
      job = await claimNext();
    } catch (err) {
      log('claim failed:', err.message);
      await sleep(POLL_MS * 2);
      continue;
    }

    if (!job) {
      await sleep(POLL_MS);
      continue;
    }

    log(`claimed job ${job.id} (${job.type}) -> ${job.serial ?? 'no-serial'}`);
    try {
      const result = await runJob(job);
      await reportComplete(job.id, 'COMPLETED', { result });
      log(`completed ${job.id}`);
    } catch (err) {
      log(`job ${job.id} failed:`, err.message);
      try {
        await reportComplete(job.id, 'FAILED', { error: err.message });
      } catch (reportErr) {
        log('failed to report failure:', reportErr.message);
      }
    }
  }

  clearInterval(hb);
  log('shutting down.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

loop().catch((err) => {
  console.error('[agent] fatal:', err);
  process.exit(1);
});
