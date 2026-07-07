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

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { inflateSync, deflateSync, crc32 } from 'node:zlib';

const execFileAsync = promisify(execFile);

const API_URL = (process.env.FLEET_API_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.FLEET_API_KEY || '';
const HOST_KEY = process.env.FLEET_HOST_KEY || '';
const POLL_MS = Number(process.env.FLEET_POLL_MS || 3000);
const HEARTBEAT_MS = Number(process.env.FLEET_HEARTBEAT_MS || 30000);
const ADB = process.env.FLEET_ADB || 'adb';
// Optional H.264 fast-stream path. When FLEET_FFMPEG points at an ffmpeg binary,
// streaming uses `screenrecord --output-format=h264 | ffmpeg -> mjpeg` instead of
// per-frame PNG screencap (which caps at ~1fps). ffmpeg is an external binary
// (not an npm dep), so the agent stays dependency-free; without it we fall back
// to the PNG path automatically.
const FFMPEG = process.env.FLEET_FFMPEG || '';
const STREAM_W = Number(process.env.FLEET_STREAM_W || 540);   // capture width for h264
const STREAM_BITRATE = process.env.FLEET_STREAM_BITRATE || '4M';
// Live streaming: convert the API URL to its ws(s) origin. Streaming needs the
// global WebSocket client (Node 21+); on older Node it is silently skipped.
const STREAM_URL = API_URL.replace(/^http/, 'ws') + `/ws/agent-stream?key=${encodeURIComponent(HOST_KEY)}`;
const STREAM_DEFAULT_FPS = Number(process.env.FLEET_STREAM_FPS || 12);

// Test mode (FLEET_TEST_JOB) runs a single job locally over ADB and never talks to
// the API, so the API creds are not required there.
if (!process.env.FLEET_TEST_JOB && (!API_URL || !API_KEY || !HOST_KEY)) {
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

// adb with a hard timeout. Some commands (notably `uiautomator dump` on the
// WhatsApp Conversation screen under Waydroid) can HANG indefinitely instead of
// erroring — a plain await never returns and no .catch() fires. This kills the
// child after `ms` and rejects, so callers can fall back. Returns stdout.
async function adbT(serial, args, ms = 12000) {
  const full = serial ? ['-s', serial, ...args] : args;
  const { stdout } = await execFileAsync(ADB, full, { maxBuffer: 64 * 1024 * 1024, timeout: ms, killSignal: 'SIGKILL' });
  return stdout;
}

// Run a shell command as root via Magisk su. Used by the inbound notification
// poll (read-only dumpsys). Returns stdout ('' on failure).
//
// CAVEAT: any redirection (`>`) inside cmd is interpreted by the OUTER adb shell
// (uid shell), not by root, so this is NOT safe for writing to root-owned files.
// The vtouch FIFO write avoids this entirely by making the FIFO world-writable
// (666) so no su is needed — see vtapReal.
async function adbSu(serial, cmd) {
  try {
    return await adb(serial, ['shell', 'su', '-c', cmd]);
  } catch {
    return '';
  }
}

// Wrap an arbitrary string so it survives the DEVICE-side /system/bin/sh re-parse.
// `adb(serial, ['shell', 'input', 'text', s])` looks argv-safe on the host, but
// adbd joins the args and re-parses them through the phone's sh — so a value like
// `a;reboot`, `a$(id)` or `` a`id` `` would EXECUTE on the device. Single-quoting
// (with the classic '\'' escape for embedded quotes) neutralises every shell
// metacharacter; the sh strips the quotes and passes the literal to `input`.
function shArg(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Type free-form text via `input text`, safely. `input` maps %s→space itself, so
// we keep the space→%s substitution, THEN single-quote the result for the device
// shell. Use this everywhere user/remote-controlled text reaches `input text`.
async function inputText(serial, text) {
  const arg = String(text).replace(/ /g, '%s');
  return adb(serial, ['shell', 'input', 'text', shArg(arg)]);
}

// --- Real touch (uinput vtouch) layer ---------------------------------------
//
// WhatsApp (and other hardened apps) reject synthetic `input tap` events. On
// Waydroid we inject a real hardware touchscreen via uinput (the `vtouch`
// device, brought up by /data/adb/wa-bringup.sh) and write "X Y" lines to a
// FIFO to emit genuine ABS_MT touch events. Coordinates from UIAutomator are in
// the Android *logical* space (e.g. 720x1280); vtouch is created in a fixed
// *physical* space (1080x2400), so every tap is rescaled. Devices without
// vtouch fall back to plain `input tap` (backward compatible).
const VT_FIFO = '/data/local/tmp/vt.fifo';
const VT_BRINGUP = '/data/adb/wa-bringup.sh';
// Per-serial cache: { has: bool, phys:{w,h}, logical:{w,h}, ts }
const vtouchCache = new Map();
const VT_CACHE_MS = 60000;

// Detect whether a live vtouch touchscreen node exists and read the logical +
// physical dimensions needed to rescale taps. Cached for VT_CACHE_MS.
async function vtouchInfo(serial) {
  const cached = vtouchCache.get(serial);
  if (cached && Date.now() - cached.ts < VT_CACHE_MS) return cached;
  const info = { has: false, phys: { w: 1080, h: 2400 }, logical: { w: 0, h: 0 }, node: null, ts: Date.now() };
  try {
    // vtouch present in EventHub? Read the whole listing once so we can also learn
    // WHICH /dev/input/eventN node it is (needed for sendevent long-press) and its
    // physical axis ranges. `getevent -pl` prints "add device N: /dev/input/eventN"
    // immediately followed by `  name: "vtouch"`.
    const listing = await adbSu(serial, 'getevent -pl 2>/dev/null');
    info.has = /name:\s*"vtouch"/.test(listing);
    if (info.has) {
      // The node whose block contains name "vtouch". Split on "add device" blocks.
      for (const block of String(listing).split(/add device \d+:/)) {
        if (!/name:\s*"vtouch"/.test(block)) continue;
        const dev = /(\/dev\/input\/event\d+)/.exec(block);
        if (dev) info.node = dev[1];
        const mx = /ABS_MT_POSITION_X[^\n]*max (\d+)/.exec(block);
        const my = /ABS_MT_POSITION_Y[^\n]*max (\d+)/.exec(block);
        if (mx) info.phys.w = Number(mx[1]) || info.phys.w;
        if (my) info.phys.h = Number(my[1]) || info.phys.h;
        break;
      }
    }
    // Android logical size. Prefer "Override size" (the space the UI lays out
    // against) over "Physical size" — mixing them mis-scales taps.
    const wm = await adb(serial, ['shell', 'wm', 'size']);
    const ov = /Override size:\s*(\d+)x(\d+)/.exec(wm);
    const ph = /Physical size:\s*(\d+)x(\d+)/.exec(wm);
    const m = ov || ph || /(\d+)x(\d+)/.exec(wm);
    if (m) { info.logical.w = Number(m[1]); info.logical.h = Number(m[2]); }
  } catch {
    /* leave defaults; has stays false on error */
  }
  vtouchCache.set(serial, info);
  return info;
}

// If the device supports root+vtouch but the node is currently missing (after a
// reboot / `stop && start`), re-run the idempotent bring-up script to restore
// the touchscreen + integrity spoof. Cheap no-op when already up.
async function ensureVtouch(serial) {
  const info = await vtouchInfo(serial);
  if (info.has) return true;
  // Only try to heal on rooted devices that actually have the bring-up script.
  const hasScript = (await adbSu(serial, `[ -f ${VT_BRINGUP} ] && echo yes`)).includes('yes');
  if (!hasScript) return false;
  await adbSu(serial, `sh ${VT_BRINGUP}`);
  vtouchCache.delete(serial);
  const after = await vtouchInfo(serial);
  return after.has;
}

// Emit a real touch at Android-logical (ax, ay) via vtouch, rescaling to the
// physical uinput space. Returns true if the real-touch path was used.
async function vtapReal(serial, ax, ay) {
  const info = await vtouchInfo(serial);
  if (!info.has) return false;
  const lw = info.logical.w || 720, lh = info.logical.h || 1280;
  const vx = Math.round((Number(ax) / lw) * info.phys.w);
  const vy = Math.round((Number(ay) / lh) * info.phys.h);
  // Write the coordinate to the vtouch FIFO. The FIFO is world-writable (666,
  // set by wa-bringup.sh), so we write as the plain adb shell user — NOT via
  // `su -c "... > fifo"`, whose redirect runs as uid shell and hits EACCES on the
  // root-owned pipe. This bug made every real-touch tap a silent no-op.
  try {
    await adb(serial, ['shell', 'echo', String(vx), String(vy), '>', VT_FIFO]);
  } catch {
    // Fallback: FIFO not yet world-writable — fix perms via su, then retry once.
    await adbSu(serial, `chmod 666 ${VT_FIFO}`);
    await adb(serial, ['shell', 'echo', String(vx), String(vy), '>', VT_FIFO]).catch(() => undefined);
  }
  return true;
}

// Unified tap: real touch when vtouch is present, else synthetic input tap.
async function tapReal(serial, ax, ay) {
  if (await vtapReal(serial, ax, ay)) return;
  await adb(serial, ['shell', 'input', 'tap', String(ax), String(ay)]);
}

// Real LONG-PRESS at Android-logical (ax, ay). WhatsApp's message context menu
// (Reply/Delete/Forward) only opens on a genuine long-press — `input swipe x y x y
// 800` is NOT recognised on this Waydroid device (VERIFIED). We drive the vtouch
// uinput node directly with a Multi-Touch-protocol-B down/hold/up sequence via
// `sendevent`. TOUCH_MAJOR + PRESSURE are required — without them the press is
// ignored (VERIFIED). Returns true if the real long-press path was used.
//   Event codes: EV_ABS=3 (SLOT=47, TRACKING_ID=57, TOUCH_MAJOR=48, PRESSURE=58,
//   POSITION_X=53, POSITION_Y=54), EV_KEY=1 (BTN_TOUCH=330), EV_SYN=0 (SYN_REPORT=0).
async function longPressReal(serial, ax, ay, holdMs = 750) {
  const info = await vtouchInfo(serial);
  if (!info.has || !info.node) {
    // Fallback: synthetic swipe with a long duration (best-effort on non-vtouch).
    await adb(serial, ['shell', 'input', 'swipe', String(ax), String(ay), String(ax), String(ay), String(holdMs)]).catch(() => undefined);
    return false;
  }
  const lw = info.logical.w || 1080, lh = info.logical.h || 2400;
  const vx = Math.round((Number(ax) / lw) * info.phys.w);
  const vy = Math.round((Number(ay) / lh) * info.phys.h);
  const E = info.node;
  const down = [
    `sendevent ${E} 3 47 0`,     // ABS_MT_SLOT 0
    `sendevent ${E} 3 57 700`,   // ABS_MT_TRACKING_ID
    `sendevent ${E} 3 48 6`,     // ABS_MT_TOUCH_MAJOR
    `sendevent ${E} 3 58 60`,    // ABS_MT_PRESSURE
    `sendevent ${E} 3 53 ${vx}`, // ABS_MT_POSITION_X
    `sendevent ${E} 3 54 ${vy}`, // ABS_MT_POSITION_Y
    `sendevent ${E} 1 330 1`,    // BTN_TOUCH down
    `sendevent ${E} 0 0 0`,      // SYN_REPORT
  ].join('; ');
  const up = [
    `sendevent ${E} 3 57 4294967295`, // ABS_MT_TRACKING_ID = -1 (lift)
    `sendevent ${E} 1 330 0`,         // BTN_TOUCH up
    `sendevent ${E} 0 0 0`,           // SYN_REPORT
  ].join('; ');
  await adbSu(serial, down);
  await new Promise((r) => setTimeout(r, holdMs));
  await adbSu(serial, up);
  return true;
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
  // PROVISION_DEVICE builds a BRAND-NEW instance, so it has no ADB serial yet —
  // it derives its own serial from the provisioning script's output. Exempt it
  // from the "must have an endpoint" guard.
  if (!serial && type !== 'NOOP' && type !== 'PROVISION_DEVICE') {
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
      // Single-quote for the device sh (the value is user-controlled) — %s keeps
      // spaces as clipper expects them.
      await adb(serial, ['shell', 'am', 'broadcast', '-a', 'clipper.set', '-e', 'text', shArg(text.replace(/ /g, '%s'))]);
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

    case 'REGISTER_WHATSAPP':
      return registerWhatsApp(serial, payload);

    case 'WHATSAPP_SEND':
      return whatsappSend(serial, payload);

    case 'WHATSAPP_READ':
      return whatsappRead(serial, payload);

    case 'WHATSAPP_PROFILE':
      return whatsappProfile(serial, payload);

    case 'WHATSAPP_BLOCK':
      return whatsappBlock(serial, payload);

    case 'WHATSAPP_BLOCKLIST':
      return whatsappBlocklist(serial, payload);

    case 'WHATSAPP_MYNUMBER':
      return whatsappMyNumber(serial, payload);

    case 'WHATSAPP_SEND_MEDIA':
      return whatsappSendMedia(serial, payload);

    case 'WHATSAPP_DELETE_MSG':
      return whatsappDeleteMsg(serial, payload);

    case 'WHATSAPP_CLEAR_CHAT':
      return whatsappClearChat(serial, payload);

    case 'APP_EXPLORE':
      return exploreApp(serial, payload);

    case 'APPLY_FINGERPRINT':
      return applyFingerprint(serial, payload);

    case 'PROVISION_INTEGRITY':
      return provisionIntegrity(serial, payload);

    case 'PROVISION_DEVICE':
      return provisionDevice(job);

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
    await inputText(serial, text);
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

// ── Shared UIAutomator action helpers, bound to one device serial ────────────
//
// These wrap the parse/find primitives into the small vocabulary every
// element-based flow needs (dump, tap-by-content, type-into-field, wait-for).
// registerWhatsApp / whatsappSend / whatsappRead all build on this.
function waHelpers(serial) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dump = async () => parseUiNodes(await uiDumpXml(serial));
  // Real touch (uinput vtouch) when available, else synthetic input tap. This
  // is the single tap primitive every WA flow (register/send/read) routes
  // through, so all of them get genuine touch events on hardened apps.
  const tapNode = async (n) => { if (n) await tapReal(serial, n.cx, n.cy); };
  // Tap at raw Android-logical coordinates (for buttons found outside the node
  // model, e.g. by screenshot inspection).
  const tapXY = async (x, y) => tapReal(serial, x, y);
  const find = async (q, field = 'any') => findNode(await dump(), q, field);
  // Whether ADBKeyboard is the active IME (set by ensureAdbKeyboard). When true,
  // typeText/clearField inject via its broadcast instead of `input text`.
  let adbKeyboardActive = false;
  // Make ADBKeyboard the default IME if it's installed (it injects text reliably
  // on redroid where `input text` is dropped). No-op if the IME isn't present.
  const ensureAdbKeyboard = async () => {
    // Cache across calls (module-level adbKbReady, per serial): once ADBKeyboard
    // is the default IME on a device it stays set, so re-running `ime list/enable/
    // set` (3 slow ADB round-trips) on EVERY send/read was pure latency. Skip it
    // when already established for this serial.
    if (adbKbReady.has(serial)) { adbKeyboardActive = true; return true; }
    try {
      const imes = await adb(serial, ['shell', 'ime', 'list', '-a', '-s']);
      if (!imes.includes('adbkeyboard')) { adbKeyboardActive = false; return false; }
      await adb(serial, ['shell', 'ime', 'enable', ADB_IME]);
      await adb(serial, ['shell', 'ime', 'set', ADB_IME]);
      adbKeyboardActive = true;
      adbKbReady.add(serial);
      return true;
    } catch { adbKeyboardActive = false; return false; }
  };
  // Tap the first element matching q (by text/desc/id). Throws if absent.
  const tapBy = async (q, field = 'any') => {
    const n = findNode(await dump(), q, field);
    if (!n) throw new Error(`buton yok: ${q}`);
    await tapNode(n);
  };
  // Tap q only if present; returns whether it was found.
  const tapIf = async (q, field = 'any') => {
    const n = findNode(await dump(), q, field);
    if (n) { await tapNode(n); return true; }
    return false;
  };
  // Type text into the currently-focused field. On redroid / custom ROMs the
  // plain `input text` IME path is unreliable, so prefer ADBKeyboard's
  // `ADB_INPUT_TEXT` broadcast (injects via a real IME) when it's the default
  // keyboard; fall back to `input text` otherwise.
  const typeText = async (text) => {
    const s = String(text);
    if (adbKeyboardActive) {
      await adb(serial, ['shell', 'am', 'broadcast', '-a', 'ADB_INPUT_TEXT', '--es', 'msg', shArg(s)]);
    } else {
      await inputText(serial, s);
    }
  };
  const clearField = async () => {
    if (adbKeyboardActive) { await adb(serial, ['shell', 'am', 'broadcast', '-a', 'ADB_CLEAR_TEXT']); return; }
    await adb(serial, ['shell', 'input', 'keyevent', '123']); // move-end
    for (let i = 0; i < 24; i++) await adb(serial, ['shell', 'input', 'keyevent', '67']); // del
  };
  // Focus a field (by text/desc/id) and type into it.
  const typeInto = async (q, text, field = 'any') => {
    const n = findNode(await dump(), q, field);
    if (!n) throw new Error(`alan yok: ${q}`);
    await tapNode(n); await sleep(600);
    await typeText(text);
  };
  // Tap an element by resource-id (most stable across app updates/locales).
  const tapById = async (resId) => {
    const n = findNode(await dump(), resId, 'id');
    if (!n) throw new Error(`id yok: ${resId}`);
    await tapNode(n);
  };
  // Focus a field by resource-id and type into it. `clear` first wipes any
  // pre-filled value.
  const typeIntoId = async (resId, text, clear = false) => {
    const n = findNode(await dump(), resId, 'id');
    if (!n) throw new Error(`id yok: ${resId}`);
    await tapNode(n); await sleep(400);
    if (clear) await clearField();
    await typeText(text);
  };
  // Wait until an element matching q appears (timeout → throw). The dump itself
  // takes ~1-2s, so a short inter-dump gap (500ms) keeps us responsive without
  // hammering — the target is usually present on the FIRST dump anyway.
  const waitFor = async (q, ms = 15000, field = 'any') => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (findNode(await dump(), q, field)) return true;
      await sleep(500);
    }
    throw new Error(`ekran gelmedi: ${q}`);
  };
  // Like waitFor but returns boolean instead of throwing (for optional screens).
  const seen = async (q, ms = 6000, field = 'any') => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (findNode(await dump(), q, field)) return true;
      await sleep(400);
    }
    return false;
  };
  // Flatten all visible text on screen (for wall detection / debugging).
  const screenText = async () => (await dump()).map((n) => n.text).filter(Boolean).join(' | ');
  // Ensure the real-touch layer is up before a flow starts (heals after reboot).
  const ensureTouch = async () => ensureVtouch(serial);
  // Real long-press at logical coords (opens WhatsApp message context menu).
  const longPress = async (x, y, ms = 750) => longPressReal(serial, x, y, ms);
  // Long-press a node (its center).
  const longPressNode = async (n, ms = 750) => { if (n) await longPressReal(serial, n.cx, n.cy, ms); };
  // Synthetic `input tap` (NOT vtouch). WhatsApp's overflow PopupWindow and its
  // Settings sub-screens open reliably with a synthetic tap but NOT with the vtouch
  // FIFO tap — the vtouch press opens then instantly dismisses the popup (VERIFIED
  // with screenshots: input tap → menu stays open; vtouch tap → menu never shows).
  // Long-press still needs vtouch; taps on menus need synthetic. Keep them separate.
  const tapSyn = async (x, y) => { await adb(serial, ['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]); };
  // Tap a node's center with a synthetic tap. Returns whether the node was truthy.
  const tapSynNode = async (n) => { if (!n) return false; await tapSyn(n.cx, n.cy); return true; };
  // Synthetic-tap the first node matching q; returns whether it was found.
  const tapSynIf = async (q, field = 'any') => {
    const n = findNode(await dump(), q, field);
    if (n) { await tapSyn(n.cx, n.cy); return true; }
    return false;
  };
  // Poll until a node matching q appears, returning it (or null on timeout). Unlike
  // waitFor/seen this RETURNS the node so callers can act on its live coordinates.
  const pollNode = async (q, ms = 8000, field = 'any') => {
    const start = Date.now();
    for (;;) {
      const n = findNode(await dump(), q, field);
      if (n) return n;
      if (Date.now() - start >= ms) return null;
      await sleep(400); // short gap; the dump itself already costs ~1-2s
    }
  };
  return { sleep, dump, tapNode, tapXY, find, tapBy, tapIf, typeInto, tapById, typeIntoId, typeText, clearField, ensureAdbKeyboard, ensureTouch, waitFor, seen, screenText, longPress, longPressNode, pollNode, tapSyn, tapSynNode, tapSynIf };
}

const WA_PKG = 'com.whatsapp';
const ADB_IME = 'com.android.adbkeyboard/.AdbIME';

// Split an E.164-ish number ("+905551234567" / "905551234567") into a country
// calling-code and the local part WhatsApp's two fields expect. We match the
// longest known calling code prefix; unknown prefixes fall back to a 1–3 digit
// best guess (most CCs are 1–3 digits).
const CALLING_CODES = ['1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98', '211', '212', '213', '216', '218', '220', '221', '223', '225', '226', '229', '233', '234', '237', '243', '244', '249', '250', '251', '254', '255', '256', '260', '263', '264', '297', '299', '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373', '374', '375', '376', '377', '378', '380', '381', '382', '383', '385', '386', '387', '389', '420', '421', '423', '501', '502', '503', '504', '505', '506', '507', '509', '591', '592', '593', '595', '598', '673', '852', '853', '855', '856', '870', '880', '886', '960', '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973', '974', '975', '976', '977', '992', '993', '994', '995', '996', '998'];
function splitE164(raw) {
  const digits = String(raw).replace(/[^\d]/g, '');
  // Longest matching calling code wins (e.g. 90 before 9).
  const match = CALLING_CODES
    .filter((c) => digits.startsWith(c))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return { cc: match, local: digits.slice(match.length) };
  // Fallback for an unlisted prefix. Real calling codes are 1–3 digits and the
  // ITU numbering ZONE is set by the leading digit: zones 1 (NANP) and 7 (Russia/
  // Kazakhstan) are the only single-digit codes; every other zone (2–6, 8, 9) uses
  // 2- or 3-digit codes, and since the list above already covers the common 2-digit
  // ones, an unlisted prefix is far more likely a 3-digit code — so guess 3 there.
  // (The old fixed 2-digit split silently mangled 3-digit-CC numbers.)
  const lead = digits[0];
  if (lead === '1' || lead === '7') return { cc: lead, local: digits.slice(1) };
  const width = digits.length > 3 ? 3 : Math.min(2, digits.length);
  return { cc: digits.slice(0, width), local: digits.slice(width) };
}

// ── WhatsApp account registration (UIAutomator, element-based) ───────────────
//
// Drives the WhatsApp first-run signup, which is PHONE-NUMBER based (no email):
//   EULA → permissions → country+number → confirm → SMS OTP → profile name.
//
// The OTP is NOT read by the agent — WhatsApp texts it to the rented number held
// by the SMS provider (sms-bus). The control plane polls that provider and either
// (a) passes the code in the payload as `otpCode`, or (b) we wait for it to be
// pushed. To keep the agent zero-dep and stateless, the OTP must be supplied:
// payload carries { phoneNumber, otpCode?, fullName, countryCode? }. If otpCode
// is absent we stop at OTP_WAIT so the control plane can re-dispatch with it.
//
// WhatsApp runs hard device-integrity checks; on x86 emulators it frequently
// shows "your phone number has been banned" / "couldn't verify". We DON'T fight
// that — we detect the wall and report it so the operator can switch to a real
// ARM device. The happy path is verified on real devices.
//
// payload: { phoneNumber, fullName, otpCode?, countryCode?, apkUrl? }
async function registerWhatsApp(serial, payload) {
  const phoneNumber = String(p(payload, 'phoneNumber', '')).trim();
  const fullName = String(p(payload, 'fullName', '')).trim();
  const otpCode = String(p(payload, 'otpCode', '')).trim();
  const apkUrl = p(payload, 'apkUrl', '');
  if (!phoneNumber) throw new Error('phoneNumber gerekli');
  if (!fullName) throw new Error('fullName gerekli');

  const h = waHelpers(serial);

  // 0) Ensure WhatsApp is installed; optionally side-load from apkUrl.
  const installed = (await adb(serial, ['shell', 'pm', 'list', 'packages', WA_PKG]))
    .includes(WA_PKG);
  if (!installed) {
    if (!apkUrl) return { status: 'NOT_INSTALLED', note: 'WhatsApp kurulu değil ve apkUrl verilmedi' };
    const local = await download(String(apkUrl), 'whatsapp.apk');
    try { await adb(serial, ['install', '-r', '-g', local]); } finally { await safeRm(local); }
  }

  // The signup screen sequence below was mapped LIVE on a real device (WhatsApp
  // 2.25.x). resource-ids are stable across locales, so we drive fields by id.

  // 0b) Pre-grant runtime permissions so the "Allow notifications/contacts"
  //     dialogs never pop up mid-flow (they overlay registration_phone and
  //     stall the run). pm grant is a no-op if already granted or not declared.
  for (const perm of [
    'android.permission.POST_NOTIFICATIONS', 'android.permission.READ_CONTACTS',
    'android.permission.WRITE_CONTACTS', 'android.permission.GET_ACCOUNTS',
    'android.permission.READ_PHONE_STATE', 'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO'
  ]) {
    await adb(serial, ['shell', 'pm', 'grant', WA_PKG, perm]).catch(() => undefined);
  }

  // 0c) Prefer ADBKeyboard for text entry — on redroid the stock IME drops
  //     `input text` into WhatsApp's fields, so number entry silently fails.
  await h.ensureAdbKeyboard();

  // 1) Launch fresh.
  await launchApp(serial, WA_PKG, null);
  await h.sleep(8000);

  // 2) Custom-ROM / emulator alert ("...unsupported... OK"). Dismiss if shown.
  //    This is an AlertDialog — its buttons need a SYNTHETIC tap. A vtouch FIFO
  //    tap opens-then-instantly-dismisses dialogs/popups (VERIFIED), so the OK
  //    press was a silent no-op and the alert stayed up, blocking EULA (which
  //    made registration_phone never appear). tapSynIf drives it correctly.
  //    Loop a couple of times in case the alert re-renders after the first tap.
  for (let i = 0; i < 3; i++) {
    if (await h.seen('custom ROM', i === 0 ? 6000 : 800) || await h.seen('Alert', 600)) {
      if (!(await h.tapSynIf('OK'))) await h.tapSynIf('OK', 'text');
      await h.sleep(1500);
    } else break;
  }

  // 3) EULA — the button is "AGREE AND CONTINUE" (caps). Try both casings.
  //    Not a dialog, but drive it with a synthetic tap too for consistency and
  //    because the button sits on the same volatile first-run surface.
  if (await h.seen('AGREE AND CONTINUE', 12000)) { await h.tapSynIf('AGREE AND CONTINUE') || await h.tapBy('AGREE AND CONTINUE'); await h.sleep(4000); }
  else if (await h.seen('Agree and continue', 2000)) { await h.tapSynIf('Agree and continue') || await h.tapBy('Agree and continue'); await h.sleep(4000); }

  // 4) Modern WhatsApp opens the "Link as companion device" (QR) screen by
  //    default. New-number signup lives behind the overflow menu:
  //    ⋮ (More options) → "Register new account".
  //    The ⋮ opens a PopupWindow and its items are menu entries — BOTH need a
  //    SYNTHETIC tap (a vtouch FIFO tap opens-then-instantly-closes the popup,
  //    VERIFIED). Retry the whole open→pick a few times: the popup sometimes
  //    fails to render on the first tap on this Waydroid build.
  if (await h.seen('companion device', 8000) || await h.seen('Link a device', 2000) || await h.seen('Link as companion', 1000)) {
    for (let attempt = 0; attempt < 4; attempt++) {
      // open the overflow menu (synthetic — vtouch dismisses popups)
      if (!(await h.tapSynIf('More options', 'desc'))) {
        // fall back to the top-right ⋮ position if the desc node isn't found
        await h.tapSyn(688, 64).catch(() => undefined);
      }
      await h.sleep(1500);
      // pick "Register new account" (menu item → synthetic). Match loosely.
      const picked = (await h.tapSynIf('Register new account'))
        || (await h.tapSynIf('Register', 'text'))
        || (await h.tapSynIf('Use a different number'));
      await h.sleep(3000);
      // done once we've left the companion screen
      if (picked && !(await h.seen('companion device', 1500) || await h.seen('Link as companion', 800))) break;
    }
  }

  // 5) Phone-number screen. Fields by resource-id:
  //    registration_cc = country-code box, registration_phone = number box.
  //    We split the E.164 number into CC + local part. The agent receives the
  //    number with a leading country code (e.g. "905551234567" or "+905551234567").
  //
  // Modern WhatsApp pops a runtime "Allow WhatsApp to send you notifications?"
  // permission dialog (package com.android.permissioncontroller) that overlays
  // the phone screen and HIDES registration_phone — so we must dismiss it BEFORE
  // waiting for the field. The button is "ALLOW" (caps) with resource-id
  // permission_allow_button. Loop a few times since up to 2 perm dialogs can
  // stack (notifications, then contacts).
  for (let i = 0; i < 3; i++) {
    const granted = await h.tapById('com.android.permissioncontroller:id/permission_allow_button').then(() => true).catch(() => false)
      || await h.tapIf('ALLOW') || await h.tapIf('Allow') || await h.tapIf('While using the app') || await h.tapIf('Continue');
    if (!granted) break;
    await h.sleep(1200);
  }

  // On Play-Services emulators/devices, Google pops a "Choose a phone number"
  // bottom-sheet (com.google.android.gms PhoneNumberHintActivity) that OVERLAYS
  // and hides registration_phone — the agent then can't find the field. Dismiss
  // it: BACK closes the sheet; a couple of attempts in case it re-appears.
  for (let i = 0; i < 3; i++) {
    const focus = await adb(serial, ['shell', 'dumpsys', 'window']).catch(() => '');
    if (/PhoneNumberHint|assistedsignin|credentials\.assistedsignin/i.test(focus)) {
      await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
      await h.sleep(1200);
    } else break;
  }

  await h.waitFor('com.whatsapp:id/registration_phone', 20000, 'id').catch(() => undefined);
  // One more sweep in case a permission dialog appeared after the field loaded.
  await h.tapById('com.android.permissioncontroller:id/permission_allow_button').catch(() => undefined);
  // And in case the Google number-hint sheet appeared late, dismiss it again.
  {
    const focus = await adb(serial, ['shell', 'dumpsys', 'window']).catch(() => '');
    if (/PhoneNumberHint|assistedsignin/i.test(focus)) { await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined); await h.sleep(1000); }
  }
  const { cc, local } = splitE164(phoneNumber);
  const localDigits = local.replace(/\D/g, '');
  // VERIFIED on this build: registration_cc and registration_phone are plain
  // EditTexts. A synthetic `input tap` on the field centre + the stock IME's
  // `input text` fills them reliably (vtouch / ADBKeyboard did NOT focus them).
  // Typing the calling code into registration_cc auto-selects the country
  // ("355" → Albania), so we DON'T need the country picker at all.
  // Switch to the stock IME for `input text` (ADBKeyboard broadcast doesn't land
  // in these fields on this build).
  await adb(serial, ['shell', 'ime', 'set', 'com.android.inputmethod.latin/.LatinIME']).catch(() => undefined);
  await h.sleep(600);
  const ccOf = async () => {
    const n = await h.find('com.whatsapp:id/registration_cc', 'id');
    return (n && n.text ? n.text : '').replace(/\D/g, '');
  };
  const phoneOf = async () => {
    const n = await h.find('com.whatsapp:id/registration_phone', 'id');
    return (n && n.text ? n.text : '').replace(/\D/g, '');
  };
  // Fill country code (auto-selects country) — synthetic tap + input text.
  for (let attempt = 0; attempt < 3 && (await ccOf()) !== cc; attempt++) {
    const n = await h.find('com.whatsapp:id/registration_cc', 'id');
    if (n) await h.tapSyn(n.cx, n.cy);
    await h.sleep(600);
    await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']).catch(() => undefined);
    for (let i = 0; i < 6; i++) await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_DEL']).catch(() => undefined);
    await adb(serial, ['shell', 'input', 'text', cc]).catch(() => undefined);
    await h.sleep(1200);
  }
  // Fill phone number — synthetic tap + input text, verify digits land.
  let numberEntered = false;
  for (let attempt = 0; attempt < 4 && !numberEntered; attempt++) {
    const n = await h.find('com.whatsapp:id/registration_phone', 'id');
    if (n) await h.tapSyn(n.cx, n.cy);
    await h.sleep(600);
    await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']).catch(() => undefined);
    for (let i = 0; i < 15; i++) await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_DEL']).catch(() => undefined);
    await adb(serial, ['shell', 'input', 'text', localDigits]).catch(() => undefined);
    await h.sleep(1000);
    const got = await phoneOf();
    if (got && got.length >= Math.min(6, localDigits.length)) { numberEntered = true; break; }
  }
  if (!numberEntered) {
    const ccNow = await ccOf();
    return { status: 'NUMBER_ENTRY_FAILED', note: `Numara alani dolmadi (cc=${ccNow || '?'}, phone bos)`, phoneNumber };
  }
  await h.sleep(400);
  // Submit (registration_submit), with a text fallback.
  await h.tapById('com.whatsapp:id/registration_submit').catch(async () => { await h.tapBy('NEXT').catch(() => undefined); });
  await h.sleep(2500);

  // 6) Confirmation dialog ("You entered the phone number ... Is this OK?").
  //    AlertDialog → synthetic tap (vtouch dismisses dialogs — see step 2).
  if (await h.seen('OK', 6000)) { (await h.tapSynIf('OK')) || (await h.tapBy('OK').catch(() => undefined)); await h.sleep(5000); }

  // 7) Device-integrity / ban walls — bail with a clear status.
  const wall = await h.screenText();
  if (/banned|can.?t use whatsapp|couldn.?t (verify|connect)|not allowed|too many|try again/i.test(wall)) {
    return { status: 'DEVICE_WALL', note: 'WhatsApp cihazı/numarayı reddetti (emülatör/ban) — gerçek ARM cihaz gerekli', screenTexts: wall.slice(0, 400) };
  }

  // 8) OTP. WhatsApp shows a 6-digit code entry. VERIFY we actually reached the
  //    verification screen before claiming OTP_WAIT — otherwise a stalled number
  //    screen would falsely report "SMS sent" when WhatsApp never sent one.
  const onOtp = (await h.seen('digit code', 30000))
    || (await h.seen('Verifying your number', 1500))
    || (await h.seen('Enter the 6-digit code', 1500))
    || (await h.seen('Verify', 1500))
    || (await h.find('com.whatsapp:id/verify_sms_code_input', 'id')) != null
    || (await h.find('com.whatsapp:id/registration_verify', 'id')) != null;
  if (!onOtp) {
    const st = (await h.screenText()).slice(0, 400);
    return { status: 'OTP_SCREEN_NOT_REACHED', note: 'Doğrulama ekranına ulaşılamadı — numara gönderimi başarısız olabilir', phoneNumber, screenTexts: st };
  }
  if (!otpCode) {
    return { status: 'OTP_WAIT', note: 'SMS kodu bekleniyor — kod gelince otpCode ile tekrar gönderin', phoneNumber };
  }
  // The code field is usually a single focusable entry; type the digits.
  await typeOtp(serial, h, otpCode);
  await h.sleep(5000);

  // 7) Some flows re-show a wall after a bad/late code.
  const afterOtp = await h.screenText();
  if (/(invalid|wrong|incorrect).*code|try again later/i.test(afterOtp)) {
    return { status: 'OTP_REJECTED', note: 'SMS kodu reddedildi', screenTexts: afterOtp.slice(0, 400) };
  }

  // 8) Profile name → finish. (Restore-backup prompt may appear; skip it.)
  await h.tapIf('Skip'); await h.tapIf('SKIP');
  if (await h.seen('your name', 12000) || await h.seen('Profile info', 4000)) {
    await h.typeInto('Type your name here', fullName).catch(async () => {
      // Fallback: tap the first EditText-like node and type.
      await h.typeInto('name', fullName);
    });
    await h.sleep(600);
    await h.tapBy('Next'); await h.sleep(5000);
  }

  const done = await h.screenText();
  return { status: 'CREATED', note: 'WhatsApp hesabı oluşturuldu', phoneNumber, screenTexts: done.slice(0, 400) };
}

// Type a 6-digit OTP, robust to either one combined field or six single-digit
// boxes. We focus the first entry, then type digit-by-digit (input text moves
// focus automatically in the six-box layout).
async function typeOtp(serial, h, code) {
  const digits = String(code).replace(/\D/g, '');
  const field = await h.find('digit code', 'any') || await h.find('code', 'any');
  if (field) await h.tapNode(field);
  await h.sleep(400);
  await adb(serial, ['shell', 'input', 'text', digits]);
}

// Dismiss the modal dialogs WhatsApp shows on emulators/custom ROMs that block
// the chat UI (e.g. "You have a custom ROM installed … OK"). The OK button is a
// real Button node; tap it by text. Safe no-op if no dialog is present.
async function dismissBlockingDialogs(serial, h) {
  for (let i = 0; i < 3; i++) {
    const nodes = await h.dump();
    const hasAlert = nodes.some((n) => /custom ROM|unsupported|Alert/i.test(n.text || ''));
    if (!hasAlert) return;
    // Prefer a clickable OK/CONTINUE button node.
    const btn = nodes.find((n) => n.clickable && /^(OK|CONTINUE|GOT IT)$/i.test((n.text || '').trim()))
      || nodes.find((n) => /^(OK|CONTINUE|GOT IT)$/i.test((n.text || '').trim()));
    if (!btn) return;
    await h.tapNode(btn);
    await h.sleep(1200);
  }
}

// ── WhatsApp: send a message ────────────────────────────────────────────────
//
// Uses the wa.me deep link so we don't need the recipient saved as a contact:
//   am start -a VIEW -d "https://wa.me/<number>?text=<urlencoded>"
// This opens the chat with the text pre-filled in the compose box; we then tap
// Send. Works whether or not the number is in the address book.
//
// payload: { to (E.164 digits, no +), message }
async function whatsappSend(serial, payload) {
  const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
  const message = String(p(payload, 'message', ''));
  if (!to) throw new Error('to (telefon numarası) gerekli');
  if (!message) throw new Error('message gerekli');

  const h = waHelpers(serial);
  // TEMP timing instrumentation (FLEET_SEND_TIMING=1): prints per-step ms to stderr.
  const T0 = Date.now();
  const tlog = process.env.FLEET_SEND_TIMING === '1'
    ? (label) => console.error(`  [send] ${label}: +${Date.now() - T0}ms`)
    : () => {};
  // Guarantee real touch (heals vtouch after reboot) and a reliable IME.
  await h.ensureTouch();
  tlog('ensureTouch');
  await h.ensureAdbKeyboard();
  tlog('ensureAdbKeyboard');
  const url = `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
  // adbd re-parses the joined args through the phone's /system/bin/sh, so a URL
  // containing shell metacharacters (a ')' from an encoded ':)' smiley, '&', etc.)
  // breaks the command ("syntax error: unexpected ')'"). Single-quote the -d value
  // with shArg so sh passes it through literally.
  await adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', shArg(url), WA_PKG]);
  // Wait for the chat to actually open instead of a flat 5s. Poll for the compose
  // box (id/entry) to appear — usually ~1-2s — and bail early. Falls back to a
  // 4.5s cap so a slow open still proceeds. Speeds up the common case a lot.
  {
    let opened = false;
    for (let i = 0; i < 9 && !opened; i++) {
      await h.sleep(500);
      opened = Boolean(await h.find('com.whatsapp:id/entry', 'id').catch(() => null));
    }
  }
  tlog('chat opened (entry poll)');
  // SPEED: take ONE dump and use it for BOTH the blocking-dialog sweep AND the
  // invalid-recipient check, instead of dismissBlockingDialogs (its own dump) +
  // a separate screenText() dump (~2.2s each). On the common path (no dialog,
  // valid number) this is a single dump.
  {
    const nodes = await h.dump().catch(() => []);
    const flat = nodes.map((n) => n.text).filter(Boolean).join(' | ');
    // Blocking alert ("custom ROM… OK") → tap OK, then fall back to the full sweep.
    if (/custom ROM|unsupported|Alert/i.test(flat)) {
      const btn = nodes.find((n) => n.clickable && /^(OK|CONTINUE|GOT IT)$/i.test((n.text || '').trim()))
        || nodes.find((n) => /^(OK|CONTINUE|GOT IT)$/i.test((n.text || '').trim()));
      if (btn) { await h.tapNode(btn); await h.sleep(1000); }
      await dismissBlockingDialogs(serial, h); // handle any further dialogs
    }
    // "X is not on WhatsApp" / invalid-number → report, don't hang.
    if (/not on whatsapp|invalid|isn.?t a valid/i.test(flat)) {
      return { status: 'INVALID_RECIPIENT', note: 'Numara WhatsApp\'ta değil veya geçersiz', to, screenTexts: flat.slice(0, 300) };
    }
  }
  tlog('dialog+invalid check (1 dump)');

  // ── CRITICAL: minimize `uiautomator dump` here. ──────────────────────────────
  // With text in the compose box WhatsApp's view tree churns, and REPEATED dumps
  // push it into an ANR ("WhatsApp isn't responding"), which then blocks the send
  // entirely. So the send path below is DUMP-FREE: the deep link already filled
  // the compose box, so we just tap the send button's known location and confirm
  // via a single lightweight screencap-based check — never a dump loop.

  // Send-button center. We know its exact on-device coordinates from the dump we
  // captured once (id/send bounds ≈ [940,2134]-[1066,2260] on a 1080x2400 panel),
  // i.e. ~93% width / ~91.5% height. Compute from the live logical size so it
  // scales to other panels. vtouch rescales logical→physical.
  let sw = 720, sh = 1280;
  try {
    const wm = await adb(serial, ['shell', 'wm', 'size']);
    const ov = /Override size:\s*(\d+)x(\d+)/.exec(wm);
    const ph = /Physical size:\s*(\d+)x(\d+)/.exec(wm);
    const m = ov || ph || /(\d+)x(\d+)/.exec(wm);
    if (m) { sw = Number(m[1]) || sw; sh = Number(m[2]) || sh; }
  } catch { /* keep defaults */ }
  const sendX = Math.round(sw * 0.929); // button center ≈ (940+1066)/2 / 1080
  const sendY = Math.round(sh * 0.916); // button center ≈ (2134+2260)/2 / 2400

  const needle = message.trim();
  // Read the compose text via ONE guarded dump. One dump won't ANR (a LOOP does).
  // Returns true = still full, false = cleared/sent, null = couldn't tell.
  const composeStillFull = async () => {
    const nodes = await h.dump().catch(() => null);
    if (!nodes) return null;
    const entry = nodes.find((n) => n.resId.includes('id/entry'));
    if (!entry) return null;
    return (entry.text ?? '').includes(needle.slice(0, 12));
  };

  // Tap the send button, then CHECK before tapping again. The message usually
  // leaves on the 1st or 2nd tap; every extra tap lands on the now-empty compose's
  // MIC button and pops "Can't set up the recorder". So: tap → wait → if the box
  // cleared, STOP. At most 2 taps. One dump per iteration is safe (not a tight loop).
  // Poll the compose box for up to capMs (in 350ms steps) instead of a flat 1400ms
  // wait, so a fast send (the box clears in ~300-500ms) returns early without
  // sacrificing the safety of confirming the box actually cleared.
  const waitCleared = async (capMs) => {
    const start = Date.now();
    for (;;) {
      const still = await composeStillFull();
      if (still === false) return false;             // cleared → sent
      if (Date.now() - start >= capMs) return still; // true (full) or null (unknown)
      await h.sleep(350);
    }
  };
  // The send button responds to a SYNTHETIC `input tap` but consistently IGNORES the
  // vtouch FIFO tap (VERIFIED: one synthetic tap clears the box; a vtouch tap leaves
  // it full so the old vtouch-first code always burned attempt 0). Tap SYNTHETIC on
  // BOTH attempts — attempt 0 usually sends, attempt 1 is a safety retry.
  let sent = false;
  for (let attempt = 0; attempt < 2 && !sent; attempt++) {
    await adb(serial, ['shell', 'input', 'tap', String(sendX), String(sendY)]); // synthetic (the reliable path)
    const still = await waitCleared(1500);
    tlog(`send tap ${attempt} + verify (still=${still})`);
    if (still === false) { sent = true; break; }  // cleared → sent
    // still === true (definitely not sent) → loop and retry; null → also retry once
  }

  // Dismiss any "Can't set up the recorder" / recording dialog a stray tap raised,
  // so it never blocks the next send. (Tap OK / press BACK.)
  const scr = await h.screenText().catch(() => '');
  let recordingHit = false;
  if (/recorder|recording|kaydediliyor|slide to cancel/i.test(scr)) {
    recordingHit = true;
    await h.tapIf('OK').catch(() => undefined);
    await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
    await h.sleep(300);
    await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
  }

  // Final confirmation if the loop couldn't confirm (null path): one more dump.
  if (!sent) {
    const still = await composeStillFull();
    if (still === false) sent = true; // box cleared after all → sent
  }

  if (!sent) {
    // Genuine failure — the bubble never appeared. Report it honestly (do NOT
    // claim SENT). The message is likely still in the compose box.
    return {
      status: 'COMPOSE_FAILED',
      note: recordingHit
        ? 'Gönderilemedi (yanlışlıkla ses kaydı tetiklendi, iptal edildi)'
        : 'Mesaj gönderilemedi (giden balon görünmedi)',
      to,
      screenTexts: (await h.screenText().catch(() => '')).slice(0, 300)
    };
  }
  tlog('SENT');
  return { status: 'SENT', to, message };
}

// ── WhatsApp: read messages from a chat ─────────────────────────────────────
//
// Opens a chat (by contact name if given, else assumes a chat is already open or
// opens via wa.me) and pulls the visible message bubbles. WhatsApp tags each
// bubble's text with resource-id .../message_text.
//
// payload: { from? (contact name to open), to? (number to open via wa.me) }
async function whatsappRead(serial, payload) {
  const from = String(p(payload, 'from', '')).trim();
  const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
  const h = waHelpers(serial);
  await h.ensureTouch();
  await h.ensureAdbKeyboard();

  // Make sure a chat is open.
  if (to) {
    await adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', shArg(`https://wa.me/${to}`), WA_PKG]);
    await h.sleep(5000);
  } else if (from) {
    await launchApp(serial, WA_PKG, null);
    await h.sleep(4000);
    // Open search, type the contact, tap the first chat hit.
    if (await h.tapIf('Search', 'desc')) {
      await h.sleep(800);
      await inputText(serial, from);
      await h.sleep(1500);
      await h.tapBy(from, 'text').catch(() => undefined);
      await h.sleep(2500);
    }
  }
  await dismissBlockingDialogs(serial, h);

  // Pull bubbles. Prefer the message_text id; fall back to all on-screen text.
  const nodes = await h.dump();
  const bubbles = nodes
    .filter((n) => n.text && n.resId.includes('message_text'))
    .map((n) => n.text);
  const messages = bubbles.length > 0 ? bubbles : nodes.map((n) => n.text).filter(Boolean);
  return { status: 'OK', count: messages.length, messages: messages.slice(-50) };
}

// ── WhatsApp: shared chat navigation helpers ────────────────────────────────

// Read the device's logical screen size (WhatsApp/Waydroid honour the Override
// size). Cached per serial. Used for coordinate-based taps on screens where
// `uiautomator dump` hangs (the Conversation screen).
const wmSizeCache = new Map();
async function wmSize(serial) {
  if (wmSizeCache.has(serial)) return wmSizeCache.get(serial);
  let sw = 1080, sh = 2400;
  try {
    const wm = await adbT(serial, ['shell', 'wm', 'size'], 6000);
    const ov = /Override size:\s*(\d+)x(\d+)/.exec(wm);
    const ph = /Physical size:\s*(\d+)x(\d+)/.exec(wm);
    const m = ov || ph || /(\d+)x(\d+)/.exec(wm);
    if (m) { sw = Number(m[1]) || sw; sh = Number(m[2]) || sh; }
  } catch { /* keep defaults */ }
  const size = { sw, sh };
  wmSizeCache.set(serial, size);
  return size;
}

// Take a screencap and return its PNG buffer (null on a blank/failed grab). Used
// both to detect screen state and to capture the avatar. screencap does NOT ANR
// like uiautomator dump, so it's the reliable primitive on the chat screens.
async function grabPng(serial, ms = 15000) {
  try {
    const { stdout } = await execFileAsync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], {
      encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: ms, killSignal: 'SIGKILL'
    });
    return stdout && stdout.length > 2048 ? stdout : null;
  } catch { return null; }
}

// ── Zero-dependency PNG crop (node:zlib only) ───────────────────────────────
//
// The WhatsApp contact-info & full-screen photo screens block screencap on this
// device (capture returns 0 bytes), so we can't grab the big avatar directly.
// The CONVERSATION screen's screencap DOES work and shows the small toolbar
// avatar top-left. So we screencap the chat and crop the avatar rectangle out of
// it. Android screencap emits a 8-bit RGBA, non-interlaced PNG — we only need to
// handle that one shape. Returns a cropped PNG Buffer, or null on any mismatch.
function cropPng(png, rx, ry, rw, rh) {
  try {
    // Verify PNG signature.
    const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!png || png.length < 8 || !png.subarray(0, 8).equals(SIG)) return null;
    // Walk chunks: read IHDR, concat IDAT data, ignore the rest.
    let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
    const idat = [];
    while (off + 8 <= png.length) {
      const len = png.readUInt32BE(off);
      const type = png.toString('ascii', off + 4, off + 8);
      const data = png.subarray(off + 8, off + 8 + len);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0); height = data.readUInt32BE(4);
        bitDepth = data[8]; colorType = data[9];
      } else if (type === 'IDAT') { idat.push(data); }
      else if (type === 'IEND') break;
      off += 12 + len; // len + type(4) + data + crc(4)
    }
    // Only handle 8-bit RGBA (colorType 6) — what Android screencap produces.
    if (bitDepth !== 8 || colorType !== 6 || !width || !height) return null;
    const channels = 4, stride = width * channels;
    const raw = inflateSync(Buffer.concat(idat)); // filtered scanlines: 1 byte filter + stride
    // Unfilter into a flat RGBA raster (PNG filter types 0-4).
    const rowBytes = stride;
    const out = Buffer.alloc(height * rowBytes);
    let pos = 0;
    for (let y = 0; y < height; y++) {
      const filter = raw[pos++];
      const cur = out.subarray(y * rowBytes, y * rowBytes + rowBytes);
      raw.copy(cur, 0, pos, pos + rowBytes); pos += rowBytes;
      const prev = y > 0 ? out.subarray((y - 1) * rowBytes, (y - 1) * rowBytes + rowBytes) : null;
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= channels ? cur[i - channels] : 0;
        const b = prev ? prev[i] : 0;
        const c = (prev && i >= channels) ? prev[i - channels] : 0;
        let v = cur[i];
        if (filter === 1) v = (v + a) & 0xff;
        else if (filter === 2) v = (v + b) & 0xff;
        else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
        else if (filter === 4) {
          const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          v = (v + pr) & 0xff;
        }
        cur[i] = v;
      }
    }
    // Clamp the crop rect to the image.
    const cx = Math.max(0, Math.min(rx, width - 1));
    const cy = Math.max(0, Math.min(ry, height - 1));
    const cw = Math.max(1, Math.min(rw, width - cx));
    const ch = Math.max(1, Math.min(rh, height - cy));
    // Build cropped filtered data (filter type 0 for every row).
    const cropStride = cw * channels;
    const filtered = Buffer.alloc(ch * (cropStride + 1));
    for (let y = 0; y < ch; y++) {
      filtered[y * (cropStride + 1)] = 0; // no filter
      const src = (cy + y) * rowBytes + cx * channels;
      out.copy(filtered, y * (cropStride + 1) + 1, src, src + cropStride);
    }
    const compressed = deflateSync(filtered);
    // Re-assemble a minimal PNG.
    const chunk = (type, data) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
      const typeBuf = Buffer.from(type, 'ascii');
      const body = Buffer.concat([typeBuf, data]);
      const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(body) >>> 0, 0);
      return Buffer.concat([len, body, crcBuf]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(cw, 0); ihdr.writeUInt32BE(ch, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
  } catch { return null; }
}

// Open a chat with a peer. Prefer the wa.me deep link (works without a saved
// contact); if only a `from` name is given, open the app and search for it.
// DUMP-FREE for the `to` path: the Conversation screen ANRs uiautomator dump, so
// we just wait a fixed beat after the deep link (proven reliable in whatsappSend).
async function waOpenChat(serial, h, { to, from }) {
  if (to) {
    await adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', shArg(`https://wa.me/${to}`), WA_PKG]);
    // SPEED: poll for the compose box (id/entry) to appear instead of a flat 8s
    // wait — the chat is usually reachable in ~2-3s. A single `find` per step is
    // safe here (the compose box is EMPTY so there's no view-tree churn/ANR — the
    // ANR only happens with text in the box + a dump LOOP, which we don't do). We
    // give it ~2s to start rendering, then poll up to an 8s cap so a slow cold
    // start still proceeds exactly as before.
    await h.sleep(2000);
    for (let i = 0; i < 12; i++) {
      if (await h.find('com.whatsapp:id/entry', 'id').catch(() => null)) break;
      await h.sleep(500);
    }
    return true;
  }
  if (from) {
    await launchApp(serial, WA_PKG, null);
    await h.sleep(3500);
    if (await h.tapIf('Search', 'desc')) {
      await h.sleep(800);
      await inputText(serial, from);
      await h.sleep(1500);
      await h.tapBy(from, 'text').catch(() => undefined);
      await h.sleep(2200);
      return true;
    }
  }
  return false;
}

// From an open chat, open the contact-info screen. The Conversation screen ANRs
// uiautomator dump, so we DON'T dump here — we tap the toolbar title by
// COORDINATE (it always sits top-left, just right of the back arrow). The
// contact-info screen that opens does NOT churn, so callers can dump it safely.
// Returns true if the info screen looks open (verified by a guarded dump).
async function waOpenContactInfo(serial, h) {
  const { sw, sh } = await wmSize(serial);
  const ay = Math.round(sh * 0.06);
  // Returns 'yes' (markers found), 'blank' (dump empty — inconclusive, likely on
  // contact-info where capture/dump is flaky), or 'no' (dump had content but no
  // contact-info markers → we're elsewhere, e.g. still on the chat).
  const probe = async () => {
    const xml = await uiDumpXml(serial).catch(() => '');
    if (!xml) return 'blank';
    if (/Media visibility|Medya görünürlüğü|Encryption|Şifreleme|Block \+|Engelle|Disappearing|list_item_title|ContactInfo/i.test(xml)) return 'yes';
    return 'no';
  };
  // Tap the toolbar NAME (40% width), NOT the avatar: when a contact has a photo,
  // tapping the avatar opens the full-screen photo viewer instead of contact info
  // (VERIFIED). The name opens ContactInfoActivity. Because dump is flaky on this
  // device, treat a BLANK dump after the tap as "probably on info" and let the
  // caller's own dump attempts proceed — only a definite 'no' triggers a re-tap.
  await tapReal(serial, Math.round(sw * 0.40), ay);
  await h.sleep(1500); // contact-info opens quickly; probe below confirms
  let seenBlank = false;
  for (let i = 0; i < 3; i++) {
    const r = await probe();
    if (r === 'yes') return true;
    if (r === 'blank') seenBlank = true;
    await h.sleep(600);
  }
  // Definite miss (all 'no') → re-tap the name once and retry.
  if (!seenBlank) {
    await tapReal(serial, Math.round(sw * 0.40), ay);
    await h.sleep(1500);
    for (let i = 0; i < 3; i++) {
      const r = await probe();
      if (r === 'yes') return true;
      if (r === 'blank') seenBlank = true;
      await h.sleep(600);
    }
  }
  // If we only ever got blank dumps, assume we're on contact-info (capture is
  // blocked there on this device) and let the caller try — better than a false
  // NO_INFO. If we got definite 'no', report failure.
  return seenBlank;
}

// Open WhatsApp Settings. On WhatsApp 2.26+ the Settings activity is NO LONGER
// exported (`am start com.whatsapp/.settings.Settings` → "Error type 3", VERIFIED),
// so the ONLY reliable path is: cold-open Home → tap the overflow "More options"
// (⋮) → wait for the popup menu → tap "Settings" → wait for the Settings screen
// (the "Account" row is the landmark). Every step polls a FRESH dump (exec-out cat)
// so we don't tap before the target has rendered — the classic Waydroid race.
// Returns true once the Settings list is showing.
async function waOpenSettings(serial, h) {
  // One full attempt: cold-open Home → ⋮ → Settings → wait for the "Account" row.
  // CRITICAL: use SYNTHETIC taps for the overflow + Settings — the vtouch FIFO tap
  // opens then instantly dismisses the PopupWindow, so the menu never stays up (and
  // dump can't see it). Only `input tap` keeps the menu open (VERIFIED w/ screenshots).
  const attempt = async () => {
    await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
    await h.sleep(1000);
    await adb(serial, ['shell', 'am', 'start', '-n', `${WA_PKG}/.home.ui.HomeActivity`]).catch(() => undefined);
    const overflow = await h.pollNode('More options', 9000, 'desc');
    if (overflow) await h.tapSynNode(overflow); else await h.tapSyn(1027, 147);
    // Wait for the popup menu ("New group" landmark); re-tap the overflow once if it
    // didn't render.
    if (!(await h.pollNode('New group', 8000, 'text'))) {
      if (overflow) await h.tapSynNode(overflow); else await h.tapSyn(1027, 147);
      await h.pollNode('New group', 6000, 'text');
    }
    const settings = await h.pollNode('Settings', 6000, 'any');
    if (settings) await h.tapSynNode(settings);
    else await h.tapSyn(812, 1060); // fixed Settings row center (VERIFIED bounds)
    // Settings loaded when the "Account" row appears.
    return Boolean(await h.pollNode('Account', 9000, 'any'));
  };
  // Retry the WHOLE flow once. On this Waydroid host the first ⋮/Settings tap
  // occasionally lands before the chat list is fully interactive, so a single retry
  // turns an intermittent "Ayarlar ekranı açılamadı" into a reliable success
  // (VERIFIED: 1st polling-mode run failed, retry-hardened runs succeed).
  if (await attempt()) return true;
  await h.sleep(800);
  return attempt();
}

// ── WhatsApp: fetch a contact's profile (avatar + name/about/last-seen) ──────
//
// Opens the chat, goes to contact info, scrapes the profile text, then taps the
// avatar to open the full-screen photo viewer and grabs a screencap of it as a
// PNG data-URI. WhatsApp encrypts the stored photo file, so a screen capture of
// the viewer is the only ADB-only way to obtain the image (no image libs needed —
// the agent stays zero-dependency; the PNG bytes are base64'd inline).
//
// payload: { to? (E.164 digits), from? (contact name) }
// returns: { status, profile: { profileName?, about?, phone?, lastSeen? }, avatarBase64? }
async function whatsappProfile(serial, payload) {
  const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
  const from = String(p(payload, 'from', '')).trim();
  if (!to && !from) throw new Error('to veya from gerekli');

  const h = waHelpers(serial);
  await h.ensureTouch();

  const { sw, sh } = await wmSize(serial);
  // Open the chat cleanly. force-stop first so the deep link always lands on the
  // Conversation screen (a warm app sometimes stays on the chat LIST — VERIFIED).
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  await h.sleep(800);
  await waOpenChat(serial, h, { to, from });

  // ── AVATAR (from the Conversation screen) ─────────────────────────────────
  // The contact-info & full-screen-photo screens block screencap on this device
  // (0 bytes), but the CONVERSATION screen's screencap works and shows the small
  // round toolbar avatar top-left. Screencap it and crop that avatar out. The
  // toolbar avatar center ≈ 17% width / 6% height with ~5% radius (VERIFIED).
  let avatarBase64 = null;
  const full = await grabPng(serial, 15000);
  if (full) {
    // Crop rect around the toolbar avatar (a bit generous, square).
    const r = Math.round(sw * 0.058);         // radius-ish
    const acx = Math.round(sw * 0.17), acy = Math.round(sh * 0.06);
    const cropped = cropPng(full, acx - r, acy - r, r * 2, r * 2);
    // Only keep the crop if it's a real photo, not the grey/placeholder circle.
    // A placeholder (single-letter on flat bg) compresses tiny; a real photo
    // doesn't. Require a non-trivial size as a cheap "has a photo" heuristic.
    if (cropped && cropped.length > 900) {
      avatarBase64 = `data:image/png;base64,${cropped.toString('base64')}`;
    }
  }

  // ── PROFILE TEXT (from the contact-info screen) ───────────────────────────
  // Tap the toolbar NAME (not the avatar — the avatar opens the photo viewer when
  // a photo exists). The name reliably opens ContactInfoActivity, which is
  // dump-safe. Name area center ≈ 40% width / 6% height.
  await tapReal(serial, Math.round(sw * 0.40), Math.round(sh * 0.06));
  await h.sleep(2200);
  const nodes = await h.dump().catch(() => []);
  const phoneNode = nodes.find((n) => /^\+?\d[\d\s()-]{6,}$/.test((n.text || '').trim()));
  const phone = phoneNode ? phoneNode.text.trim() : (to ? `+${to}` : '');
  // Profile name shows as "~ Foo" (push-name) on the info screen.
  const tildeNode = nodes.find((n) => /^~\s*\S/.test((n.text || '').trim()));
  const byId = (frag) => (nodes.find((n) => n.resId.includes(frag) && n.text) || {}).text || '';
  const profileName = (tildeNode ? tildeNode.text.replace(/^~\s*/, '').trim() : '')
    || byId('conversation_contact_name') || byId('profile_info') || from || '';
  const about = byId('status') || byId('about');
  const profile = {
    ...(profileName ? { profileName } : {}),
    ...(about ? { about } : {}),
    ...(phone ? { phone } : {})
  };
  // Return to a neutral state.
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);

  // If we got neither text nor an avatar, report the failure honestly.
  if (!avatarBase64 && Object.keys(profile).length === 0) {
    return { status: 'NO_INFO', note: 'Kişi bilgisi/foto alınamadı', to, from };
  }

  return {
    status: 'OK',
    profile,
    ...(avatarBase64 ? { avatarBase64 } : {}),
    to: to || undefined,
    from: from || undefined
  };
}

// ── WhatsApp: block / unblock a contact ─────────────────────────────────────
//
// Opens the chat, contact info, then taps the Block / Unblock row and confirms
// the dialog. WhatsApp toggles the row label between "Block <name>" and
// "Unblock <name>" (localised), so we match either the current-state row we want
// and the confirmation button.
//
// payload: { to? , from? , block (bool, default true) }
// returns: { status: 'BLOCKED' | 'UNBLOCKED' | 'NOOP', ... }
async function whatsappBlock(serial, payload) {
  const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
  const from = String(p(payload, 'from', '')).trim();
  const block = p(payload, 'block', true) !== false;
  if (!to && !from) throw new Error('to veya from gerekli');

  const h = waHelpers(serial);
  await h.ensureTouch();

  const { sw, sh } = await wmSize(serial);
  // force-stop first so the deep link lands on the Conversation screen (VERIFIED).
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  await h.sleep(800);
  await waOpenChat(serial, h, { to, from });
  const onInfo = await waOpenContactInfo(serial, h);
  if (!onInfo) return { status: 'NO_INFO', note: 'Kişi bilgisi ekranı açılamadı', to, from };

  // Scroll down to the danger-zone rows (Block/Unblock sit near the bottom, just
  // above Report). One big swipe brings them into view (VERIFIED on-device). The
  // contact-info screen is dump-safe.
  await adb(serial, ['shell', 'input', 'swipe', String(Math.round(sw * 0.5)), String(Math.round(sh * 0.75)), String(Math.round(sw * 0.5)), String(Math.round(sh * 0.25)), '250']).catch(() => undefined);
  await h.sleep(900);

  // Desired action label. WhatsApp shows "Block +<number>" / "Unblock +<number>"
  // (or "Engelle"/"Engeli kaldır"). Match the verb at the start; the number tail
  // is ignored. If the wanted verb is absent, the contact is already in the
  // target state → ALREADY_*.
  const wantRe = block ? /^block\b|^engelle/i : /^unblock\b|^engeli\s*kaldır/i;
  const oppRe  = block ? /^unblock\b|^engeli\s*kaldır/i : /^block\b|^engelle/i;
  const nodes = await h.dump().catch(() => []);
  const norm = (t) => (t || '').trim();
  const wantRow = nodes.find((n) => wantRe.test(norm(n.text)));
  const oppRow  = nodes.find((n) => oppRe.test(norm(n.text)));
  if (wantRow) {
    await h.tapNode(wantRow);
    await h.sleep(1200);
  } else if (oppRow) {
    return { status: block ? 'ALREADY_BLOCKED' : 'ALREADY_UNBLOCKED', to, from };
  } else if (nodes.length === 0) {
    // Dump came back empty (flaky on this device) but we scrolled to the danger
    // zone. Coordinate-tap the Block/Unblock row: after the swipe it sits at
    // ~40% width / 82% height (VERIFIED bounds [189,1933]-[682,1994] on 1080x2400).
    await tapReal(serial, Math.round(sw * 0.40), Math.round(sh * 0.818));
    await h.sleep(1200);
  } else {
    // Dump had content but neither verb was present.
    return { status: 'NO_ACTION', note: 'Engelle/Engeli kaldır satırı bulunamadı', to, from };
  }

  // Confirm the dialog. The confirm button repeats the verb ("BLOCK"/"UNBLOCK" /
  // "ENGELLE"/"ENGELİ KALDIR"). Some versions add a "Report" checkbox — we leave
  // it unchecked and just confirm the block.
  const conf = await h.dump().catch(() => []);
  const confBtn = conf.find((n) => n.clickable && wantRe.test((n.text || '').trim()))
    || conf.find((n) => wantRe.test((n.text || '').trim()) && (n.text || '').trim().length < 24);
  if (confBtn) { await h.tapNode(confBtn); await h.sleep(1200); }
  else {
    // Confirm dialog button center ≈ 75% width / 55% height on the default
    // 2-button alert; coordinate-tap it when the dump was empty.
    await tapReal(serial, Math.round(sw * 0.75), Math.round(sh * 0.55)).catch(() => undefined);
    await h.sleep(1000);
  }

  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
  return { status: block ? 'BLOCKED' : 'UNBLOCKED', to: to || undefined, from: from || undefined };
}

// ── WhatsApp: read the blocked-contacts list ────────────────────────────────
//
// Navigates Settings → Privacy → Contacts → Blocked accounts and scrapes the
// listed names/numbers. Returns the raw display strings — the API maps them to
// threads. Path VERIFIED on WhatsApp 2.26.25.81 where the menu was reorganised:
// "Blocked accounts" now lives UNDER a "Contacts" row inside Privacy (it used to
// be a direct "Blocked contacts" row), and the Settings deep-link is gone.
//
// payload: {}  returns: { status: 'OK', count, blocked: [ "<name/number>", … ] }
async function whatsappBlocklist(serial /*, payload */) {
  const h = waHelpers(serial);
  await h.ensureTouch();
  const { sw, sh } = await wmSize(serial);

  const ok = await waOpenSettings(serial, h);
  if (!ok) return { status: 'NO_LIST', note: 'Ayarlar ekranı açılamadı', blocked: [], count: 0 };

  // Settings → Privacy (synthetic taps — same PopupWindow/list behaviour).
  const privacy = await h.pollNode('Privacy', 6000, 'any');
  if (!privacy) return { status: 'NO_LIST', note: 'Privacy satırı bulunamadı', blocked: [], count: 0 };
  await h.tapSynNode(privacy);
  // Privacy screen landmark.
  await h.pollNode('Last seen', 6000, 'any');

  // "Contacts" (holding "Blocked accounts") sits far down the Privacy list — scroll
  // until it appears (VERIFIED: ~2 page swipes). We match the row by its subtitle
  // "Blocked accounts" (present in the content-desc "Contacts,Blocked accounts, …").
  let contactsRow = null;
  for (let s = 0; s < 5; s++) {
    contactsRow = findNode(await h.dump().catch(() => []), 'Blocked accounts', 'any');
    if (contactsRow) break;
    await adb(serial, ['shell', 'input', 'swipe', String(Math.round(sw * 0.5)), String(Math.round(sh * 0.75)), String(Math.round(sw * 0.5)), String(Math.round(sh * 0.28)), '250']);
    await h.sleep(450); // scroll settles fast; the next dump adds its own ~1.5s
  }
  if (!contactsRow) return { status: 'NO_LIST', note: 'Engellenen hesaplar satırı bulunamadı', blocked: [], count: 0 };
  await h.tapSynNode(contactsRow);
  // This lands on the "Contacts" hub (title "Contacts", a "Blocked accounts" row
  // with a count, plus a "WhatsApp contacts" toggle). VERIFIED on 2.26.25.81.
  // SPEED: poll for the hub, and REUSE that same dump to find the clickable row
  // container — saves one ~2.2s dump vs a separate pollNode + dump.
  await h.pollNode('WhatsApp contacts', 6000, 'any');
  // Open the actual blocked list. CRITICAL: the "Blocked accounts" TEXT node is NOT
  // clickable — its clickable parent is the row container
  // `block_list_privacy_contacts_preference`; tapping the text does nothing
  // (VERIFIED w/ screenshots). Tap that container by id; fall back to the text row.
  const hubNodes = await h.dump().catch(() => []);
  const container = findNode(hubNodes, 'block_list_privacy_contacts_preference', 'id');
  if (container) await h.tapSynNode(container);
  else {
    const brow = findNode(hubNodes, 'Blocked accounts', 'any');
    if (brow) await h.tapSynNode(brow);
  }
  // Wait for the Blocked-accounts list to render.
  await h.pollNode('Accounts', 6000, 'any');
  await h.sleep(400);

  // Scrape the list rows. Blocked entries show as a contact display name or a raw
  // number; scroll to page through. Skip chrome (headers/"Add blocked"). Most lists
  // are short (0-few entries), so we stop as soon as a page adds nothing new — no
  // need for a fixed 6-page walk.
  const seen = new Set();
  for (let page = 0; page < 6; page++) {
    const nodes = await h.dump().catch(() => []);
    const before = seen.size;
    for (const n of nodes) {
      const t = (n.text || '').trim();
      if (!t) continue;
      if (/contactpicker_row_name|contact_name|row_name|conversations_row_contact_name/i.test(n.resId)) seen.add(t);
      else if (/^\+?\d[\d\s()+-]{6,}$/.test(t)) seen.add(t);
      else if (/^~\s*\S/.test(t)) seen.add(t.replace(/^~\s*/, '').trim());
    }
    const scr = nodes.find((x) => x.scrollable);
    // Stop early: nothing scrollable, OR this page added no new rows (list end).
    if (!scr || seen.size === before) break;
    await adb(serial, ['shell', 'input', 'swipe', String(scr.cx), String(Math.round(scr.cy + 300)), String(scr.cx), String(Math.max(200, scr.cy - 300)), '250']);
    await h.sleep(450);
  }
  // Filter out chrome strings that slipped through.
  const blocked = [...seen].filter((s) => !/add blocked|engellenen (kişi|hesap) ekle|blocked (contacts|accounts)|engellenen|whatsapp contacts|contacts are saved/i.test(s));
  return { status: 'OK', count: blocked.length, blocked };
}

// ── WhatsApp: read the account's OWN number ─────────────────────────────────
//
// Opens Settings and reads the profile row, which shows this account's own phone
// number. Settings deep-link is unreliable across builds, so we drive the UI:
// open WhatsApp → overflow (⋮) → Settings → the top profile row holds the number.
//
// payload: {}  returns: { status: 'OK', number } | { status: 'NOT_FOUND' }
//
// Path (VERIFIED on WhatsApp 2.26.25.81): Settings → tap the profile row (its
// content-desc is "You") → the Profile screen shows a "Phone" label immediately
// followed by the account's own number. We scrape the first phone-like text on
// that screen. Everything polls a fresh dump so we never read a stale screen.
async function whatsappMyNumber(serial /*, payload */) {
  const h = waHelpers(serial);
  await h.ensureTouch();
  const looksPhone = (t) => /^\+?\d[\d\s()+-]{8,}$/.test(String(t || '').trim());

  // ── FAST PATH (~5s vs ~22s): the chat list shows the account's own number as a
  // self-chat row "＋90 … (You)". Open Home, take ONE dump, and read it directly —
  // no Settings navigation (which costs ~5 extra ~2.2s dumps). Falls through to the
  // Settings path below if the self-chat row isn't present (user never messaged
  // themselves), so nothing is lost. VERIFIED: text="+57 310 8228143 (You)".
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  await h.sleep(800);
  await adb(serial, ['shell', 'am', 'start', '-n', `${WA_PKG}/.home.ui.HomeActivity`]).catch(() => undefined);
  await h.pollNode('More options', 8000, 'desc'); // chat list is up
  {
    const home = await h.dump().catch(() => []);
    const youNode = home.find((n) => /\(You\)/i.test(n.text || '') && looksPhone((n.text || '').replace(/\s*\(You\)\s*/i, '')));
    if (youNode) {
      const num = youNode.text.replace(/\s*\(You\)\s*/i, '').trim();
      if (num) return { status: 'OK', number: num };
    }
  }

  // ── FALLBACK: Settings → profile row ("You") → Profile screen "Phone" number.
  const ok = await waOpenSettings(serial, h);
  if (!ok) return { status: 'NOT_FOUND', note: 'Ayarlar ekranı açılamadı' };
  // The profile row at the very top has content-desc="You". Tapping it opens the
  // Profile screen. (Fallback: some builds label it with the account name only.)
  // Use synthetic taps throughout Settings (consistent with the menu behaviour).
  const youRow = await h.pollNode('You', 5000, 'desc');
  if (youRow) await h.tapSynNode(youRow);
  else {
    // Fallback: tap the top profile card by coordinate (~top of the list).
    const { sw, sh } = await wmSize(serial);
    await h.tapSyn(Math.round(sw * 0.5), Math.round(sh * 0.16));
  }
  // Wait for the Profile screen ("Phone" label is the landmark) then read the
  // number that follows it.
  await h.pollNode('Phone', 6000, 'text');
  await h.sleep(600);
  const nodes = await h.dump().catch(() => []);
  // Prefer the node right after the "Phone" label; else any phone-like text that
  // is NOT the "(You)" self-chat entry.
  let number = '';
  const phoneIdx = nodes.findIndex((n) => /^phone$/i.test((n.text || '').trim()));
  if (phoneIdx >= 0) {
    const after = nodes.slice(phoneIdx + 1).find((n) => looksPhone(n.text));
    if (after) number = after.text.trim();
  }
  if (!number) {
    const any = nodes.find((n) => looksPhone(n.text) && !/\(You\)/i.test(n.text));
    if (any) number = any.text.trim();
  }
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
  if (number) return { status: 'OK', number };
  return { status: 'NOT_FOUND', note: 'Kendi numara okunamadı' };
}

// ── WhatsApp: send a media message (image/file) ─────────────────────────────
//
// Downloads the media to the device, opens the chat, then drives attach (📎) → pick
// the just-added photo from the INLINE grid in the attach sheet → caption → send.
// VERIFIED on WhatsApp 2.26.25.81: the attach sheet shows a live photo grid inline
// (no need to open the separate Gallery app), and its tiles carry
// content-desc="Photo, date <when>…". We pushed the file just now, so the NEWEST
// tile is ours. Taps on the sheet/preview use SYNTHETIC taps (overlay UI ignores
// vtouch, same as menus). Send is VERIFIED by the compose/preview closing — no more
// false "SENT" when nothing was actually attached.
//
// payload: { to (E.164 digits), mediaUrl, caption?, kind? ('image'|'document') }
async function whatsappSendMedia(serial, payload) {
  const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
  const mediaUrl = String(p(payload, 'mediaUrl', ''));
  const caption = String(p(payload, 'caption', ''));
  const kind = String(p(payload, 'kind', 'image'));
  if (!to) throw new Error('to gerekli');
  if (!mediaUrl) throw new Error('mediaUrl gerekli');

  const h = waHelpers(serial);
  await h.ensureTouch();
  const { sw, sh } = await wmSize(serial);

  // 1) Push the media onto the device so the picker can see it. Land it in Pictures
  //    (indexed fast by the media scanner) and force a scan so the grid refreshes.
  const rawName = (mediaUrl.split('/').pop() || 'media').split('?')[0] || 'media';
  const fileName = /\.(jpg|jpeg|png|gif|webp|mp4|pdf|docx?)$/i.test(rawName) ? rawName : `${rawName}.jpg`;
  const local = await download(mediaUrl, fileName);
  const dest = `/sdcard/Pictures/${fileName}`;
  try {
    await adb(serial, ['shell', 'mkdir', '-p', '/sdcard/Pictures']).catch(() => undefined);
    await adb(serial, ['push', local, dest]);
    await adb(serial, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file://${dest}`]).catch(() => undefined);
  } finally {
    await safeRm(local);
  }
  // Give the media scanner a beat to index the new file before we open the grid.
  await h.sleep(1500);

  // 2) Open the chat (force-stop for a clean cold open).
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  await h.sleep(800);
  await waOpenChat(serial, h, { to });

  // 3) Tap the compose Attach (📎) button. Prefer its node (content-desc="Attach"),
  //    fall back to the known compose-bar position. Synthetic tap (overlay opens).
  const attachNode = findNode(await h.dump().catch(() => []), 'Attach', 'desc')
    || findNode(await h.dump().catch(() => []), 'Ekle', 'desc');
  if (attachNode) await h.tapSynNode(attachNode);
  else await h.tapSyn(Math.round(sw * 0.80), Math.round(sh * 0.916));
  // Wait for the attach sheet (its Gallery/Document labels are the landmark).
  await h.pollNode('Gallery', 4000, 'any');

  // 4) Documents go through the Document row; images use the inline photo grid.
  if (kind === 'document') {
    (await h.tapSynIf('Document', 'any').catch(() => false)) || (await h.tapSynIf('Belge', 'any').catch(() => false));
    await h.sleep(2500);
    // Document picker: tap the top-most file entry.
    const doc = (await h.dump().catch(() => [])).find((n) => /\.(pdf|docx?|txt|xlsx?)$/i.test(n.text || ''));
    if (doc) await h.tapSynNode(doc); else await h.tapSyn(Math.round(sw * 0.5), Math.round(sh * 0.25));
    await h.sleep(2000);
  } else {
    // Pick the NEWEST photo tile from the inline grid. Tiles carry
    // content-desc="Photo, date <when>…"; the newest (our just-pushed file) is the
    // first such node in document order. Fall back to Gallery if the grid is empty.
    const photoTile = (await h.dump().catch(() => [])).find((n) => /^Photo,|^Fotoğraf,/i.test((n.desc || '').trim()));
    if (photoTile) {
      await h.tapSynNode(photoTile);
      await h.sleep(2000);
    } else {
      // No inline grid — open Gallery and take the first item.
      (await h.tapSynIf('Gallery', 'any').catch(() => false)) || (await h.tapSynIf('Galeri', 'any').catch(() => false));
      await h.sleep(2500);
      const first = (await h.dump().catch(() => [])).find((n) => /^Photo,|^Fotoğraf,|^Image|image_thumb/i.test((n.desc || '') + (n.resId || '')));
      if (first) await h.tapSynNode(first); else await h.tapSyn(Math.round(sw * 0.18), Math.round(sh * 0.28));
      await h.sleep(2000);
    }
  }

  // 5) We should now be on the media preview (a caption field + a send FAB). Confirm
  //    we actually reached it: the preview has a "Add a caption…" field or a Send
  //    button with content-desc="Send".
  let onPreview = Boolean(await h.pollNode('Send', 3500, 'desc'))
    || Boolean(findNode(await h.dump().catch(() => []), 'caption', 'any'))
    || Boolean(findNode(await h.dump().catch(() => []), 'Add a caption', 'any'));
  if (!onPreview) {
    // Nothing got attached — report honestly instead of a false SENT.
    await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
    return { status: 'ATTACH_FAILED', note: 'Medya önizleme ekranı açılamadı (foto seçilemedi)', to, mediaUrl };
  }

  // 6) Optional caption: focus the caption field, CLEAR any leftover text (a prior
  //    aborted attempt can leave stale text in the compose/caption box — that caused
  //    two captions to merge), then type ours.
  if (caption) {
    const capField = findNode(await h.dump().catch(() => []), 'caption', 'any')
      || findNode(await h.dump().catch(() => []), 'Add a caption', 'any');
    if (capField) await h.tapSynNode(capField); else await h.tapSyn(Math.round(sw * 0.4), Math.round(sh * 0.9));
    await h.sleep(500);
    await h.ensureAdbKeyboard();
    await h.clearField().catch(() => undefined);
    await h.sleep(300);
    await h.typeText(caption).catch(() => undefined);
    await h.sleep(600);
  }

  // 7) Send. Prefer the Send node; fall back to the bottom-right FAB. Then VERIFY the
  //    preview closed (we're back on the chat with the compose bar) → real SENT.
  const sendNode = findNode(await h.dump().catch(() => []), 'Send', 'desc');
  if (sendNode) await h.tapSynNode(sendNode); else await h.tapSyn(Math.round(sw * 0.9), Math.round(sh * 0.92));
  await h.sleep(2500);
  // Verify: the preview's Send button is gone AND the chat compose bar (entry) is back.
  const after = await h.dump().catch(() => []);
  const stillPreview = Boolean(findNode(after, 'Send', 'desc')) && !findNode(after, 'com.whatsapp:id/entry', 'id');
  if (stillPreview) {
    return { status: 'SEND_UNCONFIRMED', note: 'Gönder sonrası önizleme kapanmadı', to, mediaUrl, ...(caption ? { caption } : {}) };
  }
  return { status: 'SENT', to, mediaUrl, ...(caption ? { caption } : {}) };
}

// ── WhatsApp: delete a message (for me / for everyone) ──────────────────────
//
// Opens the chat, long-presses the LAST outgoing bubble (the most common target),
// then Delete → "Delete for everyone" (scope=everyone) or "Delete for me". When a
// `matchText` is given we long-press the bubble whose text contains it instead.
//
// The context menu ONLY opens on a genuine long-press: `input swipe x y x y 800`
// is silently ignored on this Waydroid device — we use the vtouch MT-B sendevent
// long-press (longPress). The CAB then exposes a top-bar "Delete" icon (a NODE with
// content-desc="Delete", NOT text) which we tap by its live center. We verify the
// confirm dialog actually appeared and retry the long-press once if the CAB never
// showed (VERIFIED end-to-end on WhatsApp 2.26.25.81).
//
// payload: { to (E.164 digits), scope? ('me'|'everyone'), matchText? }
async function whatsappDeleteMsg(serial, payload) {
  const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
  const scope = String(p(payload, 'scope', 'everyone'));
  const matchText = String(p(payload, 'matchText', '')).trim();
  if (!to) throw new Error('to gerekli');

  const h = waHelpers(serial);
  await h.ensureTouch();
  const { sw, sh } = await wmSize(serial);
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  await h.sleep(800);
  await waOpenChat(serial, h, { to });

  // Locate the bubble to long-press. The chat screen IS dump-safe here (it's the
  // Conversation view but we're not typing, so no ANR). Prefer matchText; else the
  // LAST message_text node (bottom-most = most recent). Fall back to a coordinate.
  // A real message bubble (not a system line like "You deleted this message" or a
  // date separator). We only long-press these.
  const isRealBubble = (n) => /com\.whatsapp:id\/message_text/.test(n.resId || '')
    && n.text
    && !/^you deleted this message$|^this message was deleted$|bu mesaj silindi|mesaji sildiniz/i.test(n.text.trim());
  const pickBubble = async () => {
    const nodes = await h.dump().catch(() => []);
    if (matchText) {
      const b = nodes.find((n) => isRealBubble(n) && n.text.includes(matchText));
      if (b) return { x: b.cx, y: b.cy };
    }
    const texts = nodes.filter(isRealBubble);
    const last = texts[texts.length - 1];
    if (last) return { x: last.cx, y: last.cy };
    return { x: Math.round(sw * 0.72), y: Math.round(sh * 0.82) };
  };

  // Find the CAB "Delete" (trash) icon. It is an ImageButton with
  // content-desc="Delete" in the top action bar (y is small) — match the DESC
  // exactly, NOT any text, so we don't latch onto a "You deleted this message"
  // bubble ("delete" is a substring of "deleted" — that bug picked the wrong node).
  const findCabDelete = (nodes) => nodes.find((n) =>
    /^delete$|^sil$/i.test((n.desc || '').trim()) && n.cy < Math.round(sh * 0.15)
  ) || null;
  // Open the CAB via a real long-press; confirm by finding the trash icon.
  const openCab = async () => {
    const { x, y } = await pickBubble();
    await h.longPress(x, y, 750);
    await h.sleep(1000); // CAB appears quickly; the dump poll below confirms
    // Poll for the CAB trash icon (desc="Delete" near the top).
    const start = Date.now();
    for (;;) {
      const d = findCabDelete(await h.dump().catch(() => []));
      if (d) return d;
      if (Date.now() - start >= 3500) return null;
      await h.sleep(500);
    }
  };
  let deleteNode = await openCab();
  if (!deleteNode) { await h.sleep(500); deleteNode = await openCab(); }
  if (!deleteNode) return { status: 'NO_MENU', note: 'Uzun-basma menüsü açılmadı (çöp ikonu yok)', to, scope };

  // Optional debug: report the CAB node we're about to tap + all descs on screen.
  if (p(payload, 'debugCab', false)) {
    const nn = await h.dump().catch(() => []);
    return { status: 'DEBUG_CAB', to,
      deleteNode: deleteNode ? { text: deleteNode.text, desc: deleteNode.desc, resId: deleteNode.resId, cx: deleteNode.cx, cy: deleteNode.cy } : null,
      descs: nn.map((n) => n.desc).filter(Boolean).slice(0, 20) };
  }

  // Tap the CAB "Delete" (trash) icon. CRITICAL: use a SYNTHETIC tap — the CAB is an
  // action-bar overlay and, like the overflow menu, ignores the vtouch FIFO tap
  // (the CAB stays open, no dialog appears — VERIFIED w/ screenshot). Use the live
  // node bounds (coordinate math is offset-prone on this device).
  await h.tapSynNode(deleteNode);
  // Wait for the confirm dialog ("Delete message?" with scope buttons) to appear.
  await h.pollNode('Delete for', 3500, 'any');
  await h.sleep(400);

  // Confirm dialog: pick scope (synthetic taps). "Delete for everyone" only exists
  // within the ~2h window and only for outgoing messages; otherwise just
  // "Delete for me" / a plain "Delete" confirm button. We track EXACTLY which
  // button we hit so the reported scope is honest (don't claim 'everyone' when we
  // actually fell back to 'me').
  const wantEveryone = scope === 'everyone';
  const dialogNodes = await h.dump().catch(() => []);
  const dialogTexts = dialogNodes.map((n) => (n.text || '').trim()).filter(Boolean);
  // Optional debug: return what the dialog looked like without acting.
  if (p(payload, 'debugDialog', false)) {
    await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
    return { status: 'DEBUG', to, wantEveryone, dialogTexts };
  }
  let chosen = null; // 'everyone' | 'me' | 'plain'
  if (wantEveryone) {
    if ((await h.tapSynIf('Delete for everyone', 'any').catch(() => false))
      || (await h.tapSynIf('Herkesten sil', 'any').catch(() => false))) chosen = 'everyone';
  }
  if (!chosen) {
    if ((await h.tapSynIf('Delete for me', 'any').catch(() => false))
      || (await h.tapSynIf('Benden sil', 'any').catch(() => false))) chosen = 'me';
    else if ((await h.tapSynIf('Delete', 'any').catch(() => false))
      || (await h.tapSynIf('Sil', 'any').catch(() => false))) chosen = 'plain';
  }
  await h.sleep(1200);
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
  if (!chosen) return { status: 'ATTEMPTED', to, scope, note: 'Onay düğmesi bulunamadı', dialogTexts };
  // Honest scope: 'everyone' only if we actually hit the everyone button; when the
  // caller wanted everyone but it wasn't offered, say so.
  const actualScope = chosen === 'everyone' ? 'everyone' : 'me';
  const out = { status: 'DELETED', to, scope: actualScope };
  if (wantEveryone && chosen !== 'everyone') { out.note = 'Herkesten sil seçeneği yoktu, sadece benden silindi'; out.everyoneUnavailable = true; }
  return out;
}

// ── WhatsApp: clear all messages in a chat ──────────────────────────────────
//
// Opens the chat, overflow (⋮) → "More" → "Clear chat" → confirm. Removes the
// local history for this conversation (does not delete for the other party).
// Path VERIFIED on WhatsApp 2.26.25.81: the chat ⋮ menu's first page has
// New group/Add to contacts/Search/Media…/Mute/Disappearing/Chat theme/More, and
// "Clear chat" lives under "More". All taps are SYNTHETIC — the ⋮ PopupWindow
// ignores the vtouch FIFO tap (same as the Settings menu).
//
// payload: { to (E.164 digits) }
async function whatsappClearChat(serial, payload) {
  const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
  if (!to) throw new Error('to gerekli');

  const h = waHelpers(serial);
  await h.ensureTouch();
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  await h.sleep(800);
  await waOpenChat(serial, h, { to });

  // Open the chat overflow (⋮, top-right). Prefer the node; fall back to its known
  // fixed center. Synthetic tap so the popup stays open.
  const overflow = findNode(await h.dump().catch(() => []), 'More options', 'desc');
  if (overflow) await h.tapSynNode(overflow); else await h.tapSyn(1027, 147);
  await h.pollNode('Chat theme', 4000, 'any'); // menu-open landmark

  // "Clear chat" may be on the first page or nested under "More".
  let opened = await h.tapSynIf('Clear chat', 'text').catch(() => false);
  if (!opened) opened = await h.tapSynIf('Sohbeti temizle', 'text').catch(() => false);
  if (!opened) {
    // Open the "More" submenu, then Clear chat.
    (await h.tapSynIf('More', 'text').catch(() => false)) || (await h.tapSynIf('Diğer', 'text').catch(() => false));
    await h.pollNode('Clear chat', 4000, 'any');
    opened = (await h.tapSynIf('Clear chat', 'text').catch(() => false))
      || (await h.tapSynIf('Sohbeti temizle', 'text').catch(() => false));
  }
  if (!opened) return { status: 'NO_MENU', note: 'Sohbeti temizle bulunamadı', to };

  // Confirm dialog (a bottom sheet). CRITICAL: it shows the TITLE "Clear chat" (not
  // clickable, top) AND the confirm BUTTON, which on this build reads "CLEAR CHAT
  // (52 KB)" — UPPERCASE with a size suffix (VERIFIED). An includes-match on "Clear
  // chat" hits the TITLE first and does nothing → false CLEARED. So we POLL for the
  // clickable confirm button (lower half, matches the verb OR a "(NN KB)" suffix) and
  // tap that specific node.
  const { sw, sh } = await wmSize(serial);
  // The confirm BUTTON starts with the verb ("CLEAR CHAT (52 KB)" / "Sohbeti
  // temizle"). Do NOT match a bare "(NN KB)" suffix — the radio option "All messages
  // (52 kB)" also carries that suffix and sits higher, so a suffix-match grabbed the
  // WRONG node (VERIFIED via debug). Verb-prefixed + clickable + lower half only.
  const isConfirmBtn = (n) => n.clickable && n.cy > sh * 0.5 &&
    /^(clear chat|sohbeti temizle|clear|temizle)\b/i.test((n.text || '').trim());
  let confirmBtn = null;
  const cstart = Date.now();
  while (Date.now() - cstart < 4500) {
    const nodes = await h.dump().catch(() => []);
    // Among matches, take the LOWEST one (the action button sits at the very bottom).
    const matches = nodes.filter(isConfirmBtn).sort((a, b) => b.cy - a.cy);
    if (matches.length) { confirmBtn = matches[0]; break; }
    await h.sleep(600);
  }
  // Optional debug: report what the clear dialog looked like + the chosen button.
  if (p(payload, 'debugClear', false)) {
    const nn = await h.dump().catch(() => []);
    await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
    return { status: 'DEBUG_CLEAR', to,
      confirmBtn: confirmBtn ? { text: confirmBtn.text, cx: confirmBtn.cx, cy: confirmBtn.cy, clickable: confirmBtn.clickable } : null,
      clickables: nn.filter((n) => n.clickable).map((n) => ({ text: n.text, cy: n.cy })).slice(0, 15) };
  }
  if (confirmBtn) {
    await h.tapSynNode(confirmBtn);
  } else {
    // Fallback: the confirm button sits at the bottom-center of the sheet.
    await h.tapSyn(Math.round(sw * 0.5), Math.round(sh * 0.905));
  }
  await h.sleep(1500);
  // Verify the dialog actually closed (confirm button gone) → real CLEARED.
  const afterClear = await h.dump().catch(() => []);
  const dialogStillOpen = afterClear.some(isConfirmBtn);
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
  return { status: dialogStillOpen ? 'ATTEMPTED' : 'CLEARED', to };
}

// Poll a disposable inbox for the latest 4-8 digit verification code. Supports
// both catchmail (SaaS) and a self-hosted Inbucket, selected by FLEET_MAIL_PROVIDER.
//   catchmail: GET /api/v1/mailbox?address=<email>, GET /api/v1/message/{id}?mailbox=<email>
//   inbucket:  GET /api/v1/mailbox/{name},          GET /api/v1/mailbox/{name}/{id}
async function fetchEmailCode(email, timeoutMs) {
  const provider = (process.env.FLEET_MAIL_PROVIDER || '').toLowerCase();
  const isInbucket = provider === 'inbucket';
  const base = (process.env.FLEET_CATCHMAIL_BASE || (isInbucket ? 'http://localhost:9000' : 'https://api.catchmail.io')).replace(/\/+$/, '');
  const name = String(email).split('@')[0] || email;
  const start = Date.now();
  const codeFrom = (s) => { const m = String(s || '').match(/\b(\d{4,8})\b/); return m ? m[1] : null; };
  while (Date.now() - start < timeoutMs) {
    try {
      if (isInbucket) {
        const list = await (await fetch(`${base}/api/v1/mailbox/${encodeURIComponent(name)}`)).json();
        const msgs = Array.isArray(list) ? list : [];
        if (msgs.length > 0) {
          const fromSubj = codeFrom(msgs[0].subject);
          if (fromSubj) return fromSubj;
          const full = await (await fetch(`${base}/api/v1/mailbox/${encodeURIComponent(name)}/${encodeURIComponent(msgs[0].id)}`)).json();
          const body = (full.body && (full.body.text || full.body.html)) || '';
          const m = codeFrom(body);
          if (m) return m;
        }
      } else {
        const list = await (await fetch(`${base}/api/v1/mailbox?address=${encodeURIComponent(email)}`)).json();
        const msgs = Array.isArray(list.messages) ? list.messages : [];
        if (msgs.length > 0) {
          // Subject often contains the code ("637598 is your Instagram code").
          const fromSubj = codeFrom(msgs[0].subject);
          if (fromSubj) return fromSubj;
          const full = await (await fetch(`${base}/api/v1/message/${encodeURIComponent(msgs[0].id)}?mailbox=${encodeURIComponent(email)}`)).json();
          const body = (full.body && (full.body.text || full.body.html)) || '';
          const m = codeFrom(body);
          if (m) return m;
        }
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
  // Dump to a file then read it back. Use adbT: `uiautomator dump` can HANG on the
  // WhatsApp Conversation screen (view-tree churn → ANR) and a plain await would
  // block the whole job forever. On timeout we return '' so dump-based finds
  // degrade to "not found" instead of hanging — the caller's coordinate/screencap
  // fallbacks then take over.
  //
  // CRITICAL: read the file with `exec-out cat`, NOT `shell cat`. On this Waydroid
  // device a plain `adb shell cat` frequently returns a STALE copy of the previous
  // dump (the file write hasn't flushed to the shell's view yet), which silently
  // breaks every navigation that polls for a freshly-appeared screen. `exec-out`
  // uses a separate exec transport that reflects the just-written bytes (VERIFIED:
  // shell cat gave the old overflow menu while exec-out cat gave the live Settings).
  await adbT(serial, ['shell', 'uiautomator', 'dump', '/sdcard/uidump.xml'], 12000).catch(() => undefined);
  return adbExecOutText(serial, ['cat', '/sdcard/uidump.xml'], 8000).catch(() => '');
}

// Like adbT but over the `exec-out` transport (raw stdout, no pty line-ending
// mangling and — importantly on Waydroid — a fresh view of just-written files).
async function adbExecOutText(serial, args, ms = 8000) {
  const full = serial ? ['-s', serial, 'exec-out', ...args] : ['exec-out', ...args];
  const { stdout } = await execFileAsync(ADB, full, { maxBuffer: 64 * 1024 * 1024, timeout: ms, killSignal: 'SIGKILL' });
  return stdout;
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
      cls: attr(a, 'class'),
      text: attr(a, 'text'),
      desc: attr(a, 'content-desc'),
      resId: attr(a, 'resource-id'),
      clickable: attr(a, 'clickable') === 'true',
      scrollable: attr(a, 'scrollable') === 'true',
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

// ── AI Device Agent perception/action helpers (zero-dep) ────────────────────
//
// These power the AI Device Agent loop (Claude drives the phone over the WS
// channel) and the BFS app-explorer. The control plane holds the Anthropic key
// and drives the loop; the agent only perceives (buildScreenTree) and acts
// (execAgentAction) on request — keeping secrets server-side.

// Layout containers that carry no semantic meaning on their own. Dropped from
// the compact screen tree unless they have a label or are clickable.
const LAYOUT_CLASS_RE = /(FrameLayout|LinearLayout|RelativeLayout|ViewGroup|ScrollView|RecyclerView|ListView|GridView|ConstraintLayout|TableLayout|TableRow)$/;
const INTERACTIVE_CLASS_RE = /(EditText|Button|Image|Switch|CheckBox|RadioButton|Spinner|SeekBar|TextView)$/;

// The pure filter that decides which nodes appear in the screen tree. MUST be
// identical between dump and action so a `tap_element(idx)` resolves to the same
// node the model saw (the idx is the contract).
function meaningfulNodes(nodes) {
  return nodes.filter((n) =>
    n.text || n.desc || n.clickable || (n.cls && INTERACTIVE_CLASS_RE.test(n.cls))
  );
}

// Build a compact, LLM-friendly screen tree:
//   [idx] Class "label" [clickable] [x1,y1,x2,y2]
// Drops pure layout containers, caps node count, and appends a swipe hint when
// the screen is scrollable. The idx is the handle for tap_element(idx).
function buildScreenTree(nodes, cap = 40) {
  const capped = meaningfulNodes(nodes).slice(0, cap);
  const lines = capped.map((n, idx) => {
    const label = (n.text || n.desc || (n.resId ? n.resId.split('/').pop() : '') || '').slice(0, 48);
    const cls = (n.cls ? n.cls.split('.').pop() : 'View') || 'View';
    const flags = n.clickable ? ' [clickable]' : '';
    return `[${idx}] ${cls} "${label}"${flags} [${n.bounds.join(',')}]`;
  });
  const scrollHint = nodes.some((n) => n.scrollable) ? '\n(scrollable — swipe up to see more)' : '';
  if (lines.length === 0) {
    // No semantic elements (game/canvas/WebView). Offer a grid so the model can
    // tap by cell instead of hallucinating raw coordinates.
    return '(empty screen — no inspectable elements)\nUse tap_grid with a 3x3 cell (row 0-2, col 0-2) to tap blindly.' + scrollHint;
  }
  return lines.join('\n') + scrollHint;
}

// Resolve a target node via a fallback chain: content-desc → text → resource-id
// → class → absolute coords. Returns a node-like {cx,cy} or null. Used by RPA
// element steps and the AI agent's tap actions for resilience to RID drift.
function resolveTarget(nodes, locator) {
  const tryFind = (q, field) => (q ? findNode(nodes, q, field) : null);
  return (
    tryFind(locator.desc, 'desc') ||
    tryFind(locator.text, 'text') ||
    tryFind(locator.resId, 'id') ||
    (locator.cls ? nodes.find((n) => n.cls && n.cls.includes(locator.cls)) || null : null) ||
    (typeof locator.x === 'number' && typeof locator.y === 'number' ? { cx: locator.x, cy: locator.y } : null)
  );
}

// ── Stealth primitives (human-like input to dodge anti-automation) ───────────
const rnd = (a, b) => a + Math.random() * (b - a);
// Box-Muller normal sample around mean with std-dev sd.
const gauss = (mean, sd) => {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
async function stealthTap(serial, x, y) {
  const jx = Math.round(gauss(x, 8));
  const jy = Math.round(gauss(y, 8));
  await adb(serial, ['shell', 'input', 'tap', String(jx), String(jy)]);
}
async function stealthSwipe(serial, x, y, x2, y2) {
  const dur = Math.round(rnd(180, 520));
  await adb(serial, ['shell', 'input', 'swipe',
    String(Math.round(gauss(x, 6))), String(Math.round(gauss(y, 6))),
    String(Math.round(gauss(x2, 6))), String(Math.round(gauss(y2, 6))), String(dur)]);
}
async function stealthType(serial, text) {
  for (const ch of String(text)) {
    // Single-quote each char for the device sh so metachars (; $ ` etc.) can't
    // execute when typed one at a time.
    await adb(serial, ['shell', 'input', 'text', shArg(ch === ' ' ? '%s' : ch)]);
    await new Promise((r) => setTimeout(r, rnd(50, 200)));
  }
}

// Cached device screen size (wm size) so dumps can report width/height cheaply.
const screenSizes = new Map();
async function screenSize(serial) {
  if (screenSizes.has(serial)) return screenSizes.get(serial);
  let wh = { width: 1080, height: 1920 };
  try {
    const out = await adb(serial, ['shell', 'wm', 'size']);
    const m = out.match(/(\d+)x(\d+)/);
    if (m) wh = { width: Number(m[1]), height: Number(m[2]) };
  } catch { /* default */ }
  screenSizes.set(serial, wh);
  return wh;
}

// Execute ONE agent action (from the Claude tool call) over ADB. `stealth` routes
// taps/swipes/typing through the human-like primitives.
async function execAgentAction(serial, action, stealth) {
  const name = String(action && action.name);
  const a = (action && action.input) || {};
  const { width, height } = await screenSize(serial);
  switch (name) {
    case 'tap_element': {
      // Re-dump and rebuild the SAME filtered list so idx matches what the model saw.
      const nodes = meaningfulNodes(parseUiNodes(await uiDumpXml(serial)));
      const idx = Number(a.idx);
      const node = nodes[idx];
      if (!node) throw new Error(`tap_element: idx ${a.idx} out of range (${nodes.length} nodes)`);
      if (stealth) await stealthTap(serial, node.cx, node.cy);
      else await adb(serial, ['shell', 'input', 'tap', String(node.cx), String(node.cy)]);
      return;
    }
    case 'tap': {
      const x = Number(a.x);
      const y = Number(a.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('tap: x,y required');
      if (stealth) await stealthTap(serial, x, y);
      else await adb(serial, ['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
      return;
    }
    case 'tap_grid': {
      // Blind tap by grid cell on screens with no inspectable elements (game/
      // canvas/WebView). Default 3x3; tap the center of the (row,col) cell.
      const rows = Math.max(1, Math.min(8, Number(a.rows) || 3));
      const cols = Math.max(1, Math.min(8, Number(a.cols) || 3));
      const row = Math.max(0, Math.min(rows - 1, Number(a.row) || 0));
      const col = Math.max(0, Math.min(cols - 1, Number(a.col) || 0));
      const x = Math.round((col + 0.5) * (width / cols));
      const y = Math.round((row + 0.5) * (height / rows));
      if (stealth) await stealthTap(serial, x, y);
      else await adb(serial, ['shell', 'input', 'tap', String(x), String(y)]);
      return;
    }
    case 'swipe': {
      let x = Number(a.x); let y = Number(a.y); let x2 = Number(a.x2); let y2 = Number(a.y2);
      const dir = a.direction ? String(a.direction) : '';
      if (dir) {
        const cx = Math.round(width / 2);
        const cy = Math.round(height / 2);
        if (dir === 'up') { x = cx; y = Math.round(height * 0.7); x2 = cx; y2 = Math.round(height * 0.3); }
        else if (dir === 'down') { x = cx; y = Math.round(height * 0.3); x2 = cx; y2 = Math.round(height * 0.7); }
        else if (dir === 'left') { x = Math.round(width * 0.7); y = cy; x2 = Math.round(width * 0.3); y2 = cy; }
        else if (dir === 'right') { x = Math.round(width * 0.3); y = cy; x2 = Math.round(width * 0.7); y2 = cy; }
      }
      if (![x, y, x2, y2].every(Number.isFinite)) throw new Error('swipe: direction or x,y,x2,y2 required');
      if (stealth) await stealthSwipe(serial, x, y, x2, y2);
      else await adb(serial, ['shell', 'input', 'swipe', String(x), String(y), String(x2), String(y2), '200']);
      return;
    }
    case 'type_text': {
      const text = String(a.text ?? '');
      if (stealth) await stealthType(serial, text);
      else await inputText(serial, text);
      return;
    }
    case 'press_key':
      await adb(serial, ['shell', 'input', 'keyevent', String(Number(a.keycode) || 4)]);
      return;
    case 'launch_app': {
      const pkg = String(a.packageName ?? '');
      if (!pkg) throw new Error('launch_app: packageName required');
      await launchApp(serial, pkg, null);
      return;
    }
    case 'wait':
      await new Promise((r) => setTimeout(r, Math.min(10000, Math.max(0, Number(a.ms) || 1000))));
      return;
    default:
      throw new Error(`Unknown agent action: ${name}`);
  }
}

// Structural hash of a screen: class + resource-id skeleton (text dropped) so the
// same screen with different content dedups to one node. Zero-dep FNV-1a.
function structuralHash(nodes) {
  const sig = nodes
    .filter((n) => n.clickable || (n.cls && INTERACTIVE_CLASS_RE.test(n.cls)))
    .map((n) => `${n.cls ? n.cls.split('.').pop() : 'V'}#${n.resId ? n.resId.split('/').pop() : ''}`)
    .sort()
    .join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < sig.length; i++) {
    h ^= sig.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// ── BFS app explorer (APP_EXPLORE job) ──────────────────────────────────────
//
// Force-stops + launches an app, then breadth-first taps clickable elements,
// deduping screens by structuralHash and recording transitions. Each path is
// replayed from the app root (force-stop + relaunch + re-tap the path) so the
// crawl is deterministic-ish. Bounded by maxScreens + a wall-clock budget.
async function exploreApp(serial, payload) {
  const pkg = String(p(payload, 'packageName', ''));
  if (!pkg) throw new Error('packageName gerekli');
  const maxScreens = Math.min(60, Math.max(1, Number(p(payload, 'maxScreens', 25))));
  const deadline = Date.now() + 150_000; // ~2.5 min wall-clock cap
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const relaunch = async () => {
    await adb(serial, ['shell', 'am', 'force-stop', pkg]).catch(() => undefined);
    await launchApp(serial, pkg, null);
    await sleep(3500);
  };
  // Replay a path of tap indices from a fresh app start.
  const replayPath = async (path) => {
    await relaunch();
    for (const idx of path) {
      const nodes = meaningfulNodes(parseUiNodes(await uiDumpXml(serial)));
      const node = nodes[idx];
      if (!node) return false;
      await adb(serial, ['shell', 'input', 'tap', String(node.cx), String(node.cy)]);
      await sleep(1500);
    }
    return true;
  };

  const seen = new Set();
  const screens = []; // { hash, label, nodeCount }
  const edges = []; // { from, to, viaLabel }
  const queue = []; // { path:[idx...], hash }

  await relaunch();
  let rootNodes = parseUiNodes(await uiDumpXml(serial));
  let rootHash = structuralHash(rootNodes);
  const labelOf = (nodes) => {
    const t = nodes.find((n) => n.text && n.text.length > 1);
    return (t ? t.text : pkg).slice(0, 40);
  };
  seen.add(rootHash);
  screens.push({ hash: rootHash, label: labelOf(rootNodes), nodeCount: rootNodes.length });
  // Enqueue each clickable element on the root.
  const rootMeaningful = meaningfulNodes(rootNodes);
  rootMeaningful.forEach((n, idx) => { if (n.clickable) queue.push({ path: [idx], hash: rootHash, label: (n.text || n.desc || '').slice(0, 30) }); });

  while (queue.length > 0 && screens.length < maxScreens && Date.now() < deadline) {
    const item = queue.shift();
    const ok = await replayPath(item.path);
    if (!ok) continue;
    const nodes = parseUiNodes(await uiDumpXml(serial));
    const hash = structuralHash(nodes);
    edges.push({ from: item.hash, to: hash, viaLabel: item.label || '' });
    if (seen.has(hash)) continue;
    seen.add(hash);
    screens.push({ hash, label: labelOf(nodes), nodeCount: nodes.length });
    // Enqueue children one level deeper.
    const meaningful = meaningfulNodes(nodes);
    meaningful.forEach((n, idx) => {
      if (n.clickable && screens.length + queue.length < maxScreens * 2) {
        queue.push({ path: [...item.path, idx], hash, label: (n.text || n.desc || '').slice(0, 30) });
      }
    });
  }

  await adb(serial, ['shell', 'am', 'force-stop', pkg]).catch(() => undefined);
  return { packageName: pkg, graph: { screens, edges }, screenCount: screens.length };
}

// ── Apply device fingerprint via setprop (anti-detection) ────────────────────
//
// The control plane generates a fingerprint (IMEI/model/etc) and stores it in
// Postgres; this brings it DOWN to the device by setting the matching system
// properties. setprop on most build props needs root (works on rootable AVD/
// redroid; a non-root device will reject some keys — we apply best-effort and
// report which succeeded). NOTE: persistent identifier spoofing typically needs
// a reboot and/or a hooking layer (Xposed/Magisk) to fully stick; setprop covers
// the readable build.* surface that most app checks read.
//
// payload: { fingerprint: { model, manufacturer, brand, osVersion, buildNumber,
//            serialNo, androidId, ... } }
async function applyFingerprint(serial, payload) {
  const fp = (payload && payload.fingerprint) || {};
  // Map fingerprint fields → Android system properties. Only set the ones present.
  const pairs = [
    ['ro.product.model', fp.model],
    ['ro.product.manufacturer', fp.manufacturer],
    ['ro.product.brand', fp.brand],
    ['ro.product.name', fp.model],
    ['ro.product.device', fp.model],
    ['ro.build.product', fp.model],
    ['ro.build.fingerprint', fp.buildNumber],
    ['ro.build.display.id', fp.buildNumber],
    ['ro.serialno', fp.serialNo],
    ['ro.boot.serialno', fp.serialNo],
    ['ro.build.version.release', fp.osVersion]
  ].filter(([, v]) => v !== undefined && v !== null && String(v) !== '');

  const applied = [];
  const failed = [];
  for (const [key, val] of pairs) {
    try {
      await adb(serial, ['shell', 'setprop', String(key), String(val)]);
      applied.push(key);
    } catch (e) {
      failed.push({ key, error: e.message });
    }
  }
  // android_id lives in settings, not a prop.
  if (fp.androidId) {
    try {
      await adb(serial, ['shell', 'settings', 'put', 'secure', 'android_id', String(fp.androidId)]);
      applied.push('settings.secure.android_id');
    } catch (e) {
      failed.push({ key: 'android_id', error: e.message });
    }
  }

  // Root-less applicable extras: screen resolution + density + timezone. These
  // take effect WITHOUT root (wm/settings are user-accessible) so they actually
  // change what apps see, unlike most ro.* build props.
  if (fp.resolution && /^\d+x\d+$/.test(String(fp.resolution))) {
    try { await adb(serial, ['shell', 'wm', 'size', String(fp.resolution)]); applied.push('wm.size'); }
    catch (e) { failed.push({ key: 'wm.size', error: e.message }); }
  }
  if (fp.dpi && Number(fp.dpi) > 0) {
    try { await adb(serial, ['shell', 'wm', 'density', String(Number(fp.dpi))]); applied.push('wm.density'); }
    catch (e) { failed.push({ key: 'wm.density', error: e.message }); }
  }
  if (fp.timezone) {
    try { await adb(serial, ['shell', 'service', 'call', 'alarm', '3', 's16', String(fp.timezone)]); applied.push('timezone'); }
    catch (e) { failed.push({ key: 'timezone', error: e.message }); }
  }

  return { applied: applied.length, appliedKeys: applied, failed, note: failed.length ? 'bazı prop\'lar reddedildi (root/reboot gerekebilir)' : 'tüm props uygulandı' };
}

// ── Provision Play Integrity / device-integrity bypass (best-effort) ─────────
//
// x86 emulators fail Google/Play device-integrity (and apps like WhatsApp). A
// real fix needs a Magisk+Zygisk module (e.g. PlayIntegrityFix) flashed into a
// rootable image — that's an image-provisioning step done out of band, not over
// plain ADB. Here we do the ADB-reachable part: spoof the build props that the
// BASIC integrity check reads, and report whether a deeper module is required.
// payload: { fingerprintProps?: {key:value}, securityPatch? }
async function provisionIntegrity(serial, payload) {
  const props = (payload && payload.fingerprintProps) || {
    'ro.boot.verifiedbootstate': 'green',
    'ro.boot.flash.locked': '1',
    'ro.boot.veritymode': 'enforcing',
    'ro.debuggable': '0',
    'ro.secure': '1'
  };
  const applied = [];
  const failed = [];
  for (const [key, val] of Object.entries(props)) {
    try {
      await adb(serial, ['shell', 'setprop', String(key), String(val)]);
      applied.push(key);
    } catch (e) {
      failed.push({ key, error: e.message });
    }
  }
  // Detect whether a hardware-backed attestation is even possible (it isn't on a
  // plain emulator) so the operator knows STRONG integrity needs a real device.
  let hasKeystore = false;
  try {
    const feats = await adb(serial, ['shell', 'pm', 'list', 'features']);
    hasKeystore = /hardware_keystore|strongbox/i.test(feats);
  } catch { /* ignore */ }
  return {
    applied: applied.length,
    appliedKeys: applied,
    failed,
    strongIntegrityPossible: hasKeystore,
    note: hasKeystore
      ? 'BASIC props uygulandı; STRONG donanım onayı mevcut olabilir'
      : 'BASIC props uygulandı; STRONG integrity emülatörde mümkün değil — gerçek cihaz veya Magisk+PlayIntegrityFix modülü gerekir'
  };
}

// ── One-click device provisioning (PROVISION_DEVICE) ────────────────────────
//
// Builds a brand-new isolated Waydroid instance from scratch and brings it all
// the way to "WhatsApp-ready", reporting each sub-step's progress so the
// dashboard shows a live wizard. The agent runs AS ROOT on the KVM host, so it
// shells out to the parametric provisioning scripts (WD_DIR) for the host-level
// work (binderfs, bridge, userdata clone) and uses ADB / lxc-attach for the
// in-container work. Every step was proven live on the fleet (mi1/mi2/mi3):
//   - root: the cloned userdata's Magisk APK can be a STUB (29KB) that magiskd
//     won't trust; reinstalling the REAL apk via container-side `pm install`
//     restores su. (ADB `pm install` gives "Broken pipe" — lxc-attach is stable.)
//   - screen: a fresh instance boots 1080x2368@180; the recipe coords need
//     1080x2400@421, so we override.
//   - mount trap: host-side userdata files may be invisible in the container's
//     mount namespace — vtouch + wa-bringup are streamed in via base64.
//   - unique identity: each device gets a distinct fingerprint (model/serial/
//     android_id) so WhatsApp can't link the fleet together.
// Scope ends at "WhatsApp-ready" — number/OTP registration is out of scope.

const WD_DIR = process.env.FLEET_WD_DIR || '/opt/fleet-agent/waydroid';
const MAGISK_PKG = 'io.github.huskydg.magisk';

// Run one of the parametric host scripts (bash, on the host — NOT adb).
async function hostSh(script, args = [], ms = 600000) {
  const { stdout, stderr } = await execFileAsync('bash', [join(WD_DIR, script), ...args], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: ms,
    killSignal: 'SIGKILL'
  });
  return { stdout: String(stdout || ''), stderr: String(stderr || '') };
}

// Fire-and-forget a host script that NEVER returns (e.g. wd-run.sh keeps the
// systemd session alive with `wait $SESSION_PID`). Awaiting it would block the
// agent for the full timeout; instead we spawn it fully detached so it boots
// Android in the background while the agent proceeds to verify boot over ADB.
function hostShDetached(script, args = []) {
  const child = spawn('bash', [join(WD_DIR, script), ...args], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  return child.pid;
}

// Run a command inside an instance's container (root, stable — survives the ADB
// "Broken pipe" that plagues fresh Waydroid instances).
async function lxcAttach(instance, argv, ms = 60000) {
  const lxcp = `/var/lib/waydroid.${instance}/lxc`;
  const { stdout } = await execFileAsync(
    'lxc-attach',
    ['-P', lxcp, '-n', 'waydroid', '--', ...argv],
    { maxBuffer: 64 * 1024 * 1024, timeout: ms, killSignal: 'SIGKILL' }
  );
  return String(stdout || '');
}

// Resolve the container's actual DHCP address (it may differ from the .112
// guess). Reads the instance's dnsmasq lease file; falls back to the container's
// live eth0 address. Returns null if neither is available yet.
async function resolveLeaseIp(instance, subnetId) {
  const leaseFile = `/var/lib/misc/dnsmasq.waydroid-${instance}.leases`;
  try {
    const raw = await readFile(leaseFile, 'utf8');
    // lease line: "<expiry> <mac> <ip> <name> <clientid>" — take the last (newest).
    const lines = raw.trim().split('\n').filter(Boolean);
    const last = lines[lines.length - 1];
    const ip = last && last.split(/\s+/)[2];
    if (ip && ip.startsWith(`192.168.${subnetId}.`)) return ip;
  } catch { /* lease file may not exist yet */ }
  try {
    const out = await lxcAttach(instance, ['ip', '-4', 'addr', 'show', 'eth0'], 15000);
    const m = new RegExp(`inet (192\\.168\\.${subnetId}\\.\\d+)`).exec(out);
    if (m) return m[1];
  } catch { /* container may not be up yet */ }
  return null;
}

// Poll getprop sys.boot_completed==1 over ADB until timeout.
async function waitBoot(serial, ms = 180000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const out = await adbT(serial, ['shell', 'getprop', 'sys.boot_completed'], 8000);
      if (String(out).trim() === '1') return true;
    } catch { /* device may be reconnecting */ }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

// Stream a local file into the container's OWN view of /data/local/tmp via
// base64 (works around the mount-namespace trap where host-side userdata files
// are invisible to the container). Chunked so the arg list never overflows.
async function pushB64(serial, localPath, destPath) {
  const buf = await readFile(localPath);
  const b64 = buf.toString('base64');
  const tmp = `${destPath}.b64`;
  // truncate/create then append in ~48KB chunks
  await adb(serial, ['shell', 'sh', '-c', shArg(`: > ${tmp}`)]);
  for (let i = 0; i < b64.length; i += 48000) {
    const chunk = b64.slice(i, i + 48000);
    await adb(serial, ['shell', 'sh', '-c', shArg(`printf %s ${chunk} >> ${tmp}`)]);
  }
  // decode (toybox base64 -d, fall back to base64 -d) then make executable
  await adb(serial, ['shell', 'sh', '-c',
    shArg(`(toybox base64 -d ${tmp} > ${destPath} 2>/dev/null || base64 -d ${tmp} > ${destPath}); chmod 755 ${destPath}; rm -f ${tmp}`)]);
}

// Copy an installed APK from the source (running) instance into a new instance:
// pull the REAL apk, push it, install container-side (stable). Returns true on
// a verified install.
async function cloneApk(srcSerial, dstSerial, instance, pkg) {
  const path = String(await adb(srcSerial, ['shell', 'pm', 'path', pkg]) || '')
    .split('\n').map((l) => l.trim()).find((l) => l.startsWith('package:'));
  if (!path) throw new Error(`${pkg} not found on source ${srcSerial}`);
  const apk = path.replace(/^package:/, '');
  const dir = await mkdtemp(join(tmpdir(), 'wa-apk-'));
  const local = join(dir, 'base.apk');
  try {
    await adb(srcSerial, ['pull', apk, local]);
    await adb(dstSerial, ['push', local, '/data/local/tmp/_clone.apk']);
    const out = await lxcAttach(instance, ['/system/bin/sh', '-c',
      'pm install -r -g /data/local/tmp/_clone.apk; rm -f /data/local/tmp/_clone.apk'], 120000);
    const ok = /Success/i.test(out) || (await adb(dstSerial, ['shell', 'pm', 'path', pkg])).includes('package:');
    if (!ok) throw new Error(`install ${pkg} failed: ${out.trim().slice(0, 200)}`);
    return true;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Best-effort progress report; never blocks the flow. `note` doubles as a live
// log line (the dashboard streams these into a terminal); `status` lets us push
// a terminal FAILED line the instant a step throws, before reportComplete.
async function reportProgress(jobId, step, percent, note, status) {
  try {
    await api(`/agent/jobs/${jobId}/progress`, {
      method: 'POST',
      body: JSON.stringify({ step, percent, ...(note ? { note } : {}), ...(status ? { status } : {}) })
    });
  } catch (e) {
    log('progress report failed:', e.message);
  }
}

async function provisionDevice(job) {
  const jobId = job.id;
  const payload = job.payload || {};
  const instance = String(payload.instance || '').trim();
  if (!instance) throw new Error('provision: instance name required');
  const srcSerial = String(payload.srcSerial || process.env.FLEET_WD_SRC || '192.168.248.112:5555');
  const fp = payload.fingerprint || {};
  const proxy = payload.proxy || null;

  // Current step context so log() lines below carry the right step/percent.
  let curStep = 'infra';
  let curPct = 5;
  // Emit a live log line to the dashboard terminal (best-effort).
  const logLine = (text) => reportProgress(jobId, curStep, curPct, text);

  const step = async (key, percent, note, fn) => {
    curStep = key;
    curPct = percent;
    await reportProgress(jobId, key, percent, note);
    try {
      return await fn();
    } catch (e) {
      // Push a terminal FAILED line with the full technical detail immediately.
      await reportProgress(jobId, key, percent, `❌ HATA: ${e.message}`, 'FAILED');
      throw new Error(`provision ${key}: ${e.message}`);
    }
  };

  // 1) infra — build the isolated instance (host-level). The script's ip= is a
  //    best-guess (.112); the container actually gets its address from DHCP, so
  //    we resolve the REAL ip from the dnsmasq lease after boot (step 2).
  const infra = await step('infra', 8, 'İzole altyapı kuruluyor', async () => {
    await logLine(`Instance "${instance}" için izole altyapı kuruluyor (binderfs + bridge + userdata klon ~4GB)…`);
    const { stdout } = await hostSh('wd-provision.sh', [instance], 600000);
    const m = /PROVISION_RESULT\s+subnet=(\d+)\s+ip=(\S+)\s+port=(\d+)/.exec(stdout);
    if (!m) throw new Error(`no PROVISION_RESULT in output: ${stdout.trim().slice(-300)}`);
    await logLine(`✓ Altyapı hazır — subnet 192.168.${m[1]}.0/24, bridge waydroid-${instance}`);
    return { subnetId: Number(m[1]), ip: m[2], adbPort: Number(m[3]) };
  });
  const subnetId = infra.subnetId;
  const adbPort = infra.adbPort;
  let ip = infra.ip;
  let serial = `${ip}:${adbPort}`;

  // 2) boot — start the session DETACHED (wd-run never returns), then verify boot
  //    over ADB and resolve the real DHCP ip.
  await step('boot', 18, 'Cihaz açılışı bekleniyor', async () => {
    await logLine('Android boot ediliyor (weston + container + session)…');
    hostShDetached('wd-run.sh', [instance]); // fire-and-forget: keeps session alive
    // Give the container a moment to come up + lease an address.
    await new Promise((r) => setTimeout(r, 8000));
    const leased = await resolveLeaseIp(instance, subnetId).catch(() => null);
    if (leased && leased !== ip) {
      await logLine(`DHCP → ${leased} (container adresini aldı)`);
      ip = leased;
      serial = `${ip}:${adbPort}`;
    }
    await ensureConnected(serial);
    const booted = await waitBoot(serial, 180000);
    if (!booted) throw new Error('boot_completed not reached within 180s');
    await logLine(`✓ boot_completed=1 — Android hazır (${serial})`);
  });

  // 3) root — the cloned Magisk apk can be a stub; reinstall the real one.
  await step('root', 35, 'Root / Magisk yeniden kuruluyor', async () => {
    await logLine('Klon Magisk APK stub olabilir — gerçek Magisk (~12.7MB) kuruluyor…');
    await cloneApk(srcSerial, serial, instance, MAGISK_PKG);
    await launchApp(serial, MAGISK_PKG).catch(() => undefined); // refresh manager trust
    await new Promise((r) => setTimeout(r, 4000));
    const id = await lxcAttach(instance, ['/system/bin/sh', '-c', 'su -c id'], 20000).catch(() => '');
    if (!/uid=0/.test(id)) throw new Error(`su denied after Magisk reinstall: ${id.trim().slice(0, 120)}`);
    await logLine('✓ Root doğrulandı — su → uid=0(root)');
  });

  // 4) screen — recipe coordinates need 1080x2400 @ density 421.
  await step('screen', 47, 'Ekran ayarları (1080x2400@421)', async () => {
    await adb(serial, ['shell', 'wm', 'size', '1080x2400']);
    await adb(serial, ['shell', 'wm', 'density', '421']);
    vtouchCache.delete(serial);
    await logLine('✓ Ekran 1080x2400 @ 421 dpi ayarlandı');
  });

  // 5) vtouch + unique identity — stream vtouch into the container, spoof a
  //    UNIQUE device so WhatsApp can't link the fleet.
  await step('vtouch', 58, 'Gerçek dokunma + benzersiz kimlik', async () => {
    // stream vtouch binary + parametric wa-bringup into container-view
    const vtLocal = `/root/.local/share-${instance}/waydroid/data/local/tmp/vtouch`;
    await pushB64(serial, vtLocal, '/data/local/tmp/vtouch').catch(async () => {
      // fall back to the source instance's vtouch if the clone lacks it
      const srcVt = `/root/.local/share-work/waydroid/data/local/tmp/vtouch`;
      await pushB64(serial, srcVt, '/data/local/tmp/vtouch');
    });
    await pushB64(serial, join(WD_DIR, 'wa-bringup.sh'), '/data/local/tmp/wa-bringup.sh');
    // unique fingerprint via setprop (model/serial/android_id/etc.)
    await applyFingerprint(serial, { fingerprint: fp }).catch((e) => log('applyFingerprint:', e.message));
    // re-pin screen (applyFingerprint may have changed wm size from fp.resolution)
    await adb(serial, ['shell', 'wm', 'size', '1080x2400']);
    await adb(serial, ['shell', 'wm', 'density', '421']);
    vtouchCache.delete(serial);
    // run wa-bringup as root with unique-identity env (resetprop + vtouch node)
    const env = [
      fp.model ? `WA_MODEL=${shArg(fp.model)}` : '',
      fp.brand ? `WA_BRAND=${shArg(fp.brand)}` : '',
      fp.manufacturer ? `WA_MANUFACTURER=${shArg(fp.manufacturer)}` : '',
      fp.buildNumber ? `WA_FINGERPRINT=${shArg(fp.buildNumber)}` : '',
      fp.serialNo ? `WA_SERIAL=${shArg(fp.serialNo)}` : '',
      fp.androidId ? `WA_ANDROID_ID=${shArg(fp.androidId)}` : ''
    ].filter(Boolean).join(' ');
    await adb(serial, ['shell', 'su', '-c', shArg(`${env} sh /data/local/tmp/wa-bringup.sh`)]).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 2000));
    const ok = await ensureVtouch(serial).catch(() => false);
    const model = fp.model || 'SM-G991B';
    await logLine(ok
      ? `✓ vtouch aktif + benzersiz kimlik (${model}) uygulandı`
      : `⚠ Kimlik (${model}) uygulandı, vtouch InputReader'da henüz görünmüyor`);
  });

  // 6) route — Android netstack leaves fwmark tables empty every boot.
  await step('route', 68, 'Ağ yönlendirme', async () => {
    const gw = `192.168.${subnetId}.1`;
    const cidr = `192.168.${subnetId}.0/24`;
    for (const table of ['main', 'local_network', 'eth0']) {
      await lxcAttach(instance, ['ip', 'route', 'add', 'default', 'via', gw, 'dev', 'eth0', 'table', table], 15000).catch(() => undefined);
    }
    for (const table of ['eth0', 'local_network']) {
      await lxcAttach(instance, ['ip', 'route', 'add', cidr, 'dev', 'eth0', 'proto', 'static', 'scope', 'link', 'src', ip, 'table', table], 15000).catch(() => undefined);
    }
    await logLine(`✓ Ağ yönlendirme eklendi (gw ${gw})`);
  });

  // 7) proxy — country-matched residential exit (only if requested).
  if (proxy && proxy.country && proxy.username && proxy.host) {
    await step('proxy', 76, `Proxy (${proxy.country})`, async () => {
      await logLine(`${proxy.country} residential proxy'ye yönlendiriliyor (redsocks + iptables)…`);
      await hostSh('wd-proxy.sh', [
        instance, String(proxy.country), String(proxy.username),
        String(proxy.password || ''), String(proxy.host), String(proxy.port || 9999)
      ], 60000);
      await logLine(`✓ Çıkış IP ${proxy.country} ülkesine yönlendirildi`);
    });
  } else {
    await logLine('Proxy istenmedi — atlanıyor (datacenter IP)');
  }

  // 8) apks — clone the WhatsApp-automation app set from the source instance.
  await step('apks', 84, 'Uygulamalar kuruluyor', async () => {
    const pkgs = [
      ['com.whatsapp', 'WhatsApp'],
      ['com.android.vending', 'Play Store'],
      ['com.google.android.gms', 'Play Services'],
      ['com.android.adbkeyboard', 'ADB Klavye'],
      ['com.fleet.a11y', 'Erişilebilirlik']
    ];
    for (const [pkg, name] of pkgs) {
      const has = (await adb(serial, ['shell', 'pm', 'path', pkg]).catch(() => '')).includes('package:');
      if (has) { await logLine(`• ${name} zaten kurulu`); continue; }
      await logLine(`${name} kuruluyor…`);
      await cloneApk(srcSerial, serial, instance, pkg)
        .then(() => logLine(`✓ ${name} kuruldu`))
        .catch((e) => logLine(`⚠ ${name} kurulamadı: ${e.message.slice(0, 100)}`));
    }
  });

  // 9) a11y + keyboard — enable the accessibility service + ADBKeyboard IME.
  await step('a11y', 92, 'Erişilebilirlik + klavye', async () => {
    await adb(serial, ['shell', 'cmd', 'settings', 'put', 'secure', 'enabled_accessibility_services',
      'com.fleet.a11y/com.fleet.a11y.FleetA11yService']).catch(() => undefined);
    await adb(serial, ['shell', 'cmd', 'settings', 'put', 'secure', 'accessibility_enabled', '1']).catch(() => undefined);
    await adb(serial, ['shell', 'ime', 'enable', 'com.android.adbkeyboard/.AdbIME']).catch(() => undefined);
    await adb(serial, ['shell', 'ime', 'set', 'com.android.adbkeyboard/.AdbIME']).catch(() => undefined);
    // GMS crash service that spams "Play Store keeps stopping" during registration
    await adb(serial, ['shell', 'su', '-c',
      'pm disable com.google.android.gms/.chimera.PersistentDirectBootAwareApiService']).catch(() => undefined);
    await logLine('✓ Erişilebilirlik servisi + ADB klavye etkinleştirildi');
  });

  // 10) persist — verify the full stack is up.
  const checks = await step('persist', 97, 'Kalıcılık doğrulanıyor', async () => {
    const boot = String(await adbT(serial, ['shell', 'getprop', 'sys.boot_completed'], 8000) || '').trim() === '1';
    const rootOk = /uid=0/.test(await lxcAttach(instance, ['/system/bin/sh', '-c', 'su -c id'], 15000).catch(() => ''));
    const vt = await ensureVtouch(serial).catch(() => false);
    await logLine(`Kontrol: boot=${boot ? '✓' : '✗'} root=${rootOk ? '✓' : '✗'} vtouch=${vt ? '✓' : '✗'} proxy=${proxy ? '✓' : '—'}`);
    return { boot, root: rootOk, vtouch: vt, proxy: !!proxy };
  });

  // 11) done.
  await reportProgress(jobId, 'done', 100, `✓ Kurulum tamamlandı — ${instance} WhatsApp-hazır (${serial})`);
  return { instance, serial, ip, adbPort, subnetId, ready: true, checks };
}

async function runRpaStep(serial, step) {
  const type = String(step.type);
  switch (type) {
    case 'tap':
      return adb(serial, ['shell', 'input', 'tap', String(step.x), String(step.y)]);
    case 'swipe':
      return adb(serial, ['shell', 'input', 'swipe', String(step.x), String(step.y), String(step.x2), String(step.y2)]);
    case 'type':
      return inputText(serial, String(step.text ?? ''));
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
      // centre from the UIAutomator bounds and taps there. When a `locator` object
      // is supplied, use the fallback chain (desc→text→id→class→coords) for
      // resilience to resource-id/text drift across app versions.
      const field = type === 'tapText' ? 'text' : type === 'tapDesc' ? 'desc' : 'id';
      const query = String(step.query ?? step.text ?? '');
      const nodes = parseUiNodes(await uiDumpXml(serial));
      const node = step.locator
        ? resolveTarget(nodes, step.locator)
        : findNode(nodes, query, field);
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

// Reject URLs that point at the host/private network. The full urlGuard (DNS
// resolve + range check) lives on the API side; the agent is zero-dep, so we do a
// lightweight literal-address + scheme + credential check. This blocks the obvious
// SSRF payloads (http://169.254.169.254, http://10.x, http://[::1], http://localhost)
// without pulling in `node:dns`. A hostname that resolves to a private IP at
// connect time is not caught here, but redirects are re-checked at every hop.
function assertPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error(`Invalid URL: ${raw}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${u.protocol}`);
  }
  if (u.username || u.password) throw new Error('Blocked URL with embedded credentials');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase(); // strip IPv6 brackets
  const isPrivate =
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host === '::1' || host === '0.0.0.0' ||
    host.startsWith('127.') || host.startsWith('10.') ||
    host.startsWith('192.168.') || host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||           // 172.16.0.0/12
    /^(fc|fd)[0-9a-f]{2}:/.test(host) ||                 // fc00::/7 unique-local
    host.startsWith('fe80:');                            // link-local
  if (isPrivate) throw new Error(`Blocked private/loopback host: ${host}`);
  return u;
}

async function download(url, name) {
  assertPublicUrl(url);
  // Follow redirects manually so each hop is re-validated (a public URL can 302
  // to an internal one → SSRF). Cap the chain to avoid loops.
  let current = String(url);
  let res;
  for (let hop = 0; hop < 5; hop++) {
    res = await fetch(current, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      assertPublicUrl(current);
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`Download failed (${res ? res.status : 'no response'}) for ${url}`);
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

// HMAC request signing (payload integrity + replay protection).
//
// Every agent→API request is signed with HMAC-SHA256 over a canonical string:
//   `${timestamp}.${METHOD}.${path}.${bodyString}`
// The signing KEY is the plaintext host agent key (HOST_KEY) — the SAME value we
// already send in `x-agent-key`. The API looks the host up by sha256(x-agent-key)
// and then re-computes this HMAC with the same plaintext key it just received, so
// no extra shared secret / schema change is needed. Timestamp lets the API reject
// stale/replayed requests (±5 min window). Uses only node:crypto (zero-dep).
//
// Emitted headers:
//   x-agent-ts    = millisecond timestamp used in the signed string
//   x-agent-sign  = hex HMAC-SHA256 of the canonical string
function signRequest(method, path, bodyString) {
  const ts = String(Date.now());
  const canonical = `${ts}.${String(method).toUpperCase()}.${path}.${bodyString || ''}`;
  const sign = createHmac('sha256', HOST_KEY).update(canonical).digest('hex');
  return { ts, sign };
}

// fetch() wrapper that attaches the auth headers PLUS the HMAC signature headers.
// The signed `path` and `bodyString` must exactly match what the server sees
// (req.originalUrl and the raw JSON body), so callers pass the same path/body.
async function signedFetch(path, init) {
  const method = (init && init.method) || 'GET';
  const bodyString = (init && typeof init.body === 'string') ? init.body : '';
  const { ts, sign } = signRequest(method, path, bodyString);
  const mergedHeaders = { ...headers, ...(init && init.headers ? init.headers : {}), 'x-agent-ts': ts, 'x-agent-sign': sign };
  return fetch(`${API_URL}${path}`, { ...init, headers: mergedHeaders });
}

async function api(path, init) {
  const res = await signedFetch(path, init);
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

// The ADB serials currently reporting "device" (reachable — not offline/
// unauthorized/missing). The API uses this exact set to mark only the phones
// that are truly up as ONLINE, instead of assuming every bound device is live.
async function reachableSerials() {
  try {
    const out = await adb(null, ['devices']);
    return out
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => /\sdevice$/.test(l))
      .map((l) => l.split(/\s+/)[0])
      .filter(Boolean);
  } catch {
    return [];
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

// --- WhatsApp inbound message capture (notification poll) -------------------
//
// Zero-dep, root-based inbound listener: every WA_INBOX_MS we read
// `dumpsys notification` (as root) and parse WhatsApp NotificationRecord blocks
// into {from,text}. New (deduped) messages are pushed to the control plane via
// POST /agent/whatsapp/inbound, which persists them, fans out a webhook, a WS
// event, and a Telegram/Slack/Discord notification. No APK / accessibility
// service needed — works with the screen off.
const WA_INBOX_MS = Number(process.env.FLEET_WA_INBOX_MS || 3000);
const WA_INBOX_ENABLED = process.env.FLEET_WA_INBOX !== '0';
// serial -> Set of recent message keys (sha256), capped to avoid unbounded growth.
const waSeen = new Map();
const WA_SEEN_MAX = 400;
// serial -> last scrape state { sig, seq }. The foreground bubble-scrape only
// sees the NEWEST incoming bubble, so two identical short replies ("ok", "evet")
// would collapse to one dedup key and the second would be lost. We emit only
// when the visible signature (text + position + incoming-count) changes, and tag
// each emission with a monotonic sequence so genuinely-distinct same-text
// messages get distinct dedup keys. Notification-path messages are untouched.
const waScrapeState = new Map();

function waSeenSet(serial) {
  let s = waSeen.get(serial);
  if (!s) { s = new Set(); waSeen.set(serial, s); }
  return s;
}

// Parse `dumpsys notification --noredact` for WhatsApp message notifications.
// Returns [{ from, text, whenMs }]. WhatsApp uses android.title=sender name/number,
// android.text=message body (or android.messages / android.bigText for multi-line).
function parseWaNotifications(dump) {
  const out = [];
  // Split into per-notification blocks; keep only WhatsApp ones.
  const blocks = String(dump).split(/NotificationRecord\(/).slice(1);
  for (const b of blocks) {
    const head = b.slice(0, 300);
    if (!/pkg=com\.whatsapp\b/.test(head)) continue;
    // Skip WhatsApp's own persistent/service notifications (calls, backup, etc.)
    // We only want conversational message notifications: they carry a title+text.
    const title = pickExtra(b, 'android.title');
    let text = pickExtra(b, 'android.bigText') || pickExtra(b, 'android.text');
    if (!title || !text) continue;
    // Ignore summary/aggregate lines like "3 new messages" / "N messages from M chats".
    if (/^\d+\s+new messages?$/i.test(text) || /messages? from .* chats?$/i.test(text)) continue;
    // Ignore non-message notices (backup, storage, security).
    if (/^(Backing up|Checking for new messages|WhatsApp web|Tap for more)/i.test(text)) continue;
    const whenMs = Number(/when=(\d+)/.exec(b)?.[1] || 0);
    out.push({ from: title.trim(), text: text.trim(), whenMs });
  }
  return out;
}

// Extract an android.* extra value from a NotificationRecord block. Android's
// dumpsys prints extras as `android.title=TYPE (VALUE)` where TYPE is String /
// SpannableString / CharSequence and VALUE is inside parentheses, e.g.
//   android.title=SpannableString (Jane Doe)
//   android.text=String (Hey are you there?)
// We pull the parenthesized value; if the format ever differs we fall back to
// the rest-of-line.
function pickExtra(block, key) {
  const line = new RegExp(key.replace(/\./g, '\\.') + '=([^\\n]*)').exec(block);
  if (!line) return '';
  const raw = line[1].trim();
  // Typed form: "String (value)" / "SpannableString (value)".
  const typed = /^(?:String|SpannableString|CharSequence|Spanned)\s*\((.*)\)\s*$/s.exec(raw);
  if (typed) return typed[1].trim();
  // Untyped fallback: strip a trailing "(String)" hint if any.
  return raw.replace(/\s*\((String|CharSequence|SpannableString)\)\s*$/i, '');
}

// Scrape INCOMING message bubbles from an open WhatsApp Conversation. Incoming
// bubbles sit on the LEFT half of the screen (outgoing are on the right), so we
// use each message_text node's horizontal center to keep only received ones.
// Returns [{from, text, whenMs}] shaped like parseWaNotifications for merging.
async function scrapeIncomingBubbles(serial) {
  // parseUiNodes is SYNCHRONOUS (returns an array, not a Promise) — the old
  // `...).catch()` threw a TypeError and killed the whole poll. Guard the (async)
  // uiDumpXml + (sync) parse together and bail cleanly on any failure.
  let nodes = [];
  try { nodes = parseUiNodes(await uiDumpXml(serial)); } catch { return []; }
  if (!nodes.length) return [];
  // Screen width to split left/right.
  let sw = 720;
  try {
    const wm = await adb(serial, ['shell', 'wm', 'size']);
    const ov = /Override size:\s*(\d+)x/.exec(wm);
    const ph = /Physical size:\s*(\d+)x/.exec(wm);
    const m = ov || ph; if (m) sw = Number(m[1]) || sw;
  } catch { /* keep default */ }
  // The chat title bar holds the peer name/number.
  const peer = (nodes.find((n) => n.resId.includes('conversation_contact_name'))?.text
    || nodes.find((n) => n.resId.includes('conversation_contact'))?.text
    || 'WhatsApp').trim();
  // Collect incoming (left-anchored) message_text bubbles, keeping their vertical
  // position so we can take only the LAST (newest) one. Scraping every visible
  // bubble would re-notify old messages on each poll.
  const incoming = [];
  for (const n of nodes) {
    if (!n.text || !n.resId.includes('message_text')) continue;
    if (typeof n.cx === 'number' && n.cx > sw * 0.5) continue; // outgoing → skip
    incoming.push({ text: n.text.trim(), cy: typeof n.cy === 'number' ? n.cy : 0 });
  }
  if (!incoming.length) return [];
  // Order bubbles top→bottom (oldest→newest) by vertical position.
  incoming.sort((a, b) => a.cy - b.cy);

  // Emit every incoming bubble AFTER the last one we already emitted, not just the
  // single newest. When the operator sends several quick replies within one poll
  // interval (3s), the old "newest only" logic dropped the ones in between. We
  // anchor on the last-emitted text: find it in the current visible list and emit
  // everything below it. If it's not visible anymore (scrolled off) we emit just
  // the newest to avoid re-flooding old history. The seen-set (from|text) still
  // dedups across ticks, so re-emitting an already-pushed bubble is a no-op.
  const prev = waScrapeState.get(serial);
  const texts = incoming.map((b) => b.text).filter(Boolean);
  if (!texts.length) return [];
  const newest = texts[texts.length - 1];
  // Nothing changed since last tick → skip.
  if (prev && prev.sig === newest) return [];

  let toEmit;
  if (prev && prev.sig) {
    const idx = texts.lastIndexOf(prev.sig);
    // Emit bubbles after the anchor; if the anchor isn't visible, just the newest.
    toEmit = idx >= 0 ? texts.slice(idx + 1) : [newest];
  } else {
    toEmit = [newest]; // first sighting on this serial → only the newest
  }
  waScrapeState.set(serial, { sig: newest });
  // whenMs stays 0 → the push uses Date.now(). Dedup by from|text in the seen-set.
  return toEmit.map((text) => ({ from: peer, text, whenMs: 0 }));
}

async function pollWhatsappInbox(serial) {
  const dump = await adbSu(serial, 'dumpsys notification --noredact 2>/dev/null');
  let msgs = dump ? parseWaNotifications(dump) : [];

  // WhatsApp suppresses notifications while a chat is OPEN in the foreground, so
  // the notification poll would miss those messages. When WhatsApp's Conversation
  // is on screen, also scrape incoming bubbles directly (message_text nodes that
  // aren't ours). This makes inbound capture work whether the app is fore/back.
  try {
    const top = await adb(serial, ['shell', 'dumpsys', 'activity', 'activities']);
    if (/com\.whatsapp\/\S*Conversation/.test(top)) {
      const scraped = await scrapeIncomingBubbles(serial);
      if (scraped.length) msgs = msgs.concat(scraped);
    }
  } catch { /* best-effort */ }

  if (msgs.length === 0) return;
  const seen = waSeenSet(serial);
  const fresh = [];
  for (const m of msgs) {
    // Include `seq` for scrape-path messages (undefined for notification-path):
    // it lets two identical-text foreground replies dedup as distinct.
    const key = createHash('sha256').update(`${m.from}|${m.text}|${m.whenMs}|${m.seq ?? ''}`).digest('hex');
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push({ ...m, key });
  }
  // Cap the seen-set memory.
  if (seen.size > WA_SEEN_MAX) {
    const excess = seen.size - WA_SEEN_MAX;
    let i = 0;
    for (const k of seen) { if (i++ >= excess) break; seen.delete(k); }
  }
  if (fresh.length === 0) return;
  for (const m of fresh) {
    try {
      // Push by ADB serial; the control plane maps it to the workspace-scoped
      // deviceId (it owns the host↔device binding and agent auth).
      await api('/agent/whatsapp/inbound', {
        method: 'POST',
        body: JSON.stringify({ serial, from: m.from, text: m.text, ts: m.whenMs || Date.now() }),
      });
      log(`wa inbound ${serial}: ${m.from} -> ${m.text.slice(0, 40)}`);
    } catch (err) {
      // Re-arm so a transient push failure retries next tick instead of dropping.
      seen.delete(m.key);
      log('wa inbound push failed:', err.message);
    }
  }
}

// Poll every reachable device for new WhatsApp notifications. Devices without
// root / WhatsApp simply return nothing (adbSu → '' on failure).
async function whatsappInboxTick() {
  if (!WA_INBOX_ENABLED) return;
  // Skip while a job is running. A job's WhatsApp RPA (uiautomator dump / screencap
  // / taps) and the inbox poll's own dumpsys/screencap on the SAME device race each
  // other on this Waydroid host — that contention is a leading cause of the "job
  // hangs / dump comes back blank" instability. Serialising the inbox poll behind
  // the job loop keeps every job's device access exclusive, so jobs run faster and
  // more reliably even under back-to-back load.
  if (jobBusy) return;
  try {
    const serials = await reachableSerials();
    for (const serial of serials) {
      if (jobBusy) return; // a job may have started mid-tick — yield the device
      await pollWhatsappInbox(serial).catch(() => undefined);
    }
  } catch (err) {
    log('wa inbox tick failed:', err.message);
  }
}

async function heartbeat() {
  try {
    const serials = await reachableSerials();
    // Send both the count (host capacity gauge) and the exact reachable serials
    // so the API marks only live phones ONLINE and the rest OFFLINE.
    await api('/agent/heartbeat', { method: 'POST', body: JSON.stringify({ runningPhones: serials.length, serials }) });
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

// Fast streaming via on-device H.264 + ffmpeg → MJPEG. screenrecord emits a live
// H.264 elementary stream; ffmpeg decodes it and re-encodes to a continuous MJPEG
// stream on stdout. We split that stream on JPEG SOI/EOI markers and push each
// complete JPEG as one frame over the existing FRM: protocol — so the dashboard
// is unchanged, but frames arrive at 20-30fps instead of ~1fps. screenrecord has
// a 180s hard limit, so we respawn the pipeline when it ends.
function startCaptureH264(ws, deviceId, serial) {
  void ensureConnected(serial);
  const prefix = Buffer.concat([FRAME_PREFIX, Buffer.from(frameDeviceId(deviceId))]);
  const MAX_BUFFERED = 1_500_000;
  const state = { serial, h264: true, rec: null, ff: null, stopped: false, buf: Buffer.alloc(0) };

  const spawnPipeline = () => {
    if (state.stopped) return;
    // 1) screenrecord → raw H.264 on stdout (downscaled for speed)
    const rec = spawn(ADB, ['-s', serial, 'exec-out',
      `screenrecord --output-format=h264 --size ${STREAM_W}x${Math.round(STREAM_W * 20 / 9)} --bit-rate ${bitrateBps(STREAM_BITRATE)} --time-limit=170 -`
    ], { windowsHide: true });
    // 2) ffmpeg: H.264 stdin → MJPEG stdout (q=6 ~ good/small, low latency flags)
    // No fps filter: it re-clones the last frame on a static screen and actually
    // throttled output to ~0fps in testing. Passing every decoded frame yields
    // ~20-25fps with live motion and idles cheaply when the screen is still.
    const ff = spawn(FFMPEG, [
      '-loglevel', 'error', '-fflags', 'nobuffer', '-flags', 'low_delay',
      '-f', 'h264', '-i', 'pipe:0',
      '-an', '-c:v', 'mjpeg', '-q:v', '7', '-pix_fmt', 'yuvj420p',
      '-f', 'mjpeg', 'pipe:1'
    ], { windowsHide: true });
    state.rec = rec; state.ff = ff;

    rec.stdout.on('data', (d) => { try { ff.stdin.write(d); } catch { /* ff gone */ } });
    rec.on('error', (e) => log(`[screenrecord] spawn error: ${e.message}`));
    // screenrecord has a hard time-limit; on close, end ffmpeg's stdin and respawn
    // the whole pipeline so the stream is continuous.
    rec.on('close', () => { try { ff.stdin.end(); } catch { /* ignore */ } if (!state.stopped) setTimeout(spawnPipeline, 200); });
    ff.stdin.on('error', () => { /* pipe closed; rec close will respawn */ });

    // Parse the MJPEG stream: frames are JPEG (FFD8 ... FFD9). Accumulate and emit
    // each complete JPEG.
    ff.stdout.on('data', (chunk) => {
      state.buf = state.buf.length ? Buffer.concat([state.buf, chunk]) : chunk;
      // Emit every complete JPEG currently in the buffer.
      let start = state.buf.indexOf(SOI);
      while (start !== -1) {
        const end = state.buf.indexOf(EOI, start + 2);
        if (end === -1) break; // incomplete; wait for more
        const jpeg = state.buf.subarray(start, end + 2);
        if (ws.readyState === 1 && ws.bufferedAmount <= MAX_BUFFERED) {
          ws.send(Buffer.concat([prefix, jpeg]));
        }
        state.buf = state.buf.subarray(end + 2);
        start = state.buf.indexOf(SOI);
      }
      // Guard against unbounded growth if no EOI ever arrives.
      if (state.buf.length > 8_000_000) state.buf = Buffer.alloc(0);
    });
    ff.stderr.on('data', (d) => { const s = d.toString().trim(); if (s && /error|invalid|failed/i.test(s)) log(`[ffmpeg] ${s.slice(0, 200)}`); });
    ff.on('error', (e) => log(`[ffmpeg] spawn error: ${e.message} — is FLEET_FFMPEG correct?`));
    ff.on('close', () => { if (!state.stopped) setTimeout(spawnPipeline, 200); });
  };

  spawnPipeline();
  captures.set(deviceId, state);
  log(`stream start ${deviceId} via H.264 (${STREAM_W}px)`);
}

const SOI = Buffer.from([0xff, 0xd8]); // JPEG start-of-image
const EOI = Buffer.from([0xff, 0xd9]); // JPEG end-of-image

// Raw H.264 fast path (no ffmpeg transcode). The agent ships the live Annex-B
// elementary stream straight to the browser, which decodes it with WebCodecs —
// removing the host-side ffmpeg→MJPEG re-encode and lifting the old ~3fps PNG
// cap. Frames are framed "H264:" + deviceId(36) + 1 keyframe-flag byte + bytes.
// The hub caches the config (SPS/PPS) chunk so late-joining viewers can start.
const H264_PREFIX = Buffer.from('H264');
const STREAM_H264_RAW = process.env.FLEET_STREAM_H264_RAW === '1';

// Split an Annex-B buffer into NAL units (each starting at a 00 00 01 / 00 00 00 01
// start code) and report whether the chunk carries config (SPS=7/PPS=8) or an
// IDR keyframe (5). We don't need a full parser — just the nal_unit_type nibble.
function classifyH264Chunk(buf) {
  let hasConfig = false;
  let hasIdr = false;
  for (let i = 0; i + 3 < buf.length; i++) {
    // start code: 00 00 01 (3) or 00 00 00 01 (4)
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      const t = buf[i + 3] & 0x1f;
      if (t === 7 || t === 8) hasConfig = true;
      else if (t === 5) hasIdr = true;
      i += 2;
    }
  }
  return { hasConfig, hasIdr };
}

// Raw H.264 capture: screenrecord → stdout → frame to the browser unchanged.
function startCaptureH264Raw(ws, deviceId, serial) {
  void ensureConnected(serial);
  const prefix = Buffer.concat([H264_PREFIX, Buffer.from(frameDeviceId(deviceId))]);
  const MAX_BUFFERED = 4_000_000;
  const state = { serial, h264raw: true, rec: null, stopped: false };

  const spawnRec = () => {
    if (state.stopped) return;
    const rec = spawn(ADB, ['-s', serial, 'exec-out',
      `screenrecord --output-format=h264 --size ${STREAM_W}x${Math.round(STREAM_W * 20 / 9)} --bit-rate ${bitrateBps(STREAM_BITRATE)} --time-limit=170 -`
    ], { windowsHide: true });
    state.rec = rec;
    rec.stdout.on('data', (chunk) => {
      if (ws.readyState !== 1 || ws.bufferedAmount > MAX_BUFFERED) return;
      const { hasConfig, hasIdr } = classifyH264Chunk(chunk);
      // flag byte: bit0 = keyframe/IDR, bit1 = carries SPS/PPS config.
      const flag = Buffer.from([(hasIdr ? 1 : 0) | (hasConfig ? 2 : 0)]);
      try { ws.send(Buffer.concat([prefix, flag, chunk])); } catch { /* gone */ }
    });
    rec.on('error', (e) => log(`[screenrecord-raw] ${e.message}`));
    // 170s hard limit → respawn for a continuous stream. A fresh screenrecord
    // re-emits SPS/PPS + an IDR, so the decoder re-syncs automatically.
    rec.on('close', () => { if (!state.stopped) setTimeout(spawnRec, 150); });
  };

  spawnRec();
  captures.set(deviceId, state);
  log(`stream start ${deviceId} via RAW H.264 (${STREAM_W}px, WebCodecs)`);
}

function bitrateBps(s) {
  const m = String(s).trim().match(/^(\d+(?:\.\d+)?)\s*([mMkK]?)$/);
  if (!m) return 4_000_000;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  return Math.round(n * (unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1));
}

function startCapture(ws, deviceId, serial, fps) {
  stopCapture(deviceId);
  if (!serial) return;
  // Fastest path: raw H.264 to the browser's WebCodecs decoder (no host transcode).
  if (STREAM_H264_RAW) { startCaptureH264Raw(ws, deviceId, serial); return; }
  // Next: H.264 → MJPEG via ffmpeg when ffmpeg is configured.
  if (FFMPEG) { startCaptureH264(ws, deviceId, serial); return; }
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
  const state = { serial, busy: false, stopped: false, timer: null, fps };
  const prefix = Buffer.concat([FRAME_PREFIX, Buffer.from(frameDeviceId(deviceId))]);
  // Tight self-scheduling loop instead of setInterval. `screencap -p` on a
  // software-rendered Waydroid takes ~200-250ms, which capped the old timer at
  // ~4fps. We fire the NEXT screencap immediately after each frame completes
  // (no fixed delay), so the pipeline runs as fast as the device can serialize
  // frames rather than idling between ticks. Backpressure still drops frames
  // when the socket is congested so latency stays bounded.
  const loop = async () => {
    while (!state.stopped) {
      if (ws.readyState !== 1) break;
      if (ws.bufferedAmount > MAX_BUFFERED) { await new Promise((r) => setTimeout(r, 15)); continue; }
      try {
        const img = await captureFrame(serial);
        if (state.stopped) break;
        if (ws.readyState === 1 && ws.bufferedAmount <= MAX_BUFFERED) {
          ws.send(Buffer.concat([prefix, img]));
        }
      } catch {
        await new Promise((r) => setTimeout(r, 50)); // brief backoff on error
      }
      // Yield so we honor at most the requested fps (but never idle-throttle
      // below the device's own capture rate).
      const minGap = Math.max(0, interval - 5);
      if (minGap) await new Promise((r) => setTimeout(r, minGap === interval ? 0 : 1));
    }
  };
  captures.set(deviceId, state);
  void loop();
  log(`stream start ${deviceId} @ ~${Math.round(1000 / interval)}fps target (pipelined)`);
}

function stopCapture(deviceId) {
  const s = captures.get(deviceId);
  if (s) {
    s.stopped = true;
    if (s.timer) clearInterval(s.timer);
    if (s.rec) { try { s.rec.kill(); } catch { /* ignore */ } }
    if (s.ff) { try { s.ff.kill(); } catch { /* ignore */ } }
    captures.delete(deviceId);
    log(`stream stop ${deviceId}`);
  }
}

// Make ADBKeyboard the active IME for a serial (module-level, used by live
// control). Cached per-serial so we don't re-run `ime set` on every keystroke.
const adbKbReady = new Set();
async function ensureAdbKeyboard(serial) {
  if (adbKbReady.has(serial)) return true;
  try {
    const imes = await adb(serial, ['shell', 'ime', 'list', '-a', '-s']);
    if (!imes.includes('adbkeyboard')) return false;
    await adb(serial, ['shell', 'ime', 'enable', ADB_IME]);
    await adb(serial, ['shell', 'ime', 'set', ADB_IME]);
    adbKbReady.add(serial);
    return true;
  } catch {
    return false;
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
      if (serial) {
        if (msg.stealth) await stealthTap(serial, msg.x, msg.y);
        else await adb(serial, ['shell', 'input', 'tap', String(msg.x), String(msg.y)]);
      }
      return;
    case 'input.swipe':
      if (serial) {
        if (msg.stealth) await stealthSwipe(serial, msg.x, msg.y, msg.x2, msg.y2);
        else await adb(serial, ['shell', 'input', 'swipe', String(msg.x), String(msg.y), String(msg.x2), String(msg.y2), String(msg.ms || 120)]);
      }
      return;
    case 'input.key':
      if (serial) await adb(serial, ['shell', 'input', 'keyevent', String(msg.keycode)]);
      return;
    case 'input.text':
      if (serial) {
        const t = String(msg.text || '');
        if (msg.stealth) await stealthType(serial, t);
        // Prefer the ADBKeyboard IME broadcast: WhatsApp (and other hardened
        // apps) drop plain `input text` into their EditTexts, but accept the
        // IME-injected `ADB_INPUT_TEXT` broadcast. Fall back to `input text`
        // when the ADB keyboard IME isn't the active one.
        else if (await ensureAdbKeyboard(serial)) {
          await adb(serial, ['shell', 'am', 'broadcast', '-a', 'ADB_INPUT_TEXT', '--es', 'msg', shArg(t)]);
        } else {
          await inputText(serial, t);
        }
      }
      return;
    default:
      return;
  }
}

// AI Device Agent WS request/response. The control plane (which holds the
// Anthropic key + drives the loop) asks us to (a) dump the screen as a compact
// tree, or (b) execute one action and re-dump. We reply with the same reqId so
// the API can correlate. After an action we ALWAYS re-dump and attach the fresh
// tree so the model sees the consequence in the same tool_result (auto-append).
// Capture a PNG screenshot as base64 for vision. When ffmpeg is configured we
// downscale to ~720px wide PNG (smaller payload, faster Claude vision); without
// ffmpeg we send the raw screencap PNG. Returns '' on failure (vision optional).
async function captureShot(serial) {
  try {
    const png = await captureFrame(serial); // raw PNG buffer
    if (FFMPEG) {
      try {
        const scaled = await new Promise((resolve, reject) => {
          const ff = spawn(FFMPEG, ['-loglevel', 'error', '-i', 'pipe:0', '-vf', 'scale=720:-1', '-f', 'apng', 'pipe:1'], { windowsHide: true });
          const chunks = [];
          ff.stdout.on('data', (d) => chunks.push(d));
          ff.on('error', reject);
          ff.on('close', () => resolve(Buffer.concat(chunks)));
          ff.stdin.on('error', () => undefined);
          ff.stdin.write(png);
          ff.stdin.end();
        });
        if (scaled && scaled.length > 0) return scaled.toString('base64');
      } catch { /* fall back to raw png */ }
    }
    return png.toString('base64');
  } catch {
    return '';
  }
}

async function handleAgentRequest(stream, msg) {
  const serial = msg.serial;
  const send = (obj) => { try { if (stream.readyState === 1) stream.send(JSON.stringify(obj)); } catch { /* gone */ } };
  if (!serial) {
    send({ type: `${msg.type}.result`, reqId: msg.reqId, ok: false, error: 'no ADB serial for device', tree: '' });
    return;
  }
  await ensureConnected(serial);
  if (msg.type === 'agent.dump') {
    try {
      const nodes = parseUiNodes(await uiDumpXml(serial));
      const wh = await screenSize(serial);
      const shot = msg.wantShot ? await captureShot(serial) : '';
      send({ type: 'agent.dump.result', reqId: msg.reqId, ok: true, tree: buildScreenTree(nodes, Number(msg.cap) || 40), nodeCount: nodes.length, width: wh.width, height: wh.height, ...(shot ? { shot } : {}) });
    } catch (e) {
      send({ type: 'agent.dump.result', reqId: msg.reqId, ok: false, error: e.message, tree: '' });
    }
    return;
  }
  // agent.action
  try {
    await execAgentAction(serial, msg.action, Boolean(msg.stealth));
    await new Promise((r) => setTimeout(r, 600)); // let the UI settle
    const nodes = parseUiNodes(await uiDumpXml(serial));
    const shot = msg.wantShot ? await captureShot(serial) : '';
    send({ type: 'agent.action.result', reqId: msg.reqId, ok: true, tree: buildScreenTree(nodes, 40), ...(shot ? { shot } : {}) });
  } catch (e) {
    let tree = '';
    try { tree = buildScreenTree(parseUiNodes(await uiDumpXml(serial)), 40); } catch { /* ignore */ }
    send({ type: 'agent.action.result', reqId: msg.reqId, ok: false, error: e.message, tree });
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
      else if (msg.type === 'agent.dump' || msg.type === 'agent.action') await handleAgentRequest(stream, msg).catch(() => undefined);
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
// True while a claimed job is executing. The WhatsApp inbox poll checks this and
// yields the device so the job's RPA has exclusive ADB access (see whatsappInboxTick).
let jobBusy = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function loop() {
  log(`starting — polling ${API_URL} every ${POLL_MS}ms`);
  await heartbeat();
  const hb = setInterval(heartbeat, HEARTBEAT_MS);
  // WhatsApp inbound-message poll (notification-based). Best-effort; failures
  // are logged and never block the job loop. Gated on jobBusy so it never contends
  // with a running job on the same device.
  const waInbox = WA_INBOX_ENABLED ? setInterval(() => { whatsappInboxTick().catch(() => undefined); }, WA_INBOX_MS) : null;
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
    jobBusy = true;
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
    } finally {
      jobBusy = false;
    }
  }

  clearInterval(hb);
  if (waInbox) clearInterval(waInbox);
  log('shutting down.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Test mode ────────────────────────────────────────────────────────────────
// Run a SINGLE job locally and print its result, without touching the API/queue.
// Usage: FLEET_TEST_JOB='{"type":"WHATSAPP_MYNUMBER","serial":"192.168.240.112:5555","payload":{}}' node agent.mjs
// This exercises the exact runJob() path a claimed job would take — the truest
// local verification of a device flow. Exits when done.
if (process.env.FLEET_TEST_JOB) {
  (async () => {
    let spec;
    try { spec = JSON.parse(process.env.FLEET_TEST_JOB); }
    catch (e) { console.error('[test] bad FLEET_TEST_JOB json:', e.message); process.exit(2); }
    const job = { id: 'test-' + Date.now(), type: spec.type, serial: spec.serial, payload: spec.payload || {} };
    console.error(`[test] running ${job.type} on ${job.serial} ...`);
    try {
      const result = await runJob(job);
      console.log('TEST_RESULT_JSON:' + JSON.stringify(result));
      process.exit(0);
    } catch (err) {
      console.log('TEST_ERROR_JSON:' + JSON.stringify({ error: err.message, stack: err.stack }));
      process.exit(1);
    }
  })();
} else {
  loop().catch((err) => {
    console.error('[agent] fatal:', err);
    process.exit(1);
  });
}
