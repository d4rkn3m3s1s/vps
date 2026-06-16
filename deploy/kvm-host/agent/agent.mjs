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
      if (activity) return { stdout: await adb(serial, ['shell', 'am', 'start', '-n', `${pkg}/${activity}`]) };
      return { stdout: await adb(serial, ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']) };
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

    default:
      throw new Error(`Unsupported job type: ${type}`);
  }
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
      return adb(serial, ['shell', 'monkey', '-p', String(step.packageName ?? ''), '-c', 'android.intent.category.LAUNCHER', '1']);
    case 'shell':
      return adb(serial, ['shell', String(step.command ?? '')]);
    case 'wait':
      await new Promise((r) => setTimeout(r, Number(step.ms ?? 1000)));
      return { waited: Number(step.ms ?? 1000) };
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

async function heartbeat() {
  try {
    const runningPhones = await runningPhoneCount();
    await api('/agent/heartbeat', { method: 'POST', body: JSON.stringify({ runningPhones }) });
  } catch (err) {
    log('heartbeat failed:', err.message);
  }
}

// --- main loop --------------------------------------------------------------

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function loop() {
  log(`starting — polling ${API_URL} every ${POLL_MS}ms`);
  await heartbeat();
  const hb = setInterval(heartbeat, HEARTBEAT_MS);

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
