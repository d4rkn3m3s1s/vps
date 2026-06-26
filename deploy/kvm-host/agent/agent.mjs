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

    case 'REGISTER_WHATSAPP':
      return registerWhatsApp(serial, payload);

    case 'WHATSAPP_SEND':
      return whatsappSend(serial, payload);

    case 'WHATSAPP_READ':
      return whatsappRead(serial, payload);

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

// ── Shared UIAutomator action helpers, bound to one device serial ────────────
//
// These wrap the parse/find primitives into the small vocabulary every
// element-based flow needs (dump, tap-by-content, type-into-field, wait-for).
// registerWhatsApp / whatsappSend / whatsappRead all build on this.
function waHelpers(serial) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dump = async () => parseUiNodes(await uiDumpXml(serial));
  const tapNode = async (n) => { if (n) await adb(serial, ['shell', 'input', 'tap', String(n.cx), String(n.cy)]); };
  const find = async (q, field = 'any') => findNode(await dump(), q, field);
  // Whether ADBKeyboard is the active IME (set by ensureAdbKeyboard). When true,
  // typeText/clearField inject via its broadcast instead of `input text`.
  let adbKeyboardActive = false;
  // Make ADBKeyboard the default IME if it's installed (it injects text reliably
  // on redroid where `input text` is dropped). No-op if the IME isn't present.
  const ensureAdbKeyboard = async () => {
    try {
      const imes = await adb(serial, ['shell', 'ime', 'list', '-a', '-s']);
      if (!imes.includes('adbkeyboard')) { adbKeyboardActive = false; return false; }
      await adb(serial, ['shell', 'ime', 'enable', ADB_IME]);
      await adb(serial, ['shell', 'ime', 'set', ADB_IME]);
      adbKeyboardActive = true;
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
      await adb(serial, ['shell', 'am', 'broadcast', '-a', 'ADB_INPUT_TEXT', '--es', 'msg', s]);
    } else {
      await adb(serial, ['shell', 'input', 'text', s.replace(/ /g, '%s')]);
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
  // Wait until an element matching q appears (timeout → throw).
  const waitFor = async (q, ms = 15000, field = 'any') => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (findNode(await dump(), q, field)) return true;
      await sleep(1000);
    }
    throw new Error(`ekran gelmedi: ${q}`);
  };
  // Like waitFor but returns boolean instead of throwing (for optional screens).
  const seen = async (q, ms = 6000, field = 'any') => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (findNode(await dump(), q, field)) return true;
      await sleep(800);
    }
    return false;
  };
  // Flatten all visible text on screen (for wall detection / debugging).
  const screenText = async () => (await dump()).map((n) => n.text).filter(Boolean).join(' | ');
  return { sleep, dump, tapNode, find, tapBy, tapIf, typeInto, tapById, typeIntoId, typeText, clearField, ensureAdbKeyboard, waitFor, seen, screenText };
}

const WA_PKG = 'com.whatsapp';
const ADB_IME = 'com.android.adbkeyboard/.AdbIME';

// Split an E.164-ish number ("+905551234567" / "905551234567") into a country
// calling-code and the local part WhatsApp's two fields expect. We match the
// longest known calling code prefix; unknown prefixes fall back to a 1–3 digit
// best guess (most CCs are 1–3 digits).
const CALLING_CODES = ['1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98', '212', '213', '216', '218', '220', '233', '234', '254', '351', '352', '353', '354', '358', '359', '370', '371', '372', '373', '380', '420', '421', '852', '855', '880', '886', '961', '962', '963', '964', '965', '966', '971', '972', '973', '974', '977', '992', '994', '995', '998'];
function splitE164(raw) {
  const digits = String(raw).replace(/[^\d]/g, '');
  // Longest matching calling code wins (e.g. 90 before 9).
  const match = CALLING_CODES
    .filter((c) => digits.startsWith(c))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return { cc: match, local: digits.slice(match.length) };
  // Fallback: assume a 2-digit CC.
  return { cc: digits.slice(0, 2), local: digits.slice(2) };
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
  if (await h.seen('custom ROM', 6000) || await h.seen('Alert', 1000)) {
    await h.tapBy('OK').catch(() => undefined); await h.sleep(2000);
  }

  // 3) EULA — the button is "AGREE AND CONTINUE" (caps). Try both casings.
  if (await h.seen('AGREE AND CONTINUE', 12000)) { await h.tapBy('AGREE AND CONTINUE'); await h.sleep(4000); }
  else if (await h.seen('Agree and continue', 2000)) { await h.tapBy('Agree and continue'); await h.sleep(4000); }

  // 4) Modern WhatsApp opens the "Link as companion device" (QR) screen by
  //    default. New-number signup lives behind the overflow menu:
  //    ⋮ (More options) → "Register new account".
  if (await h.seen('companion device', 8000) || await h.seen('Link a device', 2000)) {
    await h.tapBy('More options', 'desc').catch(() => undefined); await h.sleep(1500);
    await h.tapBy('Register new account').catch(() => undefined); await h.sleep(3000);
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
  // Fill country code (clear first — it may be pre-filled from locale).
  if (cc) await h.typeIntoId('com.whatsapp:id/registration_cc', cc, true).catch(() => undefined);
  await h.sleep(400);
  await h.typeIntoId('com.whatsapp:id/registration_phone', local, true);
  await h.sleep(600);
  // Submit (registration_submit), with a text fallback.
  await h.tapById('com.whatsapp:id/registration_submit').catch(async () => { await h.tapBy('NEXT'); });
  await h.sleep(2500);

  // 6) Confirmation dialog ("You entered the phone number ... Is this OK?").
  if (await h.seen('OK', 6000)) { await h.tapBy('OK'); await h.sleep(5000); }

  // 7) Device-integrity / ban walls — bail with a clear status.
  const wall = await h.screenText();
  if (/banned|can.?t use whatsapp|couldn.?t (verify|connect)|not allowed|too many|try again/i.test(wall)) {
    return { status: 'DEVICE_WALL', note: 'WhatsApp cihazı/numarayı reddetti (emülatör/ban) — gerçek ARM cihaz gerekli', screenTexts: wall.slice(0, 400) };
  }

  // 8) OTP. WhatsApp shows a 6-digit code entry. If we weren't given the code,
  //    stop and let the control plane re-dispatch once the SMS provider has it.
  await h.waitFor('digit code', 30000).catch(() => undefined);
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
  const url = `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
  await adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url, WA_PKG]);
  await h.sleep(5000);
  await dismissBlockingDialogs(serial, h);

  // "X is not on WhatsApp" / invalid-number dialog → report, don't hang.
  const txt = await h.screenText();
  if (/not on whatsapp|invalid|isn.?t a valid/i.test(txt)) {
    return { status: 'INVALID_RECIPIENT', note: 'Numara WhatsApp\'ta değil veya geçersiz', to, screenTexts: txt.slice(0, 300) };
  }

  // The compose box is pre-filled by the deep link. Tap the Send button
  // (content-desc "Send"). If the text wasn't pre-filled, type it ourselves.
  if (!(await h.find('Send', 'desc'))) {
    // No send button yet — focus the input and type the message.
    await h.typeInto('Type a message', message).catch(() => undefined);
    await h.sleep(500);
  }
  const sendBtn = await h.find('Send', 'desc');
  if (!sendBtn) return { status: 'COMPOSE_FAILED', note: 'Gönder butonu bulunamadı', to, screenTexts: (await h.screenText()).slice(0, 300) };
  await h.tapNode(sendBtn);
  await h.sleep(1500);

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

  // Make sure a chat is open.
  if (to) {
    await adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `https://wa.me/${to}`, WA_PKG]);
    await h.sleep(5000);
  } else if (from) {
    await launchApp(serial, WA_PKG, null);
    await h.sleep(4000);
    // Open search, type the contact, tap the first chat hit.
    if (await h.tapIf('Search', 'desc')) {
      await h.sleep(800);
      await adb(serial, ['shell', 'input', 'text', from.replace(/ /g, '%s')]);
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
  // Prefer the H.264 fast path when ffmpeg is configured.
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
    s.stopped = true;
    if (s.timer) clearInterval(s.timer);
    if (s.rec) { try { s.rec.kill(); } catch { /* ignore */ } }
    if (s.ff) { try { s.ff.kill(); } catch { /* ignore */ } }
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
