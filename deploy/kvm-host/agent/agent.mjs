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
import { readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir, loadavg, cpus as osCpus } from 'node:os';
import { join, basename } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { inflateSync, deflateSync, crc32 } from 'node:zlib';
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

const execFileAsync = promisify(execFile);

const API_URL = (process.env.FLEET_API_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.FLEET_API_KEY || '';
const HOST_KEY = process.env.FLEET_HOST_KEY || '';
const POLL_MS = Number(process.env.FLEET_POLL_MS || 3000);
const HEARTBEAT_MS = Number(process.env.FLEET_HEARTBEAT_MS || 30000);
// ★L3: live-panel screenshot cadence during a WhatsApp register run (the in-flow
// thumbnail ticker, DISTINCT from the host HEARTBEAT_MS above). 5s balances a smooth
// live view against screencap contention; tunable per host.
const WA_HEARTBEAT_MS = Number(process.env.FLEET_WA_HEARTBEAT_MS || 5000);
// ★2026-08-01 ÖN-UÇUŞ: kayıt yapan cihazların son doğrulanmış ÇIKIŞ IP'si
// (serial → {ip, at}). İki hesabın AYNI çıkış IP'sinden kaydolması WhatsApp'ın en net
// toplu-ban sinyali, o yüzden kayıt öncesi çakışmayı bildiriyoruz. Süreç-içi ve TTL'li:
// kalıcı state YOK (agent restart'ta temizlenir — sadece eşzamanlı kayıtları yakalar,
// zaten çakışmanın tehlikeli olduğu pencere de o). TDZ'den kaçınmak için burada,
// tüm kullanımlardan ÖNCE tanımlı.
const waExitIps = new Map();
const WA_EXIT_IP_TTL_MS = Number(process.env.FLEET_WA_EXIT_IP_TTL_MS || 30 * 60 * 1000);
const ADB = process.env.FLEET_ADB || 'adb';
// Optional H.264 fast-stream path. When FLEET_FFMPEG points at an ffmpeg binary,
// streaming uses `screenrecord --output-format=h264 | ffmpeg -> mjpeg` instead of
// per-frame PNG screencap (which caps at ~1fps). ffmpeg is an external binary
// (not an npm dep), so the agent stays dependency-free; without it we fall back
// to the PNG path automatically.
const FFMPEG = process.env.FLEET_FFMPEG || '';
// Directory holding the repo's bundled APKs on this host (whatsapp.apk, magisk.apk,
// fleet-a11y.apk, adbkeyboard.apk). The API sends only a file NAME for bundled
// installs; the agent resolves it here so no host paths cross the API boundary.
const APK_DIR = process.env.FLEET_APK_DIR || '/opt/fleet-agent/apks';
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

// ── Secret env-strip (defense-in-depth) ─────────────────────────────────────
//
// Every child we spawn (adb shell, su -c, bash host scripts) inherits process.env
// by default — which means FLEET_API_KEY / FLEET_HOST_KEY / any *_TOKEN / *_SECRET
// the agent runs with would leak into the device shell and any script an attacker
// could influence. We've already copied the values the agent actually needs into
// module constants above (API_KEY, HOST_KEY, ADB, FFMPEG…), so we now scrub the
// sensitive names out of process.env. Children spawned afterwards no longer see
// them. We keep FLEET_* config the host SCRIPTS legitimately read (URLs, non-secret
// tuning) but drop credential-shaped names. Best-effort: a delete that throws
// (frozen prop) is ignored.
(function stripSecretEnv() {
  const SENSITIVE = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|BEARER|AUTH|COOKIE|CREDENTIAL|PRIVATE)/i;
  // Names we DELETE outright — the agent has already read what it needs.
  const HARD_DROP = new Set(['FLEET_API_KEY', 'FLEET_HOST_KEY']);
  for (const name of Object.keys(process.env)) {
    if (HARD_DROP.has(name) || SENSITIVE.test(name)) {
      try { delete process.env[name]; } catch { /* frozen — ignore */ }
    }
  }
})();

// --- ADB helpers ------------------------------------------------------------

// ★2026-07-23 (P-2): GLOBAL ADB CONCURRENCY SEMAPHORE. busyDevices only serialises jobs
// PER DEVICE; nothing bounded the HOST-WIDE total of concurrent adb children. Up to
// MAX_CONCURRENT_JOBS (24) jobs + 3 tickers' device loops + stream capture + otp-watch
// could fire 40-60 simultaneous `adb`/`dumpsys` commands at a SINGLE adbd — which
// serialises them internally anyway, so the surplus just spikes host load and triggers the
// uiautomator/dump hangs the code elsewhere calls "adb instability". This gate caps the
// number of adb children in flight at once (default 20, tuned for the 80-core host); excess
// callers queue and run as slots free. Per-device serialisation still lives in busyDevices;
// this is the host-wide ceiling on top of it.
const ADB_MAX_INFLIGHT = Number(process.env.FLEET_ADB_MAX_INFLIGHT || 20);
let _adbInflight = 0;
const _adbWaiters = [];
function _adbAcquire() {
  if (_adbInflight < ADB_MAX_INFLIGHT) { _adbInflight++; return Promise.resolve(); }
  return new Promise((resolve) => _adbWaiters.push(resolve));
}
function _adbRelease() {
  const next = _adbWaiters.shift();
  if (next) next(); // hand the slot straight to a waiter (count stays the same)
  else _adbInflight--;
}
async function withAdbSlot(fn) {
  await _adbAcquire();
  try { return await fn(); }
  finally { _adbRelease(); }
}

// ★2026-07-23 (C-1): HARD TIMEOUT + SIGKILL. The old adb() had NO timeout — the comment
// claiming "adb calls have their own short timeouts" was WRONG. On Waydroid, an adb shell
// (input/tap/dumpsys) can HANG indefinitely when adbd/uiautomator wedges; without a
// timeout the child never settles, and while withJobTimeout rejects the awaiting job at
// the wall-clock cap, the underlying ADB child stayed alive and a NEXT job on the SAME
// device then drove parallel ADB into a half-finished flow (fake-SENT / wrong-screen tap).
// A generous 30s cap kills any wedge; normal commands finish in well under a second.
const ADB_DEFAULT_TIMEOUT = Number(process.env.FLEET_ADB_TIMEOUT_MS || 30000);
async function adb(serial, args, ms = ADB_DEFAULT_TIMEOUT) {
  const full = serial ? ['-s', serial, ...args] : args;
  return withAdbSlot(async () => {
    const { stdout } = await execFileAsync(ADB, full, { maxBuffer: 64 * 1024 * 1024, timeout: ms, killSignal: 'SIGKILL' });
    return stdout;
  });
}

// adb with a hard timeout. Some commands (notably `uiautomator dump` on the
// WhatsApp Conversation screen under Waydroid) can HANG indefinitely instead of
// erroring — a plain await never returns and no .catch() fires. This kills the
// child after `ms` and rejects, so callers can fall back. Returns stdout.
async function adbT(serial, args, ms = 12000, stdin = undefined) {
  const full = serial ? ['-s', serial, ...args] : args;
  // ★2026-07-23 (P-2): count against the global ADB inflight cap (same as adb()).
  return withAdbSlot(async () => {
    // No stdin → the fast, simple execFile path (unchanged).
    if (stdin === undefined) {
      const { stdout } = await execFileAsync(ADB, full, { maxBuffer: 64 * 1024 * 1024, timeout: ms, killSignal: 'SIGKILL' });
      return stdout;
    }
    // WITH stdin → spawn so we can write to the child's stdin. This lets callers feed data
    // (e.g. SQL) on stdin instead of quoting it into the command — the adb→su→sh→sqlite
    // layers mangle any inline SQL ("syntax error near x27SELECT"), but stdin passes through
    // cleanly. promisify(execFile) can't do stdin (that's execFileSync-only), hence spawn.
    return await new Promise((resolve, reject) => {
      const child = spawn(ADB, full, { stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      let done = false;
      const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish(reject, new Error('adbT stdin timeout')); }, ms);
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('error', (e) => finish(reject, e));
      child.on('close', () => finish(resolve, out));
      try { child.stdin.write(stdin); child.stdin.end(); } catch (e) { finish(reject, e); }
    });
  });
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
    // HARD timeout: on some Magisk setups the manager denies adb-shell su and the
    // `su -c` call HANGS forever ("Shell was denied Superuser rights") instead of
    // erroring — a plain await would stall the whole flow. adbT kills the child
    // after the timeout so root steps degrade to best-effort no-ops.
    return await adbT(serial, ['shell', 'su', '-c', cmd], 8000);
  } catch {
    return '';
  }
}

// ── ROOT SQLITE (stdin-safe) ─────────────────────────────────────────────────
// Run SQL against a WhatsApp DB as root, feeding the SQL on STDIN (NOT inline) so the
// adb→su→sh→sqlite quote layers can't mangle it. Appends a numeric sentinel row (the
// caller must include `SELECT 987654321;` LAST) so we can tell "query ran, empty result"
// from "root/sqlite unavailable" — returns null on the latter, an array of rows on the
// former. Rows are '|'-joined columns (sqlite default). db: 'msgstore'|'wa'.
async function waSql(serial, db, sql) {
  const path = `/data/data/com.whatsapp/databases/${db}.db`;
  const full = sql.trimEnd().endsWith(';') ? `${sql}\nSELECT 987654321;\n` : `${sql};\nSELECT 987654321;\n`;
  const raw = await adbT(serial, ['shell', 'su', '-c', `sqlite3 ${path}`], 8000, full).catch(() => '');
  const lines = String(raw).split('\n');
  const idx = lines.findIndex((l) => l.trim() === '987654321');
  if (idx < 0) return null; // sentinel missing → root/sqlite/db unavailable
  return lines.slice(0, idx).filter((l) => l.length > 0);
}

// Read a peer's messages straight from msgstore.db (no UI). Resolves the modern LID
// mapping (jid_map) AND the classic direct s.whatsapp.net chat with a UNION, so it works
// on both new and old accounts. Returns [{ fromMe, ts, text }] newest-first, or null if
// root/db is unavailable (caller falls back to UI scraping). Text is sqlite-escaped-safe
// because it travels on stdin; we only split on the FIRST two '|' so message bodies that
// contain '|' stay intact.
async function readWaMessages(serial, number, limit = 50) {
  const num = String(number || '').replace(/[^\d]/g, '');
  if (!num) return null;
  const n = Math.min(Math.max(1, limit | 0), 200);
  // Two chat-resolution paths UNION'd: (A) LID → jid_map → number, (B) direct number jid.
  const sql =
    `SELECT m.from_me, m.timestamp, m.text_data FROM message m ` +
    `JOIN chat c ON c._id=m.chat_row_id ` +
    `JOIN jid_map jm ON jm.lid_row_id=c.jid_row_id ` +
    `JOIN jid j ON j._id=jm.jid_row_id ` +
    `WHERE j.user='${num}' AND j.server='s.whatsapp.net' AND m.text_data IS NOT NULL ` +
    `UNION ` +
    `SELECT m.from_me, m.timestamp, m.text_data FROM message m ` +
    `JOIN chat c ON c._id=m.chat_row_id ` +
    `JOIN jid j ON j._id=c.jid_row_id ` +
    `WHERE j.user='${num}' AND j.server='s.whatsapp.net' AND m.text_data IS NOT NULL ` +
    `ORDER BY 2 DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  return rows
    .map((line) => {
      const a = line.indexOf('|');
      const b = line.indexOf('|', a + 1);
      if (a < 0 || b < 0) return null;
      return { fromMe: line.slice(0, a) === '1', ts: Number(line.slice(a + 1, b)) || 0, text: line.slice(b + 1) };
    })
    .filter(Boolean);
}

// List the device's conversations straight from msgstore.db (no UI) — like reading the
// WhatsApp home screen via SQL. Returns [{ peer, unread, ts, lastText }] newest-first, or
// null if root/db is unavailable. New WA builds key EVERY chat by a LID, so we resolve the
// real number through jid_map (falling back to the direct jid.user when there's no map).
async function readWaConversations(serial, limit = 50) {
  const n = Math.min(Math.max(1, limit | 0), 200);
  const sql =
    `SELECT COALESCE(jn.user, j.user), c.unseen_message_count, c.sort_timestamp, substr(lm.text_data,1,120) ` +
    `FROM chat c JOIN jid j ON j._id=c.jid_row_id ` +
    `LEFT JOIN jid_map jm ON jm.lid_row_id=c.jid_row_id ` +
    `LEFT JOIN jid jn ON jn._id=jm.jid_row_id ` +
    `LEFT JOIN message lm ON lm._id=c.last_message_row_id ` +
    `WHERE c.sort_timestamp>0 AND COALESCE(jn.server,j.server) IN ('s.whatsapp.net','lid') ` +
    `ORDER BY c.sort_timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  return rows
    .map((line) => {
      const parts = line.split('|');
      if (parts.length < 3) return null;
      const peer = (parts[0] || '').replace(/[^\d]/g, '');
      if (!peer) return null;
      return {
        peer: `+${peer}`,
        unread: Number(parts[1]) || 0,
        ts: Number(parts[2]) || 0,
        lastText: parts.slice(3).join('|') // body may contain '|'
      };
    })
    .filter(Boolean);
}

// ── ROOT-DB READ HELPERS (msgstore.db / wa.db, no UI) ────────────────────────
// All share the LID-resolving chat lookup: new WhatsApp keys every chat by a LID
// (jid_map.lid_row_id → the real number jid). Each helper returns null on root/db
// failure so callers can fall back. status codes (VERIFIED LIVE across mi2/4/8/11):
//   5 = SENT (single tick) · 6 = DELIVERED (double grey) · 13 = READ (blue).
const WA_MSG_STATUS = { 5: 'SENT', 6: 'DELIVERED', 13: 'READ' };
function waStatusName(code) { return WA_MSG_STATUS[Number(code)] || 'PENDING'; }

// A reusable "chat_row_id for this number" sub-select — LID path UNION direct path.
// VERIFIED-LIVE FIX: on modern WA every chat is keyed by a LID jid (server='lid'); the
// real number is reached via jid_map (lid_row_id → jid_row_id). Two subtleties the old
// filter got wrong, causing empty results (0||||) on real devices:
//   1. A number can have MORE THAN ONE jid row (e.g. one 's.whatsapp.net' + a second
//      row) and jid_map may point at either — so we match jid_map's target by user ONLY
//      (numbers are globally unique), not user+server, or the mapping row is missed.
//   2. Keep the direct-jid path (older accounts / self-chats where the chat is keyed by
//      the number's own jid, not a LID) — matched by user, any server.
function waChatFilter(num) {
  return (
    `c.jid_row_id IN (` +
    `SELECT jm.lid_row_id FROM jid_map jm JOIN jid j ON j._id=jm.jid_row_id WHERE j.user='${num}' ` +
    `UNION SELECT j._id FROM jid j WHERE j.user='${num}')`
  );
}

// Outbound delivery/read status for a peer's recent sent messages (tick tracking).
// Returns [{ ts, status, text }] newest-first, or null.
async function readWaReceipts(serial, number, limit = 20) {
  const num = String(number || '').replace(/[^\d]/g, '');
  if (!num) return null;
  const n = Math.min(Math.max(1, limit | 0), 100);
  const sql =
    `SELECT m.timestamp, m.status, substr(m.text_data,1,80) FROM message m JOIN chat c ON c._id=m.chat_row_id ` +
    `WHERE ${waChatFilter(num)} AND m.from_me=1 AND m.text_data IS NOT NULL ORDER BY m.timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  return rows
    .map((line) => {
      const a = line.indexOf('|'), b = line.indexOf('|', a + 1);
      if (a < 0 || b < 0) return null;
      return { ts: Number(line.slice(0, a)) || 0, status: waStatusName(line.slice(a + 1, b)), text: line.slice(b + 1) };
    })
    .filter(Boolean);
}

// Media inventory for a peer (or whole device if number omitted). Returns
// [{ ts, fromMe, mime, name, size, caption, path }] newest-first, or null.
async function readWaMedia(serial, number, limit = 50) {
  const num = String(number || '').replace(/[^\d]/g, '');
  const n = Math.min(Math.max(1, limit | 0), 200);
  const where = num ? `WHERE ${waChatFilter(num)}` : '';
  const sql =
    `SELECT m.timestamp, m.from_me, mm.mime_type, mm.media_name, mm.file_size, substr(mm.media_caption,1,60), mm.file_path ` +
    `FROM message_media mm JOIN message m ON m._id=mm.message_row_id JOIN chat c ON c._id=m.chat_row_id ` +
    `${where} ORDER BY m.timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  return rows
    .map((line) => {
      const p = line.split('|');
      if (p.length < 7) return null;
      return { ts: Number(p[0]) || 0, fromMe: p[1] === '1', mime: p[2] || '', name: p[3] || '', size: Number(p[4]) || 0, caption: p[5] || '', path: p.slice(6).join('|') };
    })
    .filter(Boolean);
}

// Call history from call_log. Returns [{ ts, fromMe, video, durationSec, result }], or null.
async function readWaCallLog(serial, limit = 50) {
  const n = Math.min(Math.max(1, limit | 0), 200);
  const sql = `SELECT timestamp, from_me, video_call, duration, call_result FROM call_log ORDER BY timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  return rows
    .map((line) => {
      const p = line.split('|');
      if (p.length < 5) return null;
      return { ts: Number(p[0]) || 0, fromMe: p[1] === '1', video: p[2] === '1', durationSec: Number(p[3]) || 0, result: Number(p[4]) || 0 };
    })
    .filter(Boolean);
}

// Full-text-ish message search across all chats on the device (LIKE — robust across
// WA builds; FTS table names vary). Returns [{ ts, fromMe, peer, text }], or null.
async function readWaSearch(serial, query, limit = 50) {
  const q = String(query || '').replace(/'/g, "''").slice(0, 100);
  if (!q) return null;
  const n = Math.min(Math.max(1, limit | 0), 200);
  const sql =
    `SELECT m.timestamp, m.from_me, COALESCE(jn.user, j.user), substr(m.text_data,1,120) ` +
    `FROM message m JOIN chat c ON c._id=m.chat_row_id JOIN jid j ON j._id=c.jid_row_id ` +
    `LEFT JOIN jid_map jm ON jm.lid_row_id=c.jid_row_id LEFT JOIN jid jn ON jn._id=jm.jid_row_id ` +
    `WHERE m.text_data LIKE '%${q}%' ORDER BY m.timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  return rows
    .map((line) => {
      const p = line.split('|');
      if (p.length < 4) return null;
      const peer = (p[2] || '').replace(/[^\d]/g, '');
      return { ts: Number(p[0]) || 0, fromMe: p[1] === '1', peer: peer ? `+${peer}` : '', text: p.slice(3).join('|') };
    })
    .filter(Boolean);
}

// Total unread across the device: sum of chat.unseen_message_count + unread chat count.
async function readWaUnread(serial) {
  const rows = await waSql(serial, 'msgstore', `SELECT COALESCE(SUM(unseen_message_count),0), COUNT(CASE WHEN unseen_message_count>0 THEN 1 END) FROM chat`);
  if (rows === null || !rows.length) return null;
  const p = rows[0].split('|');
  return { totalUnread: Number(p[0]) || 0, unreadChats: Number(p[1]) || 0 };
}

// Full contacts list from wa.db (wa_contacts) — every WhatsApp contact the account
// knows with a display name + number, straight from the device's own address book.
// Only rows that are actual WhatsApp users (is_whatsapp_user=1) with a name, so we
// skip the noise of every phone-book entry. Returns [{ number, name }] or null.
async function readWaContactsList(serial, limit = 200) {
  const n = Math.min(Math.max(1, limit | 0), 500);
  // jid is like "<number>@s.whatsapp.net"; strip to digits. Some builds lack
  // is_whatsapp_user — the COALESCE-name filter + jid shape already keep it sane.
  const sql =
    `SELECT jid, COALESCE(display_name, wa_name, nullptr) FROM wa_contacts ` +
    `WHERE jid LIKE '%@s.whatsapp.net' AND COALESCE(display_name, wa_name) IS NOT NULL ` +
    `AND COALESCE(display_name, wa_name) <> '' ORDER BY COALESCE(display_name, wa_name) LIMIT ${n}`;
  // `nullptr` isn't valid SQL — guard the query with a plain form (older schemas
  // choke on unknown funcs); build the real SQL without the stray token.
  const realSql =
    `SELECT jid, COALESCE(display_name, wa_name) FROM wa_contacts ` +
    `WHERE jid LIKE '%@s.whatsapp.net' AND COALESCE(display_name, wa_name) IS NOT NULL ` +
    `AND COALESCE(display_name, wa_name) <> '' ORDER BY COALESCE(display_name, wa_name) LIMIT ${n}`;
  void sql;
  const rows = await waSql(serial, 'wa', realSql);
  if (rows === null) return null;
  return rows
    .map((line) => {
      const a = line.indexOf('|');
      if (a < 0) return null;
      const number = (line.slice(0, a) || '').replace(/@.*/, '').replace(/[^\d]/g, '');
      const name = line.slice(a + 1);
      if (!number) return null;
      return { number: `+${number}`, name };
    })
    .filter(Boolean);
}

// Members of a group chat, from msgstore.db. Groups are keyed by a jid whose server is
// 'g.us'; membership lives in group_participant_user (newer) or group_participants
// (older). We resolve the group by its subject (name) OR its raw jid user id, then join
// participant jids. Returns [{ number, admin }] or null. `group` = subject or jid id.
async function readWaGroupMembers(serial, group, limit = 500) {
  const g = String(group || '').replace(/'/g, "''").slice(0, 120);
  if (!g) return null;
  const gDigits = g.replace(/[^\d]/g, '');
  const n = Math.min(Math.max(1, limit | 0), 1000);
  // Newer schema: group_participant_user(group_jid_row_id, user_jid_row_id, rank).
  // Match the group by subject (chat + jid) or by its numeric jid user. rank>=1 = admin.
  const sqlNew =
    `SELECT uj.user, gpu.rank FROM group_participant_user gpu ` +
    `JOIN jid gj ON gj._id=gpu.group_jid_row_id ` +
    `JOIN jid uj ON uj._id=gpu.user_jid_row_id ` +
    `LEFT JOIN chat c ON c.jid_row_id=gj._id ` +
    `WHERE gj.server='g.us' AND (gj.user='${gDigits}' OR c.subject='${g}') ` +
    `LIMIT ${n}`;
  let rows = await waSql(serial, 'msgstore', sqlNew);
  // Fallback to the legacy table if the modern one is missing (rows===null AND the
  // db is actually reachable). We can't tell "no root" from "no table" via null alone,
  // so probe the legacy table only when the new query yielded nothing.
  // ★2026-07-23 (C-4): legacy fallback matched with `gjid LIKE '%digits%'` — a SUBSTRING
  // match that returns members of EVERY group whose jid CONTAINS the digit string (e.g.
  // group="12345" matched 120123456789@g.us), and when the caller passed a subject (gDigits
  // empty) it became `LIKE '%%'` = ALL groups. Both silently return the WRONG members list.
  // Fix: anchor the match to the exact group jid (`<digits>@g.us`), and skip the legacy path
  // entirely when we have no numeric group id to anchor on.
  if ((rows === null || rows.length === 0) && gDigits) {
    const sqlOld =
      `SELECT j.user, gp.admin FROM group_participants gp ` +
      `JOIN jid j ON j.raw_string LIKE gp.jid ` +
      `WHERE gp.gjid LIKE '${gDigits}@%' LIMIT ${n}`;
    const legacy = await waSql(serial, 'msgstore', sqlOld);
    if (legacy && legacy.length) rows = legacy;
  }
  if (rows === null) return null;
  return rows
    .map((line) => {
      const a = line.indexOf('|');
      const number = (a < 0 ? line : line.slice(0, a)).replace(/[^\d]/g, '');
      const rank = a < 0 ? 0 : Number(line.slice(a + 1)) || 0;
      if (!number) return null;
      return { number: `+${number}`, admin: rank >= 1 };
    })
    .filter(Boolean);
}

// One chat's aggregate summary from msgstore.db: total messages, in/out split, media
// count, first & last message timestamps. Cheap analytics with zero UI. Resolves the
// chat via the LID-aware filter. Returns { total, inbound, outbound, media, firstTs,
// lastTs } or null.
async function readWaChatSummary(serial, number) {
  const num = String(number || '').replace(/[^\d]/g, '');
  if (!num) return null;
  const sql =
    `SELECT COUNT(*), SUM(CASE WHEN m.from_me=0 THEN 1 ELSE 0 END), ` +
    `SUM(CASE WHEN m.from_me=1 THEN 1 ELSE 0 END), ` +
    `SUM(CASE WHEN m.message_type IN (1,2,3,9,13,20) THEN 1 ELSE 0 END), ` +
    `MIN(m.timestamp), MAX(m.timestamp) ` +
    `FROM message m JOIN chat c ON c._id=m.chat_row_id WHERE ${waChatFilter(num)}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null || !rows.length) return null;
  const p = rows[0].split('|');
  const total = Number(p[0]) || 0;
  return {
    total,
    inbound: Number(p[1]) || 0,
    outbound: Number(p[2]) || 0,
    media: Number(p[3]) || 0,
    firstTs: Number(p[4]) || 0,
    lastTs: Number(p[5]) || 0
  };
}

// Read a value out of one of WhatsApp's shared_prefs XML files via root. Returns the
// first <string name="KEY">VALUE</string> match, or null. VERIFIED LIVE: the modern
// WA build (2.26.x) keeps the registered number in shared_prefs, NOT the props table —
// registration_jid="905380525622" + cc="90" live in com.whatsapp_preferences_light.xml.
async function readWaPref(serial, key, files = ['com.whatsapp_preferences_light.xml', 'com.whatsapp_preferences.xml', 'startup_prefs.xml']) {
  for (const f of files) {
    const raw = await adbT(serial, ['shell', 'su', '-c', `cat /data/data/com.whatsapp/shared_prefs/${f}`], 6000).catch(() => '');
    if (!raw) continue;
    // <string name="cc">90</string>  |  <string name="registration_jid">9053...</string>
    const m = String(raw).match(new RegExp(`<(?:string|long|int)\\s+name="${key}"(?:\\s+value="([^"]*)")?\\s*>?([^<]*)</?`, 'i'));
    if (m) {
      const v = (m[1] !== undefined ? m[1] : m[2]) || '';
      if (v.trim()) return v.trim();
    }
  }
  return null;
}

// Account health straight from the device: registered number + display name +
// WhatsApp version + a coarse "registered?" flag. VERIFIED-LIVE FIX: the number is
// NOT in wa.db props on modern builds (that table lacks registration_jid); it lives in
// shared_prefs (registration_jid + cc). We read there first, fall back to props, and
// add the push (display) name from msgstore props. Returns { number, name, waVersion,
// registered } (any field may be null) — an object when root works, null when it doesn't.
// ★★ 2026-07-28 SESSIZ SAGLIK YOKLAMASI (mesaj GONDERMEDEN durum tespiti).
// NEDEN: hesap durumu (KISITLI/YASAKLI/CIKIS) bugune kadar SADECE bir gonderim
// denenirken ogreniliyordu. Yani "durumu ogrenmek icin mesaj at" gerekiyordu; bu hem
// disari trafik uretir (ban sinyali) hem de mantik hatasi tasir: KISITLI hesap MEVCUT
// sohbete cevap verebildigi icin "gonderim basarili = kisitli degil" cikarimi YANLIS.
// COZUM: WhatsApp'in KENDI ekran metnini oku — banner kesin kanittir ve okumak icin
// mesaj gondermek GEREKMEZ. Var olan bir sohbeti ACIP okuruz; hicbir sey yazilmaz.
// Desenler, gonderim akisinda CANLI dogrulanmis olanlarla AYNIDIR (tek kaynak).
async function waHealthProbe(serial) {
  const h = waHelpers(serial);
  const texts = async () => {
    const nodes = meaningfulNodes(parseUiNodes(await uiDumpXml(serial).catch(() => '')));
    return nodes.map((n) => n.text || n.desc || '').join(' | ').slice(0, 1200);
  };
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  // CANLI OLCUM: `monkey -c LAUNCHER` bu imajda WhatsApp'i ACMIYOR (ekranda launcher
  // kaliyor) -> yoklama ana ekrani okuyup yanlislikla "sohbet yok" diyordu. Dogru yol:
  await adb(serial, ['shell', 'am', 'start', '-n', `${WA_PKG}/com.whatsapp.HomeActivity`]).catch(() => undefined);
  await sleep(4500);
  const foc = await adb(serial, ['shell', 'dumpsys', 'window']).catch(() => '');
  // ★ON PLAN DOGRULAMASI: WhatsApp gercekten acilmadiysa HICBIR hukum verme. Bunsuz
  // launcher/ANR ekrani "sorun yok" gibi okunur ve gercek bir kisit gozden kacar.
  if (!/com\.whatsapp\//i.test(foc)) return { state: 'UNKNOWN', evidence: 'WhatsApp on plana gelmedi', unverified: true };
  let scr = await texts();
  // 1) YASAKLI — ban ekrani / ban metni
  if (/BanAppeal|userban/i.test(foc) || /can.?t use whatsapp|account can.?t use|hesab\w* whatsapp'?ı kullanamaz|banned|suspended|yasakl|askıya/i.test(scr)) {
    return { state: 'BANNED', evidence: scr.slice(0, 300) };
  }
  // 2) CIKIS YAPILMIS — kayit/EULA ekrani
  if (/whatsapp\/.*(registration|\.EULA|RegisterName|verifynumber)/i.test(foc)
      || /welcome to whatsapp|agree and continue|kabul et ve devam/i.test(scr)) {
    return { state: 'LOGGED_OUT', evidence: scr.slice(0, 300) };
  }
  // 3) KISITLI — var olan bir sohbeti AC (mesaj YOK) ve banner/read-only ara.
  // CANLI: bu surumde sohbet satiri 'contact_row_container' (conversations_row_contact_name YOK).
  const row = await h.find('com.whatsapp:id/contact_row_container', 'id').catch(() => null)
    || await h.find('com.whatsapp:id/conversations_row_contact_name', 'id').catch(() => null);
  if (!row) return { state: 'ACTIVE', evidence: 'sohbet listesi acik, sohbet yok (kisit dogrulanamadi)', unverified: true };
  await h.tapNode(row).catch(() => undefined);
  await sleep(2500);
  scr = await texts();
  const readOnly = await h.find('com.whatsapp:id/read_only_chat_info', 'id').catch(() => null)
    || await h.find('com.whatsapp:id/read_only_chat_info_content', 'id').catch(() => null);
  const entry = await h.find('com.whatsapp:id/entry', 'id').catch(() => null);
  let state = 'ACTIVE';
  if (/account is restricted|can.?t start new chats|hesab\w* kısıtl|yeni sohbet başlat/i.test(scr) || readOnly) state = 'RESTRICTED';
  else if (!entry) state = 'UNKNOWN';   // yazma kutusu yok ama banner da yok -> karar VERME
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  return { state, evidence: scr.slice(0, 300) };
}

async function readWaAccountHealth(serial) {
  // Primary source: shared_prefs registration_jid (bare number) — VERIFIED LIVE.
  let number = null;
  const regJid = await readWaPref(serial, 'registration_jid');
  if (regJid) {
    const d = regJid.replace(/@.*/, '').replace(/[^\d]/g, '');
    if (d) number = `+${d}`;
  }
  // Fallback: legacy wa.db props table (older builds). null here also tells us whether
  // root/db is reachable at all — if BOTH the pref read and this fail, treat as no-root.
  let dbReachable = regJid !== null;
  if (!number) {
    const jidRows = await waSql(serial, 'wa', `SELECT value FROM props WHERE key='registration_jid' LIMIT 1`);
    if (jidRows !== null) {
      dbReachable = true;
      if (jidRows.length) {
        const d = (jidRows[0] || '').replace(/@.*/, '').replace(/[^\d]/g, '');
        if (d) number = `+${d}`;
      }
    }
  }
  if (!dbReachable && number === null) return null; // root/db truly unavailable
  // Display (push) name — msgstore props key 'user_push_name' (VERIFIED LIVE).
  let name = null;
  const nameRows = await waSql(serial, 'msgstore', `SELECT value FROM props WHERE key='user_push_name' LIMIT 1`);
  if (nameRows && nameRows.length && nameRows[0]) name = nameRows[0];
  // WhatsApp package version via dumpsys — cheap + always present. Absent → null.
  let waVersion = null;
  const dump = await adb(serial, ['shell', 'dumpsys', 'package', 'com.whatsapp']).catch(() => '');
  const vm = String(dump).match(/versionName=([^\s]+)/);
  if (vm) waVersion = vm[1];
  return { number, name, waVersion, registered: !!number };
}

// ── MEDIA FETCH (root pull of a DOWNLOADED media file) ───────────────────────
// Pull an already-DOWNLOADED media file off the device as base64. VERIFIED LIVE:
// `adb exec-out su -c "cat <path>"` streams a root-owned file over stdout (dodging the
// `adb pull` permission wall), and `| base64` makes it safe to carry in JSON. WhatsApp
// only writes a media file to disk once it's been downloaded (auto-download or a tap);
// until then message_media.file_path is empty and the bytes live only as an encrypted
// CDN blob — so this returns { pending:true } for not-yet-downloaded media rather than
// guessing. Returns { found, pending, items:[{ ts, fromMe, mime, name, size, base64 }] }.
// `max` caps how many files we base64 (each is inlined into the job result).
async function readWaFetchMedia(serial, number, limit = 5, maxBytes = 8 * 1024 * 1024) {
  const num = String(number || '').replace(/[^\d]/g, '');
  const n = Math.min(Math.max(1, limit | 0), 20);
  const where = num ? `WHERE ${waChatFilter(num)}` : '';
  const sql =
    `SELECT m.timestamp, m.from_me, mm.mime_type, mm.media_name, mm.file_size, mm.file_path ` +
    `FROM message_media mm JOIN message m ON m._id=mm.message_row_id JOIN chat c ON c._id=m.chat_row_id ` +
    `${where} ORDER BY m.timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null; // root/db unavailable
  const items = [];
  let pending = 0;
  for (const line of rows) {
    const parts = line.split('|');
    if (parts.length < 6) continue;
    const ts = Number(parts[0]) || 0;
    const fromMe = parts[1] === '1';
    const mime = parts[2] || '';
    const name = parts[3] || '';
    const size = Number(parts[4]) || 0;
    const path = parts.slice(5).join('|');
    // No file_path → not downloaded to disk yet (only an encrypted CDN blob exists).
    if (!path) { pending++; items.push({ ts, fromMe, mime, name, size, base64: null, pending: true }); continue; }
    // Resolve to an absolute path if WhatsApp stored a relative one.
    const full = path.startsWith('/') ? path : `/data/media/0/${path}`;
    // Guard against inlining a huge file: skip base64 if the DB size is over the cap.
    if (size > maxBytes) { items.push({ ts, fromMe, mime, name, size, base64: null, tooLarge: true }); continue; }
    // Root-cat the file → base64. exec-out keeps the bytes binary-clean over stdout.
    const b64 = await adbT(serial, ['exec-out', 'su', '-c', `cat '${full.replace(/'/g, "'\\''")}' | base64`], 20000)
      .then((s) => String(s).replace(/[\r\n]/g, ''))
      .catch(() => '');
    if (b64) items.push({ ts, fromMe, mime, name, size, base64: b64 });
    else { pending++; items.push({ ts, fromMe, mime, name, size, base64: null, unreadable: true }); }
  }
  return { found: items.length, pending, items };
}

// Root-cat a single file → base64 (binary-clean over stdout). '' on failure/too-large.
// Shared by view-once + voice-note + auto-capture. maxBytes guards JSON bloat.
async function catFileB64(serial, full, maxBytes = 12 * 1024 * 1024) {
  const esc = String(full).replace(/'/g, "'\\''");
  // Size-check first (root stat) so we don't stream a huge file just to drop it.
  const szRaw = await adbT(serial, ['exec-out', 'su', '-c', `stat -c %s '${esc}' 2>/dev/null`], 6000).catch(() => '');
  const size = Number(String(szRaw).trim()) || 0;
  if (size > maxBytes) return { size, base64: null, tooLarge: true };
  const b64 = await adbT(serial, ['exec-out', 'su', '-c', `cat '${esc}' | base64`], 25000)
    .then((s) => String(s).replace(/[\r\n]/g, '')).catch(() => '');
  return { size, base64: b64 || null };
}

// ── VIEW-ONCE (tek görünümlük foto/video) ────────────────────────────────────
// View-once media the account received. state: 1=unopened, 2=opened/expired. Even an
// OPENED view-once often still has its file on disk (root sees what the UI hides), so we
// base64 whatever remains. Returns { count, items:[{ ts, fromMe, peer, mime, state,
// base64|null, pending? }] } or null. VERIFIED-LIVE schema: message_view_once_media
// (message_row_id, state); the bytes live in message_media.file_path like normal media.
async function readWaViewOnce(serial, limit = 10) {
  const n = Math.min(Math.max(1, limit | 0), 30);
  const sql =
    `SELECT m.timestamp, m.from_me, COALESCE(jn.user, j.user), mm.mime_type, vo.state, mm.file_path, mm.file_size ` +
    `FROM message_view_once_media vo JOIN message m ON m._id=vo.message_row_id ` +
    `LEFT JOIN message_media mm ON mm.message_row_id=m._id ` +
    `JOIN chat c ON c._id=m.chat_row_id JOIN jid j ON j._id=c.jid_row_id ` +
    `LEFT JOIN jid_map jm ON jm.lid_row_id=c.jid_row_id LEFT JOIN jid jn ON jn._id=jm.jid_row_id ` +
    `ORDER BY m.timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  const items = [];
  for (const line of rows) {
    const p = line.split('|');
    if (p.length < 7) continue;
    const ts = Number(p[0]) || 0, fromMe = p[1] === '1';
    const peer = (p[2] || '').replace(/[^\d]/g, '');
    const mime = p[3] || '', state = Number(p[4]) || 0;
    const path = p.slice(5, p.length - 1).join('|'); // file_path (may contain '|')
    let base64 = null, pending = false;
    if (path) {
      const full = path.startsWith('/') ? path : `/data/media/0/${path}`;
      const r = await catFileB64(serial, full);
      base64 = r.base64;
      if (!base64) pending = true;
    } else pending = true; // file gone (opened + purged) — DB row remains but no bytes
    items.push({ ts, fromMe, peer: peer ? `+${peer}` : '', mime, state, base64, ...(pending ? { pending: true } : {}) });
  }
  return { count: items.length, items };
}

// ── VOICE NOTES (sesli mesajlar) ─────────────────────────────────────────────
// The account's voice notes (PTT) — audio media, optionally base64'd. Returns
// { count, items:[{ ts, fromMe, peer, durationSec, size, base64|null }] } or null.
// Audio is matched by mime (audio/*) — WhatsApp stores PTT as .opus in Voice Notes.
async function readWaVoiceNotes(serial, number, limit = 10, withAudio = true) {
  const num = String(number || '').replace(/[^\d]/g, '');
  const n = Math.min(Math.max(1, limit | 0), 30);
  const where = num ? `AND ${waChatFilter(num)}` : '';
  const sql =
    `SELECT m.timestamp, m.from_me, COALESCE(jn.user, j.user), mm.media_duration, mm.file_size, mm.file_path, mm.mime_type ` +
    `FROM message_media mm JOIN message m ON m._id=mm.message_row_id ` +
    `JOIN chat c ON c._id=m.chat_row_id JOIN jid j ON j._id=c.jid_row_id ` +
    `LEFT JOIN jid_map jm ON jm.lid_row_id=c.jid_row_id LEFT JOIN jid jn ON jn._id=jm.jid_row_id ` +
    `WHERE mm.mime_type LIKE 'audio/%' ${where} ORDER BY m.timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  const items = [];
  for (const line of rows) {
    const p = line.split('|');
    if (p.length < 7) continue;
    const ts = Number(p[0]) || 0, fromMe = p[1] === '1';
    const peer = (p[2] || '').replace(/[^\d]/g, '');
    const durationSec = Number(p[3]) || 0, size = Number(p[4]) || 0;
    const path = p.slice(5, p.length - 1).join('|');
    let base64 = null;
    if (withAudio && path) {
      const full = path.startsWith('/') ? path : `/data/media/0/${path}`;
      base64 = (await catFileB64(serial, full)).base64;
    }
    items.push({ ts, fromMe, peer: peer ? `+${peer}` : '', durationSec, size, base64 });
  }
  return { count: items.length, items };
}

// ── DELETED (silinen — "herkesten sil" ama DB'de kalan) ──────────────────────
// Messages the peer REVOKED ("delete for everyone"): the UI hides them, but the row +
// its text survive in the DB. This is the classic "anti-delete" — what was deleted, by
// whom, when, and the original text. VERIFIED-LIVE schema: message_revoked
// (message_row_id, revoked_key_id, admin_jid_row_id, revoke_timestamp); the text stays
// in message.text_data. Returns [{ ts, revokedAt, fromMe, peer, text }] or null.
async function readWaDeleted(serial, limit = 50) {
  const n = Math.min(Math.max(1, limit | 0), 200);
  const sql =
    `SELECT m.timestamp, mr.revoke_timestamp, m.from_me, COALESCE(jn.user, j.user), substr(m.text_data,1,200) ` +
    `FROM message_revoked mr JOIN message m ON m._id=mr.message_row_id ` +
    `JOIN chat c ON c._id=m.chat_row_id JOIN jid j ON j._id=c.jid_row_id ` +
    `LEFT JOIN jid_map jm ON jm.lid_row_id=c.jid_row_id LEFT JOIN jid jn ON jn._id=jm.jid_row_id ` +
    `ORDER BY mr.revoke_timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  return rows
    .map((line) => { const p = line.split('|'); if (p.length < 5) return null; const peer = (p[3] || '').replace(/[^\d]/g, ''); return { ts: Number(p[0]) || 0, revokedAt: Number(p[1]) || 0, fromMe: p[2] === '1', peer: peer ? `+${peer}` : '', text: p.slice(4).join('|') }; })
    .filter(Boolean);
}

// ── LINKS (paylaşılan tüm URL'ler) ───────────────────────────────────────────
// Every URL shared in the account's chats. message_link marks WHICH message carries a
// link (message_row_id, link_index); the URL itself is in message.text_data — we extract
// it with a regex. Returns [{ ts, fromMe, peer, url, text }] newest-first, or null.
async function readWaLinks(serial, number, limit = 50) {
  const num = String(number || '').replace(/[^\d]/g, '');
  const n = Math.min(Math.max(1, limit | 0), 200);
  const where = num ? `AND ${waChatFilter(num)}` : '';
  const sql =
    `SELECT m.timestamp, m.from_me, COALESCE(jn.user, j.user), m.text_data ` +
    `FROM message_link ml JOIN message m ON m._id=ml.message_row_id ` +
    `JOIN chat c ON c._id=m.chat_row_id JOIN jid j ON j._id=c.jid_row_id ` +
    `LEFT JOIN jid_map jm ON jm.lid_row_id=c.jid_row_id LEFT JOIN jid jn ON jn._id=jm.jid_row_id ` +
    `WHERE m.text_data IS NOT NULL ${where} GROUP BY m._id ORDER BY m.timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  const urlRe = /https?:\/\/[^\s|]+/i;
  return rows
    .map((line) => {
      const p = line.split('|');
      if (p.length < 4) return null;
      const peer = (p[2] || '').replace(/[^\d]/g, '');
      const text = p.slice(3).join('|');
      const m = text.match(urlRe);
      return { ts: Number(p[0]) || 0, fromMe: p[1] === '1', peer: peer ? `+${peer}` : '', url: m ? m[0] : '', text: text.slice(0, 160) };
    })
    .filter((x) => x && x.url);
}

// ── REACTIONS (emoji tepkileri) ──────────────────────────────────────────────
// Emoji reactions on a peer's messages, from message_add_on_reaction. Returns
// [{ ts, emoji, fromMe }] newest-first, or null. New WA stores reactions as add-ons.
async function readWaReactions(serial, number, limit = 50) {
  const num = String(number || '').replace(/[^\d]/g, '');
  const n = Math.min(Math.max(1, limit | 0), 200);
  const where = num ? `AND ${waChatFilter(num)}` : '';
  const sql =
    `SELECT r.timestamp, r.reaction, r.sender_timestamp FROM message_add_on_reaction r ` +
    `JOIN message_add_on ao ON ao._id=r.message_add_on_row_id ` +
    `JOIN message m ON m._id=ao.parent_message_row_id JOIN chat c ON c._id=m.chat_row_id ` +
    `WHERE r.reaction IS NOT NULL ${where} ORDER BY r.timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) {
    // Fallback schema: some builds keep reactions inline on message_add_on.
    const alt = await waSql(serial, 'msgstore', `SELECT timestamp, reaction FROM message_add_on WHERE reaction IS NOT NULL ORDER BY timestamp DESC LIMIT ${n}`);
    if (alt === null) return null;
    return alt.map((l) => { const a = l.indexOf('|'); return a < 0 ? null : { ts: Number(l.slice(0, a)) || 0, emoji: l.slice(a + 1), fromMe: false }; }).filter(Boolean);
  }
  return rows
    .map((line) => { const p = line.split('|'); if (p.length < 2) return null; return { ts: Number(p[0]) || 0, emoji: p[1] || '', fromMe: false }; })
    .filter(Boolean);
}

// ── POLLS (anketler) ─────────────────────────────────────────────────────────
// Polls the account has in its chats, from message_poll + options. Returns
// [{ ts, question, options:[{ name, votes }] }] newest-first, or null.
async function readWaPolls(serial, limit = 20) {
  const n = Math.min(Math.max(1, limit | 0), 100);
  // VERIFIED-LIVE FIX: message_poll has NO poll_name column — the poll question is the
  // poll message's own text (message.text_data). Join it for the question text.
  const sql =
    `SELECT mp.message_row_id, m.timestamp, substr(m.text_data,1,200) FROM message_poll mp ` +
    `JOIN message m ON m._id=mp.message_row_id ORDER BY m.timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  const polls = [];
  for (const line of rows) {
    const p = line.split('|');
    if (p.length < 3) continue;
    const msgId = p[0];
    const ts = Number(p[1]) || 0;
    const question = p.slice(2).join('|');
    // Option names + vote counts for this poll.
    const opts = await waSql(serial, 'msgstore',
      `SELECT po.option_name, (SELECT COUNT(*) FROM message_poll_vote pv WHERE pv.poll_option_id=po._id) ` +
      `FROM message_poll_option po WHERE po.message_row_id=${Number(msgId) || 0}`);
    const options = (opts || []).map((o) => { const a = o.lastIndexOf('|'); return { name: a < 0 ? o : o.slice(0, a), votes: a < 0 ? 0 : Number(o.slice(a + 1)) || 0 }; });
    polls.push({ ts, question, options });
  }
  return polls;
}

// ── READ-BY (grup mesajını kim okudu) ────────────────────────────────────────
// Per-recipient delivery/read receipts for the account's OWN sent messages in a chat,
// from receipt_user — in a group this tells you WHICH members read a message. Returns
// [{ ts, member, deliveredTs, readTs }] or null.
async function readWaReadBy(serial, number, limit = 50) {
  const num = String(number || '').replace(/[^\d]/g, '');
  if (!num) return null;
  const n = Math.min(Math.max(1, limit | 0), 200);
  const sql =
    `SELECT m.timestamp, j.user, ru.receipt_device_timestamp, ru.read_timestamp ` +
    `FROM receipt_user ru JOIN message m ON m._id=ru.message_row_id ` +
    `JOIN jid j ON j._id=ru.receipt_user_jid_row_id JOIN chat c ON c._id=m.chat_row_id ` +
    `WHERE ${waChatFilter(num)} AND m.from_me=1 ORDER BY m.timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  return rows
    .map((line) => { const p = line.split('|'); if (p.length < 4) return null; const mem = (p[1] || '').replace(/[^\d]/g, ''); return { ts: Number(p[0]) || 0, member: mem ? `+${mem}` : '', deliveredTs: Number(p[2]) || 0, readTs: Number(p[3]) || 0 }; })
    .filter(Boolean);
}

// ── STARRED (yıldızlı mesajlar) ──────────────────────────────────────────────
// The account's starred (bookmarked) messages across all chats. Returns
// [{ ts, fromMe, peer, text }] newest-first, or null.
async function readWaStarred(serial, limit = 50) {
  const n = Math.min(Math.max(1, limit | 0), 200);
  const sql =
    `SELECT m.timestamp, m.from_me, COALESCE(jn.user, j.user), substr(m.text_data,1,120) ` +
    `FROM message m JOIN chat c ON c._id=m.chat_row_id JOIN jid j ON j._id=c.jid_row_id ` +
    `LEFT JOIN jid_map jm ON jm.lid_row_id=c.jid_row_id LEFT JOIN jid jn ON jn._id=jm.jid_row_id ` +
    `WHERE m.starred=1 ORDER BY m.timestamp DESC LIMIT ${n}`;
  const rows = await waSql(serial, 'msgstore', sql);
  if (rows === null) return null;
  return rows
    .map((line) => { const p = line.split('|'); if (p.length < 4) return null; const peer = (p[2] || '').replace(/[^\d]/g, ''); return { ts: Number(p[0]) || 0, fromMe: p[1] === '1', peer: peer ? `+${peer}` : '', text: p.slice(3).join('|') }; })
    .filter(Boolean);
}

// ── LABELS (Business etiketleri + etiketli sohbetler) ────────────────────────
// WhatsApp Business labels (name/color) + how many chats carry each. Returns
// [{ id, name, color, chatCount }] or null. Empty array on a non-Business account.
async function readWaLabels(serial) {
  // predefined_id > 0 → a built-in WhatsApp label (Unread/Favorites/Groups); 0 → a real
  // user-created Business label. We surface `predefined` so callers can filter.
  const rows = await waSql(serial, 'msgstore',
    `SELECT l._id, l.label_name, l.color_id, l.predefined_id, (SELECT COUNT(*) FROM labeled_jid lj WHERE lj.label_id=l._id) ` +
    `FROM labels l ORDER BY l.predefined_id`);
  if (rows === null) return null;
  return rows
    .map((line) => { const p = line.split('|'); if (p.length < 5) return null; return { id: p[0], name: p[1] || '', color: Number(p[2]) || 0, predefined: (Number(p[3]) || 0) > 0, chatCount: Number(p[4]) || 0 }; })
    .filter(Boolean);
}

// Contact display name for a number from wa.db (rehber/display name). Returns string|null.
async function readWaContactName(serial, number) {
  const num = String(number || '').replace(/[^\d]/g, '');
  if (!num) return null;
  const rows = await waSql(serial, 'wa', `SELECT COALESCE(display_name, wa_name) FROM wa_contacts WHERE jid LIKE '${num}@%' AND COALESCE(display_name, wa_name) IS NOT NULL LIMIT 1`);
  if (rows === null || !rows.length) return null;
  return rows[0] || null;
}

// Map an E.164 phone number's calling code → ISO-2 country (mirrors the API's
// CC_TO_ISO). Used to check whether the proxy exit country matches the number before
// registration, so a +90 number on a US exit is flagged instead of silently burned.
// Kept in exact sync with the API's CC_TO_ISO (auto-proxy.ts). A subset here silently
// downgraded the exit-country check to "unverifiable" for countries the API supports
// (e.g. +62 ID / +65 SG), so a real mismatch went unflagged. Mirror the full map.
const CC_TO_ISO = {
  '355': 'AL', '90': 'TR', '49': 'DE', '44': 'GB', '33': 'FR', '39': 'IT',
  '34': 'ES', '31': 'NL', '351': 'PT', '30': 'GR', '359': 'BG', '40': 'RO',
  '48': 'PL', '380': 'UA', '7': 'RU', '46': 'SE', '47': 'NO', '45': 'DK',
  '358': 'FI', '43': 'AT', '41': 'CH', '32': 'BE', '353': 'IE', '1': 'US',
  '55': 'BR', '52': 'MX', '54': 'AR', '91': 'IN', '62': 'ID', '63': 'PH',
  '84': 'VN', '66': 'TH', '60': 'MY', '65': 'SG', '880': 'BD', '92': 'PK',
  '971': 'AE', '966': 'SA', '20': 'EG', '27': 'ZA', '234': 'NG', '61': 'AU',
  '64': 'NZ', '81': 'JP', '386': 'SI', '385': 'HR', '381': 'RS', '389': 'MK',
  '382': 'ME', '383': 'XK', '387': 'BA', '420': 'CZ', '421': 'SK', '36': 'HU',
  '370': 'LT', '371': 'LV', '372': 'EE'
};
function ccToIso(phone) {
  const d = String(phone || '').replace(/[^\d]/g, '');
  if (!d) return null;
  for (const len of [3, 2, 1]) { const cc = d.slice(0, len); if (CC_TO_ISO[cc]) return CC_TO_ISO[cc]; }
  return null;
}

// Verify the device's REAL internet exit country the way an app (WhatsApp) sees it.
// Runs curl from the plain adb shell UID — NOT `su` — because redsocks' transparent
// iptables REDIRECT only rewrites app-UID traffic; a root curl bypasses it and would
// return the host's datacenter IP, masking a proxy that isn't actually routing. Best
// effort + short timeout so it never blocks provisioning; returns null on any failure.
async function verifyExitCountry(serial) {
  // 1) Cihaz-içi curl (hızlı). AMA Waydroid'de `adb shell curl https://…` TUTARSIZ
  // (DNS/TLS güvenilmez → boş döner) → "Çıkış IP doğrulanamadı" YANLIŞ-UYARISI, proxy
  // aslında çalışırken. Boş dönerse host-tarafı forward-proxy fallback (aşağı).
  const raw = await adbT(serial, ['shell', 'curl', '-s', '--max-time', '10', 'http://ipinfo.io/json'], 13000).catch(() => '');
  const text = String(raw || '');
  const country = (text.match(/"country"\s*:\s*"([A-Z]{2})"/) || [])[1] || null;
  if (country) {
    const ip = (text.match(/"ip"\s*:\s*"([^"]+)"/) || [])[1] || null;
    const city = (text.match(/"city"\s*:\s*"([^"]+)"/) || [])[1] || null;
    return { country, ip, city };
  }
  // 2) ★2026-07-27 FALLBACK: cihaz-içi curl boş → host'tan cihazın redsocks config'indeki
  // upstream proxy üzerinden forward-proxy ile çıkış-ülkeyi doğrula (GÜVENİLİR, proxy-alarm
  // fix'iyle aynı yöntem). serial "192.168.<sub>.112:5555" → subnet → net-head → instance.
  try {
    const m = /192\.168\.(\d+)\.112/.exec(String(serial));
    if (!m) return null;
    const sub = m[1];
    // subnet → instance adı (net-head.sh subnet-map'ini ters çevirir; redsocks-inst-*.conf tara).
    const { stdout: confPath } = await execFileAsync('bash', ['-c',
      `grep -l "local_port" /etc/redsocks-inst-*.conf 2>/dev/null | while read f; do inst=$(echo "$f"|grep -oE 'mi[0-9]+'); s=$(sh /opt/fleet-agent/waydroid/net-head.sh "$inst" 2>/dev/null); [ "$s" = "${sub}" ] && echo "$f" && break; done`]).catch(() => ({ stdout: '' }));
    const conf = String(confPath || '').trim().split('\n')[0];
    if (!conf) return null;
    const { stdout: creds } = await execFileAsync('bash', ['-c',
      `U=$(grep -oE 'login = "[^"]+"' ${conf}|sed 's/login = "//;s/"//'); ` +
      `P=$(grep -oE 'password = "[^"]+"' ${conf}|sed 's/password = "//;s/"//'); ` +
      `H=$(grep -E '^[[:space:]]*ip = ' ${conf}|head -1|grep -oE '[0-9.]+'); ` +
      `PT=$(grep -E '^[[:space:]]*port = ' ${conf}|head -1|grep -oE '[0-9]+'); ` +
      // .eu → .pr (resmi çalışan host) + forward-proxy GET (http hedef, CONNECT değil).
      `HP=$(echo ncx9yhrx.pr.thordata.net); ` +
      `curl -s --max-time 10 -x "http://$U:$P@$HP:$PT" http://ipinfo.io/json 2>/dev/null`]).catch(() => ({ stdout: '' }));
    const t2 = String(creds || '');
    const c2 = (t2.match(/"country"\s*:\s*"([A-Z]{2})"/) || [])[1] || null;
    if (!c2) return null;
    return {
      country: c2,
      ip: (t2.match(/"ip"\s*:\s*"([^"]+)"/) || [])[1] || null,
      city: (t2.match(/"city"\s*:\s*"([^"]+)"/) || [])[1] || null
    };
  } catch { return null; }
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
  // Provision drops wa-bringup.sh at /data/local/tmp; a rebooted device may still
  // have the persisted copy at /data/adb. Try both. /dev/uinput does NOT exist on
  // a fresh Waydroid boot — vtouch can't register its node without it, so create
  // it (major 10, minor 223) before running bring-up ("vtouch not in sysfs" fix).
  const script = (await adbSu(serial, `[ -f /data/local/tmp/wa-bringup.sh ] && echo /data/local/tmp/wa-bringup.sh || ([ -f ${VT_BRINGUP} ] && echo ${VT_BRINGUP})`)).trim();
  if (!script.endsWith('wa-bringup.sh')) return false;
  // wa-bringup starts vtouch + probes InputReader (~15s) — well over adbSu's 8s
  // hard timeout, which would kill it mid-bring-up and leave vtouch half-created.
  // Run it directly with a 40s budget instead.
  await adbT(serial, ['shell', '/system/bin/su', '-c',
    `mknod /dev/uinput c 10 223 2>/dev/null; chmod 666 /dev/uinput; sh ${script}`], 40000).catch(() => '');
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
  // ★★★2026-08-05 FIFO YOLU SESSİZCE ÇALIŞMIYOR — CANLI A/B ÖLÇÜMÜ (mi113).
  // Aynı cihazda, aynı koordinatta (540,2064), DowngradeFriction ekranında:
  //   • `su -c "/data/local/tmp/vtouch tap 540 2064"`  → "tap sent", ekran DEĞİŞTİ ✓
  //   • `echo 540 2064 > /data/local/tmp/vt.fifo`      → exit 0 ama HİÇBİR ŞEY OLMADI ✗
  // FIFO var ve yazılabilir (prw-rw-rw-), `echo` hata da vermiyor — bu yüzden kod
  // `return true` deyip başarılı sanıyordu ve tapReal'in sentetik fallback'i BİLE
  // devreye girmiyordu: her "gerçek dokunma" SESSİZ NO-OP'tu. Business downgrade'in
  // 5 tur boyunca aşılamamasının (DOWNGRADE_STUCK) asıl sebebi buydu.
  // ⚠️2026-08-05 GERİ ALINDI: bir ara FIFO'dan SONRA binary'yi de çağırıyordum
  // (`vtouch tap`). Ama bu HER gerçek dokunmayı ÇİFTLİYOR — bir diyalogda ikinci
  // dokunma modalın DIŞINA düşüp onu İPTAL edebiliyor (canlıda Business onay modalı
  // her turda kapanıyordu). FIFO yolu dünden beri çalışan yol; ikinci çağrı yalnızca
  // FIFO'nun yutulduğu kanıtlanmış bir cihazda, TEK SEFERLİK teşhis için elle
  // yapılmalı — otomatik akışta DEĞİL.
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
  if (!serial.includes(':')) return;
  try {
    await execFileAsync(ADB, ['connect', serial], { maxBuffer: 1024 * 1024 });
  } catch {
    /* already connected or will surface on the real command */
  }
  // ★★KOK-FIX 2026-07-28 (BAYAT-OFFLINE UC): adb, TCP uclarini kendiliginden SILMEZ.
  // Bir cihaz silinince ucu host'un adb sunucusunda 'offline' olarak KALIR (ve adb onu
  // otomatik yeniden baglamaya calisir). Ayni subnet YENI bir instance'a verilince
  // (subnet geri-donusumu) `adb connect` sadece "already connected" der -> uc 'offline'
  // KALIR -> provision'in ADB-yetkilendirme dongusu 30 tur bosa doner -> 'boot' adimi
  // 150s TIMEOUT -> kurulum BASARISIZ (panelde "Kurulum basarisiz").
  // CANLI KANIT: operator 9 cihaz silince 9 uc offline kaldi; mi36/mi37/mi20 UST USTE
  // bu yuzden dustu. Ayni kodun oncesinde (bayat uc yokken) mi29 sorunsuz kuruldu ->
  // yani sebep kod DEGIL, bayat uctu. Cozum: offline gorursek ucu ONCE dusur, sonra
  // yeniden bagla (adb'nin bu durumdan tek cikis yolu).
  const st = await execFileAsync(ADB, ['-s', serial, 'get-state'], { timeout: 5000 })
    .then((r) => String(r.stdout || '').trim()).catch((e) => String(e.stdout || e.message || ''));
  if (/offline/i.test(st)) {
    await execFileAsync(ADB, ['disconnect', serial], { timeout: 5000 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    await execFileAsync(ADB, ['connect', serial], { timeout: 8000 }).catch(() => undefined);
  }
}

// BAYAT adb-ucu TEMIZLEYICISI (2026-07-28): host'ta karsiligi OLMAYAN (waydroid.<inst>
// dizini yok) her offline/unauthorized ucu dusurur -> silinen cihazlarin kalintisi
// BIRIKMEZ ve operator elle tespit etmek zorunda kalmaz. adbRecoveryTick'ten cagrilir;
// ucuz (tek `adb devices` + dizin kontrolu). liveSubnets = calisan instance'larin
// net-head.sh subnetleri; oradaki bir uca ASLA dokunulmaz (gecici offline olabilir).
async function reapStaleAdbEndpoints(liveSubnets) {
  const TAB = String.fromCharCode(9), NL = String.fromCharCode(10);
  const out = await execFileAsync(ADB, ['devices'], { timeout: 8000 })
    .then((r) => String(r.stdout || '')).catch(() => '');
  for (const raw of out.split(NL)) {
    const parts = raw.split(TAB).join(' ').trim().split(' ').filter(Boolean);
    if (parts.length < 2) continue;
    const serial = parts[0], state = parts[1];
    if (!serial.startsWith('192.168.')) continue;
    if (!/offline|unauthorized/i.test(state)) continue;
    // ★★★2026-08-13 KOK-FIX: IS YAPAN CIHAZA ASLA DOKUNMA.
    //
    // CANLI OLARAK YASANDI (mi249, +905317467445 — operatorun kaydi YANDI):
    //   21:52:10  verify: reached OTP screen (round 0)   <- OTP ekrani GERCEKTEN oradaydi
    //   21:52:15  adb-reap: bayat uc dusuruldu 192.168.152.119:5555
    //   21:52:30  otp_not_reached                        <- 18 sn bosa, NUMARA YANDI
    // ADB kopunca curFocus() '' donuyor -> onOtp() 24 turun HEPSINDE false ->
    // agent "WhatsApp SMS gondermedi" diye YANLIS TERMINAL HUKUM veriyor.
    // Ayni sey 5 cihazi daha "Durduruldu" gosterdi (21:13/21:16/21:20/21:46/22:03);
    // olculdu: hepsinin wd-run sureci CALISIYORDU, sadece ADB ucu dusurulmustu.
    //
    // `busyDevices` (her job'da dolar) ve `provisioningInstances` reap'e HIC bagli
    // degildi. `busyDevices` serial'i tam olarak bu formatta ("IP:5555") tutar.
    // Gecici bir offline, is suren cihazda NORMALDIR (session restart, yuk) — uc
    // dusurulmezse adb kendi yeniden baglar; dusurulurse is OLUR.
    if (busyDevices.has(serial)) {
      log(`adb-reap: ${serial} ATLANDI — cihazda IS SURUYOR (uc dusurulmedi)`);
      continue;
    }
    const sub = serial.split('.')[2];
    if (liveSubnets.has(String(sub))) continue;   // gercek instance -> DOKUNMA
    await execFileAsync(ADB, ['disconnect', serial], { timeout: 5000 }).catch(() => undefined);
    log(`adb-reap: bayat uc dusuruldu ${serial} (state=${state}, host'ta instance yok)`);
  }
}

function p(payload, key, fallback) {
  const v = payload[key];
  return v === undefined || v === null ? fallback : v;
}

// Per-job wall-clock caps (ms). A job that runs longer than its cap is abandoned
// with a timeout error so the agent's SERIAL job loop can move on — without this,
// a WhatsApp ANR (or any hung on-device step) could wedge the loop and, because
// ONE agent process serves ALL of this host's devices, freeze every device's work
// until the 15-min API-side reaper fired. Individual `adb` calls already have their
// own short timeouts; this bounds the TOTAL flow. Types not listed use DEFAULT.
// Long flows (register, provision) keep a generous cap; short messaging is tight.
const JOB_TIMEOUT_DEFAULT_MS = 3 * 60 * 1000;
const JOB_TIMEOUTS_MS = {
  WHATSAPP_SEND: 100 * 1000,        // normally 15-30s; 100s is a hard ceiling
  WHATSAPP_SEND_MEDIA: 150 * 1000,  // media attach is slower
  WHATSAPP_READ: 90 * 1000,
  WHATSAPP_PROFILE: 120 * 1000,
  WHATSAPP_SET_NAME: 120 * 1000,     // menü→settings→profil→isim→save navigasyonu
  WHATSAPP_SET_AVATAR: 150 * 1000,   // push+indeks+crop, media-scan gecikmesi payı
  WHATSAPP_BLOCK: 90 * 1000,
  WHATSAPP_BLOCKLIST: 90 * 1000,
  WHATSAPP_MYNUMBER: 90 * 1000,
  WA_SET_AUTODOWNLOAD: 150 * 1000,   // UI: Ayarlar→Storage→3 satır×4 kutu (idempotent atlarsa saniyeler)
  WA_UPDATE_APK: 240 * 1000,         // 141MB push + pm install -r (cold ~30s); idempotent atlarsa saniyeler
  WHATSAPP_DELETE_MSG: 90 * 1000,
  WHATSAPP_CLEAR_CHAT: 90 * 1000,
  TELEGRAM_SEND: 100 * 1000,        // mirror WHATSAPP_SEND: normally 15-30s, 100s ceiling
  TELEGRAM_REGISTER: 10 * 60 * 1000,   // OTP/2FA-park flow: keep generous (mirror REGISTER_WHATSAPP)
  REGISTER_WHATSAPP: 10 * 60 * 1000,   // OTP-park flow: keep generous
  REGISTER_INSTAGRAM: 10 * 60 * 1000,
  PROVISION_DEVICE: 12 * 60 * 1000,    // full boot→WA-ready
  PROVISION_INTEGRITY: 6 * 60 * 1000,
  RPA_RUN: 6 * 60 * 1000,
  AGENT_RUN: 8 * 60 * 1000,
  APP_EXPLORE: 8 * 60 * 1000
};

// Race a job against its wall-clock cap. On timeout the RACE promise REJECTS (→ job
// reported FAILED, dispatch loop continues), but the underlying runJob keeps running
// in the background — it can't be forcibly killed (its in-flight `adb` child procs
// have no per-call timeout and adbd may never answer). If we freed the device the
// instant the race rejected, that abandoned runJob would still be driving ADB on the
// SAME device when the next job claims it → the exact concurrent-ADB corruption this
// per-device isolation exists to prevent. So we return the underlying promise too
// (`settled`) and the caller keeps the device busy until it actually settles.
// `timedOut` tells the caller which arm won so it only waits when it must.
function withJobTimeout(type, promise) {
  const ms = JOB_TIMEOUTS_MS[type] ?? JOB_TIMEOUT_DEFAULT_MS;
  let timer;
  // Swallow late rejection of the underlying promise so it can't become an
  // unhandledRejection after the race already rejected (would crash the process
  // under Node's default handler on 100s of long-running devices).
  const settled = Promise.resolve(promise).then(
    (v) => ({ ok: true, value: v }),
    (e) => ({ ok: false, error: e })
  );
  const state = { timedOut: false };
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      state.timedOut = true;
      reject(new Error(`Job zaman aşımı (${type}, ${Math.round(ms / 1000)}s)`));
    }, ms);
    if (timer.unref) timer.unref();
  });
  const raced = Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  return { raced, settled, state };
}

// Mirrors apps/api processor.ts job handling, executed locally over ADB.
// ── EKRAN TEMİZLİĞİ GEREKTİRMEYEN JOB'LAR ───────────────────────────────────
// Bu tipler cihaz ARAYÜZÜNE hiç dokunmaz (root/sqlite okuması, shell, host-seviyesi
// instance işleri). Bunlardan sonra HOME'a basmak boşuna ADB maliyeti olur ve
// operatörün açık bıraktığı ekranı da gereksiz yere kapatır.
const NO_UI_CLEANUP_JOBS = new Set([
  'NOOP', 'EMULATOR_SHELL', 'EMULATOR_SCREENSHOT',
  'PROVISION_DEVICE', 'PROVISION_INTEGRITY', 'DEVICE_WAKE', 'DEVICE_SLEEP', 'DEVICE_DESTROY',
  'EMULATOR_CREATE', 'EMULATOR_START', 'EMULATOR_STOP', 'EMULATOR_DELETE', 'EMULATOR_INSTALL_APK',
  'EMULATOR_SET_PROXY',
  // Root-DB okumaları: WhatsApp'ın kendi SQLite'ını okur, UI gezinmesi yoktur.
  'WHATSAPP_RECEIPTS', 'WHATSAPP_MEDIA', 'WHATSAPP_FETCH_MEDIA', 'WHATSAPP_CALLS',
  'WHATSAPP_SEARCH', 'WHATSAPP_UNREAD', 'WHATSAPP_DELETED', 'WHATSAPP_LINKS',
  'WHATSAPP_REACTIONS', 'WHATSAPP_POLLS', 'WHATSAPP_READ_BY', 'WHATSAPP_STARRED',
  'WHATSAPP_LABELS_LIST', 'WHATSAPP_VIEW_ONCE', 'WHATSAPP_VOICE_NOTES',
  'WHATSAPP_CHAT_SUMMARY', 'WHATSAPP_GROUP_MEMBERS', 'WHATSAPP_CONTACTS'
]);

// ★2026-07-29 — HER İŞ SONUNDA CİHAZ TEMİZ KALIR.
//
// Eskiden yalnızca `whatsappSend`'in BAŞARI yolu HOME'a dönüyordu; her hata çıkışı
// (ACCOUNT_BANNED / CHAT_NOT_OPENED / NO_CROP / ATTACH_FAILED …) cihazı olduğu ekranda
// bırakıyordu. Canlı sonuç: 38 cihazın 6'sı izin diyaloğunda, 2'si ContactPicker'da
// TAKILI kalmıştı ve RUNNING job yoktu — yani kimse onları kurtarmıyordu.
//
// ⚠️ Temizlik neden `runJob`'un finally'sinde, `runJobTask`'ta DEĞİL: `withJobTimeout`
// akışı ÖLDÜRMÜYOR (bkz. oradaki not) — timeout'ta job FAILED yazılır ama runJob arka
// planda ADB sürmeye devam eder. Temizlik daha dışta olsaydı, geç gelen tap'ler
// HOME'dan SONRA çalışıp cihazı yine kirli bırakırdı.
async function runJob(job) {
  const { type, serial } = job;
  try {
    return await runJobInner(job);
  } finally {
    if (serial && !NO_UI_CLEANUP_JOBS.has(type)) {
      await returnToHome(serial).catch(() => undefined);
    }
  }
}

async function runJobInner(job) {
  const { type, payload, serial } = job;
  // These job types operate on a Waydroid INSTANCE (host-level), not an ADB
  // endpoint — a stopped device has no serial yet. Exempt them from the guard.
  const instanceLevel = type === 'PROVISION_DEVICE' || type === 'DEVICE_WAKE' || type === 'DEVICE_SLEEP' || type === 'DEVICE_DESTROY';
  if (!serial && type !== 'NOOP' && !instanceLevel) {
    throw new Error('Job targets a device with no ADB endpoint on this host');
  }
  // Don't try to connect to a stopped device before waking it.
  if (serial && type !== 'DEVICE_WAKE') await ensureConnected(serial);

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
      // Bundled path: the API sends { apkFile, bundled:true, instance }. We install
      // the repo-shipped APK from APK_DIR via host-mount + `pm install` (adb install
      // stalls on the 137 MB WhatsApp APK; lxc-attach pm install is robust).
      if (p(payload, 'bundled', false)) {
        return installBundledApk(job, String(p(payload, 'apkFile', '')));
      }
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
      // ★2026-08-12: `packageName` iş yükünden ham geliyor → cihaz sh'i için tırnakla.
      return { stdout: await adb(serial, ['shell', 'am', 'force-stop', shArg(String(p(payload, 'packageName', '')))]) };

    case 'EMULATOR_PUSH_FILE': {
      const url = String(p(payload, 'url', ''));
      // ★2026-08-11 GÜVENLİK: `fileName` API'de içerik denetimine tabi DEĞİL
      // (`z.string().optional()`), bu yüzden host'a inmeden ÖNCE temizleniyor.
      // Aynı değer hem host'taki geçici yola hem cihazdaki hedefe gidiyordu:
      // "../.." ile host'ta ROOT yazma, cihazda da /sdcard dışına çıkma demekti.
      const fileName = safeFileName(String(p(payload, 'fileName', 'file')));
      if (!url) throw new Error('url is required');
      const local = await download(url, fileName);
      const dest =
        p(payload, 'destination', '') === 'downloads'
          ? `/sdcard/Download/${fileName}`
          : `/sdcard/DCIM/${fileName}`;
      try {
        await adb(serial, ['push', local, dest]);
        // ★2026-08-12: `-d` argümanı CİHAZIN sh'ine yeniden ayrıştırılıyor (bkz.
        // shArg yorumu, ~satır 974). `dest` kullanıcının `fileName`'ini taşıdığı için
        // `a;reboot` / `a$(id)` cihazda ÇALIŞIRDI. safeFileName() yol ayracını
        // temizliyor ama kabuk metakarakterlerini DEĞİL — o iş shArg'ın.
        await adb(serial, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', shArg(`file://${dest}`)]);
        return { dest };
      } finally {
        await safeRm(local);
      }
    }

    case 'EMULATOR_SET_PROXY': {
      // REAL country-matched routing via redsocks + transparent iptables (the same
      // path provisioning uses). A plain `settings put global http_proxy` is
      // ignored by hardened apps like WhatsApp and carries no auth — so we drive
      // wd-proxy.sh instead. Requires the device's Waydroid instance name (API
      // folds device.metadata.instance into the payload).
      const instance = String(p(payload, 'instance', ''));
      if (!instance) {
        // Fallback for non-Waydroid devices: the legacy setting (best-effort).
        const host0 = String(p(payload, 'host', ''));
        const port0 = p(payload, 'port', null);
        if (host0 && typeof port0 === 'number') {
          // ★2026-08-12: `host0` payload'dan HAM geliyor ve cihazın sh'inde yeniden
          // ayrıştırılıyor → `evil;reboot` gibi bir değer cihazda komut çalıştırırdı.
          // (`port0` zaten `typeof === 'number'` ile korunuyor.)
          return { stdout: await adb(serial, ['shell', 'settings', 'put', 'global', 'http_proxy', shArg(`${host0}:${port0}`)]) };
        }
        throw new Error('instance (Waydroid) or host+port required');
      }
      const clear = Boolean(p(payload, 'clear', false));
      if (clear) {
        log(`SET_PROXY[${instance}] clear`);
        const out = await hostSh('wd-proxy.sh', [instance, 'clear'], 60000).catch((e) => ({ stdout: '', stderr: e.message }));
        return { cleared: true, note: out.stdout || out.stderr || 'proxy cleared' };
      }
      const country = String(p(payload, 'country', p(payload, 'countryCode', '')));
      const host = String(p(payload, 'host', ''));
      const port = p(payload, 'port', 9999);
      const user = String(p(payload, 'username', ''));
      const pass = String(p(payload, 'password', ''));
      if (!country || !host || !user) throw new Error('country, host and username are required for redsocks proxy');
      // Log which country/host is being routed so proxy problems are diagnosable
      // from the agent log (the password is never logged). Previously the log only
      // showed "claimed/completed" with no country, making "US vs TR" bugs invisible.
      log(`SET_PROXY[${instance}] country=${country} host=${host}:${port} user=${user.slice(0, 24)}…`);
      const out = await hostSh('wd-proxy.sh', [instance, country, user, pass, host, String(port)], 60000);
      // Success requires the verified PROXY_RESULT marker AND no PROXY_FAIL. wd-proxy.sh
      // now only prints PROXY_RESULT after confirming the iptables REDIRECT rule really
      // landed, and prints PROXY_FAIL (need-root / redirect-not-installed) otherwise —
      // so a routing that didn't take no longer reports a false "APPLIED".
      const stdout = String(out.stdout || '');
      const failed = /PROXY_FAIL/.test(stdout);
      const ok = /PROXY_RESULT[^\n]*redsocks=\d+/.test(stdout) && !failed;
      log(`SET_PROXY[${instance}] country=${country} → ${ok ? 'APPLIED' : 'FAILED'}`);
      if (!ok) {
        throw new Error(`proxy apply failed: ${stdout.trim().split('\n').pop() || 'wd-proxy.sh did not confirm REDIRECT'}`);
      }
      // ★2026-07-27: proxy DEĞİŞTİ → WhatsApp'ı force-stop et. WhatsApp açıksa ESKİ proxy
      // çıkışına kurulmuş bağlantıyı cache'ler; yeni ülke-proxy'sinden sonra "Couldn't
      // connect" verir (CANLI: mi12 AL→TR). force-stop → sonraki açılış temiz bağlanır.
      // Best-effort (WhatsApp kurulu olmayabilir); kayıt akışı zaten yeniden açar.
      await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
      // Confirm the REAL exit country the way WhatsApp sees it (app-uid through redsocks).
      // A mismatch here is the single best early signal that a TR number is about to
      // register on a non-TR IP → surface it in the result note (non-fatal: the routing
      // rule IS installed; the upstream proxy's geo may just differ).
      const exit = await verifyExitCountry(serial).catch(() => null);
      let note = stdout.trim().split('\n').pop() || 'proxy applied';
      if (exit && exit.country) {
        const match = exit.country.toUpperCase() === country.toUpperCase();
        note = `${match ? '✓' : '⚠'} exit ${exit.ip || '?'} (${exit.country})${match ? '' : ` ≠ ${country}`}`;
        log(`SET_PROXY[${instance}] verified exit=${exit.country} ip=${exit.ip || '?'} match=${match}`);
      }
      return { applied: true, country, ...(exit ? { exitCountry: exit.country, exitIp: exit.ip, exitCity: exit.city, exitMatch: exit.country.toUpperCase() === country.toUpperCase() } : {}), note };
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
      return registerInstagram(serial, payload, job);

    case 'REGISTER_WHATSAPP':
      return registerWhatsApp(job);

    case 'WHATSAPP_SEND':
      return whatsappSend(serial, payload);

    case 'WHATSAPP_READ':
      return whatsappRead(serial, payload);

    case 'WHATSAPP_CONVERSATIONS': {
      // List the device's chats straight from msgstore.db (no UI, zero ban surface).
      const convos = await readWaConversations(serial, Number(p(payload, 'limit', 50)) || 50);
      if (convos === null) return { status: 'NO_ROOT', note: 'Sohbet listesi okunamadı (root/db yok)', count: 0, conversations: [] };
      return { status: 'OK', count: convos.length, conversations: convos };
    }

    // ── Root-DB read jobs (all no-UI, zero ban surface) ──────────────────────
    case 'WHATSAPP_RECEIPTS': {
      const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
      const r = to ? await readWaReceipts(serial, to, Number(p(payload, 'limit', 20)) || 20) : null;
      if (r === null) return { status: 'NO_ROOT', note: to ? 'Tik durumu okunamadı (root/db yok)' : 'to gerekli', count: 0, receipts: [] };
      return { status: 'OK', count: r.length, receipts: r };
    }
    case 'WHATSAPP_MEDIA': {
      const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
      const m = await readWaMedia(serial, to, Number(p(payload, 'limit', 50)) || 50);
      if (m === null) return { status: 'NO_ROOT', note: 'Medya listesi okunamadı (root/db yok)', count: 0, media: [] };
      return { status: 'OK', count: m.length, media: m };
    }
    case 'WHATSAPP_CALLS': {
      const c = await readWaCallLog(serial, Number(p(payload, 'limit', 50)) || 50);
      if (c === null) return { status: 'NO_ROOT', note: 'Arama geçmişi okunamadı (root/db yok)', count: 0, calls: [] };
      return { status: 'OK', count: c.length, calls: c };
    }
    case 'WHATSAPP_SEARCH': {
      const q = String(p(payload, 'query', p(payload, 'q', '')));
      const s = q ? await readWaSearch(serial, q, Number(p(payload, 'limit', 50)) || 50) : null;
      if (s === null) return { status: 'NO_ROOT', note: q ? 'Arama yapılamadı (root/db yok)' : 'query gerekli', count: 0, results: [] };
      return { status: 'OK', count: s.length, results: s };
    }
    case 'WHATSAPP_UNREAD': {
      const u = await readWaUnread(serial);
      if (u === null) return { status: 'NO_ROOT', note: 'Okunmamış sayısı okunamadı (root/db yok)' };
      return { status: 'OK', ...u };
    }
    case 'WHATSAPP_CONTACTS': {
      // Full address book (WhatsApp users the account knows) from wa.db.
      const list = await readWaContactsList(serial, Number(p(payload, 'limit', 200)) || 200);
      if (list === null) return { status: 'NO_ROOT', note: 'Rehber okunamadı (root/db yok)', count: 0, contacts: [] };
      return { status: 'OK', count: list.length, contacts: list };
    }
    case 'WHATSAPP_GROUP_MEMBERS': {
      // Members of a group chat (by subject or jid id) from msgstore.db.
      const group = String(p(payload, 'group', p(payload, 'to', '')));
      const mem = group ? await readWaGroupMembers(serial, group, Number(p(payload, 'limit', 500)) || 500) : null;
      if (mem === null) return { status: 'NO_ROOT', note: group ? 'Grup üyeleri okunamadı (root/db yok)' : 'group gerekli', count: 0, members: [] };
      return { status: 'OK', count: mem.length, members: mem };
    }
    case 'WHATSAPP_CHAT_SUMMARY': {
      // Per-chat aggregate stats (message/media counts, first/last ts) from msgstore.db.
      const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
      const sum = to ? await readWaChatSummary(serial, to) : null;
      if (sum === null) return { status: 'NO_ROOT', note: to ? 'Sohbet özeti okunamadı (root/db yok)' : 'to gerekli' };
      return { status: 'OK', ...sum };
    }
    case 'WHATSAPP_ACCOUNT_HEALTH': {
      // Registered number + WhatsApp version + registered flag, no UI.
      const h = await readWaAccountHealth(serial);
      if (h === null) return { status: 'NO_ROOT', note: 'Hesap durumu okunamadı (root/db yok)' };
      // ★2026-07-28: kimlik (numara/isim/surum) YETMEZ — asil soru "hesap KULLANILABILIR mi".
      // Sessiz yoklama WhatsApp'in KENDI ekran metnini okur (mesaj GONDERMEDEN) ve
      // BANNED/LOGGED_OUT/RESTRICTED/ACTIVE dondurur. API bunu hem kotulesme hem IYILESME
      // yonunde uygular (tek yonlu damga sorunu boylece kapanir).
      const probe = await waHealthProbe(serial).catch(() => null);
      return { status: 'OK', ...h, ...(probe ? { state: probe.state, evidence: probe.evidence, ...(probe.unverified ? { unverified: true } : {}) } : {}) };
    }
    case 'WHATSAPP_FETCH_MEDIA': {
      // Pull DOWNLOADED media off the device as base64 (root cat). Not-yet-downloaded
      // media comes back with pending:true (only an encrypted CDN blob exists).
      const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
      const r = await readWaFetchMedia(serial, to, Number(p(payload, 'limit', 5)) || 5);
      if (r === null) return { status: 'NO_ROOT', note: 'Medya okunamadı (root/db yok)', found: 0, pending: 0, items: [] };
      return { status: 'OK', ...r };
    }
    case 'WHATSAPP_REACTIONS': {
      const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
      const r = await readWaReactions(serial, to, Number(p(payload, 'limit', 50)) || 50);
      if (r === null) return { status: 'NO_ROOT', note: 'Tepkiler okunamadı (root/db yok)', count: 0, reactions: [] };
      return { status: 'OK', count: r.length, reactions: r };
    }
    case 'WHATSAPP_POLLS': {
      const r = await readWaPolls(serial, Number(p(payload, 'limit', 20)) || 20);
      if (r === null) return { status: 'NO_ROOT', note: 'Anketler okunamadı (root/db yok)', count: 0, polls: [] };
      return { status: 'OK', count: r.length, polls: r };
    }
    case 'WHATSAPP_READ_BY': {
      const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
      const r = to ? await readWaReadBy(serial, to, Number(p(payload, 'limit', 50)) || 50) : null;
      if (r === null) return { status: 'NO_ROOT', note: to ? 'Okuyanlar okunamadı (root/db yok)' : 'to gerekli', count: 0, readers: [] };
      return { status: 'OK', count: r.length, readers: r };
    }
    case 'WHATSAPP_STARRED': {
      const r = await readWaStarred(serial, Number(p(payload, 'limit', 50)) || 50);
      if (r === null) return { status: 'NO_ROOT', note: 'Yıldızlı mesajlar okunamadı (root/db yok)', count: 0, starred: [] };
      return { status: 'OK', count: r.length, starred: r };
    }
    case 'WHATSAPP_LABELS': {
      const r = await readWaLabels(serial);
      if (r === null) return { status: 'NO_ROOT', note: 'Etiketler okunamadı (root/db yok)', count: 0, labels: [] };
      return { status: 'OK', count: r.length, labels: r };
    }
    case 'WHATSAPP_VIEW_ONCE': {
      // Tek görünümlük foto/video — açılmış olsa bile dosya diskteyse çekilir.
      const r = await readWaViewOnce(serial, Number(p(payload, 'limit', 10)) || 10);
      if (r === null) return { status: 'NO_ROOT', note: 'View-once okunamadı (root/db yok)', count: 0, items: [] };
      return { status: 'OK', ...r };
    }
    case 'WHATSAPP_VOICE_NOTES': {
      // Sesli mesajlar (PTT) — audio/* medya. withAudio=false ile sadece meta.
      const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
      const withAudio = p(payload, 'withAudio', true) !== false;
      const r = await readWaVoiceNotes(serial, to, Number(p(payload, 'limit', 10)) || 10, withAudio);
      if (r === null) return { status: 'NO_ROOT', note: 'Sesli mesajlar okunamadı (root/db yok)', count: 0, items: [] };
      return { status: 'OK', ...r };
    }
    case 'WHATSAPP_DELETED': {
      // Silinen ("herkesten sil") mesajlar — DB'de kalan metin. Anti-delete.
      const r = await readWaDeleted(serial, Number(p(payload, 'limit', 50)) || 50);
      if (r === null) return { status: 'NO_ROOT', note: 'Silinen mesajlar okunamadı (root/db yok)', count: 0, deleted: [] };
      return { status: 'OK', count: r.length, deleted: r };
    }
    case 'WHATSAPP_LINKS': {
      // Paylaşılan tüm URL'ler (opsiyonel to ile tek sohbet).
      const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
      const r = await readWaLinks(serial, to, Number(p(payload, 'limit', 50)) || 50);
      if (r === null) return { status: 'NO_ROOT', note: 'Linkler okunamadı (root/db yok)', count: 0, links: [] };
      return { status: 'OK', count: r.length, links: r };
    }

    case 'WHATSAPP_PROFILE':
      return whatsappProfile(serial, payload);

    case 'WHATSAPP_SET_NAME':
      return whatsappSetName(serial, payload);

    case 'WHATSAPP_SET_AVATAR':
      return whatsappSetAvatar(serial, payload);

    case 'WHATSAPP_BLOCK':
      return whatsappBlock(serial, payload);

    case 'WHATSAPP_BLOCKLIST':
      return whatsappBlocklist(serial, payload);

    case 'WHATSAPP_MYNUMBER':
      return whatsappMyNumber(serial, payload);

    case 'WA_SET_AUTODOWNLOAD':
      return waSetAutoDownload(serial, payload);

    case 'WA_UPDATE_APK':
      return waUpdateApk(serial, payload, job.id);

    case 'WHATSAPP_SEND_MEDIA':
      return whatsappSendMedia(serial, payload);

    case 'WHATSAPP_DELETE_MSG':
      return whatsappDeleteMsg(serial, payload);

    case 'WHATSAPP_CLEAR_CHAT':
      return whatsappClearChat(serial, payload);

    case 'TELEGRAM_SEND':
      return telegramSend(serial, payload);

    case 'TELEGRAM_READ':
      return telegramRead(serial, payload);

    case 'TELEGRAM_REGISTER':
      return registerTelegram(job);

    case 'APP_EXPLORE':
      return exploreApp(serial, payload);

    case 'APPLY_FINGERPRINT':
      return applyFingerprint(serial, payload);

    case 'PROVISION_INTEGRITY':
      return provisionIntegrity(serial, payload);

    case 'PROVISION_DEVICE':
      return provisionDevice(job);

    case 'DEVICE_WAKE':
      return wakeDevice(job);

    case 'DEVICE_SLEEP':
      return sleepDevice(job);

    case 'DEVICE_DESTROY':
      return destroyDevice(job);

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
async function registerInstagram(serial, payload, job) {
  const IG = 'com.instagram.android';
  const email = String(p(payload, 'email', ''));
  const password = String(p(payload, 'password', ''));
  const fullName = String(p(payload, 'fullName', ''));
  const birthYear = Number(p(payload, 'birthYear', 1995));
  if (!email || !password || !fullName) throw new Error('email, password, fullName gerekli');

  // Live progress → the dashboard IG panel (correlated by accountId). Best-effort:
  // grabs a downscaled screenshot for the "SS göster" toggle. Mirrors registerWhatsApp.
  const jobId = job && job.id ? job.id : null;
  const accountId = p(payload, 'accountId', '');
  const igStep = async (step, percent, note, status) => {
    if (!jobId) return;
    let shot;
    try { const png = await grabPng(serial, 8000); if (png) shot = await shrinkPng(png, 320); } catch { /* no shot */ }
    await reportProgress(jobId, step, percent, note, status, { accountId, ...(shot ? { shot } : {}) }).catch(() => undefined);
  };

  const dump = async () => parseUiNodes(await uiDumpXml(serial));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tapNode = async (n) => { if (n) await adb(serial, ['shell', 'input', 'tap', String(n.tapX ?? n.cx), String(n.tapY ?? n.cy)]); };
  const tapAt = async (x, y) => adb(serial, ['shell', 'input', 'tap', String(x), String(y)]);
  // Tap a button: try the uiautomator dump first (exact), fall back to vision
  // when the dump is empty/garbled (some Waydroid builds). `vTarget` defaults to
  // the query text; pass a clearer NL description when the resource-id differs
  // from what a human sees on screen.
  const tapBy = async (q, field = 'any', vTarget) => {
    const n = findNode(await dump(), q, field);
    if (n) { await tapNode(n); return; }
    const v = await visionLocate(serial, vTarget || `the "${Array.isArray(q) ? q[0] : q}" button`, `Instagram sign-up flow`);
    if (v && v.found) { await tapAt(v.x, v.y); log(`vision tap "${vTarget || q}" @ ${v.x},${v.y}`); return; }
    throw new Error(`buton yok: ${q}`);
  };
  const typeInto = async (descQ, text, vTarget) => {
    let n = findNode(await dump(), descQ, 'desc');
    if (n) { await tapNode(n); }
    else {
      const v = await visionLocate(serial, vTarget || `the "${descQ}" input field`, `Instagram sign-up flow`);
      if (!v || !v.found) throw new Error(`alan yok: ${descQ}`);
      await tapAt(v.x, v.y); log(`vision tap field "${vTarget || descQ}" @ ${v.x},${v.y}`);
    }
    await sleep(800);
    await inputText(serial, text);
  };
  // Wait until a node matching q appears (timeout → throw). If the dump stays
  // empty the whole time, do ONE vision probe at the end so a broken dump alone
  // doesn't abort the flow when the expected screen is actually showing.
  const waitFor = async (q, ms = 12000, vScreen) => {
    const start = Date.now();
    let sawAnyNode = false;
    while (Date.now() - start < ms) {
      const nodes = await dump();
      if (nodes.length) sawAnyNode = true;
      if (findNode(nodes, q, 'any')) return true;
      await sleep(1000);
    }
    // Dump never produced the node. If dumps were empty throughout, confirm the
    // screen visually before giving up (vScreen is a NL description of it).
    if (!sawAnyNode) {
      const v = await visionLocate(serial, vScreen || `the "${q}" screen`, `Instagram sign-up flow`);
      if (v && (v.found || v.screen !== 'unknown')) { log(`vision confirms screen for "${q}": ${v.screen}`); return true; }
    }
    throw new Error(`ekran gelmedi: ${q}`);
  };

  await igStep('queued', 5, 'Instagram kaydı başlıyor');

  // 0) Launch IG fresh.
  await igStep('launch', 18, 'Instagram açılıyor');
  await launchApp(serial, IG, null);
  await sleep(8000);

  // 1) Get started → 2) Sign up with email
  await igStep('signup', 28, 'E-posta ile kayıt seçiliyor');
  const nodes = await dump();
  const startVisible = findNode(nodes, 'Get started', 'any');
  if (startVisible || nodes.length === 0) {
    // Either the dump saw it, or the dump is empty — in the empty case let
    // tapBy's vision fallback decide whether a "Get started" button is showing.
    try { await tapBy('Get started', 'any', 'the "Get started" button on the Instagram welcome screen'); await sleep(4000); } catch { /* not on this screen */ }
  }
  await waitFor('Sign up with email', 12000, 'the Instagram login/signup screen with a "Sign up with email" option');
  await tapBy('Sign up with email', 'any', 'the "Sign up with email" button'); await sleep(3000);

  // 3) Email
  await igStep('email', 38, 'E-posta giriliyor');
  await waitFor("What's your email", 10000, 'the "What\'s your email" input screen');
  await typeInto('Email,', email, 'the email address input field'); await sleep(800);
  await tapBy('Next', 'any', 'the "Next" button'); await sleep(4000);

  // 4) Confirmation code — read from catchmail, enter it.
  await igStep('code_wait', 48, 'E-posta doğrulama kodu bekleniyor');
  await waitFor('confirmation code', 15000, 'the "Enter the confirmation code" screen');
  const code = await fetchEmailCode(email, 90000);
  if (!code) throw new Error('e-posta kodu gelmedi (catchmail)');
  await igStep('code', 56, `Kod giriliyor (${code})`);
  await typeInto('Code input entry field', code, 'the confirmation code input field'); await sleep(1000);
  await tapBy('Next', 'any', 'the "Next" button'); await sleep(5000);

  // 5) Password
  await igStep('password', 64, 'Şifre oluşturuluyor');
  await waitFor('Create a password', 12000, 'the "Create a password" screen');
  await typeInto('Password,', password, 'the password input field'); await sleep(800);
  await tapBy('Next', 'any', 'the "Next" button'); await sleep(4000);

  // 6) Birthday — open the date picker, roll the year back to birthYear, SET.
  await igStep('birthday', 72, 'Doğum tarihi ayarlanıyor');
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
    await tapBy('SET', 'any', 'the "SET" / "Done" button on the date picker'); await sleep(1500);
  }
  await tapBy('Next', 'any', 'the "Next" button'); await sleep(4000);

  // 7) Full name
  await igStep('name', 80, 'İsim giriliyor');
  await waitFor("What's your name", 12000, 'the "What\'s your name" input screen');
  await typeInto('Full name,', fullName, 'the full name input field'); await sleep(800);
  await tapBy('Next', 'any', 'the "Next" button'); await sleep(4000);

  // 8) Username (IG pre-fills a valid suggestion) → Next
  await igStep('username', 88, 'Kullanıcı adı onaylanıyor');
  await waitFor('Create a username', 12000, 'the "Create a username" screen');
  await tapBy('Next', 'any', 'the "Next" button'); await sleep(5000);

  // 9) Terms → I agree (this actually creates the account)
  await igStep('terms', 94, 'Şartlar kabul ediliyor (hesap oluşturuluyor)');
  const termNodes = await dump();
  if (findNode(termNodes, 'I agree', 'any') || termNodes.length === 0) {
    try { await tapBy('I agree', 'any', 'the "I agree" button on the terms/consent screen'); await sleep(10000); } catch { /* not on terms screen */ }
  }

  // 10) Post-create walls we DON'T automate (cost / human): SMS verify + captcha.
  // Read via dump; if the dump is empty, use vision to classify the wall so we
  // still return a useful status instead of a blind CREATED.
  const after = await dump();
  const texts = after.map((n) => n.text).filter(Boolean).join(' | ');
  if (/human/i.test(texts)) { await igStep('wall', 100, 'IG insan/captcha doğrulaması istedi (canlı ekrandan tamamlayın)'); return { status: 'CAPTCHA_WALL', note: 'IG insan/captcha doğrulaması istedi (manuel/proxy gerekli)', screenTexts: texts.slice(0, 400) }; }
  if (/mobile number|confirm.*number/i.test(texts)) { await igStep('wall', 100, 'IG SMS doğrulaması istedi (canlı ekrandan tamamlayın)'); return { status: 'SMS_WALL', note: 'IG SMS doğrulaması istedi (numara ücreti gerekli)', screenTexts: texts.slice(0, 400) }; }
  if (after.length === 0) {
    const v = await visionLocate(serial, 'a phone-number verification field, a captcha/"confirm you\'re human" challenge, or the Instagram home feed', 'classify the post-signup Instagram screen');
    if (v) {
      const s = (v.screen + ' ' + v.note).toLowerCase();
      if (/captcha|human|challenge/.test(s)) { await igStep('wall', 100, `IG captcha istedi (vision: ${v.screen})`); return { status: 'CAPTCHA_WALL', note: `IG insan/captcha doğrulaması istedi (vision: ${v.screen})`, screenTexts: v.note.slice(0, 400) }; }
      if (/phone|sms|number|verify/.test(s)) { await igStep('wall', 100, `IG SMS istedi (vision: ${v.screen})`); return { status: 'SMS_WALL', note: `IG SMS doğrulaması istedi (vision: ${v.screen})`, screenTexts: v.note.slice(0, 400) }; }
      if (/home|feed|profile/.test(s)) { await igStep('done', 100, 'Hesap oluşturuldu'); return { status: 'CREATED', note: `Hesap oluşturuldu (vision: ${v.screen})`, screenTexts: v.note.slice(0, 400) }; }
    }
  }

  await igStep('done', 100, 'Hesap oluşturuldu');
  return { status: 'CREATED', note: 'Hesap oluşturuldu', screenTexts: texts.slice(0, 400) };
}

// ── Shared UIAutomator action helpers, bound to one device serial ────────────
//
// These wrap the parse/find primitives into the small vocabulary every
// element-based flow needs (dump, tap-by-content, type-into-field, wait-for).
// registerWhatsApp / whatsappSend / whatsappRead all build on this.
function waHelpers(serial) {
  // ★PERF (FIRSAT 1): the verify/first-run state machines call ~15-25 detectors per
  // round, and EVERY on*()/seen()/screenText()/find() ends in a dump() — each an
  // ~1-2s uiautomator dump on this GPU-less build (that's why "Yes/verify took forever"
  // — a single round could cost 20-40s). A short TTL cache collapses all the dumps in
  // ONE round into a single real dump: the first dump() in this ~700ms window pays the
  // cost, the rest reuse it. Any sleep INVALIDATES it (screen may have changed), so a
  // detector after an action still reads a fresh screen — behavior is unchanged, only
  // the redundant same-screen re-dumps are removed.
  let _dumpCache = null;
  let _dumpAt = 0;
  const DUMP_TTL = 700;
  const clearDumpCache = () => { _dumpCache = null; _dumpAt = 0; };
  // sleep() invalidates the cache: after any wait the screen may differ.
  const sleep = (ms) => { clearDumpCache(); return new Promise((r) => setTimeout(r, ms)); };
  const dump = async () => {
    if (_dumpCache && (Date.now() - _dumpAt) < DUMP_TTL) return _dumpCache;
    _dumpCache = parseUiNodes(await uiDumpXml(serial));
    _dumpAt = Date.now();
    return _dumpCache;
  };
  // Retrying dump for ANR-prone screens (Conversation, confirm dialogs) where
  // uiautomator dump intermittently returns '' → [] on this GPU-less Waydroid host.
  // A single empty dump must NOT be read as "screen empty / dialog closed / sent" —
  // root of a class of false-SENT / false-CLEARED / lost-inbound bugs. Each sleep
  // busts the dump cache → a fresh capture. Returns [] only after all tries fail;
  // callers MUST treat [] as INCONCLUSIVE, not a confirmed empty state.
  const dumpOrRetry = async ({ tries = 3, gapMs = 500 } = {}) => {
    for (let i = 0; i < tries; i++) {
      const n = await dump().catch(() => []);
      if (n.length) return n;
      if (i < tries - 1) await sleep(gapMs);
    }
    return [];
  };
  // Real touch (uinput vtouch) when available, else synthetic input tap. This
  // is the single tap primitive every WA flow (register/send/read) routes
  // through, so all of them get genuine touch events on hardened apps.
  const tapNode = async (n) => { if (n) { clearDumpCache(); await tapReal(serial, n.tapX ?? n.cx, n.tapY ?? n.cy); } };
  // Tap at raw Android-logical coordinates (for buttons found outside the node
  // model, e.g. by screenshot inspection).
  const tapXY = async (x, y) => { clearDumpCache(); return tapReal(serial, x, y); };
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
    clearDumpCache(); // text entry changes the field without a tap/sleep
    const s = String(text);
    if (adbKeyboardActive) {
      await adb(serial, ['shell', 'am', 'broadcast', '-a', 'ADB_INPUT_TEXT', '--es', 'msg', shArg(s)]);
    } else {
      await inputText(serial, s);
    }
  };
  const clearField = async () => {
    clearDumpCache();
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
  // Flatten all visible text on screen (for wall detection / debugging). TEXT-ONLY —
  // several callers parse this POSITIONALLY (pickVerifyMethod/listVerifyOptions do
  // `sheet.split(/Receive SMS/i)[1].slice(0,60)` to read a row's lock state), so injecting
  // content-desc here would shift those offsets and break lock detection. Kept as-is.
  const screenText = async () => (await dump()).map((n) => n.text).filter(Boolean).join(' | ');
  // ★H1: text + content-desc union — some WhatsApp buttons carry their label in
  // content-desc, not text (overflow items). The verify-loop detectors used seen()/find()
  // with field='any' (which checks desc), so the hoisted per-round read must include desc
  // to preserve that recognition. Used ONLY for the loop's `txt` — NOT for the positional
  // parsers above.
  const screenTextRich = async () => (await dump()).flatMap((n) => [n.text, n.desc]).filter(Boolean).join(' | ');
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
  const tapSyn = async (x, y) => { clearDumpCache(); await adb(serial, ['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]); };
  // Tap a node's center with a synthetic tap. Returns whether the node was truthy.
  // Use tapX/tapY (the smallest clickable ancestor's center, precomputed by parseUiNodes)
  // when present — same clickable-parent resolution as tapNode. Fixes synthetic taps that
  // landed on a non-clickable icon/label leaf whose real tap target is a wrapping row
  // (COORD-2b). Falls back to the node's own center. Improves ALL tapSynNode callers.
  const tapSynNode = async (n) => { if (!n) return false; await tapSyn(n.tapX ?? n.cx, n.tapY ?? n.cy); return true; };
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
  // Coordinate-based blind tap, scaled from a 1080x2400 reference to the device's
  // ACTUAL logical screen. Needed because uiautomator `dump()` HANGS on some
  // WhatsApp builds (2.25.x) — so seen()/tapSynIf() see nothing and can't dismiss
  // the first-run alerts (custom-ROM / internet / EULA), leaving the flow stuck.
  // These alerts always render at fixed positions, so a blind synthetic tap at the
  // known coordinate works even when the accessibility tree is unreadable.
  const tapScaled = async (refX, refY, refW = 1080, refH = 2400) => {
    let w = refW, h = refH;
    try {
      const wm = await adb(serial, ['shell', 'wm', 'size']);
      const ov = /Override size:\s*(\d+)x(\d+)/.exec(wm);
      const ph = /Physical size:\s*(\d+)x(\d+)/.exec(wm);
      const m = ov || ph;
      if (m) { w = Number(m[1]); h = Number(m[2]); }
    } catch { /* fall back to reference size (assume already 1080x2400) */ }
    await tapSyn((refX / refW) * w, (refY / refH) * h);
  };
  // Accessibility-service driven text/click via the com.fleet.a11y helper APK.
  // WhatsApp's registration EditTexts (registration_cc / registration_phone)
  // REJECT focus from synthetic taps AND vtouch on WA 2.25.x — the ONLY reliable
  // way to fill them is AccessibilityNodeInfo.ACTION_SET_TEXT, which works even
  // when the field refuses focus (VERIFIED live on mi5). The APK listens for:
  //   com.fleet.a11y.SET_TEXT  extras id=<viewId substring> text=<string>
  //   com.fleet.a11y.CLICK     extras id=<viewId>  OR  text=<visible text>
  // Both are best-effort broadcasts; we don't get a return value, so callers
  // verify the on-screen result with a follow-up dump/seen.
  // These a11y broadcasts change the screen WITHOUT a tap/sleep, so they must
  // invalidate the dump cache — otherwise a following screenText()/nameLanded() could
  // read the stale pre-action tree (e.g. see the field empty after SET_TEXT filled it).
  const a11ySetText = async (id, text) => {
    clearDumpCache();
    await adb(serial, ['shell', 'am', 'broadcast', '-a', 'com.fleet.a11y.SET_TEXT', '--es', 'id', id, '--es', 'text', String(text)]).catch(() => undefined);
  };
  const a11yClickId = async (id) => {
    clearDumpCache();
    await adb(serial, ['shell', 'am', 'broadcast', '-a', 'com.fleet.a11y.CLICK', '--es', 'id', id]).catch(() => undefined);
  };
  const a11yClickText = async (text) => {
    clearDumpCache();
    await adb(serial, ['shell', 'am', 'broadcast', '-a', 'com.fleet.a11y.CLICK', '--es', 'text', String(text)]).catch(() => undefined);
  };
  // Vision fallback (see visionLocate). Ask the control-plane where to tap for a
  // natural-language target; taps with a SYNTHETIC tap (WhatsApp popups/dialogs
  // dismiss on vtouch — same reason tapSyn exists). Returns whether it tapped.
  const tapVision = async (target, hint) => {
    const v = await visionLocate(serial, target, hint || 'WhatsApp registration flow');
    if (v && v.found) { await tapSyn(v.x, v.y); log(`WA vision tap "${target}" @ ${v.x},${v.y} (screen=${v.screen})`); return true; }
    return false;
  };
  // Tap by dump first; if the node isn't found (dump empty/garbled), fall back to
  // vision. `vTarget` is the NL description for the vision fallback.
  const tapByV = async (q, field = 'any', vTarget, hint) => {
    const n = findNode(await dump(), q, field);
    if (n) { await tapNode(n); return true; }
    return tapVision(vTarget || `the "${Array.isArray(q) ? q[0] : q}" button`, hint);
  };
  return { sleep, dump, dumpOrRetry, tapNode, tapXY, find, tapBy, tapIf, typeInto, tapById, typeIntoId, typeText, clearField, ensureAdbKeyboard, ensureTouch, waitFor, seen, screenText, screenTextRich, longPress, longPressNode, pollNode, tapSyn, tapSynNode, tapSynIf, tapScaled, a11ySetText, a11yClickId, a11yClickText, tapVision, tapByV };
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
// Accepts the whole job object (needs job.id for live progress). Legacy callers
// that pass (serial, payload) still work via the shim below.
async function registerWhatsApp(job, legacyPayload) {
  // Back-compat: old dispatch called registerWhatsApp(serial, payload). Detect a
  // bare serial string and wrap it so both shapes work (no job.id → no progress).
  if (typeof job === 'string') job = { id: null, serial: job, payload: legacyPayload || {} };
  const jobId = job.id || null;
  const serial = job.serial;
  // ★OTP-WATCH: a register job just claimed this device — cancel any parked OTP-watch for
  // it. Either this is the continuation (operator entered the code → the watch's purpose is
  // over) or a fresh re-register (the old parked state is stale). The in-job heartbeat takes
  // over the live view from here.
  if (typeof otpWatch !== 'undefined') otpWatch.delete(serial);
  const payload = job.payload || {};
  const phoneNumber = String(p(payload, 'phoneNumber', '')).trim();
  const fullName = String(p(payload, 'fullName', '')).trim();
  const otpCode = String(p(payload, 'otpCode', '')).trim();
  // Operator-chosen verification method for the "Choose how to verify" sheet
  // ('sms' | 'voice' | 'missed_call'). When absent, the flow PAUSES on that sheet and
  // asks the operator via the panel (status VERIFY_METHOD) instead of blindly guessing
  // — the user asked for this so they control SMS-vs-voice per number/attempt.
  const verifyMethod = String(p(payload, 'verifyMethod', '')).trim().toLowerCase();
  // ★★★2026-08-13 OPERATOR ISTEGI: "Sıfırla dediğimde WhatsApp SİLİNMESİN ki ekrana
  // elle müdahale edebileyim." Eskiden "Sıfırla ve Tekrar Dene" otpCode/verifyMethod
  // OLMADAN yeni bir kayit isi aciyordu -> asagidaki `pm clear` KOSUYORDU -> WhatsApp
  // fabrika ayarina donuyor ve operatorun ekranda duzeltecegi hicbir sey kalmiyordu
  // (yanlis kod girildiginde en cok ihtiyac duyulan sey tam olarak buydu).
  // `keepWaData: true` geldiginde WA verisi KORUNUR: proxy/parmak izi yenilenir,
  // WhatsApp acik kaldigi yerden devam eder. Fabrika-temiz baslangic isteniyorsa
  // panel bu bayragi GONDERMEZ (ilk kayitta oldugu gibi) ve eski davranis aynen kosar.
  const keepWaData = p(payload, 'keepWaData', false) === true;
  // ★MODAL-FIX: a continuation job (operator submitted OTP or picked a verify method) re-
  // launches WhatsApp and re-runs proxy/perms/a11y/launch — but re-narrating those early
  // steps in the panel makes the SAME accountId log look like it "started over" (double
  // "queued▸ Çıkış IP" etc.). Compute this early so those success notes can be SUPPRESSED
  // on a continuation; the work still runs, only the narration is silenced. The clean
  // `verify: ↩ Doğrulama ekranına devam ediliyor` line becomes the first visible line.
  const isContinuation = Boolean(otpCode || verifyMethod);
  const apkUrl = p(payload, 'apkUrl', '');
  // accountId correlates the two register jobs (number-entry, then OTP) into one
  // continuous progress panel on the dashboard.
  const accountId = p(payload, 'accountId', '');
  if (!phoneNumber) throw new Error('phoneNumber gerekli');
  if (!fullName) throw new Error('fullName gerekli');

  const h = waHelpers(serial);

  // Live step-by-step progress (mirrors provisionDevice). Each `snap(label)` marks
  // a natural step boundary; we send the label + a downscaled screenshot to the
  // dashboard via /agent/jobs/:id/progress so the operator watches the flow live.
  // No-op when jobId is null (legacy/test callers).
  let curStep = 'launch', curPct = 0;
  const waProgress = async (step, percent, note, status, shot) => {
    if (!jobId) return;
    await reportProgress(jobId, step, percent, note, status, { accountId, ...(shot ? { shot } : {}) });
  };
  const stepPct = { perms: 8, a11y: 15, launch: 25, eula: 35, register: 50, number: 62, submit: 72, verify: 80, otp_wait: 85, otp: 90, profile: 96, done: 100 };
  const step = async (key, note, fn) => {
    curStep = key; curPct = stepPct[key] ?? curPct;
    await waProgress(key, curPct, note);
    try { return await fn(); }
    catch (e) { stopHeartbeat(); await waProgress(key, curPct, `❌ HATA: ${e.message}`, 'FAILED'); throw new Error(`register ${key}: ${e.message}`); }
  };
  const logLine = (text) => waProgress(curStep, curPct, text);

  // ★L1+L2 OBSERVABILITY — the verify state machine used to write NOTHING to the agent
  // text log (/var/log/fleet-agent.log): a 176s run left only "claimed job" + "completed",
  // so a stall was undiagnosable from the log. wlog() writes a device-tagged line via the
  // top-level log() (a console.log → stdout → the log file), reusing screen reads the
  // detectors already did (no extra ADB). markPhase() records per-screen elapsed time so
  // the operator can SEE "downgrade=38s otp_wait=40s" both in the log and in the job result.
  const waTag = `[wa ${(serial.split(':')[0] || serial).split('.').pop() || serial}]`;
  const wlog = (m) => { try { log(`${waTag} ${m}`); } catch { /* logging must never break the flow */ } };
  const t0 = Date.now();
  const timings = {};            // { phaseName: totalMs }
  let _phaseAt = t0, _phase = 'start';
  const markPhase = (name) => {
    const now = Date.now();
    const dt = now - _phaseAt;
    timings[_phase] = (timings[_phase] || 0) + dt;
    if (name !== _phase) wlog(`phase '${_phase}' ${(dt / 1000).toFixed(1)}s → ${name}`);
    _phase = name; _phaseAt = now;
  };
  const timingSummary = () => Object.entries(timings).map(([k, v]) => `${k}=${(v / 1000).toFixed(0)}s`).join(' ');

  // Step-by-step screenshots for bug-tracking: every major step + every failure
  // return captures the screen so the operator SEES exactly where it stalled
  // (instead of a blind status string). Bounded to the last 12 shots to keep the
  // job result small. base64 PNG + label + ISO timestamp. ALSO pushes a downscaled
  // copy to the live progress panel (best-effort; sharp shrinks it so the WS frame
  // stays small).
  // ★2026-08-01: ön-uçuş uyarıları (ülke uyuşmazlığı / DNS / IP çakışması / kararsızlık).
  // done() bunu sonuca ekler; böylece bir kayıt battığında "hangi ağ koşulunda battı"
  // bilgisi hesabın kaydında KALIR. Eskiden bu bilgi sadece anlık panel notundaydı ve
  // iş bitince kayboluyordu → 75 FAILED'ın ağ-sebebi sonradan analiz edilemiyordu.
  let preflightWarnings = [];
  const shots = [];
  // keepNote=true pushes ONLY the screenshot (empty note) so the current parked-state
  // note is NOT overwritten. ★BUG-A ROOT: done() calls snap(label) right AFTER a parked
  // state emitted its meaningful note (e.g. "🔀 Doğrulama yöntemi seçin…" method-select,
  // or "📲 SMS kodu bekleniyor"). The old snap always sent note '📸 <label>', which
  // CLOBBERED that note → the panel (which keys the method-select / OTP UI off the note)
  // fell back to a plain OTP box and the operator couldn't pick a method. For OTP_WAIT
  // returns done() now snaps with keepNote so the prompt survives.
  const snap = async (label, keepNote = false) => {
    const png = await grabPng(serial, 12000).catch(() => null);
    if (png) {
      shots.push({ label, ts: new Date().toISOString(), png: png.toString('base64') });
      if (shots.length > 12) shots.shift();
      // Downscaled thumbnail for the live panel (≈300px). Falls back to no shot if
      // sharp is unavailable — the step still reports, just without a screenshot.
      const thumb = await shrinkPng(png, 300).catch(() => null);
      await waProgress(curStep, curPct, keepNote ? '🎥 canlı' : `📸 ${label}`, undefined, thumb || undefined);
    }
    return label;
  };
  // Result statuses that are NOT failures: OTP_WAIT (operator will enter the code)
  // and CREATED (success). Everything else returned via done() is a real dead-end
  // (DEVICE_WALL, NUMBER_ENTRY_FAILED, NOT_INSTALLED, LOGGED_OUT…) — the job row
  // still ends COMPLETED (agent protocol), but we must surface the REAL outcome to
  // the panel as a FAILED step so the operator sees where + why it stalled instead
  // of a green "COMPLETED" lie.
  const OK_STATUSES = new Set(['CREATED', 'OTP_WAIT']);

  // Live heartbeat screenshots: push a downscaled frame every ~10s for the WHOLE run,
  // not just at step boundaries. The old flow only snapped on step changes, so long
  // stretches (companion → verify) went dark and the operator couldn't tell a stall
  // from slow progress. This ticker keeps the modal's live view fresh throughout. It
  // only pushes the thumbnail to the panel (does NOT grow the persisted `shots` array,
  // which stays step-anchored + bounded). Stopped in done()/finally.
  let heartbeat = null;
  const startHeartbeat = () => {
    if (heartbeat || !jobId) return;
    heartbeat = setInterval(async () => {
      try {
        const png = await grabPng(serial, 8000).catch(() => null);
        if (!png) return;
        const thumb = await shrinkPng(png, 300).catch(() => null);
        if (thumb) await waProgress(curStep, curPct, '🎥 canlı', undefined, thumb);
      } catch { /* best-effort; never let a frame error break the flow */ }
    }, WA_HEARTBEAT_MS); // ★L3: 5s (was 10s) → smoother live view during long stretches
    // (DowngradeFriction ~5s, OTP wait). One screencap+shrink is a small fraction of 5s
    // on GPU-less Waydroid (the dominant cost is uiautomator dump, not screencap); the
    // ticker is .unref()'d + error-swallowed so an overrun frame can never wedge the flow.
    if (heartbeat.unref) heartbeat.unref(); // don't keep the test-job process alive
  };
  const stopHeartbeat = () => { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } };
  startHeartbeat();

  // Wrap a return so it always carries the collected screenshots + a final shot,
  // and emits a terminal progress event reflecting the TRUE outcome.
  const done = async (label, obj) => {
    stopHeartbeat();
    markPhase(label);                        // close the current phase's timer
    const elapsedMs = Date.now() - t0;
    // For OTP_WAIT parked states (SMS wait / method-select / other-phone / rate-limit) the
    // caller JUST emitted the operator-facing note; snap with keepNote so the screenshot
    // is pushed WITHOUT overwriting that note (see snap()'s ★BUG-A comment).
    const st = obj && obj.status;
    await snap(label, st === 'OTP_WAIT');
    // ★L2: one SUMMARY line so a tail of the log tells the whole timing story, e.g.
    // "[wa mi68] DONE otp_wait 108s | eula=8s number=6s downgrade=38s verify=12s"
    wlog(`DONE ${label} ${(elapsedMs / 1000).toFixed(0)}s | ${timingSummary()}`);
    if (st && !OK_STATUSES.has(st)) {
      // Real failure — mark the current step FAILED with the human note so the
      // panel turns red and shows the reason (not a fake success).
      const reason = (obj && obj.note) || st;
      await waProgress(curStep, curPct, `❌ ${reason}`, 'FAILED');
    } else if (st === 'CREATED') {
      await waProgress('done', 100, '✓ WhatsApp hesabı oluşturuldu', 'COMPLETED');
    }
    // ★OTP-WATCH: when we park at OTP_WAIT the job ends COMPLETED and the in-job heartbeat
    // stops, so the panel thumbnail would freeze while the operator reads/enters the code.
    // Register this device so the agent's otpWatchTick keeps pushing a ~10s frame until the
    // continuation job arrives (which clears it) or the TTL expires. Only when we have a
    // jobId (real dispatch, not a local test) + accountId (panel correlation).
    if (st === 'OTP_WAIT' && jobId && accountId) {
      otpWatch.set(serial, { jobId, accountId, deviceId: serial, until: Date.now() + OTP_WATCH_TTL_MS });
    }
    // ★2026-08-01: ön-uçuş uyarılarını sonuca iliştir — bir kayıt battığında ağ koşulu
    // (ülke uyuşmazlığı / DNS / IP çakışması / kararsızlık) hesabın kaydında KALSIN,
    // sadece anlık panel notunda kaybolmasın. Boşsa alan hiç eklenmez (temiz sonuç).
    return { ...obj, shots, timings, elapsedMs, ...(preflightWarnings.length ? { preflightWarnings } : {}) };
  };

  // 0) Ensure WhatsApp is installed; optionally side-load from apkUrl.
  // ★LEAK GUARD (S1): every throw-path AFTER startHeartbeat() that does NOT return via
  // done() (which stops the ticker) would otherwise leak the 10s heartbeat setInterval
  // in the long-lived agent — it keeps firing screencap against a dead job forever. The
  // `pm list` read (offline device → raw reject) and download() (fetch failure) both sit
  // before the install try and both throw. Wrap them so ANY throw here clears the ticker.
  let installed;
  try {
    installed = (await adb(serial, ['shell', 'pm', 'list', 'packages', WA_PKG])).includes(WA_PKG);
  } catch (e) { stopHeartbeat(); throw e; }
  if (!installed) {
    if (!apkUrl) return done('not_installed', { status: 'NOT_INSTALLED', note: 'WhatsApp kurulu değil ve apkUrl verilmedi' });
    let local;
    try { local = await download(String(apkUrl), 'whatsapp.apk'); }
    catch (e) { stopHeartbeat(); throw e; }
    try { await adb(serial, ['install', '-r', '-g', local]); }
    catch (e) { stopHeartbeat(); throw e; }
    finally { await safeRm(local); }
  } else if (!otpCode && !verifyMethod && !keepWaData) {
    // FIRST register only — WIPE WA data so it starts factory-fresh. ROOT CAUSE
    // (VERIFIED LIVE, mi10): a reused instance keeps the previous number's session and
    // WA reopens on that number's "Verify …" / rate-limit screen, so the new number is
    // never entered. `pm clear` resets WA to first-run (EULA → number).
    //
    // ★CRITICAL (VERIFIED LIVE, watest34): NEVER clear on a CONTINUATION job — when the
    // operator submits the OTP code (or picks a verify method), the API re-dispatches
    // REGISTER_WHATSAPP with otpCode/verifyMethod while WA is PARKED on the verify
    // screen. A pm-clear here nukes that live session → WA drops back to the empty
    // "Enter your phone number" screen and the just-entered code is thrown away. So we
    // gate the wipe on "no otpCode AND no verifyMethod" (i.e. a fresh registration).
    await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
    await adb(serial, ['shell', 'pm', 'clear', WA_PKG]).catch(() => undefined);
    await h.sleep(1200);
  }

  // 0.5) ÖN-UÇUŞ (pre-flight) — numara girilmeden ÖNCE cihazın ağ katmanını doğrula.
  // WhatsApp "Login not available" verir when a +90 number registers from a non-TR IP,
  // so the operator must SEE the real exit country up front — the modal renders this as
  // the "proxy" step.
  //
  // ★2026-08-01: burası ESKİDEN sadece çıkış-ülkeyi bakıyordu. CANLI TEŞHİS (38 cihaz
  // taraması): 8 cihaz TR numarası beklerken AL IP'sinden çıkıyordu ve bir cihaz (mi25)
  // 3 denemenin 2'sinde timeout veriyordu — ikisi de panelde "çevrimiçi" görünüyordu.
  // Bu yüzden kontrol 4 boyuta genişletildi: çıkış-IP/ülke, DNS (isim çözme), IP
  // çakışması (aynı IP'den 2 hesap = toplu-ban sürücüsü) ve cihaz kararlılığı.
  //
  // ★TASARIM KARARI (operatör isteği): HİÇBİRİ kaydı DURDURMAZ — hepsi UYARI. Amaç
  // mevcut akışı bozmadan teşhis görünürlüğü kazanmak. Tüm çağrılar .catch()'li ve
  // zaman-sınırlı; ön-uçuş bir hata yüzünden kaydı ASLA düşüremez.
  {
    const numCc = ccToIso(phoneNumber);
    const warns = [];              // panelde tek satırda toplanacak uyarılar
    const exit = await verifyExitCountry(serial).catch(() => null);

    // (a) Çıkış ülkesi ↔ numara ülkesi eşleşmesi (mevcut davranış korundu).
    if (exit && exit.country) {
      const match = !numCc || exit.country.toUpperCase() === numCc.toUpperCase();
      if (!isContinuation) await waProgress('proxy', 6, // ★MODAL-FIX: suppress on continuation
        `${match ? '✓' : '⚠'} Çıkış IP: ${exit.ip || '?'} (${exit.country}${exit.city ? ', ' + exit.city : ''})` +
        `${match ? ' — numara ülkesiyle eşleşti' : ` — numara ${numCc} ama çıkış ${exit.country}, WhatsApp banlayabilir!`}`);
      if (!match) warns.push(`ülke ${exit.country}≠${numCc}`);
      wlog(`preflight exit=${exit.country} ip=${exit.ip || '?'} num=${numCc || '?'} match=${match}`);
    } else {
      if (!isContinuation) await waProgress('proxy', 6, '⚠ Çıkış IP doğrulanamadı (proxy testi başarısız) — devam ediliyor');
      warns.push('çıkış IP doğrulanamadı');
      wlog('preflight exit=DOĞRULANAMADI');
    }

    // (b) DNS / isim çözme. ★KÖK-NEDEN GEÇMİŞİ: DNS'siz bir cihaz TCP seviyesinde 301
    // döndürüp ONLINE görünür ama İSİM çözemez → WhatsApp "Couldn't connect" verir ve
    // sebep görünmez kalır (31 cihazın 9'u böyleydi). Bu yüzden IP ile değil ADIYLA
    // istek atıyoruz: 200 dönerse resolver gerçekten çalışıyordur.
    const waHttp = await adbT(serial, ['shell', 'curl', '-s', '-o', '/dev/null',
      '-w', '%{http_code}', '--max-time', '12', 'https://www.whatsapp.com'], 16000)
      .catch(() => '');
    const httpCode = String(waHttp || '').trim().match(/\d{3}/)?.[0] || '';
    const dnsOk = httpCode === '200' || httpCode === '301' || httpCode === '302';
    if (!dnsOk) {
      warns.push(`DNS/erişim yok (whatsapp.com→${httpCode || 'cevapsız'})`);
      wlog(`preflight dns=FAIL code=${httpCode || 'none'}`);
      // ★2026-08-01: DNS sonucu PANELE de bas (operatör isteği: "bu logu da modalde
      // görsek"). Eskiden sadece agent log dosyasına gidiyordu, panelde görünmüyordu.
      if (!isContinuation) await waProgress('proxy', 6,
        `⚠ DNS/isim çözme BAŞARISIZ (whatsapp.com→${httpCode || 'cevapsız'}) — "Couldn't connect" riski`);
    } else {
      wlog(`preflight dns=OK code=${httpCode}`);
      if (!isContinuation) await waProgress('proxy', 6, `✓ DNS/isim çözme OK (whatsapp.com→${httpCode})`);
    }

    // (c) Cihaz kararlılığı: (b) hiç cevap vermediyse bir kez daha yokla. mi25 örneği —
    // 3 denemenin 2'sinde timeout, 1'inde normal cevap. Kararsız cihaz kayıt ortasında
    // düşer ve numara yanar; operatörün bunu ÖNCEDEN bilmesi gerekiyor.
    if (!dnsOk) {
      const retry = await adbT(serial, ['shell', 'curl', '-s', '-o', '/dev/null',
        '-w', '%{http_code}', '--max-time', '12', 'https://www.whatsapp.com'], 16000)
        .catch(() => '');
      const rc = String(retry || '').trim().match(/\d{3}/)?.[0] || '';
      if (!rc) {
        warns.push('cihaz kararsız (ağ 2 denemede de cevapsız)');
        wlog('preflight stability=UNSTABLE');
        if (!isContinuation) await waProgress('proxy', 6, '⚠ Cihaz kararsız — ağ 2 denemede de cevap vermedi');
      } else {
        wlog(`preflight stability=RECOVERED code=${rc}`);
        if (!isContinuation) await waProgress('proxy', 6, `✓ Ağ 2. denemede toparladı (${rc})`);
      }
    }

    // (d) Çıkış IP çakışması. İki hesabın AYNI çıkış IP'sinden kaydolması WhatsApp'ın
    // en net toplu-ban sinyalidir. Kayıt yapan diğer cihazların son doğrulanmış IP'sini
    // hafızada tutup çakışmayı bildiriyoruz (süreç-içi, TTL'li — kalıcı state yok).
    if (exit && exit.ip) {
      const now = Date.now();
      for (const [s, v] of waExitIps) if (now - v.at > WA_EXIT_IP_TTL_MS) waExitIps.delete(s);
      const clash = [...waExitIps].find(([s, v]) => s !== serial && v.ip === exit.ip);
      if (clash) {
        warns.push(`IP çakışması: ${exit.ip} ${clash[0].split(':')[0]} ile aynı`);
        wlog(`preflight ipclash ${exit.ip} ~ ${clash[0]}`);
        if (!isContinuation) await waProgress('proxy', 6,
          `⚠ IP ÇAKIŞMASI: ${exit.ip} adresi ${clash[0].split(':')[0]} cihazıyla AYNI — toplu ban riski!`);
      } else {
        wlog(`preflight ipclash=none ip=${exit.ip}`);
        if (!isContinuation) await waProgress('proxy', 6, `✓ Çıkış IP benzersiz (${exit.ip}) — başka cihazla çakışmıyor`);
      }
      waExitIps.set(serial, { ip: exit.ip, at: now });
    }

    // Uyarıları TEK satırda panele bas (kayıt DEVAM eder — hiçbiri engelleyici değil).
    if (warns.length && !isContinuation) {
      await waProgress('proxy', 6, `⚠ ÖN-UÇUŞ ÖZETİ: ${warns.join(' · ')} — kayıt yine de deneniyor`);
    } else if (!warns.length && !isContinuation) {
      await waProgress('proxy', 6, '✓ ÖN-UÇUŞ TEMİZ — ülke ✓ · DNS ✓ · IP benzersiz ✓ · cihaz kararlı ✓');
    }
    preflightWarnings = warns;     // sonuçta rapor edilir (teşhis için kalıcılaşır)
  }

  // The signup screen sequence below was mapped LIVE on a real device (WhatsApp
  // 2.25.x). resource-ids are stable across locales, so we drive fields by id.

  // 0b) Pre-grant EVERY runtime permission WhatsApp declares, so NO permission
  //     dialog ever pops mid-flow (they overlay registration_phone / OTP and stall
  //     the run) → fast, unattended signup. pm grant is a no-op if already granted
  //     or not declared. Some SMS/CALL perms are "installer-exempt restricted": a
  //     plain grant can be blocked, so we ALSO lift the appops restriction as root
  //     (best-effort). The full list was taken live from a device's manifest.
  const WA_PERMS = [
    'POST_NOTIFICATIONS', 'READ_CONTACTS', 'WRITE_CONTACTS', 'GET_ACCOUNTS',
    'READ_PHONE_STATE', 'READ_PHONE_NUMBERS', 'CALL_PHONE', 'ANSWER_PHONE_CALLS',
    'CAMERA', 'RECORD_AUDIO', 'RECEIVE_SMS', 'READ_SMS', 'SEND_SMS',
    'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_MEDIA_LOCATION',
    'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE',
    'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO',
    'BLUETOOTH_CONNECT', 'NEARBY_WIFI_DEVICES'
  ];
  curStep = 'perms'; curPct = stepPct.perms;
  if (!isContinuation) await waProgress('perms', curPct, 'İzinler veriliyor (23 runtime + appops)…'); // ★MODAL-FIX
  for (const short of WA_PERMS) {
    await adb(serial, ['shell', 'pm', 'grant', WA_PKG, `android.permission.${short}`]).catch(() => undefined);
  }
  // Restricted SMS/CALL_LOG perms stay ignored by appops even after pm grant on some
  // builds — force-allow them as root so WhatsApp reads the OTP SMS without a prompt.
  for (const op of ['RECEIVE_SMS', 'READ_SMS', 'SEND_SMS', 'READ_CALL_LOG', 'READ_PHONE_NUMBERS']) {
    await adbSu(serial, `appops set ${WA_PKG} ${op} allow`).catch(() => undefined);
  }
  if (!isContinuation) await logLine('✓ İzinler verildi'); // ★MODAL-FIX

  // 0b-2) Ensure the com.fleet.a11y AccessibilityService is enabled — it's the ONLY
  //   reliable way to fill WhatsApp's registration number fields (they reject
  //   focus). Enabling it via `settings put secure` does NOT need root. Idempotent.
  curStep = 'a11y'; curPct = stepPct.a11y;
  if (!isContinuation) await waProgress('a11y', curPct, 'Erişilebilirlik servisi + klavye…'); // ★MODAL-FIX
  await adb(serial, ['shell', 'settings', 'put', 'secure', 'enabled_accessibility_services',
    'com.fleet.a11y/com.fleet.a11y.FleetA11yService']).catch(() => undefined);
  await adb(serial, ['shell', 'settings', 'put', 'secure', 'accessibility_enabled', '1']).catch(() => undefined);

  // 0c) Prefer ADBKeyboard for text entry — on redroid the stock IME drops
  //     `input text` into WhatsApp's fields, so number entry silently fails.
  await h.ensureAdbKeyboard();
  if (!isContinuation) await logLine('✓ Erişilebilirlik + klavye hazır'); // ★MODAL-FIX

  // 1) Launch fresh.
  curStep = 'launch'; curPct = stepPct.launch;
  if (!isContinuation) await waProgress('launch', curPct, 'WhatsApp açılıyor…'); // ★MODAL-FIX
  // ★2026-07-27: YENİ kayıtta WhatsApp'ı ÖNCE force-stop et. KÖK-NEDEN: cihaz farklı-ülke
  // numarası için yeniden kullanılınca proxy ülkesi değişir (AL→TR), ama WhatsApp ESKİ proxy
  // bağlantısını cache'ler → numara ekranında "Couldn't connect. Please try again later"
  // (CANLI: mi12 AL→TR, force-stop+restart ÇÖZDÜ). force-stop soğuk-başlatır → yeni proxy ile
  // temiz bağlanır. SADECE yeni kayıtta (continuation'da OTP-ekranını kapatmak akışı bozar).
  if (!isContinuation) {
    await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
    await h.sleep(1200);
  }
  await launchApp(serial, WA_PKG, null);
  // Smart wait: instead of a blind 8s sleep, poll until WhatsApp's first-run UI has
  // actually rendered (EULA / companion / phone screen), then continue immediately.
  // A cold first launch usually renders in ~3-4s, so this saves ~4s of dead time on
  // the common path while still tolerating a slow device (hard cap ~9s). VERIFIED
  // safe on mi7: the EULA "Welcome to WhatsApp" screen is up well within the cap.
  {
    let ready = false;
    for (let w = 0; w < 12 && !ready; w++) {
      await h.sleep(700);
      const foc = await adb(serial, ['shell', 'dumpsys', 'window']).catch(() => '');
      if (/registration\.app|EULA|RegisterPhone|companionmode|\.registration\./i.test(foc)) { ready = true; break; }
      if (await h.seen('WhatsApp', 300) || await h.seen('Agree and continue', 300)) { ready = true; break; }
    }
    // Small settle so the button/tree is interactable even once the window is up.
    // ★#5: ready-path 350ms (was 800) — the poll already CONFIRMED the first-run window is
    // up, so a shorter settle is enough; the not-ready path keeps 1500 for slow devices.
    await h.sleep(ready ? 350 : 1500);
  }
  await snap('launch');

  // ── CONTINUATION SHORTCUT (VERIFIED LIVE, watest34) ───────────────────────
  // When the operator submits the OTP code (or picks a verify method), the API re-
  // dispatches REGISTER_WHATSAPP with otpCode/verifyMethod. WhatsApp was NOT cleared
  // (see pm-clear gate above), so it re-opens PARKED on the verify screen — NOT on the
  // first-run/number screen. Running the full first-run + number-entry state machine
  // here is WRONG: it can't find the EULA/companion/number screens (they're already
  // behind us), so it spins in the eula loop forever and the code never gets typed.
  // FIX: if this is a continuation AND WhatsApp is already on/near the verify screen,
  // jump STRAIGHT to the verify/OTP phase (skip first-run + number entry entirely).
  // Read the focused package/activity from the mCurrentFocus line (defined HERE —
  // before the continuation block below uses it. It was previously declared further
  // down with `const`, so the continuation block hit a Temporal-Dead-Zone
  // ReferenceError and crashed EVERY OTP-submit / verify-method continuation job.)
  const curFocus = async () => {
    // ★S3: use adbT (5s hard timeout) not plain adb() — a .catch() only handles a
    // *rejection*, not a HANG. execFileAsync with no timeout never resolves if the child
    // never returns, and curFocus is called dozens of times per run + inside the verify
    // loop; a single hung `dumpsys window` on a loaded GPU-less Waydroid would freeze the
    // agent's whole job loop (no per-job wall-clock guard). The timeout degrades a hang
    // to '' → the flow falls through to its coordinate/text fallbacks instead of wedging.
    const w = await adbT(serial, ['shell', 'dumpsys', 'window'], 5000).catch(() => '');
    const m = w.match(/mCurrentFocus=\S+\s+\S+\s+([^\s}]*\/[^\s}]+)/) ||
              w.match(/mCurrentFocus=[^}]*?([\w.]+\/[\w.]+)/);
    return (m && m[1]) ? m[1] : w;
  };

  let skipToVerify = false;
  if (isContinuation) {
    const foc = await curFocus();
    // VerifyPhoneNumber activity, or the code field / "other phone" text present.
    if (/verifyphone|VerifyPhoneNumber/i.test(foc) ||
        (await h.find('com.whatsapp:id/verify_sms_code_input', 'id')) != null ||
        (await h.find('com.whatsapp:id/registration_verify', 'id')) != null ||
        (await h.seen('Verification code', 400)) ||
        (await h.seen('Choose how to verify', 400))) {
      skipToVerify = true;
      await waProgress('verify', stepPct.verify, '↩ Doğrulama ekranına devam ediliyor (kod/yöntem girilecek)…');
    } else if (/HomeActivity|home\.ui\.Home|conversations/i.test(foc) || (await h.find('com.whatsapp:id/fab', 'id')) != null) {
      // Continuation arrived but WhatsApp is ALREADY on the home screen → registration
      // already finished (a duplicate/late continuation). Report success instead of
      // re-running the number machine (which would fail to find any first-run screen).
      return done('home', { status: 'CREATED', note: 'WhatsApp zaten kayıtlı (ana ekran) — doğrulama tamamlanmış', phoneNumber });
    } else {
      // Continuation arrived but we're NOT on verify AND NOT on home — the parked
      // session was lost (crash / unexpected screen). Running the full first-run +
      // number machine here would silently DISCARD the operator's code and could
      // re-submit the number (wasting an SMS / tripping a rate-limit). Bail cleanly so
      // the operator knows a fresh registration is needed. (VERIFIED gap, scenario #7.)
      const st = (await h.screenText().catch(() => '')).slice(0, 300);
      return done('session_lost', {
        status: 'REGISTER_FAILED',
        note: 'Doğrulama oturumu kayboldu (WhatsApp beklenen ekranda değil) — kodu giremedik. Temiz bir kayıt başlatın.',
        phoneNumber, screenTexts: st
      });
    }
  }

  // ── FIRST-RUN STATE MACHINE (launch → phone-number screen) ────────────────
  // The screens between launch and the number field are NON-deterministic: the
  // custom-ROM / "internet required" alert appears on SOME boots and not others;
  // after EULA the app SOMETIMES lands on the companion/QR page and SOMETIMES goes
  // straight to the number screen; a notification-permission dialog may or may not
  // pop. A fixed "alert → EULA → companion-menu" sequence wastes time waiting for
  // screens that aren't there (slow) and breaks when one shows up out of order
  // (unstable). So — exactly like the verify phase — we LOOP: read the screen,
  // recognize the state, act, re-observe, until the phone-number field appears.
  //   • custom-ROM / internet / generic alert   → dismiss (OK)
  //   • EULA "Welcome to WhatsApp"               → Agree and continue
  //   • notification / runtime permission dialog → Allow
  //   • companion / "Link a device" / QR page    → ⋮ → "Register new account"
  //   • Google "Choose a phone number" sheet     → BACK
  //   • phone-number field present               → DONE (exit)
  curStep = 'eula'; curPct = stepPct.eula;
  await waProgress('eula', curPct, 'İlk ekranlar (uyarı / EULA / QR) çözülüyor…');
  markPhase('eula');
  const OK_XY = [582, 1349];      // custom-ROM / internet alert "OK" (verified)
  const EULA_XY = [540, 1909];    // "Agree and continue" (verified)

  // ★ Focus-activity helper. mi7's uiautomator dump is INTERMITTENTLY EMPTY (a11y
  //   tree momentarily unreadable), which makes seen()/find() silently return false
  //   and the state machine miss the screen it's actually on (VERIFIED: the flow sat
  //   on EULA for 50s+ because onEulaScreen() relied on seen() and the dump was
  //   empty that round). `dumpsys window` returns the current activity name RELIABLY
  //   even when the a11y tree doesn't, so we recognize screens by their Activity too.
  // Target: the phone-number field is present. Recognize by Activity (RegisterPhone)
  // OR the a11y field — either signal alone is enough (dump-independent primary).
  const onPhoneScreen = async () => {
    const f = await curFocus();
    if (/phonenumberentry|RegisterPhone/i.test(f)) return true;
    return (await h.find('com.whatsapp:id/registration_phone', 'id')) != null ||
      (await h.find('com.whatsapp:id/registration_cc', 'id')) != null ||
      (await h.seen('Enter your phone number', 300));
  };
  // Companion / QR page — new-number signup is behind ⋮ → "Register new account".
  const onCompanion = async () => {
    const f = await curFocus();
    if (/companionmode|RegisterAsCompanion/i.test(f)) return true;
    return (await h.seen('companion device', 400)) || (await h.seen('Link a device', 300)) ||
      (await h.seen('Link as companion', 300)) || (await h.find('com.whatsapp:id/registration_qr', 'id')) != null;
  };
  // "Transfer chat history" / "Scan QR code to connect phones" — WhatsApp offers to
  // pull chats off an OLD phone via QR. We have no old phone to scan, so this is a
  // dead-end that stalls until dismissed. Recognize by Activity (ChatTransferActivity)
  // or its text; onChatTransfer()==true means we must tap NOT NOW to fall through to
  // the normal number-verification path. VERIFIED LIVE (Pixel 7, +90 number already
  // active on a Samsung S21: CONTINUE→"Turn on location" dead-end; NOT NOW→VerifyPhoneNumber).
  const onChatTransfer = async (foc, txt) => {
    const f = foc ?? await curFocus();
    if (/ChatTransfer|migration\.transfer/i.test(f)) return true;
    const t = txt ?? await h.screenTextRich().catch(() => '');
    if (/Transfer chat history|Scan QR code to connect phones/i.test(t)) return true;
    return (await h.find('com.whatsapp:id/chat_transfer_primary_btn', 'id')) != null;
  };
  const onEulaScreen = async () => {
    const f = await curFocus();
    if (/\.EULA\b|registration\.app\.EULA/i.test(f)) return true;
    return (await h.seen('Agree and continue', 400)) || (await h.seen('AGREE AND CONTINUE', 300)) ||
      (await h.seen('Welcome to WhatsApp', 300));
  };
  // Custom-ROM / internet alert is an AlertDialog OVERLAY — it doesn't change the
  // focused activity, so this one must read the a11y tree (best-effort).
  const onRomAlert = async () =>
    (await h.seen('custom ROM', 400)) || (await h.seen('unsupported', 300)) ||
    (await h.seen('need an internet', 300)) || (await h.seen('internet connection', 300));
  const onPermDialog = async () => {
    const f = await curFocus();
    if (/permissioncontroller|GrantPermissions/i.test(f)) return true;
    return (await h.find('com.android.permissioncontroller:id/permission_allow_button', 'id')) != null ||
      (await h.seen('to send you notifications', 300));
  };
  const onNumberHint = async () => /PhoneNumberHint|assistedsignin/i.test(await curFocus());
  // Open ⋮ → "Register new account". ★VERIFIED LIVE (mi11, WA companion/QR page):
  // the overflow ImageView (content-desc "More options") sits at bounds
  // [975,84][1080,210] (center 1027,147) and opens the popup with a RAW `input tap`
  // (tapSyn is already raw input tap here — NOT vtouch). Once open, the popup's
  // "Register new account" row's REAL bounds are read from the dump and tapped at
  // its measured center (mi11: row [554,211][1070,525] → 812,368). Reading the live
  // bounds makes this resolution-independent instead of trusting a hard-coded point.
  // Vision is intentionally NOT used — it's an optional fallback that only wastes a
  // ~60s round when ANTHROPIC_API_KEY is absent, and the coordinate path is reliable.
  const openRegisterMenu = async () => {
    // 1) Open the overflow. Prefer the live "More options" node; else the a11y
    //    broadcast; else the measured coordinate. All three are raw input taps.
    const ov = await h.pollNode('More options', 1200, 'desc');
    if (ov) { await h.tapSyn(ov.cx, ov.cy); }
    else { await h.a11yClickId('menuitem_overflow'); await h.tapScaled(1027, 147).catch(() => undefined); }
    // 2) Wait for the popup row to render, then tap ITS measured center. The
    //    TextView is clickable=false so we target the clickable row parent by
    //    reading the node the dump reports for "Register new account".
    let picked = false;
    for (let m = 0; m < 6 && !picked; m++) {
      await h.sleep(600);
      const item = findNode(await h.dump(), 'Register new account', 'text');
      if (item) {
        // Tap the popup row. The text TextView is clickable=false, but a synthetic
        // tap on its center usually lands inside the clickable row on WA's popup.
        // Tap the text center first, then nudge up ~60px toward the row center
        // (measured live mi11: text 812,430 vs row 812,368) as a second shot.
        await h.tapSyn(item.cx, item.cy);
        await h.sleep(400);
        await h.tapSyn(item.cx, Math.max(0, item.cy - 60));
        await h.sleep(400);
        picked = true;
      }
    }
    // 3) a11y-text-click as a parallel best-effort (harmless if the row already took).
    await h.a11yClickText('Register new account');
    // 4) Dump-blind fallback — the popup is open but uiautomator can't read it. Use
    //    the VERIFIED measured coordinates (row center 812,368, then text 812,430).
    if (!picked) {
      await h.tapScaled(812, 368).catch(() => undefined);
      await h.sleep(500);
      await h.tapScaled(812, 430).catch(() => undefined);
    }
    return picked;
  };

  let reachedPhone = false;
  let romTaps = 0, eulaTaps = 0, menuTaps = 0, idleRounds = 0;
  // Continuation job already parked on the verify screen (see skipToVerify above):
  // skip the whole first-run + number-entry machine and go straight to the verify
  // phase, so the OTP/method gets applied instead of spinning in the eula loop.
  if (skipToVerify) reachedPhone = true;
  // ~18 observe→act rounds is plenty; the common path (EULA → number) takes 2-3.
  // ★PERF: each round reads the focused activity ONCE (dumpsys window — never hangs)
  //   and branches on it FIRST. The dump-based detectors (onRomAlert/onPermDialog via
  //   seen(), which can each stall up to 5s when a11y is unreadable) are consulted
  //   ONLY for overlays that don't change the activity, and only when the activity is
  //   the EULA/companion base screen. This cut the per-round cost from ~35s (many
  //   dumps) to ~2s on this build (measured: EULA sat for 35s/round before this).
  const firstRunT0 = Date.now();
  let lastFoc = '';
  for (let round = 0; round < 22 && !reachedPhone; round++) {
    const foc = await curFocus();
    // ★BUG-B instrumentation: log which screen the first-run loop sees each time the
    // focused activity CHANGES, with elapsed time — so a tail of the log shows exactly
    // where the ~37s "eula" phase went (e.g. stuck on a companion/QR page, or WhatsApp
    // itself slow to leave "connecting"). Only logs on change to stay quiet on fast runs.
    const focShort = (foc || '').split('/').pop()?.slice(0, 40) || '';
    if (focShort !== lastFoc) {
      wlog(`first-run r${round} +${((Date.now() - firstRunT0) / 1000).toFixed(1)}s → ${focShort}`);
      lastFoc = focShort;
    }

    // ★"System UI isn't responding" / "<app> isn't responding" ANR dialog. VERIFIED
    //   LIVE on mi7 right after a REBOOT: SystemUI ANRs repeatedly (low CPU + reboot
    //   load), overlaying an "Close app / Wait" dialog that blocks the whole flow.
    //   The focused window becomes an "Application Not Responding" system dialog. We
    //   press "Wait" (android:id/aerr_wait) to keep the app alive and dismiss the
    //   dialog; tapById + a text tap + the measured coordinate all target it (raw
    //   input taps, no dump-hang). This makes the flow survive a freshly-rebooted
    //   device instead of stalling on the number screen.
    if (/Application Not Responding|isn.t responding|aerr_/i.test(foc) || await h.seen("isn't responding", 300)) {
      await h.tapById('android:id/aerr_wait').catch(() => undefined);
      if (!(await h.tapSynIf('Wait'))) await h.tapSyn(322, 1306).catch(() => undefined); // "Wait" (measured)
      await h.sleep(1500); continue;
    }

    // Target reached? (activity is the number screen)
    if (/phonenumberentry|RegisterPhone/i.test(foc)) { reachedPhone = true; break; }

    // Google "Choose a phone number" hint sheet — BACK closes it (activity signal).
    if (/PhoneNumberHint|assistedsignin/i.test(foc)) {
      await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
      await h.sleep(1000); continue;
    }

    // Runtime permission dialog (activity signal) — allow so it can't hide fields.
    if (/permissioncontroller|GrantPermissions/i.test(foc)) {
      await h.tapById('com.android.permissioncontroller:id/permission_allow_button').catch(() => undefined);
      await h.tapSyn(540, 1247).catch(() => undefined); // notifications "Allow" (verified coord)
      await h.sleep(1000); continue;
    }

    // Companion / QR page — go through ⋮ → "Register new account". Newer WhatsApp
    // builds render "Link as companion device" (QR page, incl. the "QR code timed
    // out / Reload" state) INSIDE the registration activity, so the activity string
    // is NOT companionmode/RegisterAsCompanion. VERIFIED LIVE (mi10): a registration
    // that landed here stalled because the activity-signal branch never fired and the
    // page fell through to "unknown screen". So detect it by the text signal too
    // (onCompanion() already reads "Link as companion"/"companion device"/registration_qr).
    if (/companionmode|RegisterAsCompanion/i.test(foc) || await onCompanion()) {
      await openRegisterMenu();
      menuTaps++;
      // After the menu tap, RegisterPhone can take a moment to focus. Poll the
      // activity too (onPhoneScreen reads text; the activity flips first).
      for (let w = 0; w < 6; w++) {
        await h.sleep(800);
        if (/phonenumberentry|RegisterPhone/i.test(await curFocus()) || await onPhoneScreen()) { reachedPhone = true; break; }
      }
      continue;
    }

    // EULA screen (activity signal). The custom-ROM / internet AlertDialog is an
    // OVERLAY on top of EULA that doesn't change the activity — so while on EULA we
    // FIRST blind-dismiss the possible alert (raw OK tap, harmless if absent), THEN
    // tap the EULA accept button. Both are raw input taps (no dump) → no hang.
    // ★VERIFIED LIVE mi7: raw `input tap 540 1910` clears EULA→RegisterPhone.
    if (/\.EULA\b|registration\.app\.EULA/i.test(foc)) {
      await h.tapSyn(OK_XY[0], OK_XY[1]).catch(() => undefined);   // dismiss ROM/internet alert if present
      await h.sleep(400);
      await h.tapSyn(540, 1910).catch(() => undefined);            // EULA "Agree and continue"
      await h.a11yClickId('eula_accept');                          // broadcast fallback (non-blocking)
      eulaTaps++;
      // ★BUG-B fix: after accepting EULA, WhatsApp takes several seconds to render the
      // number screen (measured LIVE: ~14s from EULA-tap to phonenumberentry). The old
      // blind sleep(1600)+continue meant the loop re-tapped EULA (or idled) for many
      // rounds until the number screen finally appeared. Instead POLL curFocus (cheap,
      // never-hangs) until we LEFT the EULA activity, cap ~10s. Exits the instant the
      // number screen renders — cutting the dead time — while still capped for safety.
      // ★#3: cap 30 (15s, was 20/10s). Measured EULA→number is ~14s on many builds; the old
      // 10s cap often gave up JUST before RegisterPhone painted and the flow fell into the
      // companion→openRegisterMenu detour (~14-21s extra). Waiting a bit longer for a DIRECT
      // RegisterPhone catches those runs. Early-exit is unchanged, so a fast boot/companion
      // hop still exits immediately — this only extends patience on the slow-direct case.
      let leftEula = false;
      for (let w = 0; w < 30 && !leftEula; w++) {
        await h.sleep(500);
        const f2 = await curFocus();
        if (/phonenumberentry|RegisterPhone/i.test(f2)) { reachedPhone = true; leftEula = true; break; }
        if (!/\.EULA\b|registration\.app\.EULA/i.test(f2)) leftEula = true; // moved to some next screen (companion/perm) → let the loop handle it
      }
      if (reachedPhone) break;
      continue;
    }

    // Activity not recognized — could be a bare AlertDialog overlay (custom-ROM /
    // internet) that keeps the launcher/previous activity focused, or a slow-painting
    // screen. Do ONE dump-based check for the alert + the phone field, act, settle.
    if (await onRomAlert()) {
      if (!(await h.tapSynIf('OK'))) await h.tapSynIf('OK', 'text');
      await h.tapSyn(OK_XY[0], OK_XY[1]).catch(() => undefined);
      romTaps++; await h.sleep(1000); continue;
    }
    if (await onPhoneScreen()) { reachedPhone = true; break; }

    // Unknown/rendering screen. On a GPU-less device `dumpsys window` focus reads are
    // slow/flaky and the companion (QR) page's activity often isn't recognised, so the
    // register-menu attempt must NOT be gated on eulaTaps — a device can open straight
    // onto companion (no EULA). After a couple idle rounds with nothing recognised, try
    // ⋮ → "Register new account" (harmless if we're actually on a plain screen), and
    // RETRY it every few rounds up to 3 times — the popup tap is intermittent on a
    // GPU-less phone (VERIFIED: temiz2 got through first try, temiz3 needed retries).
    // Also re-check the phone screen right after, so a successful menu tap exits fast.
    idleRounds++;
    if (idleRounds >= 2 && menuTaps < 5) {
      await openRegisterMenu(); menuTaps++;
      for (let w = 0; w < 5; w++) {
        await h.sleep(800);
        if (/phonenumberentry|RegisterPhone/i.test(await curFocus()) || await onPhoneScreen()) { reachedPhone = true; break; }
      }
      if (reachedPhone) break;
    } else {
      await h.sleep(1200);
    }
  }
  await snap('first_run');
  if (reachedPhone) {
    await waProgress('register', curPct, '✓ Numara ekranına ulaşıldı');
  } else {
    return done('register_failed', {
      status: 'REGISTER_FAILED',
      note: 'Numara ekranına ulaşılamadı (ilk ekranlar geçilemedi — uyarı / EULA / QR takıldı). WhatsApp beklenmedik bir ekranda olabilir; temiz oturumla tekrar deneyin.',
      phoneNumber
    });
  }

  // Reusable "System UI isn't responding" ANR dismisser — a rebooted device ANRs
  // repeatedly and the dialog can pop OVER the number/verify screens at any moment,
  // hiding the fields. Call this before steps that need the WhatsApp UI in front.
  // Presses "Wait" (keep app alive) via id + text + measured coordinate (raw taps).
  const clearAnr = async (tries = 3) => {
    for (let i = 0; i < tries; i++) {
      const f = await curFocus();
      if (!(/Application Not Responding|isn.t responding|aerr_/i.test(f) || await h.seen("isn't responding", 250))) return;
      await h.tapById('android:id/aerr_wait').catch(() => undefined);
      if (!(await h.tapSynIf('Wait'))) await h.tapSyn(322, 1306).catch(() => undefined);
      await h.sleep(1500);
    }
  };
  await clearAnr();

  // The whole number-entry block (permission sweeps → field wait → type CC/number →
  // submit) is skipped for a continuation job that's already on the verify screen —
  // there's no number screen to fill. skipToVerify jumps us straight to the verify
  // state machine below, where the OTP/method is applied. (VERIFIED LIVE, watest34:
  // without this the continuation re-ran number entry against a verify screen and
  // never typed the code.)
  if (!skipToVerify) {
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
    if (!granted) {
      // Coordinate fallback (VERIFIED: notifications "Allow" at 540,1247 on
      // 1080x2400) for when uiautomator can't see the button. Only if a perm
      // dialog is actually up — a stray tap here is otherwise harmless.
      if (await h.seen('notifications', 800) || await h.seen('Allow', 400)) {
        await h.tapScaled(540, 1247).catch(() => undefined);
        await h.sleep(1200);
      }
      break;
    }
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
  curStep = 'number'; curPct = stepPct.number;
  await waProgress('number', curPct, `Numara giriliyor (${phoneNumber})…`);
  markPhase('number');
  const { cc, local } = splitE164(phoneNumber);
  const localDigits = local.replace(/\D/g, '');
  // ★VERIFIED LIVE (mi5, WA 2.25.x): registration_cc / registration_phone are
  // EditTexts that REJECT focus from synthetic taps AND vtouch — `input text`
  // silently no-ops. The com.fleet.a11y AccessibilityService's ACTION_SET_TEXT
  // fills them even without focus. Typing the calling code into registration_cc
  // auto-selects the country ("355" → Albania), so we skip the country picker.
  const ccOf = async () => {
    const n = await h.find('com.whatsapp:id/registration_cc', 'id');
    return (n && n.text ? n.text : '').replace(/\D/g, '');
  };
  const phoneOf = async () => {
    const n = await h.find('com.whatsapp:id/registration_phone', 'id');
    return (n && n.text ? n.text : '').replace(/\D/g, '');
  };
  // PRIMARY PATH — a11y SET_TEXT (the proven one). Set CC first (auto-picks the
  // country), then the local number. Retry a few times, verifying via a dump.
  let numberEntered = false;
  for (let attempt = 0; attempt < 4 && !numberEntered; attempt++) {
    await h.a11ySetText('registration_cc', cc);
    await h.sleep(800);
    await h.a11ySetText('registration_phone', localDigits);
    await h.sleep(1000);
    const gotPhone = await phoneOf();
    if (gotPhone && gotPhone.length >= Math.min(6, localDigits.length)) { numberEntered = true; break; }
  }
  // FALLBACK — legacy synthetic-tap + stock-IME input text (kept for builds/devices
  // where the a11y service isn't running). Only runs if a11y didn't land the digits.
  if (!numberEntered) {
    await adb(serial, ['shell', 'ime', 'set', 'com.android.inputmethod.latin/.LatinIME']).catch(() => undefined);
    await h.sleep(600);
    for (let attempt = 0; attempt < 2 && (await ccOf()) !== cc; attempt++) {
      const n = await h.find('com.whatsapp:id/registration_cc', 'id');
      if (n) await h.tapSyn(n.cx, n.cy);
      await h.sleep(600);
      await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']).catch(() => undefined);
      for (let i = 0; i < 6; i++) await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_DEL']).catch(() => undefined);
      await adb(serial, ['shell', 'input', 'text', cc]).catch(() => undefined);
      await h.sleep(1200);
    }
    for (let attempt = 0; attempt < 3 && !numberEntered; attempt++) {
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
  }
  if (!numberEntered) {
    const ccNow = await ccOf();
    return done('number_failed', { status: 'NUMBER_ENTRY_FAILED', note: `Numara alani dolmadi (cc=${ccNow || '?'}, phone bos)`, phoneNumber });
  }
  await snap('number_filled');
  await h.sleep(400);

  curStep = 'submit'; curPct = stepPct.submit;
  await waProgress('submit', curPct, 'Numara onaylanıyor (Next → Yes)…');
  // 5f) Submit (registration_submit=NEXT) + VERIFY we left the number screen. Use
  //     a11y CLICK first (proven), tap-by-id as fallback. Re-tap until a confirm
  //     dialog / OTP screen / number-error actually appears (a single tap no-ops).
  let submitted = false;
  for (let i = 0; i < 3 && !submitted; i++) {
    await h.a11yClickId('registration_submit');
    await h.tapById('com.whatsapp:id/registration_submit').catch(async () => { await h.tapBy('NEXT').catch(() => undefined); });
    for (let w = 0; w < 8; w++) {
      await h.sleep(1000);
      const gone = (await h.find('com.whatsapp:id/registration_phone', 'id')) == null;
      // DowngradeFriction (Business-account) also counts as "left the number screen" —
      // otherwise the submit loop keeps re-tapping Next on the friction screen. The
      // verify state machine's top branch then handles the two-step deactivate.
      if (gone || /DowngradeFriction/i.test(await curFocus()) || await h.seen('deactivate your Business account', 400) ||
          await h.seen('correct number', 400) || await h.seen('OK', 400) || await h.seen('digit code', 400) || await h.seen('Verifying', 400)) { submitted = true; break; }
    }
  }
  await snap('submit');
  // NOTE: the "Is this the correct number? — Yes" confirm dialog and the "Allow
  // WhatsApp to view SMS" prompt are NO LONGER handled by dedicated sequential
  // blocks here — they're two of the states the verify state machine below
  // recognizes (onConfirmNumber / onViewSmsPrompt). Whatever screen submit lands
  // on (confirm dialog, flash-call, method sheet, direct OTP, or the SMS-fail
  // dialog), the loop identifies it and acts. This is what makes the flow order-
  // independent per the operator's requirement ("her aşamada anlamalı").
  } // end !skipToVerify (number-entry block)

  curStep = 'verify'; curPct = stepPct.verify;
  await waProgress('verify', curPct, 'Doğrulama yöntemi belirleniyor…');
  markPhase('verify'); wlog('verify: state machine entered');
  // ── VERIFY STATE MACHINE ──────────────────────────────────────────────────
  // After submitting the number WhatsApp can land on ANY of several screens in a
  // NON-deterministic order (it depends on the build, the number, prior attempts,
  // and A/B flags). A fixed "flash-call → SMS → OTP" sequence breaks the moment
  // WhatsApp skips a screen or inserts a new one. So instead we LOOP: each round we
  // read the current screen, RECOGNIZE which state we're in, take the one right
  // action for it, and re-observe. This absorbs every ordering:
  //   • WhatsApp sent the SMS immediately            → onOtp()      → done (OTP_WAIT)
  //   • Flash-call education screen                  → tap "Verify another way"
  //   • "Choose how to verify" sheet                 → pick SMS if free, else Voice
  //   • "Couldn't send an SMS" dialog                → "Try another way" → voice
  //   • "Is this the correct number?" confirm        → tap Yes (re-shown late)
  //   • "Allow WhatsApp to view SMS" prompt          → Not now
  //   • ban / integrity wall                         → bail with a clear reason
  // The loop ends when we reach the OTP screen (success) or exhaust the rounds /
  // hit a terminal wall (reported honestly).
  //
  // State detectors. Primary signal is the focused ACTIVITY (via curFocus, defined
  // above) because mi7's a11y dump is intermittently empty; seen()/find() are the
  // fallback for overlays/dialogs that don't change the activity. VERIFIED activity
  // names: VerifyPhoneNumber (OTP), PrimaryFlashCallEducationScreen (flash-call).
  // ★H1 — HOISTED-READ detectors. Each takes optional (foc, txt) = the ONE curFocus()
  // and screenText() the verify loop reads once per round. When given, the detector is a
  // SYNCHRONOUS regex over that single read (no dumps). When omitted (call sites outside
  // the loop, e.g. inside pickVerifyMethod / onSmsSendFailed's recheck), it self-reads as
  // before — fully back-compatible. This collapses the old per-round cost: previously
  // each detector's absent-screen seen() burned its FULL timeout with fresh dumps
  // (because seen()'s inner sleep(400) clears the 700ms dump cache), so a round did
  // ~8-15s of dumping; now it's one curFocus (~0.3s) + one screenText (~1-2s). The retry
  // that seen() gave is preserved by the loop itself re-observing each round.
  // OTP ekranı "kesinleşti" demeden önce beklenen gözlem turu (bkz. break bloğundaki
  // GECİKMELİ DİYALOG açıklaması). Toplam ~6 sn — WhatsApp'ın hata diyaloğunu OTP
  // ekranının üstüne açması canlıda 2-4 sn sürdü. Env ile ayarlanabilir.
  const OTP_SETTLE_ROUNDS = Math.max(0, Number(process.env.FLEET_WA_OTP_SETTLE_ROUNDS || 4));
  const OTP_SETTLE_STEP_MS = Math.max(300, Number(process.env.FLEET_WA_OTP_SETTLE_STEP_MS || 1500));
  const onOtp = async (foc, txt) => {
    const f = foc ?? await curFocus();
    if (/verifyphone|VerifyPhoneNumber/i.test(f)) return true;
    const t = txt ?? await h.screenTextRich().catch(() => '');
    if (/Verifying your number|digit code|Enter the 6-digit code/i.test(t)) return true;
    // id-based fallback only when text didn't match (avoids extra dumps on the hot path)
    return (await h.find('com.whatsapp:id/verify_sms_code_input', 'id')) != null ||
      (await h.find('com.whatsapp:id/registration_verify', 'id')) != null;
  };
  // "Choose how to verify" bottom-sheet. VERIFIED LIVE (watest46, +90): this sheet
  // OPENS ON TOP of the flash-call education activity, so curFocus stays
  // PrimaryFlashCallEducationScreen — recognize it by its TEXT, not the activity.
  const onChooseVerify = async (foc, txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    if (/Choose how to verify/i.test(t)) return true;
    const rows = ['Receive SMS', 'Voice call', 'Missed call', 'Other device'].filter((r) => new RegExp(r, 'i').test(t));
    return rows.length >= 2; // a real method sheet shows several options
  };
  const onFlashCallEdu = async (foc, txt) => {
    // If the method sheet is already up, this is NOT the plain education screen — let
    // the choose-verify branch handle it (VERIFIED LIVE watest46: onFlashCallEdu was
    // firing on the flash-call activity while the sheet was open, so the agent looked
    // for "VERIFY ANOTHER WAY" — absent once the sheet is showing — and spun forever).
    const f = foc ?? await curFocus();
    const t = txt ?? await h.screenTextRich().catch(() => '');
    if (await onChooseVerify(f, t)) return false;
    if (/flashcall|FlashCallEducation/i.test(f)) return true;
    if (/missed call|VERIFY ANOTHER WAY/i.test(t)) return true;
    return (await h.find('com.whatsapp:id/secondary_button', 'id')) != null;
  };
  // ★★2026-07-30 "SMS gönderilemedi" İKİ AYRI ŞEY — KARIŞTIRILIYORDU.
  //
  // EKRAN GÖRÜNTÜSÜYLE KANITLANDI (+90 539 521 85 90, mi34):
  //   "Can't send an SMS with your code because YOU'VE TRIED TO REGISTER
  //    +90 539 521 85 90 RECENTLY. REQUEST A CALL or wait before requesting an SMS."
  // Bu bir RATE-LIMIT: numara SAĞLAM, WhatsApp sadece "az önce denedin" diyor ve
  // ÇÖZÜMÜ DE SUNUYOR ("Request a call" = sesli arama). Eski desen bunu
  // "itibar/operatör engeli — numara SMS alamıyor" diye TERMİNAL BAŞARISIZLIK
  // sayıyordu → sağlam numara boşuna "yanmış" ilan ediliyordu.
  //
  // Ayrım: metinde "tried to register … recently" / "wait before requesting" varsa
  // bu RATE-LIMIT'tir (bekle veya sesli aramayı dene), kalıcı bir engel DEĞİL.
  const onSmsRateLimited = async (foc, txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    return /tried to register .* recently|wait before requesting|request a call/i.test(t);
  };
  const onSmsSendFailed = async (foc, txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    if (!/send an SMS|send you an SMS|couldn't send|check your number/i.test(t)) return false;
    // Rate-limit ise "gönderilemedi" SAYMA — çağıran taraf bunu sesli arama /
    // bekleme dalına yönlendirir (bkz. verify döngüsü).
    if (await onSmsRateLimited(foc, t)) return false;
    return true;
  };
  const onConfirmNumber = async (foc, txt) => /correct number/i.test(txt ?? await h.screenTextRich().catch(() => ''));
  const onViewSmsPrompt = async (foc, txt) => /view SMS|automatically detect/i.test(txt ?? await h.screenTextRich().catch(() => ''));
  const onWall = async (foc, txt) => {
    // Activity signal first: CustomRegistrationBlockActivity is WhatsApp's hard block
    // ("Download the official WhatsApp to continue") — the number/APK/device combo was
    // rejected. VERIFIED LIVE (watest45, +355 AL number). It's terminal.
    const f = foc ?? await curFocus();
    if (/CustomRegistrationBlock|RegistrationBlock|parole\./i.test(f)) {
      return 'Download the official WhatsApp to continue (numara/APK engellendi)';
    }
    const t = txt ?? await h.screenTextRich();
    if (/Download the official WhatsApp|official WhatsApp to continue/i.test(t)) return t;
    // ★2026-07-29 KESİN-BAN ile GEÇİCİ ENGELİ AYIR (operatör isteği: "ekrana göre kesin oku").
    //
    // Eski desen `try again later` ve `couldn't connect` gibi GEÇİCİ ifadeleri de wall
    // sayıyordu → geçici bekletme "WhatsApp cihazı/numarayı REDDETTİ (ban)" diye
    // raporlanıyor, operatör numarayı yanmış sanıp çöpe atıyordu. (Canlı veride 18
    // "reddetti" kaydı var; bir kısmı büyük olasılıkla bu yanlış etiketten.)
    //
    // KESİN ban/kalıcı engel ifadeleri — bunlar gerçekten numara/cihaz reddi:
    if (/\bbanned\b|can.?t use whatsapp|account.*(suspended|violat)|not allowed to (use|register)|too many (attempts|requests|devices)/i.test(t)) {
      return t;
    }
    // GEÇİCİ olanlar (bekle-ve-tekrar-dene) BİLEREK wall SAYILMAZ: bunlar onRateLimit /
    // SMS-send-failed yollarında zaten daha doğru raporlanıyor. Burada null dönmek,
    // durum makinesinin doğru dala girmesini sağlar.
    if (/try again later|couldn.?t connect|check your (connection|network)/i.test(t)) return null;
    return null;
  };
  // ★RATE-LIMIT screen ("You recently connected" / "Please wait N minutes before trying
  // again, or verify another way"). NOT a wall/ban — a temporary cool-down because the
  // number was tried too recently/often. It shows up ON the VerifyPhoneNumber activity,
  // so onOtp mistakes it for a real OTP screen and the agent parks at OTP_WAIT telling
  // the operator "SMS bekleniyor" — while WhatsApp is actually saying "wait 31 minutes".
  // VERIFIED LIVE (mi27, +355683175346). Detect it BEFORE accepting OTP and report the
  // real reason + the wait time so the modal/log shows it instead of a false SMS-wait.
  // ★2026-07-30 Süreyi SANİYE olarak da döndür (`waitSeconds`): panel bunu bir bitiş
  // zamanına çevirip GERİ SAYAN sayaç gösterebilsin. Eskiden yalnızca serbest metin
  // dönüyordu ve modal "bir süre bekle" deyip kalıyordu — operatör ne kadar kaldığını
  // bilemiyordu. Metin de korunuyor (log/telegram aynı okunabilirlikte kalsın).
  const onRateLimit = async (foc, txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    // ★2026-07-30 "tried to register … recently" / "wait before requesting an SMS"
    // deseni de EKLENDİ. Ekran görüntüsüyle kanıtlandı (+90 539 521 85 90): WhatsApp
    // "Can't send an SMS … you've tried to register … recently. Request a call or wait
    // before requesting an SMS." diyor — bu bir BEKLETME, kalıcı engel DEĞİL. Eskiden
    // bu metin onRateLimit'e YAKALANMIYOR, onSmsSendFailed'a düşüp kaydı ÖLDÜRÜYORDU.
    // ★★2026-07-30 "try again in 1 hour" BİÇİMİ DE EKLENDİ. Ekran görüntüsüyle kanıtlandı
    // (+905340420653, mi34): WhatsApp "Couldn't send an SMS to your number. Please check
    // your number. If it's correct, you can try again in 1 hour, or try to verify another
    // way." diyor. Eski desen `wait\s+\d+` arıyordu — burada "wait" KELİMESİ HİÇ YOK,
    // "try again in 1 hour" var → RATE-LIMIT KAÇIRILIYOR, onSmsSendFailed'a düşüyor ve
    // sağlam numara "SMS alamıyor" diye terminal sayılıyordu. Süre çıkarımı da aynı
    // biçimi tanıyacak şekilde genişletildi (aksi halde 1 saat okunamayıp varsayılana
    // düşerdi — bu örnekte tesadüfen aynı, ama "try again in 30 minutes"te yanlış olurdu).
    // TR biçimi ("1 saat sonra tekrar deneyin" / "31 dakika bekleyin") de tanınır —
    // Türkçe'de sayı BİRİMDEN ÖNCE gelir ve "sonra/bekleyin" arkadan gelir, bu yüzden
    // ayrı bir desen şart (İngilizce desen bunu yakalamaz).
    if (!/recently connected|wait\s+\d+\s+(minute|hour|dakika|saat)|try again in\s+\d+\s+(minute|hour|dakika|saat)|\d+\s+(dakika|saat)\s+(sonra|bekle)|before trying again|tried to register .* recently|wait before requesting/i.test(t)) return null;
    const m = t.match(/(?:wait|try again in)\s+(\d+)\s+(minute|hour|dakika|saat)/i)
      || t.match(/(\d+)\s+(dakika|saat)\s+(?:sonra|bekle)/i);
    const n = m ? parseInt(m[1], 10) : 0;
    const isHour = m ? /hour|saat/i.test(m[2]) : false;
    const waitStr = m ? `${n} ${isHour ? 'saat' : 'dakika'}` : 'bir süre';
    // Süre okunamadıysa 60 dk varsay: WhatsApp'ın standart soğuma süresi bu ve
    // 0 dönmek panelde "süre doldu, hemen dene" yalanına yol açardı.
    const waitSeconds = m ? n * (isHour ? 3600 : 60) : 3600;
    // ★WhatsApp ekranda "Request a call" sunuyorsa bunu SÖYLE: operatör beklemek
    // zorunda değil, sesli aramayla HEMEN devam edebilir. (Ekran görüntüsüyle
    // kanıtlandı — eskiden bu seçenek hiç bildirilmiyordu.)
    // ★2026-07-30 "Try another way" / "verify another way" DA sayılır: ekran görüntüsünde
    // (+905340420653) düğme birebir "Try another way" ve gövde "or try to verify another
    // way" diyor — "Request a call" hiç yazmıyor. Ama bu düğme yine YÖNTEM SAYFASINA
    // (SMS/sesli arama/cevapsız arama) götürüyor, yani beklemeden alternatif yol VAR.
    const callOffered = /request a call|sesli arama|try another way|try other ways|verify another way|başka bir yol dene/i.test(t);
    return {
      note: callOffered
        ? `⏳ WhatsApp SMS'i şimdi göndermiyor (numara çok yakın zamanda denendi — geçici kısıt, ban DEĞİL). Ekran ${waitStr} bekleme diyor AMA alternatif doğrulama yolu sunuyor: beklemeden SESLİ ARAMA ile devam edilebilir.`
        : `⏳ WhatsApp bekletme: ${waitStr} bekle diyor (numara çok yakın zamanda denendi — geçici kısıt, ban değil)`,
      waitSeconds,
      waitLabel: waitStr,
      callOffered
    };
  };
  // "Switch to WhatsApp Messenger?" — the number already has a WhatsApp **Business**
  // account. Confirm "Switch now" so registration can proceed. VERIFIED LIVE (mi5, +355).
  const onSwitchDialog = async (foc, txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    return /Switch to WhatsApp Messenger/i.test(t) || (/Switch now/i.test(t) && /Use different number/i.test(t));
  };
  // "Are you sure you want to deactivate your Business account?" (DowngradeFriction
  // activity). VERIFIED LIVE (watest45, +359 BG; mi68, +90). Proceed with "USE +<number>".
  const onDowngradeFriction = async (foc, txt) => {
    const f = foc ?? await curFocus();
    if (/DowngradeFriction|downgrade\./i.test(f)) return true;
    const t = txt ?? await h.screenTextRich().catch(() => '');
    return /deactivate your Business account/i.test(t) || (/USE A DIFFERENT NUMBER/i.test(t) && /USE \+/i.test(t));
  };
  // "Verify <number> / Use your other phone to confirm moving WhatsApp to this one /
  // Enter the 6-digit code we sent to WhatsApp on your OTHER PHONE." The code is NOT
  // an SMS/voice OTP — it's pushed to the number's EXISTING WhatsApp on another
  // device, which the agent can't read. This needs a human with that phone, so we
  // stop at AWAITING_MANUAL. VERIFIED LIVE (mi5, +355 already-registered number).
  const onOtherPhoneVerify = async (foc, txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    // ★FIX (LIVE mi14 +90 538…): the screen text "Enter the 6-digit code we sent to
    // WhatsApp on your other phone" was MISSED because screenTextRich joins UI nodes with
    // " | ", and this sentence spans multiple nodes — so the exact phrase "code we sent to
    // WhatsApp on your other phone" was broken by a separator and never matched. It was
    // reported as a plain SMS OTP_WAIT ("SMS kodu bekleniyor") instead of other_phone.
    // Match on the robust signal "other phone" combined with a code/verify cue, which
    // survives the node split. (VerifyPhoneNumber activity + "other phone" + "code" is
    // unambiguous — a normal SMS OTP screen never says "other phone".)
    if (/other phone to confirm moving WhatsApp|code we sent to WhatsApp on your other phone/i.test(t)) return true;
    return /other phone/i.test(t) && /(6-digit|digit code|Verification code|Enter the).{0,80}/i.test(t);
  };
  // "You tried requesting code to other phone too many times. To verify, tap
  // 'Send SMS' [in N hours]." Terminal rate-limit specific to the move/other-phone
  // flow. VERIFIED LIVE (mi5: "in 6h 38m"; watest45 +359: NO time given, just
  // "tap 'Send SMS'"). The old regex REQUIRED an "N hours" span and returned null when
  // WhatsApp gave no time → the agent MISSED the screen and spun. Now: match the
  // phrase regardless of whether a wait time is present, returning the time if shown.
  const onOtherPhoneRateLimit = async (foc, txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    if (!/requesting code to other phone too many times/i.test(t)) return null;
    const m = /(\d+)\s*hours?,?\s*(\d+)?\s*minutes?/i.exec(t);
    return m ? `${m[1]} saat ${m[2] || 0} dakika` : 'SMS ile doğrulama gerekiyor';
  };

  // "Choose how to verify" sheet: pick the FIRST ENABLED method, preferring SMS,
  // then Voice call. A rate-limited row shows "Try again in <n> hours" (greyed) and
  // can't be selected — VERIFIED LIVE on mi7 (+90): after one attempt "Receive SMS"
  // became "Try again in 24 hours" while "Voice call" stayed enabled. Returns the
  // chosen kind ('sms'|'voice') or null if BOTH are locked.
  // Bir seçeneğin KENDİ açıklama satırını döndürür (etiketten sonraki ilk anlamlı satır).
  // ★2026-07-30: eskiden 60 KARAKTER okunuyordu ve bu SONRAKİ SEÇENEĞE TAŞIYORDU —
  // "Receive SMS / Try again in 24 hours"un kilidi bir alttaki "Voice call"a bulaşıp
  // AÇIK olan sesli aramayı da kilitli gösteriyordu (canlı: +905340420653 ekranında
  // missed_call + voice açıkken kayıt "24 saat bekle" diye durdurulmuştu).
  const optionRow = (sheet, re) => {
    const rest = sheet.split(re)[1] || '';
    const rows = rest.split('\n').map((s) => s.trim()).filter(Boolean);
    return rows[0] || '';
  };
  const pickVerifyMethod = async () => {
    const sheet = await h.screenText();
    const afterSms = optionRow(sheet, /Receive SMS/i);
    const afterVoice = optionRow(sheet, /Voice call/i);
    const smsLocked = /Try again/i.test(afterSms);
    const voicePresent = /Voice call/i.test(sheet);
    const voiceLocked = /Try again/i.test(afterVoice);
    let method = null;
    if (!smsLocked && /Receive SMS/i.test(sheet)) method = { label: 'Receive SMS', kind: 'sms', refY: 1732 };
    else if (voicePresent && !voiceLocked) method = { label: 'Voice call', kind: 'voice', refY: 1932 };
    if (!method) return null;
    if (method.kind === 'voice') await waProgress('verify', curPct, 'SMS kısıtlı — sesli arama ile doğrulanıyor…');
    else await waProgress('verify', curPct, 'SMS ile doğrulama seçiliyor…');
    // SELECT the row's radio, not just its label. VERIFIED LIVE (mi7 +90): the sheet
    // defaults to "Missed call" selected; a11y/label taps FAIL when the uiautomator
    // dump is momentarily unavailable (find() → null → no tap → Continue proceeds
    // with the WRONG method → flash-call loop). The FIX: tap the row's KNOWN screen
    // coordinate directly (dump-independent). Measured LIVE on mi7 1080x2400: tapping
    // the Voice-call row at (258,1932) moved the radio to Voice (CONFIRMED by
    // screenshot), and Continue at (648,2128) advanced to the voice OTP screen. Row
    // ref-Y: Missed call ≈1552, Receive SMS ≈1732, Voice call ≈1932 (label x≈258).
    // Read the row's radio checked-state (null when the dump is unavailable).
    const rowChecked = async () => {
      const nodes = await h.dump().catch(() => []);
      if (!nodes.length) return null;
      const label = nodes.find((n) => new RegExp(method.label, 'i').test(n.text || ''));
      if (!label) return null;
      const radio = nodes.find((n) => /reg_method_checkbox|RadioButton|CheckBox/i.test((n.resId || '') + ' ' + (n.cls || '')) && Math.abs((n.cy || 0) - (label.cy || 0)) < 90);
      return radio ? !!radio.checked : null;
    };
    // SELECT the row. ★VERIFIED LIVE on mi7 (+90): a plain `input tap 258 1932`
    // (h.tapSyn) on the Voice-call row MOVED the radio to Voice — confirmed by
    // screenshot — whereas a11yClickText + node-tap + tapScaled + a dump-derived Y
    // did NOT (the radio stayed on "Missed call"). The dump's "Voice call" label node
    // sits at the TOP of the two-line row, and tapping there doesn't reliably select
    // it; the MEASURED CONSTANT method.refY (row vertical center, 1932 for Voice) is
    // what actually moved the radio. So tap the fixed refY via raw input tap — NO
    // dump-derived Y — and re-tap a few times; then Continue.
    for (let attempt = 0; attempt < 3; attempt++) {
      await h.tapSyn(258, method.refY);   // ← raw input tap at the measured row center (PROVEN)
      await h.sleep(700);
      const chk = await rowChecked();     // best-effort verify (null when dump empty)
      if (chk === true) break;
    }
    await h.sleep(400);
    // Continue. VERIFIED live: raw `input tap 540 2128` on the Continue button
    // advanced the flow (like the row tap, the raw input tap is the reliable path on
    // this build). Try id/text first (no-op if dump empty), then the raw coordinate.
    await h.a11yClickId('continue_button');
    (await h.tapById('com.whatsapp:id/continue_button').then(() => true).catch(() => false)) || true;
    await h.tapSyn(540, 2128);            // Continue center (VERIFIED live)
    await h.sleep(800); // ★H4: 800ms (was 1500) — control returns to the verify loop which immediately re-checks onOtp() then enters the 24×750ms OTP poll, so this settle just hands off sooner; the tap needs a beat to register but the downstream poll guards correctness
    return method.kind;
  };

  // Read the "Choose how to verify" sheet and return the AVAILABLE methods with their
  // lock state, so the panel can show the operator which options are pickable. Rows:
  // Missed call / Receive SMS / Voice call; a locked row shows "Try again in <n>".
  const listVerifyOptions = async () => {
    const sheet = await h.screenText();
    // ★2026-07-30 KİLİT TESPİTİ SATIRLA SINIRLANDI. Eskiden satırdan sonraki 60 KARAKTER
    // okunuyordu — bu SONRAKİ SEÇENEĞE TAŞIYOR: "Other device / Confirm on your other
    // phone" (28 krk) + araya giren satır sonu → 60 karakterlik pencere bir alttaki
    // "Receive SMS / Try again in 24 hours"a uzanıyor ve AÇIK olan seçenek KİLİTLİ
    // sayılıyordu. Sonuç: panelde kullanılabilir yöntem gizleniyor, applyVerifyMethod
    // `null` dönüyor (o satır "kilitli" sanıldığı için). Artık yalnızca SEÇENEĞİN KENDİ
    // AÇIKLAMA SATIRI okunuyor: etiketten sonraki İLK anlamlı satır.
    const seg = (re) => optionRow(sheet, re);
    const mk = (label, kind, re) => {
      if (!re.test(sheet)) return null;
      const after = seg(re);
      const lockM = /Try again in ([^\n.]+)/i.exec(after);
      return { label, kind, locked: /Try again/i.test(after), wait: lockM ? lockM[1].trim() : null };
    };
    return [
      // "Other device" = the number is active on another phone; the code is pushed to
      // that phone's WhatsApp (other-phone flow). VERIFIED LIVE (watest46, +90 on a
      // Samsung S21). Listed so the operator can pick it from the panel.
      mk('Diğer cihaz', 'other_device', /Other device/i),
      mk('Missed call', 'missed_call', /Missed call/i),
      mk('Receive SMS', 'sms', /Receive SMS/i),
      mk('Voice call', 'voice', /Voice call/i)
    ].filter(Boolean);
  };
  // Apply a SPECIFIC operator-chosen method on the sheet (mirrors pickVerifyMethod's
  // proven raw-tap selection, but for the requested kind). Row ref-Y measured LIVE on
  // 1080x2400: Missed call ≈1552, Receive SMS ≈1732, Voice call ≈1932 (label x≈258).
  // Returns the applied kind, or null if that row is missing/locked.
  const applyVerifyMethod = async (kind) => {
    const opts = await listVerifyOptions();
    const want = opts.find((o) => o.kind === kind);
    if (!want || want.locked) return null;
    await waProgress('verify', curPct, `Doğrulama yöntemi: ${want.label} (operatör seçimi)…`);
    // The rows' vertical positions VARY by which options the sheet shows (e.g. an
    // "Other device" row shifts everything down). So find the chosen row's MEASURED
    // center from the dump instead of a fixed ref-Y (which only held for one layout).
    const label = { other_device: 'Other device', missed_call: 'Missed call', sms: 'Receive SMS', voice: 'Voice call' }[kind];
    for (let attempt = 0; attempt < 3; attempt++) {
      const node = findNode(await h.dump().catch(() => []), label, 'text');
      if (node) await h.tapSyn(node.cx, node.cy);
      else await h.tapSyn(258, kind === 'other_device' ? 1190 : kind === 'missed_call' ? 1552 : kind === 'sms' ? 1732 : 1932);
      await h.sleep(700);
    }
    await h.sleep(400);
    await h.a11yClickId('continue_button');
    (await h.tapById('com.whatsapp:id/continue_button').then(() => true).catch(() => false)) || true;
    await h.tapSyn(540, 2128); // Continue center (VERIFIED live)
    await h.sleep(800); // ★H4: 800ms (was 1500) — downstream verify loop + 24×750ms OTP poll guard correctness, so a shorter settle just hands off sooner
    return kind;
  };

  let voiceTried = false, bothLockedNote = null, wallText = null, rateLimitText = null, rateLimitInfo = null;
  // ★2026-08-04 DOWNGRADE SPIN SAYACI. CANLI OLAY (+905360459761, wa-t31k): agent
  // DowngradeFriction ekraninda 27sn'de bir AYNI adimi 5 kez tekrarladi, hic ilerlemedi.
  // Kok neden: onDowngradeFriction SADECE aktivite adina bakiyor
  // (`/DowngradeFriction|downgrade\./`), dolayisiyla "USE +" tiklamasi ISE YARAMASA da
  // ekran hala ayni aktivite oldugu icin dongu her turda "yine downgrade" deyip
  // BASTAN basliyordu — ilerleme kaydi YOKTU. 14 turun hepsi ayni ekranda yaniyordu.
  // Bu sayac kacinci kez ayni ekranda oldugumuzu tutar; branch tur sayisina gore
  // GIDEREK daha guclu yontem dener ve sonunda temiz bir tani ile birakir.
  let downgradeRounds = 0;
  // Up to ~14 observe→act rounds; the common path reaches OTP in 2-3.
  for (let round = 0; round < 14; round++) {
    // A rebooted device can pop a "System UI isn't responding" ANR over the verify
    // screens too — clear it first so it can't hide the method sheet / OTP field.
    await clearAnr(1);
    // ★H1: read the screen ONCE per round (one curFocus + one screenText) and feed ALL
    // text-based detectors from it. Previously each detector's absent-screen seen() burned
    // its full timeout on fresh dumps (seen's inner sleep clears the dump cache), so a
    // round cost ~8-15s of dumping; now it's ~0.3s + ~1-2s. If the dump momentarily
    // returns empty, re-read once so a single empty read doesn't blind the whole round.
    const foc = await curFocus();
    let txt = await h.screenTextRich().catch(() => '');
    if (!txt) { await h.sleep(300); txt = await h.screenTextRich().catch(() => ''); }
    // Success: OTP screen reached (WhatsApp sent SMS/voice code). Leave the loop.
    // ★OTHER-PHONE FIX: the "Use your other phone to confirm moving WhatsApp" screen runs
    // on the SAME VerifyPhoneNumber activity as a normal SMS OTP, so onOtp() matches it and
    // used to break here — reaching the generic OTP_WAIT that tells the operator to "wait
    // for an SMS" that never comes (the code is on the number's OTHER phone). Detect it
    // FIRST and DON'T break: let the loop fall through to the onOtherPhoneVerify branch
    // below, which returns OTP_WAIT with otpChannel:'other_phone' so the panel shows the
    // correct "read the code off your other phone" hint. VERIFIED LIVE (mi3, +90 534…).
    // ★OTHER-PHONE + CONTINUATION FIX: normally we DON'T break on the other-phone verify
    // screen (it shares VerifyPhoneNumber with a plain OTP) so the loop can report the
    // correct other_phone hint. BUT when otpCode is present this is a CONTINUATION — the
    // operator ALREADY read the code (off the other phone or SMS) and we MUST type it, not
    // re-park at OTP_WAIT. So: if otpCode exists, break as soon as onOtp is true (type it);
    // only defer to the other-phone branch when we have NO code yet (the initial park).
    // (Without this, a continuation on an other-phone number looped: onOtherPhoneVerify
    // stayed true → the break was skipped → the other-phone branch re-returned OTP_WAIT
    // without ever entering the code — LIVE mi8 +90 539…, operator entered code twice, no
    // progress.)
    // ★WALL-BEFORE-OTP GUARD (VERIFIED LIVE, mi20 +355 Business number): WhatsApp can
    // flip an apparent OTP screen into CustomRegistrationBlockActivity ("Download the
    // official WhatsApp to continue") — especially on a Business-downgrade / risky
    // number. If we break into OTP_WAIT first, the agent parks and stops watching the
    // screen, so the block is NEVER reported (operator waits forever for an SMS that
    // won't arrive). So: check the hard wall BEFORE accepting an OTP screen. If the
    // block activity/text is up, report DEVICE_WALL instead of parking at OTP_WAIT.
    wallText = await onWall(foc, txt);
    if (wallText) { wlog(`verify: WALL (pre-OTP) — ${wallText.slice(0, 80)}`); break; }

    // ★RATE-LIMIT before OTP: "You recently connected — wait N minutes". Must be checked
    // BEFORE onOtp (it renders on the same VerifyPhoneNumber screen and would otherwise be
    // parked as a false OTP_WAIT). Report it as the reason so the modal shows the real
    // "wait N minutes" state, not "SMS bekleniyor".
    rateLimitInfo = await onRateLimit(foc, txt);
    if (rateLimitInfo) {
      // ★★★2026-07-30 "Choose how to verify" SAYFASINDAKİ rate-limit metni TÜM DOĞRULAMAYI
      // KİLİTLEMEZ — SADECE O SATIRIN seçeneğini kilitler.
      //
      // CANLI OLARAK YAŞANDI (+905340420653, mi34, 04:49 — operatörün ekran görüntüsü):
      //   Choose how to verify
      //     ◉ Missed call    Auto-verify on +90 534 042 06 53      ← KULLANILABİLİR
      //     ○ Receive SMS    Try again in 24 hours                 ← kilitli (soluk)
      //     ○ Voice call     Get code at +90 534 042 06 53         ← KULLANILABİLİR
      //     [ Continue ]
      // "Try again in 24 hours" onRateLimit'e yakalanıyor ve akış BURADA break ediyordu →
      // kayıt "24 saat bekle" diye durduruluyordu. OYSA cevapsız arama ve sesli arama
      // O ANDA kullanılabilirdi: 24 saat SADECE SMS için.
      //
      // Doğrusu: sayfa açıksa break ETME — aşağıdaki onChooseVerify dalına düşsün.
      // `listVerifyOptions`/`pickVerifyMethod` kilitli satırları ZATEN ayırt ediyor
      // (smsLocked/voiceLocked), yani doğru seçenek oradan seçilir. Rate-limit'i ancak
      // sayfada KULLANILABİLİR HİÇBİR seçenek yoksa terminal sayıyoruz.
      const sheetUp = await onChooseVerify(foc, txt);
      if (sheetUp) {
        const openOpts = await listVerifyOptions().catch(() => []);
        const usable = (openOpts || []).filter((o) => !o.locked);
        if (usable.length) {
          wlog(`verify: rate-limit metni var AMA ChooseVerify sayfasinda ${usable.length} KULLANILABILIR secenek (${usable.map((o) => o.kind).join(',')}) — akis SURUYOR`);
          rateLimitInfo = null;   // terminal sayma; onChooseVerify dali devralacak
        } else {
          wlog('verify: ChooseVerify sayfasinda kullanilabilir secenek YOK — rate-limit terminal');
        }
      }
    }
    if (rateLimitInfo) {
      rateLimitText = rateLimitInfo.note;
      wlog(`verify: RATE-LIMIT (pre-OTP) — ${rateLimitText.slice(0, 80)} [${rateLimitInfo.waitSeconds}s]`);
      break;
    }

    if (await onOtp(foc, txt) && (otpCode || !(await onOtherPhoneVerify(foc, txt)))) {
      // ★★2026-07-30 OTP EKRANINA DÖNÜLDÜYSE ESKİ "SMS gönderilemedi" NOTUNU TEMİZLE.
      //
      // CANLI OLARAK YAŞANDI (+905395218590, mi34): "Couldn't send an SMS" diyaloğu
      // çıktı → bothLockedNote set edildi → OK ile kapatıldı → WhatsApp OTP ekranına
      // GERİ DÖNDÜ ("Verifying your number / Verification code / DIDN'T RECEIVE CODE?"
      // — operatörün ekranda gördüğü tam bu) → döngü OTP'ye ulaştı ve break etti.
      // AMA aşağıdaki terminal kontrol (`if (bothLockedNote && !(await onOtp()))`)
      // notu hâlâ dolu bulduğu için kayıt SMS_SEND_FAILED diye ÖLDÜRÜLÜYORDU.
      // Oysa WhatsApp kod bekliyordu: operatör SMS'i başka yolla alabilir ya da
      // "DIDN'T RECEIVE CODE?" ile sesli aramayı deneyebilirdi.
      // Sonuç: sağlam bir numara boşuna "yanmış" sayılıyordu (kayıt %19 başarı
      // oranının bir kısmı büyük olasılıkla bu).
      if (bothLockedNote) {
        wlog('verify: OTP ekranina donuldu — eski "SMS gonderilemedi" notu TEMIZLENDI');
        bothLockedNote = null;
      }
      // ★★★2026-07-30 GECİKMELİ DİYALOG TEYİT TURU — OTP'ye "ulaştık" demeden önce bekle.
      //
      // CANLI OLARAK YAŞANDI (+905340420653, mi34, 04:36): ChooseVerify'da SMS seçildi →
      // WhatsApp ÖNCE OTP ekranını çizdi ("Verifying your number" + 6 haneli kutu) →
      // onOtp true döndü → break → job OTP_WAIT yazdı ve panel OTP kutusunu açtı.
      // AMA WhatsApp hata diyaloğunu SANİYELER SONRA o ekranın ÜSTÜNE açtı:
      //   "Couldn't send an SMS to your number … try again in 1 hour, or try to
      //    verify another way."  [OK] [Try another way]
      // Döngüden çıkılmış olduğu için onSmsSendFailed/onRateLimit HİÇ ÇALIŞMADI →
      // operatör asla gelmeyecek bir kod için bekletildi (yanlış "OTP bekleniyor").
      //
      // ÖNEMLİ: diyalog açıkken "Verifying your number" metni ARKADA HÂLÂ DURUYOR,
      // yani onOtp'yi metinle sıkılaştırmak yetmez — ZAMAN gerekiyor. Bu yüzden
      // break'ten önce kısa bir gözlem turu atıp diyalog belirirse döngüye DÖNÜYORUZ
      // (continue) — orada mevcut sesli-arama / rate-limit dalları devralır.
      let lateDialog = null;   // null | 'rate' | 'sms'
      for (let dw = 0; dw < OTP_SETTLE_ROUNDS; dw++) {
        await h.sleep(OTP_SETTLE_STEP_MS);
        const dTxt = await h.screenTextRich().catch(() => '');
        if (!dTxt) continue;
        const dRate = await onRateLimit(undefined, dTxt);
        if (dRate) {
          rateLimitInfo = dRate;
          rateLimitText = dRate.note;
          wlog(`verify: OTP sonrasi GECIKMELI RATE-LIMIT diyalogu — ${dRate.note.slice(0, 70)} [${dRate.waitSeconds}s]`);
          lateDialog = 'rate';
          break;
        }
        if (await onSmsSendFailed(undefined, dTxt)) {
          wlog('verify: OTP sonrasi GECIKMELI "SMS gonderilemedi" diyalogu — sesli arama dalina donuluyor');
          lateDialog = 'sms';
          break;
        }
      }
      if (lateDialog === 'rate') break;      // rateLimitInfo dolu — aşağıdaki bekleme dalı devralır
      if (lateDialog === 'sms') continue;    // döngü onSmsSendFailed dalına düşer (Try another way)
      wlog(`verify: reached OTP screen (round ${round})`);
      break;
    }

    // "Deactivate your Business account?" (DowngradeFriction) — handled FIRST (right
    // after onOtp), BEFORE onWall/others. VERIFIED LIVE (mi68, +90 Business number):
    // this screen's body text ("…will be deleted in accordance with the applicable
    // policies…") was being mis-caught by a later branch (or the loop just never
    // reached the old late-placed DowngradeFriction branch), so the agent sat on the
    // friction screen forever. Placing it at the top means it's recognized the instant
    // it appears. TWO steps (both mapped LIVE): (1) "USE +<number>" primary_button →
    // (2) confirm the "Deactivate and switch" dialog via a11y CLICK_TEXT (its buttons
    // aren't in the dump on this GPU-less build; 690,1410 is the coord fallback).
    if (await onDowngradeFriction(foc, txt)) {
      downgradeRounds++;
      markPhase('downgrade');
      wlog(`verify: DowngradeFriction (Business hesap) — devre dışı bırakılıyor (tur ${downgradeRounds})`);
      // ★SPIN GUARD: 4 turda hala bu ekrandaysak tiklama YOLU CALISMIYOR demektir.
      // Sonsuza dek ayni seyi denemek 14 turu da yakar ve operatore "takildi" gibi
      // gorunur (CANLI: 5 tur / 108sn hicbir ilerleme yok). Temiz taniyla birak —
      // yanlis bir OTP_WAIT'ten cok daha iyi.
      // ★2026-08-05 LİMİT 5→9. ÖLÇÜM (bugün, 42 downgrade vakası):
      //   tur 1: 42 ulaştı, 0 aştı   ← HİÇBİR kayıt ilk turda geçmiyor
      //   tur 2: 42 ulaştı, 17 aştı
      //   tur 3: 25 ulaştı, 10 aştı
      //   tur 4: 15 ulaştı,  4 aştı
      //   tur 5: 11 ulaştı,  0 aştı  ← eski limit burada kesiyordu → 11'i de yandı
      // Yani tıklama KARARSIZ (flaky): aynı numara aynı kodla 3 denemede 2 kez geçti,
      // 1 kez takıldı (canlı: +905352248139 — 17:46 ✅, 17:50 ✅, 17:56 ❌).
      // Eğri hâlâ düşerek devam ediyordu; 5 tur ERKEN kesiyordu. Her tur ~25sn, 9 tur
      // ≈ 3.5dk — OTP beklemenin (9dk) yanında ucuz, ve numara YANMIYOR.
      if (downgradeRounds > 8) {
        wlog('verify: DowngradeFriction ASILI KALDI — "USE +" tıklaması ekranı değiştirmiyor');
        await snap('downgrade_stuck');
        // ★`wallText` KULLANILMAZ. Sebep: wallText "WhatsApp bizi reddetti" yolunu
        // tetikler; metin BAN/APK/COK_DENEME desenlerine uymadigi icin `RED` sinifina
        // duser ve operatore "WhatsApp kaydi reddetti, 1 SAAT BEKLEYIN" (waitSeconds
        // 3600) gosterilir. Bu YANLIS YONLENDIRME olurdu: WhatsApp reddetmedi, bizim
        // tiklamamiz gecmedi — beklemenin hicbir faydasi yok. Kendi terminal sonucumuzla
        // donuyoruz ki panel dogru aksiyonu gostersin.
        return done('downgrade_stuck', {
          status: 'DOWNGRADE_STUCK',
          note: '⚠️ Numarada eski bir WhatsApp BUSINESS hesabı var. "Business hesabını '
            + 'devre dışı bırak" ekranındaki "USE +<numara>" düğmesi otomatik tıklamaya '
            + 'yanıt vermedi (5 deneme). WhatsApp kaydı REDDETMEDİ — numara sağlam.',
          action: 'Panelden canlı ekranı açıp "USE +<numara>" düğmesine ELLE basın; kayıt '
            + 'kaldığı yerden devam eder. Ya da bu numarayı atlayıp yenisiyle devam edin.',
          resumable: true,   // numara YANMADI
          // waitSeconds YOK — beklemek bu sorunu çözmez.
        });
      }
      await snap('downgrade_business');
      await waProgress(curStep, curPct, '⚠ Numarada WhatsApp Business hesabı vardı — devre dışı bırakılıp bu numarayla devam ediliyor…');
      // Step 1: tap "USE +<number>" (id=primary_button, bottom green button).
      // ★KADEMELI: her turda bir oncekinden DAHA GUCLU bir yol dene. Eskiden her tur
      // AYNI iki adim atiliyordu; biri calismiyorsa 14 tur boyunca da calismiyordu.
      await h.a11yClickId('primary_button');
      // Dump'tan gercek dugumu bul (koordinat sabit degil, cihaz cozunurlugune gore kayar).
      let clicked = await h.tapSynIf('USE +', 'text');
      if (!clicked) clicked = await h.tapSynIf('com.whatsapp:id/primary_button', 'id');
      if (!clicked) await h.tapSyn(540, 2064).catch(() => undefined);
      // 3. turdan itibaren vtouch (gercek dokunma) da dene: bazi WhatsApp diyaloglari
      // sentetik `input tap`'e yanit vermez (vtouch fiziksel dokunma olayi uretir).
      if (downgradeRounds >= 3) {
        const n = findNode(await h.dump(), 'com.whatsapp:id/primary_button', 'id');
        if (n) await h.tapNode(n).catch(() => undefined);
      }
      // ★DOWNGRADE-LOOP FIX (VERIFIED LIVE, mi8 +90 539…): after "USE +", WhatsApp takes ONE
      // of TWO paths depending on build/number:
      //   (A) a confirm DIALOG "Deactivate your Business account? … Deactivate and switch"
      //       (VERIFIED mi68/watest45 +538/+359) → must click "Deactivate and switch".
      //   (B) NO dialog — it goes STRAIGHT to the number/verify screen (VERIFIED mi8 +539).
      // The old code ALWAYS waited ~2.5s for the (A) dialog and then blind-tapped
      // "Deactivate and switch"; on path (B) that dialog never came, the blind tap landed
      // on the number screen, and the loop re-detected DowngradeFriction → a ~28s/round
      // SPIN (LIVE: 6 rounds / 157s). Fix: poll for EITHER the dialog OR having left the
      // DowngradeFriction activity, capped ~3s. Only act on the dialog if it actually
      // appeared; if we already left DowngradeFriction, just continue (the loop's onOtp/
      // number branch handles the next screen) — no wasted blind tap, no re-detect spin.
      let sawDialog = false, leftDowngrade = false;
      for (let w = 0; w < 6; w++) {
        await h.sleep(500);
        if (await h.seen('Deactivate and switch', 250)) { sawDialog = true; break; }
        if (!/DowngradeFriction|downgrade\./i.test(await curFocus())) { leftDowngrade = true; break; }
      }
      if (sawDialog) {
        // Path (A): confirm the dialog (its buttons aren't in the GPU-less dump → a11y
        // CLICK_TEXT is the reliable path; 690,1410 is the measured coord fallback).
        await snap('downgrade_confirm');
        await h.a11yClickText('Deactivate and switch');
        if (!(await h.tapSynIf('Deactivate and switch', 'text'))) await h.tapSyn(690, 1410).catch(() => undefined);
        for (let w = 0; w < 6; w++) { await h.sleep(500); if (!/DowngradeFriction/i.test(await curFocus())) break; }
      } else if (!leftDowngrade) {
        // Neither the dialog nor a screen change within ~3s — the "USE +" tap may not have
        // landed. Re-tap once more before looping (better than a silent 28s re-detect).
        await h.a11yClickId('primary_button');
        await h.tapSyn(540, 2064).catch(() => undefined);
        await h.sleep(1500);
      }
      // Path (B) (leftDowngrade) falls straight through to continue → the loop re-observes
      // and the number/verify branch takes over.
      continue;
    }

    // Terminal ban / integrity wall — stop and report.
    wallText = await onWall(foc, txt);
    if (wallText) { wlog(`verify: WALL — ${wallText.slice(0, 80)}`); break; }

    // "Transfer chat history / Scan QR code" — WhatsApp wants to import chats off an
    // OLD phone via QR. We have none, so CONTINUE is a dead-end ("Turn on location" →
    // QR wait → stall). Tap NOT NOW (and dismiss the location dialog's "Not now" if it
    // appears) to fall through to normal number verification. VERIFIED LIVE (Pixel 7,
    // +90 already-registered number → after NOT NOW the activity flipped to
    // VerifyPhoneNumber). The agent previously had NO branch here and hung in the
    // vision-fallback loop with no screenshot/status — that stall is what this fixes.
    if (await onChatTransfer(foc, txt)) {
      wlog('verify: ChatTransfer — NOT NOW');
      await snap('chat_transfer'); // capture so the panel/operator can SEE the stall screen
      // findNode is case-insensitive, so 'not now' matches both the location dialog's
      // "Not now" AND the transfer screen's "NOT NOW". Some builds pop a
      // "Turn on location to continue the transfer" dialog first — dismiss it, then the
      // main transfer screen's NOT NOW leaves the flow → number verification.
      await h.a11yClickText('Not now');
      await h.tapSynIf('not now', 'text');
      await h.sleep(1500);
      await h.tapSynIf('not now', 'text');
      await h.sleep(2500);
      continue;
    }

    // "Switch to WhatsApp Messenger?" — number has an existing WA Business account.
    // Confirm "Switch now" to proceed (operator picked this number on purpose).
    if (await onSwitchDialog(foc, txt)) {
      wlog('verify: SwitchToMessenger dialog — Switch now');
      await snap('switch_dialog');
      await h.a11yClickText('Switch now');
      if (!(await h.tapSynIf('Switch now'))) await h.tapScaled(781, 1589).catch(() => undefined);
      await h.sleep(2500);
      continue;
    }

    // "Deactivate your Business account?" (DowngradeFriction). Proceed with THIS number
    // — TWO steps, both mapped LIVE (watest45, +359 BG Business number):
    //   1) Tap the primary "USE +<number>" button (id=primary_button, bottom green
    //      button ≈540,2064 on 1080x2400) — NOT "USE A DIFFERENT NUMBER" (loops back).
    //   2) A confirm DIALOG pops: "Deactivate your Business account? … Cancel /
    //      Deactivate and switch". Its buttons are NOT in the uiautomator dump on this
    //      GPU-less build, so a11y CLICK_TEXT on "Deactivate and switch" is the ONLY
    //      reliable path (VERIFIED: it advanced to VerifyPhoneNumber; blind coord taps
    //      alone did NOT). A measured coordinate (≈690,1410) is a best-effort fallback.
    // Move/other-phone rate-limit ("...too many times... Send SMS in N hours") —
    // terminal. Report the wait clearly so the operator knows when to retry.
    const otherRl = await onOtherPhoneRateLimit(foc, txt);
    if (otherRl) {
      wlog(`verify: OtherPhone RATE-LIMIT (${otherRl})`);
      await snap('other_phone_rate_limit');
      await h.a11yClickText('OK'); await h.tapSynIf('OK'); await h.sleep(800);
      // Set step 'otp_wait' + emit progress so the panel's OTP box (which triggers on
      // step==='otp_wait') opens with the wait note (API maps RATE_LIMITED→AWAITING_OTP).
      curStep = 'otp_wait'; curPct = stepPct.otp_wait;
      const rlNote = `⏳ WhatsApp bu numaraya "diğer telefon" kodunu çok kez istedi — ${otherRl} sonra tekrar denenebilir. (Numara zaten kayıtlı bir WhatsApp hesabına ait.)`;
      await waProgress('otp_wait', curPct, rlNote);
      return done('otp_wait', { status: 'RATE_LIMITED', otpChannel: 'rate_limited', note: rlNote, phoneNumber });
    }

    // Move/other-phone verification — the 6-digit code was pushed to the number's
    // EXISTING WhatsApp on another device (not SMS/voice). The agent can't READ it,
    // but the operator CAN read it off that phone and type it in — the code goes into
    // the SAME verify_sms_code_input field onOtp() already handles. So this is an
    // OTP-wait (panel shows the code modal), NOT AWAITING_MANUAL (which hides the
    // modal → operator has nowhere to enter the code). otpChannel tells the panel to
    // show the right hint. VERIFIED LIVE (mi10, +90 already-registered number: the
    // verify screen accepts a code typed into the field).
    if (await onOtherPhoneVerify(foc, txt)) {
      // OTP-wait (NOT a failure): the operator reads the code off the number's other
      // phone and types it into the SAME field. Use step 'otp_wait' + status OTP_WAIT
      // so done()'s OK_STATUSES keeps it out of the FAILED path AND the panel's OTP box
      // (which triggers on step==='otp_wait') appears. The 📲 note tells the operator
      // WHERE the code is (other phone, not SMS) — the modal shows it verbatim.
      wlog('verify: OtherPhone verify — OTP_WAIT (other_phone)');
      curStep = 'otp_wait'; curPct = stepPct.otp_wait;
      const otherNote = '📲 Kod diğer telefondaki WhatsApp\'a gönderildi (numara zaten kayıtlı) — o cihazdan okuyup panele girin.';
      await waProgress('otp_wait', curPct, otherNote);
      return done('otp_wait', {
        status: 'OTP_WAIT',
        otpChannel: 'other_phone',
        note: otherNote,
        phoneNumber
      });
    }

    // "<number> is not a valid mobile number for the country <X>" dialog (VERIFIED
    // LIVE on mi7, +1 802 683-3543 US). WhatsApp reached the OTP screen but rejected
    // the number as a non-mobile/invalid line — a NUMBER problem, not our bug. Bail
    // with a clear, honest reason instead of sitting at a fake OTP_WAIT.
    if (/not a valid mobile number|valid mobile number for the country/i.test(txt)) {
      return done('invalid_number', {
        status: 'INVALID_NUMBER',
        note: `WhatsApp bu numarayı geçerli bir cep numarası olarak kabul etmedi ("not a valid mobile number"). Numara yanlış/sabit-hat/kullanılmıyor olabilir — WhatsApp-uyumlu geçerli bir cep numarası kullanın.`,
        phoneNumber
      });
    }

    // "Couldn't send an SMS" dialog: try the voice route via "Try another way".
    if (await onSmsSendFailed(foc, txt)) {
      wlog('verify: SMS send FAILED — sesli aramaya geçiliyor');
      await snap('sms_send_failed');
      // ★2026-07-29: "Try another way" düğmesinin GERÇEKTEN görünmesini bekle.
      // Eskiden a11y-click + kör koordinat tap ardından sabit 2.5 sn bekleniyordu;
      // diyalog yavaş açıldığında tıklama boşa gidiyor, sonraki kontrol diyaloğu
      // hâlâ açık görüp akışı öldürüyordu (canlı: 9 kayıt "SMS gönderemedi" ile
      // bitmiş, oysa sesli arama yolu hiç denenememişti).
      await h.pollNode(['Try another way', 'Try other ways', 'Başka bir yol dene'], 6000, 'any').catch(() => null);
      await h.a11yClickText('Try another way');
      if (!(await h.tapSynIf(['Try another way', 'Try other ways', 'Başka bir yol dene'], 'any'))) {
        await h.tapScaled(742, 1353).catch(() => undefined);
      }
      // Yöntem sayfasının açılmasını POLL'la bekle (sabit sleep yerine).
      for (let w = 0; w < 12; w++) {
        if (await onChooseVerify()) break;
        await h.sleep(500);
      }
      // If the method sheet came up, take voice from it; else loop re-observes.
      if (await onChooseVerify()) { if ((await pickVerifyMethod()) === 'voice') voiceTried = true; }
      // If the dialog is STILL up (no "Try another way" / voice refused), OK-dismiss
      // once so the loop can re-observe; if it persists we report below.
      if (await onSmsSendFailed()) {
        bothLockedNote = voiceTried
          ? 'WhatsApp bu numaraya SMS de sesli aramayı da gönderemedi. Numara WhatsApp doğrulaması alamıyor (itibar/operatör engeli) — bekleyin veya WhatsApp-uyumlu başka numara kullanın.'
          : 'WhatsApp bu numaraya SMS gönderemedi. Numara WhatsApp doğrulaması alamıyor — bekleyin veya WhatsApp-uyumlu (SMS alabilen) başka numara kullanın.';
        await h.a11yClickText('OK'); await h.tapSynIf('OK'); await h.sleep(1500);
        // Give it one more observe round; if still failing, the loop's fallthrough
        // (round budget) plus the terminal check below will surface bothLockedNote.
      }
      continue;
    }

    // "Choose how to verify" sheet: SMS / Voice call / Missed call. If the operator
    // pre-picked a method (verifyMethod in the payload), apply it. Otherwise PAUSE and
    // ask via the panel — the modal shows the available (non-rate-limited) options and
    // the operator taps one, which re-dispatches with verifyMethod set. This replaces
    // the old blind SMS-preferred guess the user wanted control over.
    if (await onChooseVerify(foc, txt)) {
      wlog(`verify: ChooseVerify sheet — ${verifyMethod ? 'uygulanıyor: ' + verifyMethod : 'operatöre soruluyor'}`);
      if (verifyMethod) {
        const kind = await applyVerifyMethod(verifyMethod);
        if (kind === 'voice') voiceTried = true;
        if (kind === null) {
          bothLockedNote = 'Seçilen doğrulama yöntemi bu ekranda kullanılamıyor (kısıtlı/yok). Panelden başka yöntem seçin.';
          break;
        }
        continue;
      }
      // No operator choice yet → present the options and wait.
      await snap('choose_verify');
      const opts = await listVerifyOptions();
      curStep = 'otp_wait'; curPct = stepPct.otp_wait;
      const avail = opts.filter((o) => !o.locked).map((o) => o.kind);
      const optNote = '🔀 Doğrulama yöntemi seçin: ' +
        opts.map((o) => `${o.label}${o.locked ? ` (kısıtlı${o.wait ? ' — ' + o.wait : ''})` : ''}`).join(' · ');
      await waProgress('otp_wait', curPct, optNote);
      return done('choose_verify', {
        status: 'OTP_WAIT',
        otpChannel: 'method_select',
        verifyOptions: opts,
        availableMethods: avail,
        note: optNote,
        phoneNumber
      });
    }

    // Flash-call education screen: choose "Verify another way" → method sheet.
    if (await onFlashCallEdu(foc, txt)) {
      wlog('verify: FlashCallEdu — verify another way');
      await h.a11yClickId('secondary_button');
      await h.a11yClickText('VERIFY ANOTHER WAY');
      (await h.tapSynIf('VERIFY ANOTHER WAY')) || (await h.tapSynIf('another way', 'text'));
      await h.sleep(2200);
      continue;
    }

    // Late "Is this the correct number?" confirm dialog — accept it.
    if (await onConfirmNumber(foc, txt)) {
      wlog('verify: confirm-number dialog — Yes');
      await h.a11yClickText('Yes');
      (await h.tapSynIf('Yes')) || (await h.tapBy('Yes').catch(() => undefined));
      await h.sleep(2200);
      continue;
    }

    // "Allow WhatsApp to view SMS" prompt — we enter the code manually, so decline.
    if (await onViewSmsPrompt(foc, txt)) {
      wlog('verify: view-SMS prompt — reddediliyor');
      await h.a11yClickId('cancel');
      (await h.tapSynIf('Not now')) || (await h.tapSynIf('NOT NOW'));
      await h.sleep(1800);
      continue;
    }

    // Unknown/intermediate screen — settle briefly and re-observe.
    // ★L1 (highest-value log line): an unrecognized screen used to leave NO trace at all,
    // so the "spins on an unknown screen until rounds exhaust" stalls were invisible in
    // the log. Emit the focused activity so a tail shows exactly what we're stuck on.
    wlog(`verify: unknown screen round=${round} focus=${(foc || '').slice(0, 70)}`);
    await h.sleep(1400);
  }

  // Terminal outcomes from the state machine (before the generic OTP check below).
  if (wallText) {
    // ★2026-07-29: raporu EKRANDA YAZANA göre ayrıştır — operatör "numara yandı mı,
    // yoksa bekleyip tekrar mı deneyeyim" sorusunu tek bakışta yanıtlayabilsin.
    const w = String(wallText);
    const kind = /\bbanned\b|can.?t use whatsapp|suspended|violat/i.test(w)
      ? 'BAN'
      : /official WhatsApp|RegistrationBlock/i.test(w)
        ? 'APK'
        : /too many (attempts|requests|devices)/i.test(w)
          ? 'COK_DENEME'
          : 'RED';
    const note =
      kind === 'BAN'
        ? '⛔ NUMARA/HESAP YASAKLI — WhatsApp bu numarayı kalıcı olarak reddetti. Bu numarayı bir daha DENEMEYİN, yakılmıştır; yeni numara kullanın.'
        : kind === 'APK'
          ? '⛔ "Resmî WhatsApp" duvarı — WhatsApp bu APK/cihaz izini reddetti. Numara sağlam olabilir; cihazı sıfırlayıp (WA verisi sil + yeni kimlik) tekrar deneyin.'
          : kind === 'COK_DENEME'
            ? '⚠️ ÇOK DENEME — bu numara/cihaz kısa sürede fazla denendi. En az 1 saat BEKLEYİN; numara muhtemelen sağlam, hemen tekrar denemek yakar.'
            : '⚠️ WhatsApp kaydı reddetti. Ekran metnine bakın; geçici olabilir — 1 saat bekleyip tekrar deneyin.';
    // ★Tek cümlelik AKSİYON + `resumable`: numara yandı mı yoksa aynı numarayla
    // devam edilebilir mi — operatörün tek bakışta göreceği şey bu.
    const action =
      kind === 'BAN'
        ? 'Bu numarayı ÇÖPE atın, yeni numara girin. Tekrar denemek işe yaramaz.'
        : kind === 'APK'
          ? '"Sıfırla ve Tekrar Dene" ile cihaz kimliğini yenileyip aynı numarayla deneyin.'
          : kind === 'COK_DENEME'
            ? 'En az 1 saat bekleyin, sonra "Sıfırla ve Tekrar Dene". Numara muhtemelen sağlam.'
            : '1 saat bekleyip "Sıfırla ve Tekrar Dene". Tekrar reddederse numarayı değiştirin.';
    return done('device_wall', {
      status: 'DEVICE_WALL',
      wallKind: kind, // BAN | APK | COK_DENEME | RED — panel/telegram buna göre renk verebilir
      note,
      action,
      resumable: kind !== 'BAN', // BAN dışında aynı numarayla devam edilebilir
      ...(kind === 'COK_DENEME' || kind === 'RED' ? { waitSeconds: 3600 } : {}),
      screenTexts: w.slice(0, 400)
    });
  }
  // ★RATE-LIMIT ("You recently connected — wait N minutes"). Not terminal, but the
  // operator must SEE it instead of a false "SMS bekleniyor": WhatsApp is throttling this
  // number, not waiting for a code. Report RATE_LIMITED with the wait time so the modal
  // shows the real state and the operator knows to wait / use a different number.
  if (rateLimitText) {
    await snap('rate_limited');
    curStep = 'verify'; curPct = stepPct.verify;
    // ★waitSeconds/retryAfter: panel bunu bir bitiş anına çevirip GERİ SAYAN sayaç
    // gösterir; `recipe` operatöre ne yapması gerektiğini adım adım söyler (aynı metin
    // Telegram'a da düşer). `resumable: true` → bu numara YANMADI, süre sonunda aynı
    // kayıt devam edebilir.
    return done('rate_limited', {
      status: 'RATE_LIMITED',
      note: rateLimitText,
      waitSeconds: rateLimitInfo?.waitSeconds ?? 3600,
      waitLabel: rateLimitInfo?.waitLabel ?? 'bir süre',
      resumable: true,
      // ★2026-07-30 WhatsApp "Request a call" sunuyorsa BEKLEMEK ZORUNDA DEĞİLSİN:
      // panelden sesli arama yöntemini seçmek yeterli. Aksi halde bekleme + retry.
      action: rateLimitInfo?.callOffered
        ? 'BEKLEMENE GEREK YOK: panelden "Doğrulama yöntemi" olarak SESLİ ARAMA seçin — WhatsApp bu numaraya arama yapıp kodu söyler. Beklemek isterseniz ' + (rateLimitInfo?.waitLabel ?? 'bir süre') + ' sonra "Sıfırla ve Tekrar Dene".'
        : `${rateLimitInfo?.waitLabel ?? 'Bir süre'} bekleyin, sonra "Sıfırla ve Tekrar Dene" ile aynı numarayla devam edin. Numara yanmadı — hemen tekrar denemek yakar.`,
      ...(rateLimitInfo?.callOffered ? { callOffered: true } : {}),
      phoneNumber,
      screenTexts: rateLimitText.slice(0, 400)
    });
  }
  if (bothLockedNote && !(await onOtp())) {
    // ★SMS-SEND-FAILED → FAIL (operatör isteği): WhatsApp "Couldn't send an SMS to your
    // number" derse (ve varsa voice de gönderilemezse) bu OTP_WAIT değil, KALICI bir
    // BAŞARISIZLIKtır — SMS gelmeyecek, operatörün sonsuza kadar boşuna kod beklemesi
    // yanlış. Job'ı FAILED çek, panele net "SMS gönderilemedi, 1 saat bekleyin veya
    // WhatsApp-uyumlu başka numara kullanın" de. (VERIFIED LIVE mi16 +90 531 437…:
    // Business geçildi ama WhatsApp SMS göndermedi; eskiden OTP_WAIT'te asılı kalıyordu.)
    await snap('sms_send_failed_terminal');
    curStep = 'verify'; curPct = stepPct.verify;
    return done('sms_send_failed', {
      status: 'SMS_SEND_FAILED',
      note: bothLockedNote,
      // Numara yanmış DEĞİL: WhatsApp SMS'i gönderemedi (operatör/şebeke tarafı).
      // 1 saat sonra aynı numarayla devam edilebilir → geri sayım + kurtarma butonu.
      waitSeconds: 3600,
      waitLabel: '1 saat',
      resumable: true,
      action: '1 saat bekleyin, sonra "Sıfırla ve Tekrar Dene". Tekrar SMS gelmezse bu numara WhatsApp-uyumsuz — değiştirin.',
      phoneNumber
    });
  }

  // 8) OTP. The state machine above already handled ban walls and rate-limits. Now
  //    CONFIRM we actually reached the 6-digit verification screen before claiming
  //    OTP_WAIT — otherwise a stalled number screen would falsely report "SMS sent"
  //    when WhatsApp never sent one. Poll a little longer here since the code screen
  //    can take a few seconds to render after the method sheet.
  // ★H3: 24×750ms keeps the same ~18s ceiling but halves average detect latency —
  // onOtp() leads with curFocus() (cheap dumpsys window, never hangs), so a finer poll
  // catches the VerifyPhoneNumber flip ~0.75s sooner on the common path. ★L3: a mid-poll
  // snap every 4 rounds so a slow-to-render OTP screen still produces a live frame.
  let otpReached = await onOtp();
  if (!otpReached) {
    for (let w = 0; w < 24 && !otpReached; w++) {
      await h.sleep(750);
      otpReached = await onOtp();
      if (!otpReached && w % 4 === 3) await snap('otp_wait_poll');
    }
  }
  if (!otpReached) {
    const st = (await h.screenText()).slice(0, 400);
    // ★★★2026-08-13 "EKRAN BOS" ile "CIHAZ ERISILEMIYOR" AYNI SEY DEGIL.
    //
    // curFocus()/screenText() ADB kopunca '' doner (`.catch(() => '')` yutar) ve
    // onOtp() bu yuzden 24 turun HEPSINDE false doner. Eskiden burada dogrudan
    // OTP_SCREEN_NOT_REACHED donuluyordu = "WhatsApp SMS gondermedi" TERMINAL hukmu
    // -> NUMARA YANIYORDU. CANLI: mi249 +905317467445 — ekranda "Verifying your
    // number" YAZIYORDU (operatorun ekran goruntusu), adb-reap ucu 5 sn once
    // dusurmustu. Kayit oldu, numara bosa gitti.
    //
    // Simdi: ekran BOS ise once ucu geri baglayip BIR KEZ daha bak. Hala bosa
    // cihaz gercekten erisilemiyor demektir -> numarayi YAKMA, `resumable` birak.
    if (!st || !st.trim()) {
      await ensureConnected(serial).catch(() => undefined);
      await h.sleep(1500);
      if (await onOtp()) {
        wlog('verify: ekran BOS'
          + ' donuyordu (ADB kopmus) — uc geri baglandi, OTP ekrani DOGRULANDI');
      } else {
        const st2 = (await h.screenText().catch(() => '')).slice(0, 400);
        if (!st2 || !st2.trim()) {
          wlog('verify: CIHAZ ERISILEMIYOR (ekran okunamiyor) — numara YAKILMIYOR, kayit devam edebilir');
          await snap('adb_lost');
          return done('adb_lost', {
            status: 'DEVICE_UNREACHABLE',
            note: '⚠️ Cihaza ADB ile ulaşılamadı — ekran okunamadığı için doğrulama '
              + 'ekranına ulaşılıp ulaşılmadığı ANLAŞILAMADI. WhatsApp kaydı REDDETMEDİ; '
              + 'numaranız muhtemelen SAĞLAM ve SMS gönderilmiş olabilir.',
            action: 'Panelden canlı ekranı açıp cihazın durumuna bakın. Doğrulama ekranı '
              + 'duruyorsa kodu ELLE girebilirsiniz; ekran kapandıysa "Sıfırla ve Tekrar '
              + 'Dene" ile AYNI numarayla devam edin.',
            resumable: true,   // ★numara YANMADI — terminal hüküm verilmiyor
            phoneNumber
          });
        }
      }
    }
    if (!(await onOtp())) {
      return done('otp_not_reached', { status: 'OTP_SCREEN_NOT_REACHED', note: `Doğrulama ekranına ulaşılamadı — numara gönderimi başarısız olabilir (SMS/arama gönderilemedi). Son ekran: ${_phase}`, phoneNumber, screenTexts: st });
    }
  }
  // ★SMS-SEND-FAILED overlay check (operatör isteği): "Couldn't send an SMS to your
  // number" is a DIALOG that pops OVER the VerifyPhoneNumber activity — so onOtp() returns
  // true (activity matches) and we'd otherwise claim OTP_WAIT and tell the operator to wait
  // for an SMS that will NEVER arrive. Detect the dialog here (before parking at OTP_WAIT)
  // and FAIL honestly. (VERIFIED LIVE mi16 +90 531 437…: sat at AWAITING_OTP "SMS bekle"
  // while the screen showed "Couldn't send an SMS".)
  // ★★★2026-07-30 GECİKMELİ RATE-LIMIT — burada MUTLAKA onSmsSendFailed'DAN ÖNCE bakılır.
  //
  // CANLI OLARAK YAŞANDI (+905340420653, mi34, 04:36 — operatörün ekran görüntüsü):
  //   "Couldn't send an SMS to your number / … you can try again in 1 hour, or try to
  //    verify another way."  [OK] [Try another way]
  // Bu ekran onSmsSendFailed'a DÜŞMÜYOR (haklı olarak: rate-limit'i "kalıcı hata"
  // saymamak için onSmsRateLimited ile dışlanıyor) — AMA burada onRateLimit kontrolü
  // HİÇ YOKTU, dolayısıyla diyalog SESSİZCE GEÇİLİP `OTP_WAIT` yazılıyordu: panel OTP
  // kutusunu açıyor, operatör ASLA GELMEYECEK bir kodu bekliyordu.
  // Doğrusu: geçici kısıtı BEKLETME olarak bildir (waitSeconds + sesli arama seçeneği),
  // numarayı "yandı" saymadan.
  const otpLateRate = await onRateLimit();
  if (otpLateRate) {
    await snap('rate_limited_at_otp');
    curStep = 'verify'; curPct = stepPct.verify;
    // Şekli yukarıdaki `rateLimitText` dalıyla BİREBİR aynı tutuluyor — panel ve
    // Telegram aynı alanları (waitSeconds/waitLabel/action/resumable) okuyor.
    return done('rate_limited', {
      status: 'RATE_LIMITED',
      note: otpLateRate.note,
      waitSeconds: otpLateRate.waitSeconds,
      waitLabel: otpLateRate.waitLabel,
      resumable: true,
      action: otpLateRate.callOffered
        ? 'BEKLEMENE GEREK YOK: panelden "Doğrulama yöntemi" olarak SESLİ ARAMA seçin — WhatsApp bu numaraya arama yapıp kodu söyler. Beklemek isterseniz ' + otpLateRate.waitLabel + ' sonra "Sıfırla ve Tekrar Dene".'
        : `${otpLateRate.waitLabel} bekleyin, sonra "Sıfırla ve Tekrar Dene" ile aynı numarayla devam edin. Numara yanmadı — hemen tekrar denemek yakar.`,
      ...(otpLateRate.callOffered ? { callOffered: true } : {}),
      phoneNumber,
      screenTexts: otpLateRate.note.slice(0, 400)
    });
  }
  if (await onSmsSendFailed()) {
    await snap('sms_send_failed_terminal');
    const note = 'WhatsApp bu numaraya SMS gönderemedi ("Couldn\'t send an SMS"). Numara WhatsApp doğrulaması alamıyor (itibar/operatör engeli). 1 saat sonra tekrar deneyin veya WhatsApp-uyumlu (SMS alabilen) başka bir numara kullanın.';
    curStep = 'verify'; curPct = stepPct.verify;
    return done('sms_send_failed', { status: 'SMS_SEND_FAILED', note, phoneNumber });
  }
  curStep = 'otp_wait'; curPct = stepPct.otp_wait;
  markPhase('otp_wait');
  await snap('otp_screen');
  if (!otpCode) {
    // ★S2: the "other phone" verify screen ALSO runs on the VerifyPhoneNumber activity,
    // so on a FRESH run that lands there directly, the loop's `if (onOtp()) break` at the
    // top fires BEFORE the onOtherPhoneVerify branch ever runs — and we'd fall here and
    // tell the operator to "wait for an SMS" that never comes (the code is on the number's
    // OTHER phone). Re-test here so the panel gets the correct other_phone hint/channel.
    if (await onOtherPhoneVerify()) {
      const otherNote = '📲 Kod diğer telefondaki WhatsApp\'a gönderildi (numara zaten kayıtlı) — o cihazdan okuyup panele girin.';
      await waProgress('otp_wait', curPct, otherNote);
      return done('otp_wait', { status: 'OTP_WAIT', otpChannel: 'other_phone', note: otherNote, phoneNumber });
    }
    // Signal the panel to open its OTP box (status RUNNING, not FAILED — this is a
    // normal pause point). The dashboard shows a 6-digit input at this step.
    await waProgress('otp_wait', curPct, '📲 SMS kodu bekleniyor — panelden gireceksiniz');
    return done('otp_wait', { status: 'OTP_WAIT', otpChannel: 'sms', note: 'SMS kodu bekleniyor — kod gelince otpCode ile tekrar gönderin', phoneNumber });
  }
  curStep = 'otp'; curPct = stepPct.otp;
  await waProgress('otp', curPct, 'SMS kodu giriliyor…');
  // Type the code (input text, with a keyevent digit-by-digit fallback + verify).
  await typeOtp(serial, h, otpCode);
  await snap('otp_entered');
  await h.sleep(5000);

  // Re-show a wall after a bad/late code. Match BOTH word orders — WhatsApp's actual
  // dialog is "The code you entered is incorrect. Please try again in N seconds"
  // (code…incorrect), while the old regex only matched incorrect…code, so a wrong OTP
  // went UNDETECTED: the agent moved on / parked and the operator never saw "wrong code"
  // (VERIFIED LIVE, mi5 +90 539…: wrong code entered, dialog shown, agent didn't catch it).
  const afterOtp = await h.screenText();
  if (/(invalid|wrong|incorrect)[^.]{0,40}code|code[^.]{0,40}(is\s+)?(invalid|wrong|incorrect)|try again (later|in\s+\d+\s+(second|minute))/i.test(afterOtp)) {
    // ★2026-07-29 YANLIŞ KOD ARTIK AKIŞI ÖLDÜRMÜYOR.
    //
    // Eskiden burada OTP_REJECTED + terminal FAILED dönülüyordu: operatör doğru kodu
    // elinde tutsa bile akış bitmiş oluyor, DOĞRU kodu girmek için kaydı SIFIRDAN
    // açmak gerekiyordu — ki bu aynı numarayla ikinci deneme demek (ban riski, canlı
    // veride 28 numara çok-denemeli). Oysa WhatsApp ekranı HÂLÂ kod bekliyor.
    //
    // Yeni davranış: hesabı OTP bekleme durumunda TUT (status OTP_WAIT) ve panele
    // "kod yanlıştı, tekrar gir" de. Operatör yeni kodu girince aynı akış kaldığı
    // yerden devam eder — yeni kayıt açılmaz, numara yeniden yakılmaz.
    // ⚠️ "try again in N seconds" (hız-sınırı) durumunda da aynı: bekleyip tekrar
    // girmek doğru hamledir, kaydı çöpe atmak değil.
    const cooldown = /try again in\s+(\d+)\s+(second|minute)/i.exec(afterOtp);
    const cdSeconds = cooldown
      ? parseInt(cooldown[1], 10) * (/minute/i.test(cooldown[2]) ? 60 : 1)
      : 0;
    const waitNote = cooldown
      ? ` WhatsApp ${cooldown[1]} ${/minute/i.test(cooldown[2]) ? 'dakika' : 'saniye'} bekletiyor — süre sonunda girin.`
      : '';
    const note = `❌ Girilen SMS kodu kabul edilmedi.${waitNote} Panelden DOĞRU 6 haneli kodu tekrar girin — kayıt açık tutuluyor, yeni kayıt açmayın.`;
    await waProgress('otp_wait', stepPct.otp_wait, note);
    return done('otp_wait', {
      status: 'OTP_WAIT',
      otpChannel: 'sms',
      otpRejected: true, // panel bunu görüp "kod yanlıştı" vurgusu yapabilir
      // ★Soğuma süresi varsa panel GERİ SAYAR ve süre dolana kadar "Kodu Gönder"i
      // kilitler — erken gönderilen kod yine reddedilip sayacı sıfırdan başlatıyordu.
      ...(cdSeconds > 0 ? { waitSeconds: cdSeconds } : {}),
      resumable: true,
      action: cdSeconds > 0
        ? 'Sayaç bitince DOĞRU 6 haneli kodu girin. Kayıt açık — yeni kayıt açmayın.'
        : 'DOĞRU 6 haneli kodu tekrar girin. Kayıt açık — yeni kayıt açmayın.',
      note,
      phoneNumber,
      screenTexts: afterOtp.slice(0, 400)
    });
  }

  // 8b) Post-OTP interstitials before the profile screen: restore-backup prompt,
  //     contacts/permissions, "not now" sheets. Skip/allow them so we reach the name.
  for (let i = 0; i < 4; i++) {
    let acted = false;
    if (await h.seen('Skip', 800) || await h.seen('SKIP', 400)) { await h.a11yClickText('SKIP'); (await h.tapIf('Skip')) || (await h.tapIf('SKIP')); acted = true; }
    else if (await h.seen('Continue', 600)) { await h.a11yClickText('CONTINUE'); await h.tapIf('Continue'); acted = true; }
    else if (await h.seen('Not now', 500) || await h.seen('NOT NOW', 400)) { await h.a11yClickId('cancel'); (await h.tapIf('Not now')) || (await h.tapIf('NOT NOW')); acted = true; }
    else if (await h.tapById('com.android.permissioncontroller:id/permission_allow_button').then(() => true).catch(() => false)) { acted = true; }
    if (!acted) break;
    await h.sleep(1500);
  }

  curStep = 'profile'; curPct = stepPct.profile;
  await waProgress('profile', curPct, `Profil ismi giriliyor (${fullName})…`);
  // 9) Profile name → finish. Field is an EditText (id=registration_name on modern
  //    builds) that also rejects synthetic focus → a11y SET_TEXT primary, typeInto
  //    fallback. Verify the name landed, then Next.
  if (await h.seen('your name', 12000) || await h.seen('Profile info', 4000) || await h.find('com.whatsapp:id/registration_name', 'id')) {
    await snap('profile');
    // Verify the FULL name landed (not just the first word). VERIFIED LIVE (mi15): the
    // old first-word check let a11y write "Kaan Demir" but the screenText hadn't
    // refreshed yet, so the typeInto fallback ALSO ran → "Kaan DemirKaanDemir". Now we
    // (a) require the whole name present, (b) CLEAR the field before the typeInto
    // fallback so the two inputs can't concatenate, and (c) only fall back when a11y
    // genuinely didn't take.
    const nameLanded = async () => (await h.screenText()).replace(/\s+/g, ' ').includes(fullName);
    // ★BUG B (VERIFIED LIVE, watest34): the Profile-info screen has a "connection
    // problems" help link + the field sits near it, so a BLIND `input tap` on the
    // field/Next drifts onto it → WhatsApp opens "Set up your account" / a FAQ item
    // (FaqItemActivity) and the flow strands there. FIX: on Profile info NEVER use a
    // blind tap — a11y SET_TEXT fills the name WITHOUT focusing/tapping. If we ever
    // detect we drifted onto a help/FAQ/support screen, BACK out to RegisterName.
    const onHelpScreen = async () => {
      const f = await curFocus();
      return /Faq|inappsupport|support|SetupAccount|set up your account/i.test(f) ||
        (await h.seen('Set up your account', 400)) || (await h.seen('Fix connection issues', 400));
    };
    const backToProfileIfStrayed = async () => {
      for (let i = 0; i < 3; i++) {
        if (!(await onHelpScreen())) return;
        await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
        await h.sleep(1200);
      }
    };
    let named = false;
    for (let i = 0; i < 4 && !named; i++) {
      await backToProfileIfStrayed(); // make sure we're on Profile info, not a help page
      // a11y SET_TEXT — fills the field with NO tap (safe on this screen). Try both ids.
      await h.a11ySetText('registration_name', fullName);
      await h.a11ySetText('profile_name', fullName);
      await h.sleep(900);
      if (await nameLanded()) { named = true; break; }
      // a11y didn't stick → LAST-RESORT `input text` (ADB keyboard injects without a
      // tap-to-focus, so it can't drift onto the help link). Clear first so nothing
      // concatenates. NO tapById/typeInto here — those tap and risk the help screen.
      await h.clearField().catch(() => undefined);
      await h.sleep(300);
      await inputText(serial, fullName).catch(() => undefined);
      await h.sleep(700);
      if (await nameLanded()) { named = true; break; }
    }
    // Next/submit — a11y CLICK first (no tap drift). If still on RegisterName, tap the
    // Next button at its MEASURED bounds (read live from the dump, NOT a blind
    // coordinate that can hit the help link). Close the keyboard (BACK) between tries
    // since it can cover Next. Bail out of any help screen we stray onto.
    for (let i = 0; i < 5; i++) {
      await backToProfileIfStrayed();
      const foc = await curFocus();
      if (!/RegisterName|registration\.app\.RegisterName/i.test(foc) && !(await h.find('com.whatsapp:id/registration_name', 'id'))) break;
      // primary: a11y click on the submit button (no coordinates involved)
      await h.a11yClickId('registration_submit');
      await h.sleep(1000);
      if (!/RegisterName/i.test(await curFocus())) break;
      // secondary: tap the Next button at its REAL measured center (dump-derived)
      const nextNode = findNode(await h.dump().catch(() => []), ['registration_submit', 'Next'], 'any');
      if (nextNode) { await h.tapSyn(nextNode.cx, nextNode.cy); await h.sleep(1200); }
      if (!/RegisterName/i.test(await curFocus())) break;
      // keyboard may be covering Next — dismiss and retry
      await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
      await h.sleep(800);
    }
    await backToProfileIfStrayed();
    // ★H4: poll-until we left RegisterName (cap 3000ms) instead of a blind 3000ms. The
    // post-name interstitial sweep right below re-reads dumpsys window and acts on
    // whatever we land on, so the long blind settle was dead time; keep a floor so the
    // RegisterName→next-screen transition has painted before the sweep reads it.
    for (let w = 0; w < 6; w++) { await h.sleep(400); if (!/RegisterName/i.test(await curFocus())) break; }
  }

  // 9b) Post-name interstitials → home. Modern WhatsApp inserts optional screens
  // BETWEEN the profile name and the chat list — most importantly an "Add email
  // address" screen (RegisterEmail), and sometimes restore-backup / contacts / a
  // permission prompt. VERIFIED LIVE (watest34): the flow stranded on RegisterEmail
  // and reported PROFILE_INCOMPLETE even though registration had succeeded. So before
  // the home check, sweep these away by tapping Skip / Not now / Continue / Allow a
  // few times — each is harmless if the screen isn't there, and we stop as soon as we
  // reach home.
  for (let i = 0; i < 6; i++) {
    const win = await adb(serial, ['shell', 'dumpsys', 'window']).catch(() => '');
    if (/HomeActivity|home\.ui\.Home|conversations|\bChats\b/i.test(win) || await h.find('com.whatsapp:id/fab', 'id')) break;
    // Email screen: has a "Skip" (id=skip / text). Also generic Not now / Continue.
    await h.a11yClickId('register_email_skip').catch(() => undefined);
    await h.a11yClickId('skip').catch(() => undefined);
    const acted =
      (await h.tapSynIf('Skip', 'text')) || (await h.tapSynIf('SKIP', 'text')) ||
      (await h.tapSynIf('Not now', 'text')) || (await h.tapSynIf('NOT NOW', 'text')) ||
      (await h.tapSynIf('Not Now', 'text')) || (await h.tapSynIf('Maybe later', 'text')) ||
      (await h.tapById('com.android.permissioncontroller:id/permission_allow_button').then(() => true).catch(() => false)) ||
      (await h.tapSynIf('Continue', 'text'));
    if (!acted) await h.sleep(1200); else await h.sleep(1600);
  }

  // 10) CONFIRM we truly reached the home/chat screen before claiming success —
  //     otherwise a stalled profile step would falsely report ACTIVE.
  let atHome = false;
  for (let i = 0; i < 6; i++) {
    const win = await adb(serial, ['shell', 'dumpsys', 'window']).catch(() => '');
    if (/HomeActivity|home\.ui\.Home|conversations|\bChats\b/i.test(win) || await h.find('com.whatsapp:id/fab', 'id')) { atHome = true; break; }
    await h.sleep(2000);
  }
  const finalText = await h.screenText();
  if (!atHome) {
    await waProgress('profile', curPct, '❌ Ana ekrana ulaşılamadı', 'FAILED');
    return done('profile_incomplete', { status: 'PROFILE_INCOMPLETE', note: 'Profil/isim adımından sonra ana ekrana ulaşılamadı', phoneNumber, screenTexts: finalText.slice(0, 400) });
  }
  curStep = 'done'; curPct = stepPct.done;
  // done() emits the terminal COMPLETED progress for CREATED (see OK_STATUSES).
  return done('home', { status: 'CREATED', note: 'WhatsApp hesabı oluşturuldu (HomeActivity teyitli)', phoneNumber, screenTexts: finalText.slice(0, 400) });
}

// Type a 6-digit OTP, robust to either one combined field or six single-digit
// boxes. The OTP boxes are a custom code-widget: `input text` works on some
// builds but is silently dropped on others — so we type, VERIFY the digits
// landed, and fall back to per-digit keyevents if not. Keycode map (proven on
// Waydroid): digit d → keyevent (d + 7), i.e. 0→7, 1→8 … 9→16.
async function typeOtp(serial, h, code) {
  const digits = String(code).replace(/\D/g, '');
  // PRIMARY — a11y SET_TEXT into the OTP field (the registration EditTexts reject
  // synthetic focus on WA 2.25.x; a11y works without focus). The modern build uses
  // a single combined field id=verify_sms_code_input; try it + a couple of aliases.
  for (const id of ['verify_sms_code_input', 'registration_verify', 'code']) {
    await h.a11ySetText(id, digits);
  }
  await h.sleep(900);
  let after = await h.screenText().catch(() => '');
  if (after.includes(digits) || /verifying|connecting/i.test(after)) return;
  // FALLBACK 1 — tap the field + stock-IME input text.
  const field = await h.find('verify_sms_code_input', 'id') || await h.find('digit code', 'any') || await h.find('code', 'any');
  if (field) await h.tapNode(field);
  await h.sleep(400);
  await adb(serial, ['shell', 'input', 'text', digits]).catch(() => undefined);
  await h.sleep(700);
  after = await h.screenText().catch(() => '');
  if (after.includes(digits) || /verifying/i.test(after)) return;
  // FALLBACK 2 — per-digit keyevents into the (re-tapped) first box (keycode d+7).
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_DEL', 'KEYCODE_DEL', 'KEYCODE_DEL', 'KEYCODE_DEL', 'KEYCODE_DEL', 'KEYCODE_DEL']).catch(() => undefined);
  if (field) await h.tapNode(field).catch(() => undefined);
  const codes = digits.split('').map((d) => String(Number(d) + 7));
  await adb(serial, ['shell', 'input', 'keyevent', ...codes]).catch(() => undefined);
}

// Dismiss the modal dialogs WhatsApp shows on emulators/custom ROMs that block
// the chat UI (e.g. "You have a custom ROM installed … OK"). The OK button is a
// real Button node; tap it by text. Safe no-op if no dialog is present.
async function dismissBlockingDialogs(serial, h) {
  for (let i = 0; i < 3; i++) {
    const nodes = await h.dump();
    // ★2026-08-10 "Disappearing messages" BİLGİ EKRANI EKLENDİ.
    // CANLI: 2 günde 14 CHAT_NOT_OPENED'ın `screenTexts`'i "Disappearing messages are
    // on in this chat | This increases your privacy and…" idi. Karşı taraf kaybolan
    // mesajları AÇMIŞSA WhatsApp sohbeti açarken bu bilgi katmanını gösteriyor ve
    // compose kutusunu ÖRTÜYOR → agent kutuyu bulamayıp CHAT_NOT_OPENED'a düşüyordu.
    // Oysa sohbet AÇILMIŞTI; tek gereken bilgilendirmeyi kapatmak (OK/GOT IT).
    const hasAlert = nodes.some((n) => /custom ROM|unsupported|Alert|Disappearing messages|Kaybolan mesajlar/i.test(n.text || ''));
    if (!hasAlert) return;
    // Prefer a clickable OK/CONTINUE button node.
    const btn = nodes.find((n) => n.clickable && /^(OK|CONTINUE|GOT IT)$/i.test((n.text || '').trim()))
      || nodes.find((n) => /^(OK|CONTINUE|GOT IT)$/i.test((n.text || '').trim()));
    if (!btn) return;
    await h.tapNode(btn);
    await h.sleep(1200);
  }
}

// ★2026-08-05 TASLAK TEMİZLE — bir gönderim CHAT_NOT_OPENED ile biterken mesaj metni
// compose kutusuna YAZILMIŞ olabilir. Canlı kanıt (16:06, hedef 905367668649): hata
// anındaki ekran metni "Draft: | tekrar selamm:)" idi — yani metin kutuya girmiş ama
// gönder tuşuna basılamamıştı. WhatsApp bunu TASLAK olarak SAKLIYOR: kutu bir sonraki
// açılışta hâlâ dolu geliyor. Sonuç: operatör aynı numaraya tekrar yazdığında eski
// metnin ÜSTÜNE yazılıyor / iki mesaj birleşiyor ve yanlış içerik gidebiliyor.
//
// Bu yüzden başarısız bir gönderimden dönmeden ÖNCE kutuyu boşaltıyoruz. Yalnızca
// compose kutusu GERÇEKTEN varsa ve İÇİ DOLUYSA çalışır (kutu yoksa yapacak iş yok);
// böylece "Couldn't connect" gibi kutunun hiç açılmadığı vakalarda boşa iş yapılmaz.
// Asla throw etmez — temizlik başarısız olsa da asıl hata raporu bozulmamalı.
async function clearComposeDraft(serial, h, tlog) {
  try {
    const box = await h.find('com.whatsapp:id/entry', 'id').catch(() => null);
    if (!box) return false;                       // kutu yok → taslak da yok
    const cur = String(box.text || '').trim();
    if (!cur) return false;                       // zaten boş
    await h.tap(box).catch(() => undefined);
    await h.sleep(200);
    // ★CANLI TEST (2026-08-05, cihaz 192.168.95.112, 17 karakterlik taslak):
    // Ctrl+A + DEL bu kurulumda ÇALIŞMADI — metin kutuda aynen kaldı (ADBKeyboard
    // IME'si seçim tuş kombinasyonunu iletmiyor). Tek tek KEYCODE_DEL ise metni
    // TAMAMEN sildi (ekran görüntüsüyle doğrulandı: kutu "Message" placeholder'ına,
    // gönder ikonu mikrofona döndü). Bu yüzden doğrudan backspace kullanıyoruz —
    // çalışmayan bir "hızlı yol"u önce denemek sadece gecikme ekliyordu.
    // Üst sınır: kutudaki karakter sayısı + 2 pay, en fazla 220 tuş (uzun metinde
    // sonsuz döngüye düşmemek için).
    const n = Math.min(cur.length + 2, 220);
    for (let i = 0; i < n; i++) {
      await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_DEL']).catch(() => undefined);
    }
    await h.sleep(250);
    // ★SES-KAYDI EMNİYETİ: kutu boşalınca gönder ikonu MİKROFONA döner. Buradaki
    // girdiler keyevent (tuş) olduğu için mikrofona basılmaz — ama IME/odak beklenmedik
    // bir yere kayarsa kayıt başlayabilir ve karşı tarafa BOŞ SES MESAJI gidebilir.
    // Ucuz sigorta: kayıt arayüzü açıldıysa BACK ile iptal et (canlıda BACK'in kaydı
    // temizlediği doğrulandı). Not: `voice_note_btn` düğmesinin content-desc'i zaten
    // "Voice message … recording" içerir — o BUTONUN ETİKETİ, kayıt göstergesi DEĞİL;
    // bu yüzden düğmeyi değil, yalnızca AKTİF kayıt panelini arıyoruz.
    const rec = await h.find('com.whatsapp:id/recording_view', 'id').catch(() => null)
             || await h.find('com.whatsapp:id/slide_to_cancel_label', 'id').catch(() => null);
    if (rec) {
      await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
      await h.sleep(300);
      if (tlog) tlog('draft: ses kaydi paneli acilmisti → BACK ile iptal edildi');
    }
    const fin = await h.find('com.whatsapp:id/entry', 'id').catch(() => null);
    const ok = !String(fin?.text || '').trim();
    if (tlog) tlog(`draft cleared=${ok} (was ${cur.length} chars, ${n} DEL)`);
    return ok;
  } catch {
    return false;   // temizlik best-effort; asıl hatayı asla gölgelemesin
  }
}

// Generic "System UI / <app> isn't responding" ANR dismisser — MODULE-LEVEL twin of
// registerWhatsApp's in-scope clearAnr (agent.mjs ~1679), extracted so the send/read
// flows can use it too. On this GPU-less Waydroid an ANR dialog ("<app> isn't
// responding — Wait / Close app") pops OVER WhatsApp during message send (the compose
// box has text and any view-tree churn can trip it), and — because whatsappSend had NO
// ANR handling — the dialog stayed on screen, failed the send, AND blocked every
// subsequent send (root cause of the user's "WhatsApp donuyor / close app çıkıyor"
// report). Presses "Wait" (keep the app alive) via id + text + measured coordinate,
// all raw taps. Reads focus itself (dumpsys window, 5s hard timeout) so it needs no
// caller-scoped curFocus. Returns true if it dismissed a dialog, false if none seen.
async function clearAnrDialog(serial, h, tries = 3) {
  let dismissed = false;
  for (let i = 0; i < tries; i++) {
    const w = await adbT(serial, ['shell', 'dumpsys', 'window'], 5000).catch(() => '');
    const focused = /Application Not Responding|isn.t responding|aerr_/i.test(w);
    if (!focused && !(await h.seen("isn't responding", 250))) return dismissed;
    dismissed = true;
    await h.tapById('android:id/aerr_wait').catch(() => undefined);
    if (!(await h.tapSynIf('Wait'))) await h.tapSyn(322, 1306).catch(() => undefined);
    await h.sleep(1200);
  }
  return dismissed;
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
  // CRITICAL (VERIFIED LIVE 21:37, watest47): a cold deep-link open can trip an ANR
  // ("WhatsApp isn't responding — Wait / Close app") that sits OVER the loading chat
  // and blocks the compose box from ever appearing. The old loop just spun 9×~500ms
  // then gave up (CHAT_NOT_OPENED) WITHOUT dismissing the ANR — so every send to that
  // device failed until the dialog was cleared by hand. Clear the ANR INSIDE the poll
  // (press "Wait" to keep WhatsApp alive) so the chat can finish rendering.
  let chatOpened = false;
  for (let i = 0; i < 9 && !chatOpened; i++) {
    await h.sleep(500);
    chatOpened = Boolean(await h.find('com.whatsapp:id/entry', 'id').catch(() => null));
    // Every couple of polls, if an ANR is up, press "Wait" and give it a beat to recover.
    if (!chatOpened && i % 2 === 1 && await clearAnrDialog(serial, h, 1)) await h.sleep(700);
  }
  tlog(`chat opened (entry poll)=${chatOpened}`);
  // Last-chance recovery: if the box still never appeared, an ANR may STILL be up
  // (it can re-pop). Clear it once more and re-poll briefly before giving up — this
  // turns a transient ANR from a hard CHAT_NOT_OPENED failure into a successful send.
  if (!chatOpened) {
    if (await clearAnrDialog(serial, h, 3)) {
      await h.sleep(1000);
      for (let i = 0; i < 6 && !chatOpened; i++) {
        await h.sleep(500);
        chatOpened = Boolean(await h.find('com.whatsapp:id/entry', 'id').catch(() => null));
      }
      tlog(`chat opened after ANR recovery=${chatOpened}`);
    }
  }
  // If the compose box never appeared, WhatsApp landed on something OTHER than the
  // Conversation screen. The most common (VERIFIED LIVE, 21:00): the account is
  // "in review"/restricted/banned → a full-screen notice with NO compose box, so
  // the old code polled 9× (~23s wasted) then blindly tapped the send coordinate
  // into that notice and returned a vague COMPOSE_FAILED. Read the screen ONCE and
  // report the ACTUAL reason (account review / ban / rate-limit) instead of hanging.
  if (!chatOpened) {
    // ★2026-08-07 GEÇİCİ "Searching…" EKRANI YANLIŞ TANI ÜRETİYORDU.
    // CANLI ÖLÇÜM (mi12 / +905395264232 — CHAT_NOT_OPENED'ların %36'sını tek başına
    // üretiyordu): DB'deki `screenTexts` alanı "Searching…" idi. WhatsApp bir deep
    // link'le sohbet açarken ÖNCE numarayı arıyor ("Searching…"), SONRA sonucu
    // gösteriyor. `notice` TEK KEZ okunduğu için tam o ara ekrana denk gelince
    // HİÇBİR desen tutmuyor ve belirsiz CHAT_NOT_OPENED'a düşüyordu.
    // ★KANIT: aynı cihazda elle test — 905305793542 için 1 saniye sonra ekranda
    // "The phone number … isn't on WhatsApp." YAZIYORDU. Yani sinyal VARDI, sadece
    // agent onu görmeden karar veriyordu. Doğru sonuç INVALID_RECIPIENT (numara
    // WhatsApp'ta yok) — operatöre "sohbet açılamadı" demek YANLIŞ YÖNLENDİRME.
    // FIX: ekran hâlâ "arıyor" durumundaysa kısa süre bekleyip TEKRAR oku.
    let notice = await h.screenText().catch(() => '');
    for (let w = 0; w < 6 && /searching|aranıyor/i.test(notice) && !chatOpened; w++) {
      await h.sleep(700);
      chatOpened = Boolean(await h.find('com.whatsapp:id/entry', 'id').catch(() => null));
      if (chatOpened) break;                       // sohbet açıldı → aşağıdaki akış devam etsin
      notice = await h.screenText().catch(() => '');
    }
    if (chatOpened) tlog('chat opened after Searching wait');
  }
  if (!chatOpened) {
    const notice = await h.screenText().catch(() => '');
    // ★BAN detection via the ACTIVITY name first — the most reliable signal. WhatsApp's
    // ban screen is BanAppealActivity ("This account can't use WhatsApp" + REQUEST/
    // REVIEW). VERIFIED LIVE (mi7 +355…): the account was banned but agent reported a
    // vague CHAT_NOT_OPENED, because the old text regex missed "can't use WhatsApp" (no
    // banned/suspended/violat word). So the operator kept retrying a dead account.
    const focBan = await adb(serial, ['shell', 'dumpsys', 'window']).catch(() => '');
    if (/BanAppeal|userban/i.test(focBan) || /can.?t use whatsapp|account can.?t use|hesab\w* whatsapp'?ı kullanamaz/i.test(notice)) {
      return { status: 'ACCOUNT_BANNED', note: 'Bu WhatsApp hesabı YASAKLI (ban) — mesaj gönderilemez, hesap ölü', to, screenTexts: notice.slice(0, 400) };
    }
    if (/account.{0,3}(is|being)?.{0,3}(in )?review|hesab\w* incelen|inceleme|no longer restricted/i.test(notice)) {
      return { status: 'ACCOUNT_REVIEW', note: 'Bu WhatsApp hesabı incelemede/kısıtlı — mesaj gönderilemez (genelde 24s sürer)', to, screenTexts: notice.slice(0, 400) };
    }
    // ★RESTRICTED detection — VERIFIED LIVE (mi9 +905394660382, 2026-07-23): the
    // Conversation screen DOES open, but instead of the compose box (id/entry) WhatsApp
    // shows a read-only chat with a bottom banner "Your account is restricted. You can't
    // start new chats right now." The account can still reply in EXISTING threads (so it
    // sent fine hours earlier) but cannot START a NEW chat. The old code missed this —
    // "restricted" matches no ban/review word — so it returned a misleading CHAT_NOT_OPENED
    // and the account stayed ACTIVE while silently failing. Two signals: the banner text,
    // OR the read_only_chat_info node (chat open but no compose = restricted/read-only).
    const readOnlyChat = await h.find('com.whatsapp:id/read_only_chat_info', 'id').catch(() => null)
      || await h.find('com.whatsapp:id/read_only_chat_info_content', 'id').catch(() => null);
    if (/account is restricted|can.?t start new chats|hesab\w* kısıtl|yeni sohbet başlat/i.test(notice) || readOnlyChat) {
      return { status: 'ACCOUNT_RESTRICTED', note: '⚠️ Bu WhatsApp hesabı KISITLI — yeni sohbet başlatamıyor (mevcut sohbetlere yanıt verebilir). Genelde ban öncesi durum.', to, screenTexts: notice.slice(0, 400) };
    }
    // ★LOGGED_OUT detection — VERIFIED LIVE (mi68/watest47 2026-07-23): opening WA to
    // send landed on the "Welcome to WhatsApp" / "Agree and continue" registration screen
    // (activity com.whatsapp.registration.*), which means the ACCOUNT IS GONE — logged
    // out / cleared, not just a stubborn chat. The account must re-register before it can
    // send anything. The old code returned CHAT_NOT_OPENED here too, so watest47 failed
    // EVERY send for THREE days looking merely "stuck". Activity name is the reliable
    // signal (registration/EULA/eula); the welcome/agree text is the backup.
    const focReg = focBan || await adb(serial, ['shell', 'dumpsys', 'window']).catch(() => '');
    if (/whatsapp\/.*(registration|\.EULA|RegisterName|verifynumber)/i.test(focReg)
        || /welcome to whatsapp|agree and continue|read our privacy policy|kabul et ve devam/i.test(notice)) {
      return { status: 'ACCOUNT_LOGGED_OUT', note: '🔒 Bu WhatsApp hesabı ÇIKIŞ YAPMIŞ / kayıt silinmiş (Welcome/kayıt ekranı) — mesaj gönderilemez, yeniden kayıt gerekir.', to, screenTexts: notice.slice(0, 400) };
    }
    if (/banned|suspended|violat|yasakl|askıya|Terms of Service/i.test(notice)) {
      return { status: 'ACCOUNT_BANNED', note: 'Bu WhatsApp hesabı yasaklı/askıda — mesaj gönderilemez', to, screenTexts: notice.slice(0, 400) };
    }
    // ★2026-08-10 DESEN KAÇIRIYORDU. Gerçek ekran metni: "The phone number +90 537…
    // **isn't on** WhatsApp." — eski desen `not on whatsapp` arıyordu ama araya
    // "isn't" giriyor, `isn.?t a valid` ise "valid" bekliyor. Sonuç: numara WhatsApp'ta
    // olmadığı HÂLDE belirsiz CHAT_NOT_OPENED dönüyordu (canlı: 2 günde 2 vaka, ayrıca
    // 7 Ağu'daki "Searching…" düzeltmesi sayesinde bu metin artık screenTexts'e DÜŞÜYOR
    // — yani sinyal görünür oldu ama desen yakalamıyordu).
    // `isn'?t on whatsapp` eklendi (düz kesme + typographic ' ikisi de).
    // ★2026-08-15 DESEN YINE KACIRIYORDU: canli ekran "+902592573551 **is not a**
    // valid phone number." yaziyor ama desen yalnizca KISALTMAYI (`isn't a valid`)
    // taniyordu -> gecersiz numara belirsiz CHAT_NOT_OPENED olarak raporlaniyordu
    // (bugun 15 CHAT_NOT_OPENED'in 2'si tam bu). Acik yazim da eklendi.
    if (/not on whatsapp|isn.?t on whatsapp|invalid|is ?n.?o?.?t a valid|not a valid phone|WhatsApp'ta değil|geçerli bir telefon/i.test(notice)) {
      return { status: 'INVALID_RECIPIENT', note: 'Numara WhatsApp\'ta değil veya geçersiz', to, screenTexts: notice.slice(0, 300) };
    }
    // ★2026-08-15 BAGLANTI HATASI ayri raporlansin: "Couldn't connect. Please try again
    // later." bir UI/otomasyon arizasi DEGIL — cihazin proxy/ag cikisi o an calismiyor.
    // CHAT_NOT_OPENED olarak raporlanmasi operatoru yanlis yere bakiyordu (bugun 15'in
    // 2'si). Ayri kod ile: yeniden denenebilir ve proxy sorunu gorunur olur.
    if (/couldn.?t connect|connection failed|bağlanılamadı|bağlantı kurulamadı/i.test(notice)) {
      await clearComposeDraft(serial, h, tlog);
      return { status: 'CONNECTION_FAILED', note: 'Cihaz WhatsApp sunucusuna bağlanamadı (proxy/ağ) — tekrar denenebilir', to, screenTexts: notice.slice(0, 300) };
    }
    // Unknown non-chat screen: still don't blind-tap send into it — report honestly.
    // ★2026-08-05 Ama dönmeden ÖNCE taslağı temizle: metin kutuya girmiş olabilir ve
    // WhatsApp onu SAKLAR ("Draft: …"), sonraki gönderim eski metinle karışır.
    await clearComposeDraft(serial, h, tlog);
    return { status: 'CHAT_NOT_OPENED', note: 'Sohbet ekranı açılamadı (mesaj kutusu görünmedi)', to, screenTexts: notice.slice(0, 400) };
  }
  // An ANR ("<app> isn't responding") can pop while the deep link cold-opens the
  // chat — clear it first so the box/dialog sweep below sees the real UI, not the
  // ANR overlay. (Cheap: reads focus once, taps "Wait" only if the dialog is up.)
  await clearAnrDialog(serial, h, 2);
  tlog('anr sweep (post-open)');
  // SPEED: take ONE dump and use it for THREE things — the blocking-dialog sweep,
  // the invalid-recipient check, AND capturing the real id/send button bounds —
  // instead of separate dumps (~2.2s each). On the common path (no dialog, valid
  // number) this is a single dump. `sendNode` (if found) drives a real button tap
  // below instead of the blind coordinate; multi-line messages / different WA
  // versions move the button off the hard-coded ~93%/91.5% point, so the measured
  // node is strictly better when present (falls back to the coordinate otherwise).
  let sendNode = null;
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
    // ★2026-08-15 acik yazim ("is not a valid phone number") da yakalanir — bkz. yukarisi.
    if (/not on whatsapp|isn.?t on whatsapp|invalid|is ?n.?o?.?t a valid|not a valid phone|WhatsApp'ta değil|geçerli bir telefon/i.test(flat)) {
      return { status: 'INVALID_RECIPIENT', note: 'Numara WhatsApp\'ta değil veya geçersiz', to, screenTexts: flat.slice(0, 300) };
    }
    // Capture the send button from THIS dump (no extra dump). id/send is the paper-
    // plane. Anchor the resId to END with ":id/send" so we don't latch onto a
    // container like ":id/send_container"; among candidates prefer a clickable one,
    // then the smallest-area node (the actual button, not a wrapper). Only trust real
    // on-screen bounds (cx/cy > 0). Fall back to the coordinate tap when absent.
    const sendCands = nodes.filter((n) => /:id\/send$/.test(n.resId || '') && n.cx > 0 && n.cy > 0);
    const area = (n) => Math.max(0, (n.bounds?.[2] ?? 0) - (n.bounds?.[0] ?? 0)) * Math.max(0, (n.bounds?.[3] ?? 0) - (n.bounds?.[1] ?? 0));
    sendNode = sendCands.filter((n) => n.clickable).sort((a, b) => area(a) - area(b))[0]
      || sendCands.sort((a, b) => area(a) - area(b))[0]
      || null;
  }
  tlog(`dialog+invalid check (1 dump)${sendNode ? ' [id/send found]' : ''}`);

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
  // BEFORE every dump, clear any ANR dialog first: if "<app> isn't responding"
  // is up, the dump returns '' (→ null) and, worse, the dialog blocks the send.
  // Pressing "Wait" keeps WhatsApp alive so the box/bubble becomes readable again.
  const composeStillFull = async () => {
    if (await clearAnrDialog(serial, h, 2)) await h.sleep(400);
    const nodes = await h.dump().catch(() => null);
    if (!nodes) return null;
    const entry = nodes.find((n) => n.resId.includes('id/entry'));
    if (!entry) return null;
    return (entry.text ?? '').includes(needle.slice(0, 12));
  };
  // POSITIVE send evidence (SHOT-2): an OUTGOING bubble carrying our text appeared on
  // the right half. A cleared compose box is necessary but not sufficient — this
  // confirms the message actually landed in the thread. Best-effort; '' on a blank
  // dump so it never flips a real send to failure, only strengthens a positive.
  const outgoingBubbleAppeared = async () => {
    const nodes = await h.dump().catch(() => []);
    if (!nodes.length) return false;
    const needleHead = needle.slice(0, 24);
    return nodes.some((n) =>
      /message_text/.test(n.resId || '') &&
      (n.text || '').includes(needleHead) &&
      // right-half = outgoing (incoming bubbles sit left); cx may be undefined → allow.
      (typeof n.cx !== 'number' || n.cx > 0)
    );
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
  // Prefer the MEASURED id/send bounds captured above (accurate for multi-line
  // messages / different WA versions); fall back to the scaled blind coordinate.
  const tapX = sendNode ? Math.round(sendNode.cx) : sendX;
  const tapY = sendNode ? Math.round(sendNode.cy) : sendY;
  let sent = false;
  for (let attempt = 0; attempt < 2 && !sent; attempt++) {
    await adb(serial, ['shell', 'input', 'tap', String(tapX), String(tapY)]); // synthetic (the reliable path)
    const still = await waitCleared(1500);
    tlog(`send tap ${attempt} @${tapX},${tapY}${sendNode ? '(id/send)' : '(coord)'} + verify (still=${still})`);
    if (still === false) { sent = true; break; }  // cleared → sent
    // still === true (definitely not sent) → loop and retry; null → also retry once
  }

  // ★Late "… is not on WhatsApp" / invalid-recipient dialog (scenario #6). The early
  // one-shot check right after chat-open can MISS this on a slow device — the compose
  // box renders first and the "not on WhatsApp / invite" dialog pops a beat later,
  // AFTER we've already tapped send. Re-check here so we return INVALID_RECIPIENT
  // instead of a false SENT (the send tap may have cleared the box / hit the dialog).
  {
    const t = await h.screenText().catch(() => '');
    if (/not on WhatsApp|isn.t on WhatsApp|invalid|isn.t a valid|WhatsApp'ta değil|geçerli değil/i.test(t)) {
      return {
        status: 'INVALID_RECIPIENT',
        note: 'Alıcı WhatsApp\'ta kayıtlı değil (mesaj gönderilemedi)',
        to,
        screenTexts: t.slice(0, 300)
      };
    }
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

  // ★"Your message was not sent." dialog / red-! retry state (VERIFIED LIVE,
  // watest34): a freshly-registered account's FIRST outgoing message often fails on
  // the first attempt — WhatsApp shows a "Your message was not sent" dialog (or a red
  // "!" retry badge on the bubble) even though the compose box cleared. A single
  // "Try Again" tap delivers it (confirmed: the ! turned into ✓✓). Without this the
  // job wrongly reported COMPOSE_FAILED while the message sat un-sent. Handle up to a
  // couple of retries.
  for (let r = 0; r < 2; r++) {
    const t = await h.screenText().catch(() => '');
    // Match EN + TR "not sent" dialogs (Turkish locale showed "gönderilmedi"/
    // "Mesajınız gönderilmedi" → a false SENT before this widened the pattern).
    if (!/message was not sent|not sent|gönderilemedi|gönderilmedi|iletilemedi/i.test(t)) break;
    // "Try Again" / "Tekrar Dene" button on the "not sent" dialog.
    if (!(await h.tapSynIf('Try Again', 'text')) && !(await h.tapSynIf('Tekrar Dene', 'text'))) {
      await h.tapIf('Try Again').catch(() => undefined);
    }
    await h.sleep(4000);
  }

  // Final confirmation if the loop couldn't confirm (null path): one more dump.
  // ★2026-07-23 (C-2): STRONGER SENT proof. "Compose box cleared" is NECESSARY but NOT
  // SUFFICIENT: a stray tap landing on the mic/another field, an ANR "Wait" dismissal, or
  // WhatsApp auto-clearing the draft on a screen change all empty the box WITHOUT the
  // message going out → a false SENT (operator sees "gönderildi", recipient gets nothing).
  // So when the box cleared, still require a positive outgoing-bubble sighting; give it a
  // short grace for slow devices before deciding. Only fall back to box-cleared-alone if
  // the bubble check itself is unreadable (dump keeps failing) — never claim SENT purely
  // from an empty box when we CAN read the thread and no bubble is there.
  if (!sent) {
    const still = await composeStillFull();
    if (still === false) {
      // Box cleared — now demand positive proof via the outgoing bubble (with grace).
      let bubble = await outgoingBubbleAppeared().catch(() => null);
      if (bubble !== true) { await h.sleep(1500); bubble = await outgoingBubbleAppeared().catch(() => null); }
      if (bubble === true) sent = true;
      else if (bubble === null) sent = true; // bubble unreadable (blank dump) → box-cleared is best evidence we have
      // bubble === false (thread readable, NO bubble) → do NOT claim SENT; fall through to failure/receipt paths
    } else if (still === null && await outgoingBubbleAppeared()) {
      // Box read inconclusive but a visible outgoing bubble with our text = positive proof.
      sent = true;
    }
  }
  // After a Try-Again, re-check delivery: if the compose box is empty AND no "not
  // sent" dialog remains, treat as sent.
  if (!sent) {
    const t = await h.screenText().catch(() => '');
    if (!/message was not sent|gönderilemedi|gönderilmedi|iletilemedi/i.test(t) && (await composeStillFull()) === false) sent = true;
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
  // ── BAN-RISK MITIGATION: leave the chat after sending ────────────────────────
  // Staying on the Conversation screen keeps WhatsApp foregrounded, which (a) shows
  // the account as "online" continuously — a dead giveaway for an always-on bot —
  // and (b) auto-marks any incoming reply as READ (blue ticks) the instant it
  // arrives, since the chat is open. Pressing HOME backgrounds WhatsApp: it stops
  // reporting "online", and with no chat open incoming replies are NOT auto-read
  // (no blue ticks) — yet inbound capture keeps working because it reads from the
  // notification shade (dumpsys), not the open chat. The app stays resident so the
  // NEXT send is still warm (no cold-start penalty). Best-effort; never fails a send.
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']).catch(() => undefined);
  tlog('SENT (+HOME: çevrimiçi/okundu gizlendi)');
  // Remember the number + time so a later passive receipt read (pushOutgoingReceipt)
  // can report against the phone number the API matches on, AND its attribution guard
  // can confirm the open chat is still the one we sent to. peerName is filled in by the
  // receipt reader when the title matches (saved-contact case); null here is fine.
  waLastSentPeer.set(serial, { to, at: Date.now(), peerName: null });
  waReceiptState.delete(serial); // new send → allow this chat's DELIVERED/READ to re-fire
  return { status: 'SENT', to, message };
}

// ── Telegram: runtime package detection ─────────────────────────────────────
//
// Telegram's package name is NOT fixed — it depends on where the APK came from:
//   org.telegram.messenger      Play Store build
//   org.telegram.messenger.web  direct-APK build (telegram.org website)
//   org.thunderdog.challegram   Telegram X
// so we NEVER hard-code it. `pm list packages | grep telegram` at runtime finds the
// one actually installed (preferring the official messenger over Telegram-X when both
// are present). Cached per serial — the installed set doesn't change within a session.
// Returns null if no Telegram build is installed (caller reports NOT_INSTALLED).
const tgPkgCache = new Map();
async function detectTelegramPkg(serial) {
  if (tgPkgCache.has(serial)) return tgPkgCache.get(serial);
  let pkg = null;
  try {
    const out = await adb(serial, ['shell', 'pm', 'list', 'packages']);
    const pkgs = out
      .split('\n')
      .map((l) => l.replace(/^package:/, '').trim())
      .filter(Boolean);
    // Preference order: official messenger (+ .web variant) first, then Telegram-X.
    const prefer = [
      'org.telegram.messenger',
      'org.telegram.messenger.web',
      'org.thunderdog.challegram'
    ];
    pkg = prefer.find((c) => pkgs.includes(c)) || pkgs.find((p2) => /telegram|thunderdog\.challegram/i.test(p2)) || null;
  } catch {
    /* pm list failed — leave pkg null; caller reports NOT_INSTALLED */
  }
  tgPkgCache.set(serial, pkg);
  return pkg;
}

// ── Telegram: first-launch priming (post-install / pre-register) ─────────────
//
// Runs ONCE after Telegram is installed (from the provision `apks` step) to leave
// the app in a clean, automation-ready state BEFORE any register/send job touches it.
// It does everything that does NOT depend on a logged-in account:
//   1) Pre-grant runtime permissions over ADB (NOT lxc-attach: `pm grant` needs the
//      Binder caller identity — the same reason the a11y/keyboard step uses ADB). If a
//      permission dialog pops mid-register it overlays the phone/code field and stalls
//      the flow, so we grant them up front exactly like registerTelegram's TG_PERMS.
//   2) Lift restricted SMS appops as root so Telegram can AUTO-READ its own login SMS
//      (a clean number then often needs NO operator OTP — Telegram fills the code itself).
//   3) Cold-open the app once so first-run heavy init (DB create, emoji/resource unpack)
//      happens now, not on the register job's clock; clear the cold-open ANR if one pops.
//   4) Turn ON in-app notification message PREVIEWS via the app's SharedPreferences so
//      inbound-message polling (dumpsys notification) sees the sender + text, not just
//      "Telegram: New message". Best-effort — needs root to write the app's prefs file.
//   5) Leave the device on HOME (never in Telegram's foreground) so the live screen shows
//      the launcher, mirroring how the Magisk step force-stops itself.
// Everything is best-effort and idempotent: safe to re-run, and never throws (a failure
// here must not fail provision — Telegram is an OPTIONAL app). Returns a short status.
//
// ★a11y note: the com.fleet.a11y service is package-AGNOSTIC — its SET_TEXT/CLICK
// broadcasts act on whatever window currently has accessibility focus (the FleetA11y
// service is registered for all packages), so it drives Telegram's custom EditTexts the
// same way it drives WhatsApp's. No Telegram-specific a11y wiring is needed; the generic
// waHelpers() (dump/tap/type/a11y*/screenText) already work against Telegram (registerTelegram
// and telegramSend both rely on exactly this). This priming step therefore needs no a11y
// taps at all — it only pre-grants perms + primes prefs so the LATER a11y-driven flows land.
async function primeTelegram(serial) {
  const TG_PKG = await detectTelegramPkg(serial);
  if (!TG_PKG) return { status: 'NOT_INSTALLED' };

  // 1) Runtime permissions — same set registerTelegram pre-grants (POST_NOTIFICATIONS for
  //    the notification previews we enable below; SMS for code auto-read; contacts/phone
  //    so the add-contact/resolve paths don't prompt). `pm grant` is a no-op for perms the
  //    package doesn't declare, so an over-broad list is harmless.
  const TG_PERMS = [
    'POST_NOTIFICATIONS', 'READ_CONTACTS', 'WRITE_CONTACTS', 'GET_ACCOUNTS',
    'READ_PHONE_STATE', 'READ_PHONE_NUMBERS', 'CALL_PHONE',
    'CAMERA', 'RECORD_AUDIO', 'RECEIVE_SMS', 'READ_SMS',
    'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION',
    'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE',
    'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO'
  ];
  for (const short of TG_PERMS) {
    await adb(serial, ['shell', 'pm', 'grant', TG_PKG, `android.permission.${short}`]).catch(() => undefined);
  }
  // 2) Restricted SMS appops (root) — lets Telegram read its own login SMS.
  for (const op of ['RECEIVE_SMS', 'READ_SMS', 'READ_PHONE_NUMBERS']) {
    await adbSu(serial, `appops set ${TG_PKG} ${op} allow`).catch(() => undefined);
  }

  // 3) Cold-open once so first-run init amortizes here, then clear any cold-open ANR.
  const h = waHelpers(serial);
  await launchApp(serial, TG_PKG, null).catch(() => undefined);
  // Give first-run a moment; poll for the welcome/phone UI (bounded, like registerTelegram).
  let rendered = false;
  for (let i = 0; i < 8 && !rendered; i++) {
    await h.sleep(700);
    const txt = await h.screenText().catch(() => '');
    if (/Start Messaging|Continue in|Your phone|phone number|Enter code|Your Name|telegram/i.test(txt)) rendered = true;
    if (!rendered && i % 3 === 2) await clearAnrDialog(serial, h, 1).catch(() => undefined);
  }
  await clearAnrDialog(serial, h, 1).catch(() => undefined);

  // 4) Notification message previews ON via SharedPreferences (root). Telegram stores the
  //    global preview toggle in userconfing / mainconfig; the widely-stable key across
  //    builds is "EnablePreviewAll" (Notifications → default "Message Preview") in the
  //    app's default prefs XML. We only FLIP it to true if the prefs dir exists — writing a
  //    malformed XML would wipe settings, so we do an in-place sed that no-ops when absent.
  //    Best-effort: if root/sed is unavailable the register flow still works, previews just
  //    stay at Telegram's default (which is already ON for most builds — this hardens it).
  const prefsGlob = `/data/data/${TG_PKG}/shared_prefs/Notifications.xml`;
  await adbSu(serial,
    // Only rewrite if the file exists AND already contains the key (never create/append —
    // a partial XML corrupts prefs). Flip an existing false→true; leave everything else.
    `f=${prefsGlob}; [ -f "$f" ] && grep -q 'EnablePreviewAll' "$f" && ` +
    `sed -i 's/name="EnablePreviewAll" value="false"/name="EnablePreviewAll" value="true"/' "$f" || true`
  ).catch(() => undefined);

  // 5) Leave HOME — never keep Telegram in the foreground on the live screen.
  await adb(serial, ['shell', 'am', 'force-stop', TG_PKG]).catch(() => undefined);
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']).catch(() => undefined);

  return { status: 'PRIMED', pkg: TG_PKG, rendered };
}

// ── Telegram: send a message ────────────────────────────────────────────────
//
// Mirrors whatsappSend. Telegram exposes a deep link that resolves a phone number:
//   tg://resolve?phone=<digits>&text=<urlencoded>
// (leading "+" is stripped internally; LaunchActivity.java:2298-2307,2363).
//
// ★IMPORTANT deep-link semantics (verified against LaunchActivity.findContacts,
//  master): the phone param resolves ONLY against the account's SAVED contacts
//  (contactsByPhone / contactsByShortPhone, LaunchActivity.java:5892-5908). Behaviour:
//   • Number IS a saved contact → the private chat opens and &text= is applied as the
//     compose-box DRAFT (not auto-sent — like WhatsApp we must tap Send).
//   • Number is NOT a saved contact → NO chat opens. Telegram shows the "New contact"
//     flow instead — either a NewContactBottomSheet add-contact form, or a
//     "New contact / Phone number %s is not in your contacts list. Do you want to add
//     it?" alert (NewContactAlert*, LaunchActivity.java:3272-3293). The &text= is
//     DISCARDED on this path — there is no compose box to fill.
//  ⇒ To DM an arbitrary number reliably, that number must first be a contact on the
//  logged-in account. When it isn't, we detect the add-contact wall (no EditText compose
//  box appears; the FirstName/"Add contact"/"is not in your contacts list" screen shows)
//  and report NOT_A_CONTACT rather than blind-tapping the add-contact form.
//
// As with WhatsApp, Telegram does NOT auto-send: the pre-filled text is only a draft,
// so we must tap the Send button once the chat is open.
//
// ★MAPPED from DrKLO/Telegram source (org.telegram.messenger, master). Unlike WhatsApp,
// Telegram assigns NO resource-ids to the compose box or the send button — there is no
// setId() call anywhere in ChatActivityEnterView.java. Both are identified purely by
// class + content-desc, which are STABLE across builds/locales:
//   • Send button  = SendButton (a raw `View`, NOT a Button subclass), so in a
//     `uiautomator dump` it appears as class="android.view.View" with
//     content-desc = getString(R.string.Send)  (ChatActivityEnterView.java:3463).
//     → EN "Send" / TR "Gönder". NO resource-id.
//   • Compose box  = ChatActivityEditTextCaption → EditTextCaption → EditTextBoldCursor
//     → EditTextEffects → EditText, so it dumps as class="android.widget.EditText"
//     with hint = getString(R.string.TypeMessage) (== "Message" / "Mesaj"). NO resource-id.
//   • ★CRITICAL: when the compose box is EMPTY, Telegram HIDES the send button and shows
//     the voice/video record button in the SAME bottom-right slot — content-desc =
//     getString(R.string.AccDescr{Voice,Video}Message) ("Record voice/video message")
//     (ChatActivityEnterView.java:6122-6123). Blind-tapping that slot when the box is
//     empty starts a voice recording. So we (a) only ever tap after confirming the draft
//     is in the box, and (b) EXCLUDE the record button by content-desc when picking the
//     coordinate fallback. See VOICE_DESCS below.
// The COORDINATE fallback (send FAB ≈ bottom-right, like WA) is only used when the
// content-desc node isn't found AND the record button isn't occupying that slot, so the
// flow degrades gracefully without ever hitting the mic.
//
// payload: { to (E.164 digits, no +), message }
async function telegramSend(serial, payload) {
  const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
  const message = String(p(payload, 'message', ''));
  if (!to) throw new Error('to (telefon numarası) gerekli');
  if (!message) throw new Error('message gerekli');

  const h = waHelpers(serial); // same generic tap/type/dump/a11y helper set
  const T0 = Date.now();
  const tlog = process.env.FLEET_SEND_TIMING === '1'
    ? (label) => console.error(`  [tg-send] ${label}: +${Date.now() - T0}ms`)
    : () => {};

  // Which Telegram build is installed? (runtime-detected, never assumed)
  const TG_PKG = await detectTelegramPkg(serial);
  if (!TG_PKG) {
    return { status: 'NOT_INSTALLED', note: 'Cihazda Telegram yüklü değil', to };
  }
  tlog(`pkg=${TG_PKG}`);

  // Guarantee real touch (heals vtouch after reboot) and a reliable IME — same as WA.
  await h.ensureTouch();
  tlog('ensureTouch');
  await h.ensureAdbKeyboard();
  tlog('ensureAdbKeyboard');

  // ── Node identifiers (VERIFIED from DrKLO/Telegram source — no resource-ids exist). ──
  // compose box  = class android.widget.EditText, hint R.string.TypeMessage. No id.
  // send button  = class android.view.View, content-desc R.string.Send. No id.
  // We FIND the send button by content-desc first, then fall back to the bottom-right
  // coordinate (identical strategy to whatsappSend's sendNode → scaled-coord fallback).
  // (4) SEND-BUTTON TWO VARIANTS. The slot at the end of the input bar renders ONE of two
  //     controls depending on state, and both must be recognized:
  //   • VARIANT A — SEND FAB (the normal case): a paper-plane View, content-desc
  //       R.string.Send  → "Send" (EN) / "Gönder" (TR). This is what a fresh draft shows.
  //   • VARIANT B — DONE / CHECK icon: when the compose box is in EDIT mode (editing a
  //       previously-sent message) OR on some builds/skins the send affordance is a
  //       checkmark, content-desc R.string.Done  → "Done" (EN) / "Bitti"/"Tamam" (TR),
  //       sometimes R.string.Save ("Save"/"Kaydet"). tg://resolve never opens edit mode,
  //       but including these makes the tap resilient to skins/forks (e.g. Telegram-X,
  //       Nekogram) that relabel the send control — safe because we still exclude VOICE.
  const SEND_DESCS = ['Send', 'Gönder', 'Gonder', 'Done', 'Bitti', 'Tamam', 'Save', 'Kaydet']; // R.string.Send / R.string.Done|Save per locale
  const SEND_PRIMARY = ['Send', 'Gönder', 'Gonder']; // the FAB desc — matched first, before the Done/Save fallbacks
  // ★The record button occupies the SAME slot when the box is empty — content-desc
  // R.string.AccDescr{Voice,Video}Message. Never tap it: used to VETO the coord fallback.
  const VOICE_DESCS = ['Record voice message', 'Record video message', 'Sesli mesaj', 'Görüntülü mesaj', 'voice message', 'video message'];

  // ── (5) MULTI-LINE / EMOJI / TURKISH-safe compose typing ──────────────────────
  // The shared h.typeText() sends the raw string through `am broadcast --es msg`.
  // Two hazards for rich message bodies that this local helper handles:
  //   • NEWLINES: a literal '\n' inside `am broadcast … --es msg '…\n…'` truncates the
  //     argument at the newline (the device sh treats it as a command separator even
  //     inside single quotes for `am`'s arg tokenizer), so only the FIRST line survives
  //     and — worse — the tail can be interpreted as a stray shell token. So we type the
  //     body line-by-line: each line via the IME broadcast, and between lines inject a
  //     soft newline with KEYCODE_ENTER (66). In Telegram's compose box ENTER inserts a
  //     newline (it does NOT send — send is a discrete button), so the draft keeps its
  //     line breaks and we still control the send ourselves.
  //   • EMOJI / non-ASCII (Turkish ç/ğ/ı/ö/ş/ü, 🎉): `input text` DROPS these (ASCII-only),
  //     but the ADBKeyboard `ADB_INPUT_TEXT` broadcast commits the UTF-8 string intact.
  //     We therefore REQUIRE ADBKeyboard for any non-ASCII body and fail loudly
  //     (COMPOSE_FAILED) rather than silently sending a mangled, emoji-stripped message.
  const hasNonAscii = /[^\x00-\x7F]/.test(message);
  const adbKbOk = await h.ensureAdbKeyboard(); // idempotent; already called above, cached
  // Type `body` into the currently-focused compose box, preserving line breaks and unicode.
  const typeRichBody = async (body) => {
    const lines = String(body).split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        // Soft newline inside the compose box (Telegram ENTER = newline, not send).
        await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_ENTER']).catch(() => undefined);
        await h.sleep(120);
      }
      if (lines[i].length === 0) continue; // blank line already handled by the ENTER above
      await h.typeText(lines[i]); // routes via ADBKeyboard broadcast (UTF-8 safe) when active
      await h.sleep(180);
    }
  };

  // Open the chat via the tg:// deep link with the text pre-filled. Single-quote the
  // -d value (shArg) so encoded metacharacters in the message (&, ), etc.) pass through
  // the device sh literally — exactly the bug whatsappSend guards against.
  // encodeURIComponent already percent-escapes newlines/emoji/Turkish for the URL, so the
  // deep-link pre-fill path itself is unicode-safe; the risk is only when a build ignores
  // &text= and we fall back to typing (handled by typeRichBody above).
  const url = `tg://resolve?phone=${to}&text=${encodeURIComponent(message)}`;
  await adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', shArg(url), TG_PKG]).catch(() => undefined);

  // Wait for the chat to actually open. Telegram's compose EditText appearing is the
  // signal the chat rendered. Poll (like WA's id/entry poll) and clear any ANR that
  // pops over the cold open. We detect the compose box by class=EditText (id unknown).
  // Compose box has NO resource-id (verified) → detect by class android.widget.EditText.
  // The chat screen has exactly one EditText (the message field); prefer the one whose
  // hint/text looks like the message field ("Message"/"Mesaj") and, to avoid latching the
  // New-contact form's First/Last-name EditTexts, ignore ones sitting in the top half.
  const findComposeBox = async (nodesIn) => {
    const nodes = nodesIn || await h.dump().catch(() => []);
    const edits = nodes.filter((n) => /(^|\.)EditText$/i.test(n.cls || '') && n.cx > 0 && n.cy > 0);
    if (edits.length === 0) return null;
    // The message field sits in the bottom input bar → largest cy wins on ties.
    const looksLikeMsg = (n) => /message|mesaj|type a message/i.test(`${n.text || ''} ${n.desc || ''}`);
    return edits.find(looksLikeMsg)
      || edits.slice().sort((a, b) => b.cy - a.cy)[0]
      || null;
  };
  let composeBox = null;
  for (let i = 0; i < 9 && !composeBox; i++) {
    await h.sleep(500);
    composeBox = await findComposeBox();
    if (!composeBox && i % 2 === 1 && await clearAnrDialog(serial, h, 1)) await h.sleep(700);
  }
  tlog(`chat opened (compose poll)=${Boolean(composeBox)}`);

  // Last-chance ANR recovery (an ANR can re-pop and hide the box), same as WA.
  if (!composeBox) {
    if (await clearAnrDialog(serial, h, 3)) {
      await h.sleep(1000);
      for (let i = 0; i < 6 && !composeBox; i++) {
        await h.sleep(500);
        composeBox = await findComposeBox();
      }
      tlog(`chat opened after ANR recovery=${Boolean(composeBox)}`);
    }
  }

  // The compose box never appeared → Telegram landed on a non-chat screen. Read it
  // ONCE (rich = text + content-desc: several walls are alert BUTTONS whose label lives
  // in content-desc) and report the real reason instead of blind-tapping (WA scenario #6).
  if (!composeBox) {
    const notice = await h.screenTextRich().catch(() => '');
    // (6) ★FLOOD-WAIT FIRST — it can co-occur with a spam bulletin, and it's the one wall
    // that carries a retry-after we want to surface. Exact strings (values/strings.xml):
    //   R.string.FloodWait          "Too many attempts, please try again later."
    //   R.string.FloodWaitTime      "Too many attempts. Please try again in %1$s."
    //   R.string.NobodyLikesSpam2 / login FLOOD_WAIT_%d bulletins.
    // Extract the retry-after ("N seconds/minutes/hours") when Telegram prints it.
    if (/too many attempts|too many tries|please try again in|FLOOD_?WAIT|flood control|çok fazla deneme|daha sonra tekrar deneyin|lütfen .* sonra/i.test(notice)) {
      const m = /(\d+)\s*(hour|hr|minute|min|second|sec|saat|dakika|dk|saniye|sn)/i.exec(notice);
      return {
        status: 'FLOOD_WAIT',
        note: `Telegram hız sınırı (flood-wait): çok fazla deneme — ${m ? `${m[1]} ${m[2]}` : 'bir süre'} sonra tekrar deneyin`,
        to,
        ...(m ? { retryAfter: `${m[1]} ${m[2]}` } : {}),
        screenTexts: notice.slice(0, 400)
      };
    }
    // ★Most common wall (VERIFIED): the number is NOT a saved contact, so tg://resolve
    // opened the "New contact" add-contact flow instead of a chat. Exact strings from
    // NewContactAlert*/NewContactBottomSheet (values/strings.xml):
    //   "Phone number %s is not in your contacts list. Do you want to add it?"
    //   title "New contact", button "Add contact"; the sheet shows "First name (required)".
    // Detect it and report NOT_A_CONTACT — to DM this number, add it as a contact first.
    if (/not in your contacts list|add contact|new contact|first name \(required\)|rehber(iniz)?e ekle|kişilerinizde (yok|kayıtlı değil)|yeni kişi/i.test(notice)) {
      return { status: 'NOT_A_CONTACT', note: 'Numara bu hesabın kişilerinde kayıtlı değil — Telegram DM için önce kişi olarak eklenmeli (tg://resolve?phone yalnızca kayıtlı kişiyle sohbet açar)', to, screenTexts: notice.slice(0, 400) };
    }
    // (1) INVALID_RECIPIENT — the number has NO Telegram account at all. Strings:
    //   R.string.NoUsersFound "No users found." / MTProto PHONE_NOT_OCCUPIED /
    //   USERNAME_NOT_OCCUPIED / "isn't on Telegram" contact-import bulletins.
    if (/not on telegram|isn.t on telegram|no telegram account|no users found|phone.{0,12}(not|isn.t).{0,12}(found|registered|occupied)|USERNAME_NOT_OCCUPIED|PHONE_NOT_OCCUPIED|kullanıcı bulunamadı|Telegram'da (yok|değil|kayıtlı değil)|Telegram kullanmıyor/i.test(notice)) {
      return { status: 'INVALID_RECIPIENT', note: 'Numara Telegram\'da kayıtlı değil (hesabı yok) — mesaj gönderilemez', to, screenTexts: notice.slice(0, 400) };
    }
    // (2) BLOCKED — the user exists but privacy/spam rules forbid messaging them. Strings:
    //   R.string.PrivacyMessagesRestrictedByThisUser "This user doesn't accept messages…"
    //   "You can't send messages to this user." / USER_PRIVACY_RESTRICTED / PEER_FLOOD /
    //   USER_IS_BLOCKED / "You were blocked".
    if (/can.t send messages|doesn.t accept (messages|new messages)|only accept messages from|USER_PRIVACY_RESTRICTED|PEER_FLOOD|USER_IS_BLOCKED|you were blocked|privacy|engellendi(niz)?|mesaj (kabul etmiyor|gönderemezsiniz)|gizlilik/i.test(notice)) {
      return { status: 'BLOCKED', note: 'Telegram bu kullanıcıya mesaj göndermeyi engelledi (kullanıcının gizlilik ayarları / spam koruması / engelleme)', to, screenTexts: notice.slice(0, 400) };
    }
    // Not logged in / no account on this Telegram → can't send.
    if (/log in|sign in|your phone number|start messaging|giriş yap|numaranızı/i.test(notice)) {
      return { status: 'NOT_LOGGED_IN', note: 'Bu cihazda Telegram oturumu açık değil', to, screenTexts: notice.slice(0, 400) };
    }
    return { status: 'CHAT_NOT_OPENED', note: 'Sohbet ekranı açılamadı (mesaj kutusu görünmedi)', to, screenTexts: notice.slice(0, 400) };
  }

  // Clear any ANR that popped while opening, so the sweep below sees the real UI.
  await clearAnrDialog(serial, h, 2);
  tlog('anr sweep (post-open)');

  // ── (3) DRAFT PRE-FILL VERIFY + IME SELF-HEAL ─────────────────────────────────
  // The deep link pre-fills the compose box, but some Telegram builds IGNORE the &text=
  // param (they silently open an EMPTY chat). So: read the box; if our message isn't
  // there, type it via the reliable IME path (typeRichBody = newline/emoji/Turkish-safe).
  // (whatsappSend can rely on wa.me always pre-filling; tg:// is less consistent, so we
  //  verify + self-heal here.)
  // The verify needle uses the FIRST LINE (up to 12 chars) — the deep-link path and the
  // dump both surface the whole body as box.text, but line breaks/emoji can shift byte
  // offsets, so comparing on a short ASCII-ish prefix of line 1 is the most robust probe.
  const firstLine = (message.split(/\r\n|\r|\n/)[0] || '').trim();
  const needle = firstLine || message.trim();
  // Probe = first 12 chars of line 1 with any trailing non-ASCII trimmed (a multi-byte
  // char can be split by the dump), so the includes() check doesn't fail on a clean fill.
  const probe = needle.slice(0, 12).replace(/[^\x00-\x7F]+$/, '') || needle.slice(0, 4);
  {
    const box = await findComposeBox();
    const cur = (box && (box.text ?? '')) || '';
    const prefilled = probe.length > 0 && cur.includes(probe);
    if (!prefilled) {
      // (5)+(3) GUARD: the body has emoji/Turkish/non-ASCII but ADBKeyboard is NOT the
      // active IME → `input text` would DROP those chars and send a mangled/empty message.
      // Fail loudly instead of silently corrupting the outgoing text.
      if (hasNonAscii && !adbKbOk) {
        return {
          status: 'COMPOSE_FAILED',
          note: 'Mesaj emoji/Türkçe/özel karakter içeriyor ama ADBKeyboard IME aktif değil — düz `input text` bu karakterleri düşürür; gönderim iptal edildi (cihaza ADBKeyboard kurulmalı)',
          to,
          reason: 'NON_ASCII_NO_IME'
        };
      }
      // Focus the box and type. typeRichBody routes through ADBKeyboard when active and
      // preserves line breaks (KEYCODE_ENTER between lines) + UTF-8 (emoji/Turkish).
      if (box) { await h.tapNode(box); await h.sleep(500); }
      await h.clearField().catch(() => undefined);
      await typeRichBody(message);
      await h.sleep(500);
      // Re-verify the self-heal actually landed text — if the box is STILL empty the field
      // rejected input entirely (rare on redroid), so don't fall through to a blind send.
      const box2 = await findComposeBox();
      const cur2 = (box2 && (box2.text ?? '')) || '';
      const filled2 = cur2.trim().length > 0 && (probe.length === 0 || cur2.includes(probe) || cur2.trim().length >= Math.min(4, needle.length));
      if (!filled2) {
        return {
          status: 'COMPOSE_FAILED',
          note: 'Mesaj kutusu doldurulamadı (deep-link &text= yok sayıldı ve IME yazımı da tutmadı) — gönderim iptal edildi',
          to,
          screenTexts: (await h.screenText().catch(() => '')).slice(0, 300)
        };
      }
      tlog('compose self-filled (deep-link text was empty)');
    }
  }

  // ── Locate the Send button. Prefer the content-desc node, else coordinate fallback. ──
  // The SendButton lives in a 100dp-wide, right+bottom-gravity container at the end of the
  // input bar (ChatActivityEnterView.java:3468), so it sits at the bottom-right, like
  // WhatsApp's. Compute the scaled blind coordinate up front (used when no node is found).
  let sw = 720, sh = 1280;
  try {
    const wm = await adb(serial, ['shell', 'wm', 'size']);
    const ov = /Override size:\s*(\d+)x(\d+)/.exec(wm);
    const ph = /Physical size:\s*(\d+)x(\d+)/.exec(wm);
    const m = ov || ph || /(\d+)x(\d+)/.exec(wm);
    if (m) { sw = Number(m[1]) || sw; sh = Number(m[2]) || sh; }
  } catch { /* keep defaults */ }
  // Send FAB centre ≈ 92% width (100dp container hugs the right edge with a small margin)
  // and ≈ 96% height (the input bar is the last row above the nav bar). WhatsApp used
  // ~93%/~91.5%; Telegram's bar sits slightly lower, hence 96%.
  const sendX = Math.round(sw * 0.92);
  const sendY = Math.round(sh * 0.96);

  let sendNode = null;
  let recordInSlot = false;
  {
    const nodes = await h.dump().catch(() => []);
    // Send button has NO resource-id — it carries content-desc R.string.Send. Match the
    // desc exactly (== "send"/"gönder") so we never latch a "Send as…"/"Scheduled" control.
    for (const d of SEND_DESCS) {
      const n = nodes.find((x) => (x.desc || '').trim().toLowerCase() === d.toLowerCase() && x.cx > 0 && x.cy > 0);
      if (n) { sendNode = n; break; }
    }
    // ★VETO: if the record (voice/video) button is what's occupying the send slot, the
    // draft never made it into the box → tapping the coordinate would start a recording.
    if (!sendNode) {
      recordInSlot = VOICE_DESCS.some((d) => nodes.some((x) => (x.desc || '').toLowerCase().includes(d.toLowerCase())));
    }
  }
  if (!sendNode && recordInSlot) {
    // The send button isn't present and the mic is in its place → the compose box is empty
    // in Telegram's eyes. Report rather than blind-tap the mic (mirrors WA empty-box guard).
    return {
      status: 'COMPOSE_FAILED',
      note: 'Gönder butonu görünmüyor (mesaj kutusu boş sayılıyor; kayıt/mikrofon butonu yerinde) — gönderim iptal edildi',
      to,
      screenTexts: (await h.screenText().catch(() => '')).slice(0, 300)
    };
  }
  const tapX = sendNode ? Math.round(sendNode.tapX ?? sendNode.cx) : sendX;
  const tapY = sendNode ? Math.round(sendNode.tapY ?? sendNode.cy) : sendY;
  tlog(`send button ${sendNode ? '[desc found]' : '[coord fallback]'} @${tapX},${tapY}`);

  // Confirm-before-retry loop, identical strategy to whatsappSend: a SYNTHETIC tap on
  // the send button, then check whether the compose box CLEARED (= sent). Telegram
  // clears the box on send; if it's still full we retry once. At most 2 taps so a
  // stray tap on an empty box doesn't trigger the voice-record button.
  const composeStillFull = async () => {
    if (await clearAnrDialog(serial, h, 2)) await h.sleep(400);
    const box = await findComposeBox();
    if (!box) return null; // couldn't read → unknown
    return (box.text ?? '').includes(needle.slice(0, 12));
  };
  const waitCleared = async (capMs) => {
    const start = Date.now();
    for (;;) {
      const still = await composeStillFull();
      if (still === false) return false;             // cleared → sent
      if (Date.now() - start >= capMs) return still; // true (full) or null (unknown)
      await h.sleep(350);
    }
  };
  let sent = false;
  for (let attempt = 0; attempt < 2 && !sent; attempt++) {
    await adb(serial, ['shell', 'input', 'tap', String(tapX), String(tapY)]); // synthetic (reliable for FAB)
    const still = await waitCleared(1500);
    tlog(`send tap ${attempt} @${tapX},${tapY}${sendNode ? '(desc)' : '(coord)'} + verify (still=${still})`);
    if (still === false) { sent = true; break; }
  }

  // Late spam/invalid wall: Telegram can pop the "can't message this user" alert a beat
  // AFTER we tap send (slow device). Re-check so we return the real reason, not a false SENT.
  {
    const t = await h.screenText().catch(() => '');
    // Post-send walls (from strings.xml): FloodWait "Too many attempts, please try again
    // later", privacy/restriction bulletins, or a late add-contact prompt.
    if (/can.t send messages|not on telegram|USERNAME_NOT_OCCUPIED|too many attempts|flood|spam|not in your contacts list|çok fazla|engellendi|daha sonra tekrar/i.test(t)) {
      return { status: 'BLOCKED', note: 'Telegram mesajı reddetti (gizlilik/spam/flood veya numara Telegram\'da değil)', to, screenTexts: t.slice(0, 300) };
    }
  }

  // Final confirmation if the loop couldn't confirm (null path): one more read.
  if (!sent) {
    const still = await composeStillFull();
    if (still === false) sent = true; // box cleared after all → sent
  }

  if (!sent) {
    return {
      status: 'COMPOSE_FAILED',
      note: 'Mesaj gönderilemedi (mesaj kutusu boşalmadı — gönderim doğrulanamadı)',
      to,
      screenTexts: (await h.screenText().catch(() => '')).slice(0, 300)
    };
  }

  // ── BAN-RISK MITIGATION: leave the chat after sending (WhatsApp Fix 9 twin) ───
  // Staying on the chat keeps Telegram foregrounded (shows "online", auto-reads
  // incoming replies). Press HOME so Telegram backgrounds: it stops reporting online
  // and incoming messages aren't auto-marked read. The app stays resident so the next
  // send is warm. Best-effort; never fails a send.
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']).catch(() => undefined);
  tlog('SENT (+HOME: çevrimiçi/okundu gizlendi)');
  return { status: 'SENT', to, message, pkg: TG_PKG };
}

// ── Telegram: read a conversation ───────────────────────────────────────────
//
// Templated on whatsappRead, but Telegram's chat surface is different enough that
// this is NOT a copy — it fixes the two concrete gaps the WhatsApp reader had:
//   (1) whatsappRead reads only what's on ONE screen (no scroll) → misses history.
//   (2) whatsappRead can't tell INCOMING from OUTGOING bubbles (it returns a flat
//       string list) → the receipt/inbound pipeline can't act on direction.
// This reader SCROLLS the history up, DEDUPES across passes, and TAGS each message
// as 'in' | 'out'.
//
// ★★ WHY THE TELEGRAM CHAT IS HARD TO SCRAPE (mapped from DrKLO/Telegram, master):
//   • Messages render in `org.telegram.ui.Cells.ChatMessageCell`, a raw custom `View`
//     (NOT a TextView) that DRAWS its text on a Canvas — so in a `uiautomator dump`
//     the message text is NOT in the node's `text` attribute. It IS exposed via
//     accessibility: ChatMessageCell.onInitializeAccessibilityNodeInfo() builds a
//     content-description from the message ("<sender>\n<text>\n<time>" style), so the
//     bubble dumps as class="android.view.View" with the message in `content-desc`
//     and an EMPTY `text`. ⇒ We read bubbles from `desc`, not `text` (opposite of WA).
//   • NO resource-ids exist on the cells (Telegram sets none), and there is NO in/out
//     flag in the dump. Direction is inferred GEOMETRICALLY: outgoing bubbles are
//     right-gravity, incoming are left-gravity (ChatMessageCell positions the bubble
//     background by `currentMessageObject.isOutOwner()`). The stable signal in the
//     dump is the bubble's horizontal placement: an OUT bubble hugs the right edge
//     (its right edge is near screen-width and it does NOT start at the left margin);
//     an IN bubble starts at the left margin. We classify by which side of screen
//     center the bubble's MIDPOINT sits AND whether it touches the left/right margin,
//     so a wide bubble that crosses center is still classified by the edge it hugs.
//   • The message list is an inverted RecyclerListView (`chatListView`) — newest at the
//     BOTTOM, and scrolling UP (swipe down-gesture) reveals OLDER messages. We start at
//     the bottom (freshly-opened chat), read, then scroll up to page through history.
//
// payload: { to? (E.164 digits — DM opened via tg://resolve, must be a saved contact),
//            from? (contact display name — opens via search),
//            limit? (max messages to return, default 50, cap 200),
//            scrollPages? (how many history pages to page up, default 4, cap 12) }
async function telegramRead(serial, payload) {
  const to = String(p(payload, 'to', '')).replace(/[^\d]/g, '');
  const from = String(p(payload, 'from', '')).trim();
  const limit = Math.min(Math.max(1, Number(p(payload, 'limit', 50)) || 50), 200);
  const scrollPages = Math.min(Math.max(0, Number(p(payload, 'scrollPages', 4)) || 0), 12);

  const h = waHelpers(serial); // same generic tap/type/dump/a11y helper set
  const T0 = Date.now();
  const tlog = process.env.FLEET_SEND_TIMING === '1'
    ? (label) => console.error(`  [tg-read] ${label}: +${Date.now() - T0}ms`)
    : () => {};

  const TG_PKG = await detectTelegramPkg(serial);
  if (!TG_PKG) return { status: 'NOT_INSTALLED', note: 'Cihazda Telegram yüklü değil', to: to || undefined };

  await h.ensureTouch();
  await h.ensureAdbKeyboard();

  // ── Open the chat ───────────────────────────────────────────────────────────
  // Two entry paths, mirroring whatsappRead:
  //   • `to` (phone): tg://resolve?phone deep-link. Like telegramSend, this ONLY opens
  //     a chat if the number is a SAVED CONTACT of the logged-in account — otherwise it
  //     lands on the New-contact flow (no chat, no bubbles). We detect that below.
  //   • `from` (name): open Telegram, use the top search to find the dialog by name and
  //     tap the first result. Telegram's global search field carries content-desc
  //     R.string.Search ("Search" / "Ara"); results are dialog rows in the search list.
  if (to) {
    await adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', shArg(`tg://resolve?phone=${to}`), TG_PKG]).catch(() => undefined);
    await h.sleep(4500);
  } else if (from) {
    await launchApp(serial, TG_PKG, null);
    await h.sleep(4000);
    // Open search (content-desc "Search"/"Ara"), type the name, tap the first hit.
    if (await h.tapIf(['Search', 'Ara'], 'desc')) {
      await h.sleep(900);
      await h.typeText(from);
      await h.sleep(1800);
      // The first search result row carries the contact's name as text/desc → tap it.
      await h.tapBy(from, 'any').catch(() => undefined);
      await h.sleep(3000);
    }
  } else {
    return { status: 'BAD_REQUEST', note: 'to (telefon) veya from (kişi adı) gerekli' };
  }
  await clearAnrDialog(serial, h, 2);

  // ── Confirm a chat actually opened (compose box present), else report the reason ──
  // Reuse the same compose-box detector shape as telegramSend: the message EditText is
  // the signal the Conversation screen rendered. If it never appears we're on a wall
  // (not-a-contact / not-logged-in) — read the screen ONCE and return the real reason
  // instead of scraping an empty/irrelevant screen.
  const hasComposeBox = async () => {
    const nodes = await h.dump().catch(() => []);
    return nodes.some((n) => /(^|\.)EditText$/i.test(n.cls || '') && n.cy > 0);
  };
  let opened = false;
  for (let i = 0; i < 8 && !opened; i++) {
    opened = await hasComposeBox();
    if (!opened) { await h.sleep(600); if (i % 2 === 1) await clearAnrDialog(serial, h, 1); }
  }
  tlog(`chat opened=${opened}`);
  if (!opened) {
    const notice = await h.screenText().catch(() => '');
    if (/not in your contacts list|add contact|new contact|first name \(required\)|rehber(iniz)?e ekle|kişilerinizde (yok|kayıtlı değil)|yeni kişi/i.test(notice)) {
      return { status: 'NOT_A_CONTACT', note: 'Numara bu hesabın kişilerinde kayıtlı değil — Telegram sohbeti yalnızca kayıtlı kişiyle açılır (tg://resolve?phone). Okumak için önce kişi olarak ekleyin', to: to || undefined, screenTexts: notice.slice(0, 400) };
    }
    if (/log in|sign in|your phone number|start messaging|giriş yap|numaranızı/i.test(notice)) {
      return { status: 'NOT_LOGGED_IN', note: 'Bu cihazda Telegram oturumu açık değil', to: to || undefined, screenTexts: notice.slice(0, 400) };
    }
    return { status: 'CHAT_NOT_OPENED', note: 'Sohbet ekranı açılamadı (mesaj kutusu görünmedi)', to: to || undefined, from: from || undefined, screenTexts: notice.slice(0, 400) };
  }

  // ── Screen geometry, for the direction (in/out) classifier + scroll gesture ──
  const { sw, sh } = await wmSize(serial);
  const centerX = sw / 2;

  // ── Bubble extraction from one dump ──────────────────────────────────────────
  //
  // A message bubble is a ChatMessageCell → dumps as class android.view.View with the
  // message in `content-desc` (see header). We keep only nodes that:
  //   • have a non-trivial content-desc,
  //   • sit in the message LIST band (below the toolbar, above the input bar) — this
  //     drops the toolbar title, the "typing…" subtitle, and the compose-box hint,
  //   • aren't the compose EditText (that's a real widget, class EditText, excluded).
  // Direction: OUT hugs the RIGHT margin, IN hugs the LEFT margin. We decide by the
  // bubble's midpoint side AND its nearest-edge gap, so a bubble wider than half the
  // screen is still classified by the margin it touches.
  const TOOLBAR_Y = Math.round(sh * 0.10);   // below the chat toolbar (avatar/name row)
  const INPUTBAR_Y = Math.round(sh * 0.86);  // above the compose/input bar
  const MARGIN = Math.round(sw * 0.06);       // ~6% edge gutter Telegram leaves per side
  // Metadata-only a11y strings we must NOT treat as message text (localized).
  const META_RE = /^(typing|online|last seen|seen recently|çevrimiçi|yazıyor|son görülme|bugün|today|yesterday|dün)\b/i;
  const extractBubbles = (nodes) => {
    const out = [];
    for (const n of nodes) {
      const desc = (n.desc || '').trim();
      if (!desc || desc.length < 1) continue;
      if (/(^|\.)EditText$/i.test(n.cls || '')) continue;      // compose box
      const [x1, y1, x2] = n.bounds;
      const cy = n.cy;
      if (cy <= TOOLBAR_Y || cy >= INPUTBAR_Y) continue;        // chrome, not a bubble
      // A ChatMessageCell dumps as View/ViewGroup; skip obvious non-cell chrome by
      // requiring the node carry real message-like content, not a bare status word.
      if (META_RE.test(desc)) continue;
      // Direction: which margin does the bubble hug?
      const leftGap = x1 - 0;
      const rightGap = sw - x2;
      const mid = (x1 + x2) / 2;
      let dir;
      if (leftGap <= MARGIN && rightGap > MARGIN) dir = 'in';        // pinned left → incoming
      else if (rightGap <= MARGIN && leftGap > MARGIN) dir = 'out';  // pinned right → outgoing
      else dir = mid < centerX ? 'in' : 'out';                       // fall back to midpoint side
      // The a11y desc can carry a trailing time/status ("… 12:34" / "… Read"); keep the
      // whole desc as the message (callers can strip), but use a normalized key for dedup
      // so the same bubble re-seen after a scroll (with a jittered time suffix) collapses.
      out.push({ dir, text: desc, y: cy, key: `${dir}:${desc.replace(/\s+/g, ' ').trim()}` });
    }
    // Top-to-bottom on screen (older→newer within this viewport).
    out.sort((a, b) => a.y - b.y);
    return out;
  };

  // ── Read the visible viewport, then page UP through history, deduping. ───────
  // Telegram's list is inverted (newest at the bottom). We're at the bottom on open,
  // so we collect the newest page first, then swipe DOWN (finger down = content up =
  // OLDER messages) to reveal history. Dedup by the normalized key; ORDER is preserved
  // oldest→newest by prepending each older page ahead of what we already have.
  const seenKeys = new Set();
  let ordered = []; // oldest → newest
  const ingest = (bubbles, prepend) => {
    const fresh = [];
    for (const b of bubbles) {
      if (seenKeys.has(b.key)) continue;
      seenKeys.add(b.key);
      fresh.push({ dir: b.dir, text: b.text });
    }
    if (fresh.length === 0) return 0;
    ordered = prepend ? [...fresh, ...ordered] : [...ordered, ...fresh];
    return fresh.length;
  };

  // First (bottom / newest) page.
  ingest(extractBubbles(await h.dump().catch(() => [])), false);
  tlog(`page 0: ${ordered.length} msgs`);

  // Page up through history. A down-swipe in the middle of the list scrolls to OLDER
  // messages (finger drags content downward). Stop early when a page yields no NEW
  // bubbles (reached the top / no more history) or we already have `limit` messages.
  const swipeToOlder = async () => {
    // Swipe within the message band only, so we don't grab the toolbar or input bar.
    const x = Math.round(sw * 0.5);
    const yTop = Math.round(sh * 0.30);
    const yBot = Math.round(sh * 0.72);
    await adb(serial, ['shell', 'input', 'swipe', String(x), String(yTop), String(x), String(yBot), '350']).catch(() => undefined);
    await h.sleep(700); // let the list settle before the next dump
  };
  for (let pg = 1; pg <= scrollPages && ordered.length < limit; pg++) {
    await swipeToOlder();
    await clearAnrDialog(serial, h, 1);
    const added = ingest(extractBubbles(await h.dump().catch(() => [])), true);
    tlog(`page ${pg}: +${added} (total ${ordered.length})`);
    if (added === 0) break; // no new history surfaced → top reached
  }

  // Leave the chat so Telegram backgrounds (don't sit foregrounded auto-reading /
  // showing online) — same ban-risk mitigation telegramSend applies after a send.
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']).catch(() => undefined);

  // Return newest-last, capped to `limit`. `messages` (plain text, newest-last) mirrors
  // whatsappRead's shape for backward compatibility; `items` adds the direction tag.
  const items = ordered.slice(-limit);
  return {
    status: 'OK',
    to: to || undefined,
    from: from || undefined,
    count: items.length,
    messages: items.map((m) => m.text),
    items, // [{ dir:'in'|'out', text }] — direction-tagged, oldest→newest
    pkg: TG_PKG
  };
}

// ── Telegram account registration (UIAutomator, class/text-based) ────────────
//
// Drives the Telegram Android first-run signup, which — like WhatsApp — is
// PHONE-NUMBER based (no email required to create the account):
//   welcome ("Start Messaging") → country + phone → code (SMS/app) →
//   [2FA cloud password if the number already has an account] → name → home.
//
// ★★ CRITICAL DIFFERENCE FROM WHATSAPP (WHY THIS ISN'T A COPY-PASTE): Telegram's
// entire UI is CUSTOM-DRAWN (org.telegram.ui.* SlideViews, no XML layouts). It
// exposes NO stable resource-ids and NO com.fleet.a11y-fillable id fields — the
// a11ySetText(id, …) path that makes WhatsApp registration work DOES NOT APPLY
// here. So every screen is recognized by (a) the focused Activity
// (LaunchActivity — Telegram runs the whole login inside ONE activity, so the
// activity signal is far weaker than WA's per-screen activities) and (b) the
// on-screen TEXT (localized title/hint strings). Fields are driven by their
// android.widget.EditText class (the only stable handle), tapped to focus and
// filled via the ADBKeyboard IME (same reliable text path send/read use). This
// is why the flow leans on screenText() detectors + EditText-class taps, not the
// id-based SET_TEXT/CLICK broadcasts. VERIFIED-LIVE markers are TODO — the
// coordinates/text below are mapped from Telegram's public source
// (org.telegram.ui.LoginActivity) and the English strings.xml; confirm each
// against a live `uiautomator dump` on the target build before trusting it.
//
// ★★ THREE TELEGRAM-SPECIFIC OTP/2FA CASES the WhatsApp flow doesn't have:
//   (a) OTP-to-OTHER-DEVICE (operator-OTP): if the number is already logged into
//       Telegram on another device, the login code is delivered IN-APP to that
//       device ("We've sent the code to the Telegram app on your other device"),
//       NOT by SMS. The agent can't read it — the OPERATOR must read it off that
//       device and submit it. This is the DEFAULT for reused numbers, so it's
//       first-class here (otpChannel:'app'/'other_device'), whereas on WA it's an
//       edge case. A fresh/unused number gets an SMS instead.
//   (b) 2FA CLOUD PASSWORD: if the number already has an account WITH two-step
//       verification enabled, after the code Telegram asks for the cloud password
//       ("Enter your password"). We can't guess it — park at PASSWORD_WAIT so the
//       operator can supply it (payload.cloudPassword on the continuation).
//   (c) FLOOD-WAIT: too many code requests → "Too many attempts, please try again
//       in N…" / FLOOD_WAIT. Terminal-ish; report the wait so the operator knows
//       when to retry (mirrors WA's other-phone rate-limit).
//
// OTP handling mirrors registerWhatsApp: the agent is zero-dep + stateless, so
// the code must be SUPPLIED. payload carries { phoneNumber, otpCode?, fullName,
// cloudPassword?, countryCode?, apkUrl? }. If otpCode is absent we park at
// OTP_WAIT so the control plane re-dispatches with it; if a cloud password is
// needed and absent we park at PASSWORD_WAIT (surfaced via the same OTP_WAIT
// panel channel with otpChannel:'cloud_password').
//
// Accepts the whole job object (needs job.id for live progress). Legacy callers
// that pass (serial, payload) still work via the shim below (matches registerWhatsApp).
async function registerTelegram(job, legacyPayload) {
  // Back-compat: allow registerTelegram(serial, payload) as well as (job).
  if (typeof job === 'string') job = { id: null, serial: job, payload: legacyPayload || {} };
  const jobId = job.id || null;
  const serial = job.serial;
  // ★OTP-WATCH: a register job just claimed this device — cancel any parked OTP-watch
  // for it (continuation or fresh re-register). Same rationale as registerWhatsApp.
  if (typeof otpWatch !== 'undefined') otpWatch.delete(serial);
  const payload = job.payload || {};
  const phoneNumber = String(p(payload, 'phoneNumber', '')).trim();
  const fullName = String(p(payload, 'fullName', '')).trim();
  const otpCode = String(p(payload, 'otpCode', '')).trim();
  // Operator-supplied Telegram cloud password (two-step verification). Only present
  // on a continuation after we parked at PASSWORD_WAIT. Never logged.
  const cloudPassword = String(p(payload, 'cloudPassword', '')).trim();
  // Optional split: last name is separate on Telegram's register screen. If the
  // operator sends only fullName we split on the first space (first + rest).
  const lastNameRaw = String(p(payload, 'lastName', '')).trim();
  const apkUrl = p(payload, 'apkUrl', '');
  // accountId correlates the multi-step register jobs into one progress panel.
  const accountId = p(payload, 'accountId', '');
  if (!phoneNumber) throw new Error('phoneNumber gerekli');
  if (!fullName) throw new Error('fullName gerekli');
  // A continuation job is one that carries the operator's OTP or cloud password —
  // Telegram is already PARKED on the code/password screen, so we must NOT restart
  // the whole first-run machine (would discard the entered value). Same gate concept
  // as registerWhatsApp's isContinuation.
  const isContinuation = Boolean(otpCode || cloudPassword);

  // Name split: Telegram's register screen has First name (required) + Last name
  // (optional) fields. Prefer an explicit lastName; else split fullName.
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || fullName;
  const lastName = lastNameRaw || (nameParts.length > 1 ? nameParts.slice(1).join(' ') : '');

  const h = waHelpers(serial); // same generic tap/type/dump/screenText helper set

  // ── Live progress (mirrors registerWhatsApp exactly) ──────────────────────
  let curStep = 'launch', curPct = 0;
  const tgProgress = async (step, percent, note, status, shot) => {
    if (!jobId) return;
    await reportProgress(jobId, step, percent, note, status, { accountId, ...(shot ? { shot } : {}) });
  };
  const stepPct = { perms: 8, launch: 20, welcome: 32, phone: 46, submit: 58, code: 72, otp_wait: 78, password: 84, profile: 92, done: 100 };
  const step = async (key, note, fn) => {
    curStep = key; curPct = stepPct[key] ?? curPct;
    await tgProgress(key, curPct, note);
    try { return await fn(); }
    catch (e) { stopHeartbeat(); await tgProgress(key, curPct, `❌ HATA: ${e.message}`, 'FAILED'); throw new Error(`tg-register ${key}: ${e.message}`); }
  };
  const logLine = (text) => tgProgress(curStep, curPct, text);

  // ── Observability (device-tagged log + phase timing), mirrors registerWhatsApp ──
  const tgTag = `[tg ${(serial.split(':')[0] || serial).split('.').pop() || serial}]`;
  const tlog = (m) => { try { log(`${tgTag} ${m}`); } catch { /* logging must never break the flow */ } };
  const t0 = Date.now();
  const timings = {};
  let _phaseAt = t0, _phase = 'start';
  const markPhase = (name) => {
    const now = Date.now();
    const dt = now - _phaseAt;
    timings[_phase] = (timings[_phase] || 0) + dt;
    if (name !== _phase) tlog(`phase '${_phase}' ${(dt / 1000).toFixed(1)}s → ${name}`);
    _phase = name; _phaseAt = now;
  };
  const timingSummary = () => Object.entries(timings).map(([k, v]) => `${k}=${(v / 1000).toFixed(0)}s`).join(' ');

  // ── Screenshots + heartbeat (identical machinery to registerWhatsApp) ─────
  const shots = [];
  const snap = async (label, keepNote = false) => {
    const png = await grabPng(serial, 12000).catch(() => null);
    if (png) {
      shots.push({ label, ts: new Date().toISOString(), png: png.toString('base64') });
      if (shots.length > 12) shots.shift();
      const thumb = await shrinkPng(png, 300).catch(() => null);
      await tgProgress(curStep, curPct, keepNote ? '🎥 canlı' : `📸 ${label}`, undefined, thumb || undefined);
    }
    return label;
  };
  // OTP_WAIT (code needed) and PASSWORD_WAIT (2FA) are BOTH operator-input parks, not
  // failures — done() keeps them out of the FAILED path AND (because the panel opens
  // its input box on step==='otp_wait') both route through that step. CREATED = success.
  const OK_STATUSES = new Set(['CREATED', 'OTP_WAIT', 'PASSWORD_WAIT']);

  let heartbeat = null;
  const startHeartbeat = () => {
    if (heartbeat || !jobId) return;
    heartbeat = setInterval(async () => {
      try {
        const png = await grabPng(serial, 8000).catch(() => null);
        if (!png) return;
        const thumb = await shrinkPng(png, 300).catch(() => null);
        if (thumb) await tgProgress(curStep, curPct, '🎥 canlı', undefined, thumb);
      } catch { /* best-effort */ }
    }, WA_HEARTBEAT_MS);
    if (heartbeat.unref) heartbeat.unref();
  };
  const stopHeartbeat = () => { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } };
  startHeartbeat();

  const done = async (label, obj) => {
    stopHeartbeat();
    markPhase(label);
    const elapsedMs = Date.now() - t0;
    const st = obj && obj.status;
    // OTP_WAIT / PASSWORD_WAIT already emitted their operator-facing note — snap with
    // keepNote so the screenshot doesn't clobber it (same ★BUG-A guard as WA).
    await snap(label, st === 'OTP_WAIT' || st === 'PASSWORD_WAIT');
    tlog(`DONE ${label} ${(elapsedMs / 1000).toFixed(0)}s | ${timingSummary()}`);
    if (st && !OK_STATUSES.has(st)) {
      const reason = (obj && obj.note) || st;
      await tgProgress(curStep, curPct, `❌ ${reason}`, 'FAILED');
    } else if (st === 'CREATED') {
      await tgProgress('done', 100, '✓ Telegram hesabı oluşturuldu', 'COMPLETED');
    }
    // Keep the parked live view fresh via the agent's otpWatchTick (same as WA).
    if ((st === 'OTP_WAIT' || st === 'PASSWORD_WAIT') && jobId && accountId) {
      otpWatch.set(serial, { jobId, accountId, deviceId: serial, until: Date.now() + OTP_WATCH_TTL_MS });
    }
    return { ...obj, shots, timings, elapsedMs };
  };

  // ── Focused-activity read (Telegram runs login inside ONE activity, so this is
  // only useful to confirm we're IN Telegram, not to tell screens apart — screen
  // recognition is TEXT-based below). Uses adbT (5s hard timeout) like WA's curFocus.
  const curFocus = async () => {
    const w = await adbT(serial, ['shell', 'dumpsys', 'window'], 5000).catch(() => '');
    const m = w.match(/mCurrentFocus=\S+\s+\S+\s+([^\s}]*\/[^\s}]+)/) ||
              w.match(/mCurrentFocus=[^}]*?([\w.]+\/[\w.]+)/);
    return (m && m[1]) ? m[1] : w;
  };

  // 0) Ensure Telegram is installed. Runtime-detect the package (never hard-coded —
  // org.telegram.messenger / .web / Telegram-X), optionally side-load from apkUrl.
  // ★LEAK GUARD: every throw before done() must stopHeartbeat() (same as WA).
  let TG_PKG = await detectTelegramPkg(serial);
  if (!TG_PKG) {
    if (!apkUrl) { stopHeartbeat(); return done('not_installed', { status: 'NOT_INSTALLED', note: 'Telegram kurulu değil ve apkUrl verilmedi' }); }
    let local;
    try { local = await download(String(apkUrl), 'telegram.apk'); }
    catch (e) { stopHeartbeat(); throw e; }
    try { await adb(serial, ['install', '-r', '-g', local]); }
    catch (e) { stopHeartbeat(); throw e; }
    finally { await safeRm(local); }
    tgPkgCache.delete(serial);            // re-detect the freshly-installed package
    TG_PKG = await detectTelegramPkg(serial);
    if (!TG_PKG) { stopHeartbeat(); return done('not_installed', { status: 'NOT_INSTALLED', note: 'Telegram kurulumu doğrulanamadı' }); }
  } else if (!isContinuation) {
    // FIRST register only — WIPE Telegram data so it starts factory-fresh. Same ROOT
    // CAUSE as WA: a reused instance keeps the previous number's session and reopens
    // on the chat list / a stale login screen, so the new number is never entered.
    // NEVER clear on a CONTINUATION (the operator's parked code/password screen would
    // be nuked and the just-entered value thrown away — the exact WA watest34 bug).
    await adb(serial, ['shell', 'am', 'force-stop', TG_PKG]).catch(() => undefined);
    await adb(serial, ['shell', 'pm', 'clear', TG_PKG]).catch(() => undefined);
    await h.sleep(1200);
  }

  // 0.5) Proxy sanity check BEFORE entering the number (same as WA): Telegram also
  // geo-scores the login IP, and a mismatch is the single best early ban signal. We
  // don't hard-abort — just surface the real exit country. Suppressed on continuation.
  {
    const numCc = ccToIso(phoneNumber);
    const exit = await verifyExitCountry(serial).catch(() => null);
    if (exit && exit.country) {
      const match = !numCc || exit.country.toUpperCase() === numCc.toUpperCase();
      if (!isContinuation) await tgProgress('perms', 6,
        `${match ? '✓' : '⚠'} Çıkış IP: ${exit.ip || '?'} (${exit.country}${exit.city ? ', ' + exit.city : ''})` +
        `${match ? ' — numara ülkesiyle eşleşti' : ` — numara ${numCc} ama çıkış ${exit.country}, Telegram engelleyebilir!`}`);
    } else if (!isContinuation) {
      await tgProgress('perms', 6, '⚠ Çıkış IP doğrulanamadı (proxy testi başarısız) — devam ediliyor');
    }
  }

  // 0b) Pre-grant Telegram's runtime permissions so no dialog pops mid-flow (it would
  // overlay the phone/code field and stall). pm grant is a no-op if not declared.
  // Telegram needs SMS read (to AUTO-FILL the SMS code — the happy path for a fresh
  // number) + contacts/phone/notifications. The auto-fill is why a clean number often
  // needs NO operator OTP: Telegram reads its own SMS. Restricted SMS ops are also
  // lifted as root (appops), same as WA.
  const TG_PERMS = [
    'POST_NOTIFICATIONS', 'READ_CONTACTS', 'WRITE_CONTACTS', 'GET_ACCOUNTS',
    'READ_PHONE_STATE', 'READ_PHONE_NUMBERS', 'CALL_PHONE',
    'CAMERA', 'RECORD_AUDIO', 'RECEIVE_SMS', 'READ_SMS',
    'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION',
    'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE',
    'READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO'
  ];
  curStep = 'perms'; curPct = stepPct.perms;
  if (!isContinuation) await tgProgress('perms', curPct, 'İzinler veriliyor…');
  for (const short of TG_PERMS) {
    await adb(serial, ['shell', 'pm', 'grant', TG_PKG, `android.permission.${short}`]).catch(() => undefined);
  }
  for (const op of ['RECEIVE_SMS', 'READ_SMS', 'READ_PHONE_NUMBERS']) {
    await adbSu(serial, `appops set ${TG_PKG} ${op} allow`).catch(() => undefined);
  }
  // Prefer ADBKeyboard for reliable text entry (Telegram's custom EditTexts drop
  // `input text` on redroid, exactly like WA's fields).
  await h.ensureAdbKeyboard();
  await h.ensureTouch();
  if (!isContinuation) await logLine('✓ İzinler + klavye hazır');

  // 1) Launch Telegram. Poll until the first-run UI has actually rendered (welcome /
  // phone / login), then continue — same smart-wait as WA (saves dead time on a fast
  // cold open, tolerates a slow device up to ~9s).
  curStep = 'launch'; curPct = stepPct.launch;
  if (!isContinuation) await tgProgress('launch', curPct, 'Telegram açılıyor…');
  await launchApp(serial, TG_PKG, null);
  {
    let ready = false;
    for (let w = 0; w < 12 && !ready; w++) {
      await h.sleep(700);
      const txt = await h.screenText().catch(() => '');
      if (/Start Messaging|Continue in|Your phone|phone number|Enter code|Your Name/i.test(txt)) { ready = true; break; }
      // A returning EditText (phone/code field already up) is also "ready".
      if ((await h.find('EditText', 'any').catch(() => null)) && /telegram/i.test(await curFocus())) { ready = true; break; }
    }
    await h.sleep(ready ? 400 : 1500);
  }
  await snap('launch');

  // ── SCREEN DETECTORS (all TEXT-based — Telegram has no per-screen activity/ids) ──
  // Each takes an optional hoisted `txt` (one screenText read per loop round) so a
  // round is ~1 dump, not N — same ★H1 optimization as WA's verify loop.
  //
  // Welcome / intro: the "Start Messaging" button (+ "Continue in <lang>" language row).
  const onWelcome = async (txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    return /Start Messaging|Continue in /i.test(t);
  };
  // Phone-entry screen: title "Your phone number" / hint, or a country row + phone EditText.
  const onPhoneScreen = async (txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    if (/Your phone number|Your Phone|Please confirm your country code and enter your phone number/i.test(t)) return true;
    // Fallback: an EditText is present and we're NOT on a later screen (no code/name/password cues).
    const hasEdit = (await h.find('EditText', 'any').catch(() => null)) != null;
    return hasEdit && !/Enter code|Your Name|Your password|Two-Step/i.test(t);
  };
  // Code screen (any delivery variant): "Enter code" title, "sent ... code" bodies.
  const onCodeScreen = async (txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    return /Enter code|We've sent (an SMS with an )?(the )?(activation )?code|Phone verification|We're calling your phone|Didn't get the code/i.test(t);
  };
  // ★OTP-to-OTHER-DEVICE (operator-OTP): the code went to the number's EXISTING
  // Telegram on ANOTHER device ("We've sent the code to the Telegram app on your other
  // device"). The agent CANNOT read it — the operator must. This is Telegram's DEFAULT
  // for reused numbers. Distinct from the SMS case (which a fresh number gets + Telegram
  // can auto-fill from its own SMS).
  const onCodeToOtherDevice = async (txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    return /code to the Telegram app|to the \*?\*?Telegram\*?\*? app on your other device|sent the code to the Telegram/i.test(t);
  };
  // ★2FA CLOUD PASSWORD: number already has an account with two-step verification.
  // "Enter your password" / "Two-Step Verification" / "cloud password".
  const onPasswordScreen = async (txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    return /Two-Step Verification|Enter your password|cloud password|Your account is protected with an additional password/i.test(t);
  };
  // ★FLOOD-WAIT / too-many-attempts (terminal-ish rate limit).
  const onFloodWait = async (txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    if (!/Too many attempts|too many times|try again|FLOOD_WAIT|limit(ed)?/i.test(t)) return null;
    const m = /(\d+)\s*(hour|minute|second|saat|dakika|saniye)/i.exec(t);
    return m ? `${m[1]} ${m[2]}` : 'bir süre';
  };
  // Banned/invalid number wall (terminal).
  const onNumberWall = async (txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    if (/Banned Phone Number|number is banned|Invalid Phone Number|not a valid|number.*invalid/i.test(t)) return t;
    return null;
  };
  // Register (new-account) screen: "Your Name" / "Profile info" / "First name (required)".
  const onRegisterScreen = async (txt) => {
    const t = txt ?? await h.screenTextRich().catch(() => '');
    return /Your Name|Profile info|First name \(required\)|Enter your name and add a profile picture|Add profile photo/i.test(t);
  };
  // Home / chat list reached = success. Telegram's main screen shows the chats title,
  // the compose FAB (content-desc "New Message"), or the settings/search bar.
  const onHome = async (txt) => {
    const f = await curFocus();
    if (/DialogsActivity|LaunchActivity/i.test(f) && (await h.find('New Message', 'desc').catch(() => null))) return true;
    const t = txt ?? await h.screenTextRich().catch(() => '');
    return /New Message/i.test(t) || (/Chats/i.test(t) && (await h.find('New Message', 'desc').catch(() => null)) != null);
  };

  // Helper: focus the first EditText on screen and type `value` via the reliable IME.
  // Telegram fields reject `input text` on redroid but accept the ADBKeyboard broadcast
  // (same as WA send). `nth` picks which EditText (0=first) for multi-field screens
  // (register: first name = 0, last name = 1).
  const fillEditText = async (value, nth = 0, clear = true) => {
    const edits = (await h.dump().catch(() => [])).filter((n) => /EditText/i.test(n.cls || '') && n.cx > 0);
    const field = edits[nth] || edits[0];
    if (!field) return false;
    await h.tapNode(field); await h.sleep(500);
    if (clear) await h.clearField().catch(() => undefined);
    await h.typeText(value); await h.sleep(600);
    return true;
  };
  // Telegram's advance button is the floating round arrow FAB bottom-right. On the
  // phone/name screens it's a plain FloatingActionButton; its content-desc is the
  // localized "Done"/"Next"/"Proceed" (org.telegram.ui — R.string.Done) but MANY builds
  // leave it empty, so we can't rely on a desc match alone. Strategy (mirrors WA's
  // send-FAB → measured-node → scaled-coord ladder):
  //   1) find a node whose desc is one of the localized Done labels and tap its MEASURED
  //      center (works even after the layout shifts),
  //   2) else the scaled bottom-right coordinate.
  // ★KEYBOARD GUARD: after fillEditText the ADBKeyboard IME is up and covers the bottom
  // ~40% of the screen — a blind 88%-height tap would hit the keyboard, not the FAB
  // (exact bug WA guards against on RegisterName). So we FIRST dismiss the IME with BACK
  // when it's open, then tap. `dismissIme` presses BACK only if a keyboard is showing so
  // we never accidentally BACK out of the screen when no IME is up.
  const DONE_DESCS = ['Done', 'Next', 'Proceed', 'Bitti', 'İleri', 'Devam', 'Continue'];
  const imeShowing = async () => {
    // dumpsys input_method exposes mInputShown/mShowRequested; reliable on redroid.
    const s = await adbT(serial, ['shell', 'dumpsys', 'input_method'], 4000).catch(() => '');
    return /mInputShown=true|mShowRequested=true|isInputViewShown=true/i.test(s);
  };
  const dismissIme = async () => {
    if (await imeShowing()) {
      await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
      await h.sleep(500);
    }
  };
  const tapDone = async () => {
    // 1) Locale-aware desc node (tap its real measured center).
    for (const d of DONE_DESCS) {
      const n = await h.find(d, 'desc').catch(() => null);
      if (n) { await h.tapNode(n); return true; }
    }
    // 2) Coordinate fallback — but only AFTER closing the keyboard so we hit the FAB, not
    // the IME. Telegram's Done FAB sits ~bottom-right (~88% w, ~88% h on a 1080x2400 ref).
    await dismissIme();
    let w = 1080, ht = 2400;
    try {
      const wm = await adb(serial, ['shell', 'wm', 'size']);
      const m = /Override size:\s*(\d+)x(\d+)/.exec(wm) || /Physical size:\s*(\d+)x(\d+)/.exec(wm);
      if (m) { w = +m[1]; ht = +m[2]; }
    } catch { /* keep defaults */ }
    await h.tapSyn(Math.round(w * 0.88), Math.round(ht * 0.88));
    return false;
  };

  // ── CONTINUATION SHORTCUT (mirrors registerWhatsApp's skipToVerify) ───────
  // On a continuation the operator submitted the code (or cloud password) and Telegram
  // was NOT cleared, so it re-opens PARKED on the code/password screen. Jump STRAIGHT
  // to the code/password phase — running the welcome+phone machine here is WRONG (those
  // screens are behind us) and would spin.
  curStep = 'welcome'; curPct = stepPct.welcome;
  let reachedCode = false, reachedPassword = false;
  if (isContinuation) {
    const t = await h.screenTextRich().catch(() => '');
    if (cloudPassword && await onPasswordScreen(t)) {
      reachedPassword = true;
      await tgProgress('password', stepPct.password, '↩ 2FA parola ekranına devam ediliyor…');
    } else if (await onCodeScreen(t) || await onPasswordScreen(t)) {
      reachedCode = true;
      await tgProgress('code', stepPct.code, '↩ Kod ekranına devam ediliyor…');
    } else if (await onHome(t)) {
      return done('home', { status: 'CREATED', note: 'Telegram zaten kayıtlı (ana ekran) — doğrulama tamamlanmış', phoneNumber });
    } else {
      // Parked session lost (crash / unexpected screen). Don't restart the phone
      // machine (would discard the code/waste a request). Bail cleanly (WA scenario #7).
      return done('session_lost', {
        status: 'REGISTER_FAILED',
        note: 'Doğrulama oturumu kayboldu (Telegram beklenen ekranda değil) — kodu/parolayı giremedik. Temiz bir kayıt başlatın.',
        phoneNumber, screenTexts: t.slice(0, 300)
      });
    }
  }

  // ── FIRST-RUN STATE MACHINE (launch → phone screen) ───────────────────────
  // Like WA, the screens between launch and the phone field are non-deterministic
  // (welcome may or may not show; a language sheet may pop). LOOP: read screen,
  // recognize state, act, re-observe, until the phone field appears. Skipped entirely
  // on a continuation (we jumped to code/password above).
  markPhase('welcome');
  let reachedPhone = false;
  if (!isContinuation) {
    for (let round = 0; round < 16 && !reachedPhone; round++) {
      const txt = await h.screenTextRich().catch(() => '');
      if (await onPhoneScreen(txt)) { reachedPhone = true; break; }
      if (await onWelcome(txt)) {
        // "Start Messaging" advances to the phone screen. Tap the button by text;
        // Telegram draws it as a TextView inside a clickable container (tapNode resolves
        // the clickable parent). ★TODO(live-map): confirm coordinate fallback.
        tlog(`first-run r${round}: welcome → Start Messaging`);
        if (!(await h.tapSynIf('Start Messaging', 'text'))) {
          // Coordinate fallback: the button sits ~mid-lower-center on the intro screen.
          await h.tapScaled(540, 2000).catch(() => undefined);
        }
        await h.sleep(2000);
        continue;
      }
      // Unknown/rendering screen — settle and re-observe (a language-select or a
      // permission dialog can appear; a stray Continue/Allow is harmless).
      if (!(await h.tapSynIf('Allow', 'text')) && !(await h.tapSynIf('Continue', 'text'))) {
        tlog(`first-run r${round}: unknown screen focus=${(await curFocus()).slice(0, 60)}`);
      }
      await h.sleep(1300);
    }
    await snap('first_run');
    if (!reachedPhone) {
      return done('phone_screen_failed', {
        status: 'REGISTER_FAILED',
        note: 'Telefon numarası ekranına ulaşılamadı (giriş ekranları geçilemedi). Temiz oturumla tekrar deneyin.',
        phoneNumber
      });
    }

    // ── PHONE ENTRY ──────────────────────────────────────────────────────────
    // Telegram has a country row + a phone EditText that auto-formats. Typing the
    // FULL E.164 (with +) into the phone field usually auto-selects the country, like
    // WA's registration_cc trick — but Telegram's field expects the number WITHOUT the
    // country code once the country is picked. Safest path (VERIFY LIVE): type the full
    // "+<cc><local>" — Telegram parses the leading + and splits it. If that leaves the
    // field with only the local part, that's expected. ★TODO(live-map): confirm whether
    // the full +E.164 or (country picker + local) is needed on the target build.
    curStep = 'phone'; curPct = stepPct.phone;
    await tgProgress('phone', curPct, `Numara giriliyor (${phoneNumber})…`);
    markPhase('phone');
    // Dismiss a late permission dialog that could cover the field.
    await h.tapById('com.android.permissioncontroller:id/permission_allow_button').catch(() => undefined);
    const e164 = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber.replace(/\D/g, '')}`;
    let phoneFilled = false;
    for (let attempt = 0; attempt < 3 && !phoneFilled; attempt++) {
      // Type the full +E.164 into the (first) phone EditText; Telegram splits country+local.
      if (await fillEditText(e164, 0, true)) {
        await h.sleep(800);
        // Verify SOME digits landed (the field shows the formatted local part).
        const after = await h.screenText().catch(() => '');
        const digitsSeen = (after.match(/\d/g) || []).length;
        if (digitsSeen >= 6) { phoneFilled = true; break; }
      }
      await h.sleep(700);
    }
    await snap('phone_filled');
    if (!phoneFilled) {
      return done('number_failed', { status: 'NUMBER_ENTRY_FAILED', note: 'Numara alanı doldurulamadı', phoneNumber });
    }

    // ── SUBMIT (Done) → confirm dialog "Is this the correct number? Yes" ──────
    curStep = 'submit'; curPct = stepPct.submit;
    await tgProgress('submit', curPct, 'Numara onaylanıyor (Done → Yes)…');
    markPhase('submit');
    let submitted = false;
    for (let i = 0; i < 3 && !submitted; i++) {
      await tapDone();
      // Telegram shows a "Is this the correct number? +<n>" confirm dialog with a Yes button.
      for (let w = 0; w < 8; w++) {
        await h.sleep(1000);
        const t = await h.screenTextRich().catch(() => '');
        // Accept the confirm dialog if present.
        if (/correct number|is this correct|confirm/i.test(t)) {
          await h.tapSynIf('Yes', 'text'); await h.sleep(1500);
        }
        // Left the phone screen (reached code / password / flood / wall)?
        if (await onCodeScreen(t) || await onPasswordScreen(t) || await onFloodWait(t) || await onNumberWall(t)) { submitted = true; break; }
      }
    }
    await snap('submit');
  }

  // ── CODE / OTP STATE MACHINE ──────────────────────────────────────────────
  // After submit Telegram lands on the code screen (SMS OR in-app to another device),
  // OR jumps straight to the 2FA password screen (if the code auto-filled from SMS and
  // the account has 2FA), OR shows flood-wait / a number wall. LOOP: recognize + act.
  curStep = 'code'; curPct = stepPct.code;
  await tgProgress('code', curPct, 'Doğrulama ekranı belirleniyor…');
  markPhase('code');
  let codeEntered = false;
  for (let round = 0; round < 12; round++) {
    const txt = await h.screenTextRich().catch(() => '');

    // Terminal: flood-wait / rate limit.
    const flood = await onFloodWait(txt);
    if (flood) {
      tlog(`code: FLOOD-WAIT (${flood})`);
      await snap('flood_wait');
      curStep = 'otp_wait'; curPct = stepPct.otp_wait;
      const note = `⏳ Telegram bu numaraya çok fazla kod isteği gördü — ${flood} sonra tekrar deneyin (FLOOD_WAIT).`;
      await tgProgress('otp_wait', curPct, note);
      return done('flood_wait', { status: 'RATE_LIMITED', otpChannel: 'rate_limited', note, phoneNumber });
    }
    // Terminal: banned / invalid number.
    const wall = await onNumberWall(txt);
    if (wall) {
      tlog(`code: NUMBER WALL — ${wall.slice(0, 60)}`);
      await snap('number_wall');
      return done('number_wall', { status: 'NUMBER_WALL', note: 'Telegram numarayı reddetti (yasaklı/geçersiz numara)', phoneNumber, screenTexts: wall.slice(0, 300) });
    }

    // 2FA cloud password screen (may appear here if the SMS code auto-filled).
    if (await onPasswordScreen(txt)) { reachedPassword = true; break; }

    // Code screen. If we have the operator's code, ENTER it. Otherwise PARK.
    if (await onCodeScreen(txt)) {
      if (otpCode) {
        tlog('code: entering operator code');
        await snap('code_screen');
        // Telegram's code field is a single EditText (some builds split into per-digit
        // boxes but accept a single typed string). Type the digits; it auto-submits on
        // the last digit, else tap Done.
        await fillEditText(String(otpCode).replace(/\D/g, ''), 0, true);
        await h.sleep(1500);
        await tapDone();
        await h.sleep(3500);
        // Re-read: rejected code → error text; success → password screen / register / home.
        const after = await h.screenTextRich().catch(() => '');
        if (/Invalid code|code (is )?(expired|invalid)|wrong code/i.test(after)) {
          return done('code_rejected', { status: 'OTP_REJECTED', note: 'Doğrulama kodu reddedildi', phoneNumber, screenTexts: after.slice(0, 300) });
        }
        codeEntered = true;
        break;
      }
      // No code yet → PARK. Distinguish the delivery channel so the panel shows the
      // right hint: 'app'/'other_device' = operator must read it off the number's other
      // Telegram; 'sms' = it's coming by SMS (Telegram may also auto-fill it — we still
      // park so the operator can enter it if auto-fill didn't fire).
      const otherDevice = await onCodeToOtherDevice(txt);
      curStep = 'otp_wait'; curPct = stepPct.otp_wait;
      const note = otherDevice
        ? '📲 Kod, numaranın DİĞER cihazındaki Telegram uygulamasına gönderildi (numara zaten kayıtlı) — o cihazdan okuyup panele girin.'
        : '📲 Telegram doğrulama kodu bekleniyor — SMS gelince panelden girin.';
      tlog(`code: OTP_WAIT (${otherDevice ? 'other_device' : 'sms'})`);
      await tgProgress('otp_wait', curPct, note);
      return done('otp_wait', {
        status: 'OTP_WAIT',
        otpChannel: otherDevice ? 'other_device' : 'sms',
        note, phoneNumber
      });
    }

    // Already advanced past the code (register/home) — a fresh number whose SMS
    // auto-filled without us. Break and let the post-code phase handle it.
    if (await onRegisterScreen(txt) || await onHome(txt)) { codeEntered = true; break; }

    tlog(`code: unknown screen round=${round} focus=${(await curFocus()).slice(0, 60)}`);
    await h.sleep(1400);
  }

  // ── 2FA CLOUD PASSWORD ────────────────────────────────────────────────────
  // The number already has an account WITH two-step verification. We can't guess the
  // password — if the operator supplied one, enter it; else PARK at PASSWORD_WAIT.
  if (reachedPassword || await onPasswordScreen()) {
    curStep = 'password'; curPct = stepPct.password;
    markPhase('password');
    await snap('password_screen');
    if (cloudPassword) {
      tlog('password: entering operator cloud password');
      await tgProgress('password', curPct, 'İki adımlı doğrulama parolası giriliyor…');
      await fillEditText(cloudPassword, 0, true);
      await h.sleep(1200);
      await tapDone();
      await h.sleep(3500);
      const after = await h.screenTextRich().catch(() => '');
      if (/Invalid password|wrong password|password.*incorrect/i.test(after)) {
        return done('password_rejected', { status: 'PASSWORD_REJECTED', note: 'İki adımlı doğrulama parolası reddedildi', phoneNumber, screenTexts: after.slice(0, 300) });
      }
      // Advanced past 2FA → register/home below.
    } else {
      // PARK for the operator to supply the cloud password (routes through the OTP panel
      // channel with otpChannel:'cloud_password' so the panel shows a password prompt).
      const note = '🔒 Numarada iki adımlı doğrulama (2FA) açık — Telegram bulut parolasını panele girin (cloudPassword).';
      tlog('password: PASSWORD_WAIT (2FA)');
      curStep = 'otp_wait'; curPct = stepPct.otp_wait;
      await tgProgress('otp_wait', curPct, note);
      return done('password_wait', { status: 'PASSWORD_WAIT', otpChannel: 'cloud_password', note, phoneNumber });
    }
  }

  // ── REGISTER (new account) — enter First + Last name → Done ────────────────
  // Only shown for a number that has NEVER had a Telegram account (a truly fresh
  // number). A reused number logs straight into its existing account (skips this and
  // lands on home). So this screen is OPTIONAL.
  curStep = 'profile'; curPct = stepPct.profile;
  markPhase('profile');
  if (await onRegisterScreen()) {
    await tgProgress('profile', curPct, `Profil ismi giriliyor (${firstName}${lastName ? ' ' + lastName : ''})…`);
    await snap('register_screen');
    // First name (required) = EditText 0; last name (optional) = EditText 1.
    await fillEditText(firstName, 0, true);
    await h.sleep(500);
    if (lastName) { await fillEditText(lastName, 1, true); await h.sleep(500); }
    await tapDone();
    await h.sleep(4000);
  }

  // ── CONFIRM HOME (success) ────────────────────────────────────────────────
  // Sweep any post-register interstitials (permissions/sync prompts) toward home.
  for (let i = 0; i < 6; i++) {
    const txt = await h.screenTextRich().catch(() => '');
    if (await onHome(txt)) break;
    // Dismiss common post-login prompts (contacts sync, notifications, "Continue").
    const acted =
      (await h.tapSynIf('Continue', 'text')) ||
      (await h.tapSynIf('Not Now', 'text')) || (await h.tapSynIf('Skip', 'text')) ||
      (await h.tapById('com.android.permissioncontroller:id/permission_allow_button').then(() => true).catch(() => false));
    await h.sleep(acted ? 1600 : 1400);
  }
  let atHome = false;
  for (let i = 0; i < 6; i++) {
    if (await onHome()) { atHome = true; break; }
    await h.sleep(2000);
  }
  const finalText = await h.screenTextRich().catch(() => '');
  if (!atHome) {
    await tgProgress('profile', curPct, '❌ Ana ekrana ulaşılamadı', 'FAILED');
    return done('profile_incomplete', { status: 'PROFILE_INCOMPLETE', note: 'Kod/isim adımından sonra ana ekrana ulaşılamadı', phoneNumber, screenTexts: finalText.slice(0, 300) });
  }
  curStep = 'done'; curPct = stepPct.done;
  return done('home', { status: 'CREATED', note: 'Telegram hesabı oluşturuldu (ana ekran teyitli)', phoneNumber, pkg: TG_PKG, screenTexts: finalText.slice(0, 300) });
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

  // ── ★ROOT FAST PATH (~1s vs ~6s, and NEVER changes the screen → zero ban surface):
  // read the thread straight from msgstore.db instead of deep-linking the chat and
  // scraping message_text bubbles off the UI. Resolves the modern LID mapping so it works
  // on new WA builds. Only when we have a NUMBER (to); name-only (from) still needs the UI
  // to locate the chat. Falls through to the UI scrape if root/db is unavailable (null).
  if (to) {
    const msgs = await readWaMessages(serial, to, 50).catch(() => null);
    if (msgs) {
      return { status: 'OK', count: msgs.length, messages: msgs.map((m) => m.text).slice(-50), source: 'db' };
    }
  }

  const h = waHelpers(serial);
  await h.ensureTouch();
  await h.ensureAdbKeyboard();

  // Make sure a chat is open — via the shared waOpenChat (real open-verify + ANR-clear
  // + locale-safe search), and bail with NO_CHAT if it didn't open (invalid number /
  // account restricted / ANR) instead of scraping whatever screen we're on.
  if (to || from) {
    if (!(await waOpenChat(serial, h, { to, from }))) {
      return { status: 'NO_CHAT', note: 'Sohbet açılamadı (numara geçersiz / hesap kısıtlı / ANR)', count: 0, messages: [] };
    }
  }
  await dismissBlockingDialogs(serial, h);

  // Pull bubbles from a retrying dump (blank dump ≠ empty chat). Only real
  // message_text bubbles count — do NOT fall back to "all on-screen text", which
  // swept in toolbar/chrome strings and reported them as messages (inflated count).
  const nodes = await h.dumpOrRetry({ tries: 3, gapMs: 500 });
  if (!nodes.length) return { status: 'READ_UNCONFIRMED', note: 'Sohbet okunamadı (boş dump)', count: 0, messages: [] };
  const bubbles = nodes
    .filter((n) => n.text && n.resId.includes('message_text'))
    .map((n) => n.text);
  // No message bubbles on a successfully-dumped chat → genuinely empty (or all media).
  return { status: 'OK', count: bubbles.length, messages: bubbles.slice(-50) };
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
// Returns TRUE only when the chat's compose box (id/entry) is actually on screen.
// Previously the `to` path returned true unconditionally — so an invalid/non-WhatsApp
// number, an account-in-review wall, or an ANR overlay all reported "opened" and every
// subsequent tap went to the WRONG screen (false success / wrong-target action). Now
// callers can trust the return value and bail with NO_CHAT instead of blind-tapping.
async function waOpenChat(serial, h, { to, from }) {
  if (to) {
    await adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', shArg(`https://wa.me/${to}`), WA_PKG]);
    // SPEED: poll for the compose box (id/entry). Also clear an ANR overlay that can
    // sit on top of the Conversation view (mirrors whatsappSend's open-poll logic) —
    // otherwise the poll times out under an "isn't responding" dialog and we wrongly
    // conclude the chat never opened. Track whether entry was actually seen.
    await h.sleep(2000);
    let chatOpened = false;
    for (let i = 0; i < 12; i++) {
      if (await h.find('com.whatsapp:id/entry', 'id').catch(() => null)) { chatOpened = true; break; }
      if (i % 2 === 1 && await clearAnrDialog(serial, h, 1)) await h.sleep(700);
      await h.sleep(500);
    }
    return chatOpened;
  }
  if (from) {
    await launchApp(serial, WA_PKG, null);
    await h.sleep(3500);
    // Locale-safe Search (English "Search" / Turkish "Ara"); findNode accepts arrays.
    if (await h.tapIf(['Search', 'Ara'], 'desc')) {
      await h.sleep(800);
      await inputText(serial, from);
      await h.sleep(1500);
      await h.tapBy(from, 'text').catch(() => undefined);
      await h.sleep(2200);
      // Verify-after: confirm the compose box appeared (chat really opened) rather
      // than returning true just because we tapped a search result that may not exist.
      let chatOpened = false;
      for (let i = 0; i < 8; i++) {
        if (await h.find('com.whatsapp:id/entry', 'id').catch(() => null)) { chatOpened = true; break; }
        await h.sleep(500);
      }
      return chatOpened;
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
    // Locale-safe landmarks (EN/TR) — findNode/pollNode accept string arrays.
    const overflow = await h.pollNode(['More options', 'Diğer seçenekler'], 9000, 'desc');
    if (overflow) await h.tapSynNode(overflow); else await h.tapSyn(1027, 147);
    // Wait for the popup menu ("New group"/"Yeni grup" landmark); re-tap the overflow
    // once if it didn't render.
    if (!(await h.pollNode(['New group', 'Yeni grup'], 8000, 'text'))) {
      if (overflow) await h.tapSynNode(overflow); else await h.tapSyn(1027, 147);
      await h.pollNode(['New group', 'Yeni grup'], 6000, 'text');
    }
    const settings = await h.pollNode(['Settings', 'Ayarlar'], 6000, 'any');
    if (settings) await h.tapSynNode(settings);
    else await h.tapSyn(812, 1060); // fixed Settings row center (VERIFIED bounds)
    // Settings loaded when the "Account"/"Hesap" row appears.
    return Boolean(await h.pollNode(['Account', 'Hesap'], 9000, 'any'));
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
// Şu an öndeki (resumed) activity'nin tam adını döndür (ör. "com.whatsapp/.profile.
// ui.ProfileInfoActivity"). Profil akışında ekran-geçişlerini doğrulamak için kullanılır.
async function currentActivity(serial) {
  const out = await adb(serial, ['shell', 'dumpsys', 'activity', 'activities']).catch(() => '');
  const m = /(?:topResumedActivity|mResumedActivity)=ActivityRecord\{[^ ]+ [^ ]+ ([^ \/]+\/[^ }]+)/.exec(String(out || ''));
  return m ? m[1] : '';
}

// Odaktaki pencere (dumpsys window). currentActivity ile aynı şeyi vermez: bir
// DİYALOG (izin isteme) odaktadır ama altındaki activity "resumed" görünebilir.
async function focusedWindow(serial) {
  const out = await adb(serial, ['shell', 'dumpsys', 'window']).catch(() => '');
  const m = /mCurrentFocus=Window\{[^ ]+ [^ ]+ ([^}]+)\}/.exec(String(out || ''));
  return m ? String(m[1]).trim() : '';
}

// ── EKRAN KURTARMA ──────────────────────────────────────────────────────────
//
// ★2026-07-29 — NEDEN VAR: canlı ölçümde 38 cihazın 6'sı `GrantPermissionsActivity`
// üzerinde, 2'si ContactPicker'da TAKILI kalmıştı ve o sırada RUNNING job YOKTU.
// Yani işler bitmiş, ekran kimse tarafından temizlenmemişti (operatör "cihaz kendi
// kendine galeriye girmiş" diye bildirdi). Kökler: (a) izin diyaloğunu kapatan mantık
// 7 ayrı yere kopyalanmıştı, hepsi kayıt akışının içindeydi ve medya/avatar
// akışlarında hiç yoktu; (b) hiçbir job bitiminde cihazı temiz duruma döndürmüyordu.
// Bu iki yardımcı o boşluğu kapatır ve tek kaynak olur.

// Runtime izin diyaloğu açıksa ONAYLA. Paket-bağımsızdır: WhatsApp'ın da, üçüncü
// parti Galeri uygulamasının da diyaloğunu kapatır.
// ⚠️ Türkçe metinler BİLEREK eklendi — dosyadaki eski kopyalar yalnızca İngilizce
// ('Allow'/'Continue') arıyordu, Türkçe yerelli cihazda yalnızca resource-id ve kör
// koordinata kalıyordu.
const PERM_ALLOW_IDS = [
  'com.android.permissioncontroller:id/permission_allow_button',
  'com.android.permissioncontroller:id/permission_allow_all_button',
  'com.android.permissioncontroller:id/permission_allow_foreground_only_button',
  'com.android.packageinstaller:id/permission_allow_button'
];
const PERM_ALLOW_TEXTS = [
  'Allow all', 'Tümüne izin ver',
  'While using the app', 'Uygulamayı kullanırken',
  'Allow', 'İzin ver', 'İzin Ver', 'Buna izin ver', 'Ver',
  'Continue', 'Devam'
];

function isPermissionDialog(focus) {
  return /permissioncontroller|GrantPermissions|packageinstaller/i.test(String(focus || ''));
}

// Diyalog açık kaldığı sürece (en fazla `tries` tur) onaylamayı dener.
// Dönüş: kapatıldıysa true.
async function dismissPermissionDialog(serial, { tries = 3 } = {}) {
  let dismissed = false;
  for (let i = 0; i < tries; i++) {
    const focus = await focusedWindow(serial).catch(() => '');
    if (!isPermissionDialog(focus)) return dismissed;
    // Tek dump, sonra sırayla: resource-id (dile bağımsız, en güvenilir) → metin.
    const nodes = await uiDumpXml(serial).then(parseUiNodes).catch(() => []);
    let tapped = false;
    for (const id of PERM_ALLOW_IDS) {
      const node = nodes.find((n) => String(n.resId || '').includes(id));
      if (node) {
        await adb(serial, ['shell', 'input', 'tap', String(node.cx), String(node.cy)]).catch(() => undefined);
        tapped = true;
        break;
      }
    }
    if (!tapped) {
      for (const label of PERM_ALLOW_TEXTS) {
        const q = label.toLowerCase();
        const node = nodes.find(
          (n) => String(n.text || '').trim().toLowerCase() === q || String(n.desc || '').trim().toLowerCase() === q
        );
        if (node) {
          await adb(serial, ['shell', 'input', 'tap', String(node.cx), String(node.cy)]).catch(() => undefined);
          tapped = true;
          break;
        }
      }
    }
    // 3) son çare: bilinen buton konumu (ekran oranıyla)
    if (!tapped) {
      const { sw, sh } = await wmSize(serial).catch(() => ({ sw: 1080, sh: 2400 }));
      await adb(serial, ['shell', 'input', 'tap', String(Math.round(sw * 0.5)), String(Math.round(sh * 0.52))])
        .catch(() => undefined);
    }
    dismissed = true;
    await sleep(700);
  }
  return dismissed;
}

// Cihazı TEMİZ duruma döndür: açık izin diyaloğunu kapat, sonra ana ekrana dön.
// Her UI süren job'ın sonunda (başarı VE hata) çağrılır — bkz. runJob'un finally'si.
// Best-effort: buradaki hiçbir hata job sonucunu etkilemez.
async function returnToHome(serial) {
  try {
    // Açık bir izin diyaloğu HOME'u yutabilir → önce onu temizle.
    await dismissPermissionDialog(serial, { tries: 2 }).catch(() => undefined);
    await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']).catch(() => undefined);
    // Doğrula: hâlâ launcher'da değilsek bir kez daha dene (picker/crop ekranları
    // ilk HOME'u bazen yutuyor).
    const focus = await focusedWindow(serial).catch(() => '');
    if (focus && !/launcher/i.test(focus)) {
      await sleep(400);
      await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']).catch(() => undefined);
    }
  } catch {
    /* temizlik asla job'ı bozmaz */
  }
}

// ── Kendi WhatsApp profilini DEĞİŞTİR: isim + avatar (2026-07-24) ────────────
// SS-SS canlı tespit edilen koordinat reçetesi (watest48/mi2, 1080x2368, WA v2.26).
// Koordinatlar EKRAN-ORANI olarak yazıldı (çözünürlükten bağımsız → farklı cihazlar
// da çalışır). Akış tamamen SYNTHETIC `input tap` + koordinat (uiautomator WA'da
// hang eder → SS-SS koordinat sür, denenmiş ve kanıtlanmış dersler).
//
// Profil ekranına navigasyon (isim + avatar için ORTAK):
//   Main → ⋮ menü → Settings → avatar(profil kartı) → ProfileInfoActivity.
// ★2026-07-29 HIZ: bu fonksiyon isim + avatar akışlarının ORTAK yoluydu ve toplam
// 10.3 saniye KÖR bekleme içeriyordu (800+3500+1500+2500+2500). Her adım artık
// "ekran hazır mı" pollingine çevrildi: tipik cihazda saniyeler kazanılıyor, yavaş
// cihazda üst sınır eski süreden daha toleranslı. Davranış (tap reçetesi) aynı.
async function waOpenProfileScreen(serial) {
  const { sw, sh } = await wmSize(serial);
  const tap = (fx, fy) => adb(serial, ['shell', 'input', 'tap', String(Math.round(sw * fx)), String(Math.round(sh * fy))]);
  // Bir koşul sağlanana kadar bekle (400 ms aralık). Sağlanmazsa sessizce devam
  // eder — eski kör sleep davranışının en kötü hâlinden daha kötü olmaz.
  const waitFor = async (pred, maxMs) => {
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
      if (await pred().catch(() => false)) return true;
      await sleep(400);
    }
    return false;
  };
  const actIs = (re) => async () => re.test(await currentActivity(serial).catch(() => ''));

  // WA'yı temiz aç (soğuk başlatınca chat listesinde durabilir; force-stop garanti).
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  await adb(serial, ['shell', 'am', 'start', '-n', `${WA_PKG}/.Main`]).catch(() => undefined);
  // Ana ekran gelene kadar bekle (eski: kör 800+3500).
  await waitFor(actIs(/whatsapp/i), 6000);
  // ⋮ menü (sağ üst) → Settings.
  // ★2026-08-07 NO_PROFILE'ın kaynağı: menü açılışı KÖR `sleep(600)` idi ve activity
  // değişmediği için poll edilemiyordu. Menü animasyonu geç biterse "Settings"
  // tıklaması BOŞA gidiyor, Settings hiç açılmıyor ve akış NO_PROFILE ile bitiyordu.
  // CANLI: 6 saatte 43 NO_PROFILE, 6+ cihaza DAĞILMIŞ (en fazla 3'er) — yani cihaza
  // özgü arıza DEĞİL, KARARSIZ zamanlama. Elle tekrarladığımda akış SORUNSUZ çalıştı
  // (HomeActivity → SettingsTabActivity → ProfileInfoActivity), bu da geçiciliği
  // doğruluyor.
  // FIX: menüyü dump'tan doğrula (metin göründü mü) ve tutmadıysa TEKRAR dene.
  for (let attempt = 0; attempt < 3; attempt++) {
    await tap(0.943, 0.063);
    // Menü gerçekten açıldı mı? Activity değişmiyor, o yüzden ekran metnine bakıyoruz.
    const menuUp = await waitFor(async () => {
      const t = await adb(serial, ['shell', 'uiautomator', 'dump', '/sdcard/wa-menu.xml'])
        .then(() => adb(serial, ['shell', 'cat', '/sdcard/wa-menu.xml']))
        .catch(() => '');
      return /Settings|Ayarlar/i.test(String(t));
    }, 2500);
    if (menuUp) break;
    await sleep(400);   // menü açılmadı → kapat/aç döngüsüne girmeden tekrar dene
  }
  await tap(0.633, 0.395);
  // Settings ekranı gelene kadar bekle (eski: kör 2500).
  if (!(await waitFor(actIs(/Settings|Preferences/i), 4000))) {
    // Tıklama tutmadı — menü hâlâ açık olabilir. Bir kez daha dene (ucuz).
    await tap(0.633, 0.395);
    await waitFor(actIs(/Settings|Preferences/i), 3000);
  }
  // Settings üst profil kartındaki AVATAR'a tap → ProfileInfoActivity. (İsim metnine
  // tap YANLIŞ: yanındaki ⊕ "hesap ekle" sheet'ini açar — avatar dairesine tap DOĞRU.)
  await tap(0.5, 0.205);
  if (!(await waitFor(actIs(/ProfileInfo/i), 4000))) {
    await tap(0.5, 0.205);
    await waitFor(actIs(/ProfileInfo/i), 3000);
  }
  const act = await currentActivity(serial).catch(() => '');
  return /ProfileInfo/i.test(act);
}

// WHATSAPP_SET_NAME — profil ismini (pushname) değiştir. payload: { name }.
async function whatsappSetName(serial, payload) {
  const name = String(p(payload, 'name', '')).trim();
  if (!name) throw new Error('name gerekli');
  if (name.length > 25) throw new Error('isim en fazla 25 karakter (WhatsApp sınırı)');
  await ensureAdbKeyboard(serial);
  const { sw, sh } = await wmSize(serial);
  const tap = (fx, fy) => adb(serial, ['shell', 'input', 'tap', String(Math.round(sw * fx)), String(Math.round(sh * fy))]);
  if (!(await waOpenProfileScreen(serial))) {
    return { status: 'NO_PROFILE', note: 'Profil ekranı açılamadı (WA kısıtlı/çıkış olabilir)' };
  }
  // Name satırına tap → isim düzenleme (ProfileInfoFragmentHost).
  await tap(0.289, 0.438); await sleep(1800);
  // Mevcut ismi tam sil (MOVE_END + 30× DEL) — ADBKeyboard clear yerine keyevent garanti.
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']).catch(() => undefined);
  for (let i = 0; i < 30; i++) await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_DEL']).catch(() => undefined);
  await sleep(500);
  // Yeni ismi ADBKeyboard broadcast ile yaz (boşluk dahil UTF-8 intact).
  await adb(serial, ['shell', 'am', 'broadcast', '-a', 'ADB_INPUT_TEXT', '--es', 'msg', shArg(name)]);
  await sleep(1500);
  // Save (yeşil buton alt).
  await tap(0.5, 0.894); await sleep(2500);
  // Doğrula: ProfileInfoActivity'ye döndük mü (Save başarılıysa isim ekranından çıkar).
  const act = await currentActivity(serial).catch(() => '');
  const ok = /ProfileInfo/i.test(act) && !/FragmentHost/i.test(act);
  return { status: ok ? 'OK' : 'UNCONFIRMED', name, activity: act };
}

// WHATSAPP_SET_AVATAR — profil resmini değiştir. payload: { imageB64 } (PNG/JPEG base64)
// VEYA { imagePath } (host'ta hazır dosya yolu). Galeri-picker Waydroid'de BOŞ geldiği
// için onu ATLIYORUZ: resmi /sdcard/DCIM/Camera'ya yaz → MediaStore'a indeksle → WA
// foto iznini ver → `com.whatsapp/.SetAsProfilePhoto` intent'ini content:// URI ile
// DOĞRUDAN aç (CropImage'e düşer) → Done. (galeri-picker'sız = çok daha stabil.)
async function whatsappSetAvatar(serial, payload) {
  const b64 = String(p(payload, 'imageB64', '') || '');
  if (!b64) throw new Error('imageB64 gerekli (PNG/JPEG base64)');
  const { sw, sh } = await wmSize(serial);
  const tap = (fx, fy) => adb(serial, ['shell', 'input', 'tap', String(Math.round(sw * fx)), String(Math.round(sh * fy))]);
  // 1) base64'ü host'ta geçici dosyaya yaz, cihaza push et (DCIM/Camera).
  const tmp = `/tmp/wa-avatar-${Date.now()}.img`;
  const remote = '/sdcard/DCIM/Camera/wa_avatar.png';
  await writeFile(tmp, Buffer.from(b64.replace(/^data:[^,]+,/, ''), 'base64'));
  try {
    await adb(serial, ['push', tmp, remote]);
    // 2) MediaStore'a indeksle + _id al (SetAsProfilePhoto content:// URI ister).
    await adb(serial, ['shell', 'su', '-c', 'content call --uri content://media --method scan_volume --arg external_primary']).catch(() => undefined);
    // ★2026-07-29 HIZ: eskiden burada sabit 1200 ms bekleniyordu. Tarama genelde çok
    // daha hızlı bitiyor; indeks görünene kadar POLL et (üst sınır eski davranışın
    // ~3 katı, yani yavaş cihazda daha da toleranslı).
    let mediaId = '';
    for (let i = 0; i < 12; i++) {
      const q = await adb(serial, ['shell', 'content', 'query', '--uri', 'content://media/external/images/media',
        '--projection', '_id:_data', '--where', `"_data='/storage/emulated/0/DCIM/Camera/wa_avatar.png'"`]).catch(() => '');
      const m = /_id=(\d+)/.exec(String(q || ''));
      if (m) { mediaId = m[1]; break; }
      await sleep(300);
    }
    if (!mediaId) return { status: 'NO_INDEX', note: 'Resim MediaStore\'a indekslenemedi' };
    // 3) WA'ya foto izni ver (yeni Android scoped-storage için şart).
    for (const perm of ['android.permission.READ_MEDIA_IMAGES', 'android.permission.READ_EXTERNAL_STORAGE']) {
      await adb(serial, ['shell', 'pm', 'grant', WA_PKG, perm]).catch(() => undefined);
    }
    // 4) SetAsProfilePhoto'yu content:// URI ile DOĞRUDAN aç → CropImage.
    await adb(serial, ['shell', 'am', 'start', '-n', `${WA_PKG}/.SetAsProfilePhoto`,
      '-a', 'android.intent.action.ATTACH_DATA', '-d', `content://media/external/images/media/${mediaId}`, '-t', 'image/png']);
    // ★HIZ: sabit 3500 ms yerine crop ekranı görünene kadar poll.
    let cropAct = '';
    for (let i = 0; i < 20; i++) {
      cropAct = await currentActivity(serial).catch(() => '');
      if (/CropImage|SetAsProfile/i.test(cropAct)) break;
      // ★Araya bir izin diyaloğu veya uygulama seçici girmiş olabilir; onayla ve
      // devam et. Eskiden bu ele alınmıyordu ve iş cihazı O EKRANDA bırakıp ölüyordu.
      if (isPermissionDialog(await focusedWindow(serial).catch(() => ''))) {
        await dismissPermissionDialog(serial, { tries: 1 }).catch(() => undefined);
      }
      await sleep(250);
    }
    if (!/CropImage|SetAsProfile/i.test(cropAct)) {
      return { status: 'NO_CROP', note: 'Crop ekranı açılmadı', activity: cropAct };
    }
    // 5) Done (crop sağ alt).
    await tap(0.833, 0.933);
    // ★HIZ: sabit 4000 ms yerine sonuç ekranı görünene kadar poll.
    let act = '';
    for (let i = 0; i < 20; i++) {
      act = await currentActivity(serial).catch(() => '');
      if (/ProfileInfo|Home/i.test(act)) break;
      await sleep(250);
    }
    const ok = /ProfileInfo|SetAsProfile|Home/i.test(act);
    return { status: ok ? 'OK' : 'UNCONFIRMED', mediaId, activity: act };
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

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
  if (!(await waOpenChat(serial, h, { to, from }))) {
    return { status: 'NO_CHAT', note: 'Sohbet açılamadı (numara geçersiz / hesap kısıtlı / ANR)', to };
  }

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
  // Retrying dump: if the contact-info screen didn't render / dumped blank, we must
  // NOT synthesize phone/name from the caller-supplied `to`/`from` and pass it off as
  // scraped data (the old `to ? '+'+to : ''` / `|| from` fallbacks did exactly that,
  // returning status:'OK' with fabricated values). Only build fields from REAL nodes.
  const nodes = await h.dumpOrRetry({ tries: 3, gapMs: 500 });
  const scraped = nodes.length > 0;
  const phoneNode = nodes.find((n) => /^\+?\d[\d\s()-]{6,}$/.test((n.text || '').trim()));
  const phone = phoneNode ? phoneNode.text.trim() : '';
  // Profile name shows as "~ Foo" (push-name) on the info screen.
  const tildeNode = nodes.find((n) => /^~\s*\S/.test((n.text || '').trim()));
  const byId = (frag) => (nodes.find((n) => n.resId.includes(frag) && n.text) || {}).text || '';
  const profileName = (tildeNode ? tildeNode.text.replace(/^~\s*/, '').trim() : '')
    || byId('conversation_contact_name') || byId('profile_info') || '';
  const about = byId('status') || byId('about');
  const profile = {
    ...(profileName ? { profileName } : {}),
    ...(about ? { about } : {}),
    ...(phone ? { phone } : {})
  };
  // Return to a neutral state.
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);

  // If the info screen never yielded a dump AND we have no avatar, we read nothing —
  // report honestly rather than an empty-but-OK profile.
  if (!scraped && !avatarBase64) {
    return { status: 'NO_INFO', note: 'Kişi bilgisi ekranı okunamadı (boş dump)', to, from };
  }
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
  if (!(await waOpenChat(serial, h, { to, from }))) {
    return { status: 'NO_CHAT', note: 'Sohbet açılamadı (numara geçersiz / hesap kısıtlı / ANR)', to, from };
  }
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
  // Retrying dump: the contact-info screen is usually dump-safe, but an empty read
  // must NOT trigger a state-blind coordinate tap — that would flip an already-blocked
  // contact to UNBLOCKED (reverse action) and lie that the request succeeded.
  const nodes = await h.dumpOrRetry({ tries: 3, gapMs: 500 });
  const norm = (t) => (t || '').trim();
  // Some builds carry the label in content-desc, not text — test both (screenTextRich).
  const rowText = (n) => `${norm(n.text)} ${norm(n.desc)}`.trim();
  const wantRow = nodes.find((n) => wantRe.test(rowText(n)));
  const oppRow  = nodes.find((n) => oppRe.test(rowText(n)));
  if (wantRow) {
    await h.tapNode(wantRow);
    await h.sleep(1200);
  } else if (oppRow) {
    return { status: block ? 'ALREADY_BLOCKED' : 'ALREADY_UNBLOCKED', to, from };
  } else if (nodes.length === 0) {
    // Every retry came back empty — we CANNOT know the current block state, so a
    // coordinate tap here is a coin-flip that could reverse the action. Bail honestly
    // instead of guessing (old code blind-tapped ~40%/82% and reported success).
    return { status: 'DUMP_EMPTY', note: 'Kişi bilgisi okunamadı — durum bilinmediği için işlem yapılmadı', to, from };
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

  // VERIFY-AFTER-ACTION: re-read the contact-info row and confirm the verb FLIPPED to
  // the opposite (Block→Unblock present, or vice-versa). Otherwise the tap may have
  // missed / the dialog may still be open, and reporting BLOCKED/UNBLOCKED would lie.
  await h.sleep(600);
  const afterBlock = await h.dumpOrRetry({ tries: 2, gapMs: 500 });
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
  if (afterBlock.length) {
    const flipped = afterBlock.some((n) => oppRe.test(`${norm(n.text)} ${norm(n.desc)}`.trim()));
    const stillWant = afterBlock.some((n) => wantRe.test(`${norm(n.text)} ${norm(n.desc)}`.trim()));
    if (!flipped && stillWant) {
      return { status: 'UNVERIFIED', note: 'İşlem doğrulanamadı (durum değişmemiş görünüyor)', to: to || undefined, from: from || undefined };
    }
  }
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

  // ── ★ROOT FAST PATH (~1s vs ~34s): read the block list straight from WhatsApp's DB.
  // The UI walk below is Settings → Privacy → Blocked contacts — 3 screens, a dump+tap
  // each, ~34s (measured live). wa.db's wa_block_list table holds one row per blocked
  // contact as "<number>@s.whatsapp.net" (schema: jid TEXT). Reading it needs no UI, no
  // screen change → zero ban surface, and is exact. Falls through to the UI walk only if
  // root/sqlite/db are unavailable.
  // ── ★ROOT FAST PATH (~1s vs ~34s): read the block list from wa.db instead of walking
  // Settings → Privacy → Blocked (3 screens, ~34s live). wa_block_list holds one row per
  // blocked contact as "<number>@s.whatsapp.net". We run sqlite3 UNDER su and feed the
  // SQL on STDIN via `sqlite-cli.sh` (a tiny host-side helper) — NOT inline, because the
  // adb→su→sh→sqlite quote layers mangle any inline SQL ("syntax error near x27SELECT").
  // A sentinel line (999999) proves sqlite actually ran, so an empty result is a real
  // "nobody blocked", not a failed query. Falls through to the UI walk if root/sqlite/db
  // are unavailable (no sentinel).
  {
    const raw = await adbT(
      serial,
      ['shell', 'su', '-c', 'sqlite3 /data/data/com.whatsapp/databases/wa.db'],
      8000,
      'SELECT jid FROM wa_block_list;\nSELECT 999999;\n'
    ).catch(() => '');
    if (/(^|\n)999999(\n|$)/.test(String(raw))) {
      const blocked = String(raw)
        .split('\n')
        .map((l) => (l.match(/^(\d{6,15})@/) || [])[1])
        .filter(Boolean)
        .map((n) => `+${n}`);
      return { status: 'OK', count: blocked.length, blocked };
    }
    // else: root/sqlite unavailable → fall through to the UI walk below.
  }

  const { sw, sh } = await wmSize(serial);
  const ok = await waOpenSettings(serial, h);
  if (!ok) return { status: 'NO_LIST', note: 'Ayarlar ekranı açılamadı', blocked: [], count: 0 };

  // Settings → Privacy (synthetic taps — same PopupWindow/list behaviour). EN/TR.
  const privacy = await h.pollNode(['Privacy', 'Gizlilik'], 6000, 'any');
  if (!privacy) return { status: 'NO_LIST', note: 'Gizlilik satırı bulunamadı', blocked: [], count: 0 };
  await h.tapSynNode(privacy);
  // Privacy screen landmark (EN/TR).
  await h.pollNode(['Last seen', 'Son görülme'], 6000, 'any');

  // "Contacts" (holding "Blocked accounts"/"Engellenen hesaplar") sits far down the
  // Privacy list — scroll until it appears (VERIFIED: ~2 page swipes). We match the
  // row by its subtitle. Retrying dump so a blank read isn't taken as "not present".
  let contactsRow = null;
  for (let s = 0; s < 5; s++) {
    contactsRow = findNode(await h.dumpOrRetry({ tries: 2, gapMs: 400 }), ['Blocked accounts', 'Engellenen hesaplar'], 'any');
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
  await h.pollNode(['WhatsApp contacts', 'WhatsApp kişileri'], 6000, 'any');
  // Open the actual blocked list. CRITICAL: the "Blocked accounts" TEXT node is NOT
  // clickable — its clickable parent is the row container
  // `block_list_privacy_contacts_preference`; tapping the text does nothing
  // (VERIFIED w/ screenshots). Tap that container by id; fall back to the text row.
  const hubNodes = await h.dumpOrRetry({ tries: 2, gapMs: 400 });
  const container = findNode(hubNodes, 'block_list_privacy_contacts_preference', 'id');
  if (container) await h.tapSynNode(container);
  else {
    const brow = findNode(hubNodes, ['Blocked accounts', 'Engellenen hesaplar'], 'any');
    if (brow) await h.tapSynNode(brow);
  }
  // Wait for the Blocked-accounts list to render (EN "Accounts" / TR "Hesaplar").
  await h.pollNode(['Accounts', 'Hesaplar'], 6000, 'any');
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
// ── WA OTOMATIK MEDYA INDIRME maskesini AC (job: WA_SET_AUTODOWNLOAD) ──────────
//
// ★NEDEN JOB: gelen medyanin OTOMATIK inmesi icin maske acik olmali
// (networkSafe). Maske UI'dan acilir (root TUTMAZ; WA acilista geri yukler).
// Job olmasi = agent'in mevcut kademeli dispatch'ine takilir -> 156 cihazda
// es zamanli UI otomasyonu YAPILMAZ (o sistemi kilitler). Idempotent: zaten
// 15 ise hizli atlar.
//
// ★2026-08-15 WhatsApp'i filo-referans APK'ya guncelle — VERI KORUYARAK.
// Kok sorun: filoda 3+ farkli WA surumu vardi (2.26.25/2.26.30/2.26.31); autodownload
// menusu her surumde farkli (activity adi, "Settings" vs "Settings X", scroll gereksinimi,
// checkbox davranisi) -> otomasyon guvenilmezdi; en eski surumler "guncelle" duvarinda
// (Alert ekrani) hic acilmiyordu. Cozum: ayni-imzali referans APK'yi `pm install -r -d`
// ile mevcut kurulumun USTUNE yaz. Canli dogrulandi (37.115: 2.26.30.77 -> 2.26.31.78):
// hesap/mesaj/oturum KORUNUR (chat listesi + eski mesajlar duruyor), surum tek noktaya
// toplanir. Buyuk APK'da `adb install` takiliyor -> push + `pm install` (EMULATOR_INSTALL
// ile ayni desen). Idempotent: zaten hedef surumdeyse dokunmaz.
async function waUpdateApk(serial, payload, jobId) {
  // Panel "guncelleme modali" icin canli ilerleme: her asama /jobs/:id/progress'e
  // yuzde+not gonderir (PROVISION ile ayni kanal → provision.progress WS event).
  const prog = (percent, note, status) =>
    (jobId ? reportProgress(jobId, 'wa-update', percent, note, status).catch(() => undefined) : Promise.resolve());
  const apkPath = String(p(payload, 'apkPath', '') || '/opt/fleet-agent/apk/whatsapp-latest.apk');
  if (!existsSync(apkPath)) throw new Error('referans APK bulunamadi: ' + apkPath);
  const readVer = async () => {
    // Sadece versionName satirini cek (tum dumpsys cikti ~100KB, maxBuffer bosuna sismesin).
    const out = await adb(serial, ['shell', `dumpsys package ${WA_PKG} | grep -m1 versionName`]).catch(() => '');
    return (/versionName=([0-9.]+)/.exec(String(out || '')) || [])[1] || '';
  };
  await prog(5, 'Referans APK ve mevcut sürüm kontrol ediliyor', 'RUNNING');
  const before = await readVer();
  let target = '';
  try { target = String(readFileSync(apkPath + '.version', 'utf8')).replace(/[^0-9.]/g, ''); } catch { /* .version opsiyonel */ }
  // Idempotent: zaten hedef surumdeyse hicbir sey yapma (toplu guncellemede tekrar-guvenli).
  if (before && target && before === target) {
    await prog(100, `Zaten güncel (${before})`, 'COMPLETED');
    return { ok: true, status: 'ZATEN_GUNCEL', before, after: before, target };
  }
  const tmp = '/data/local/tmp/wa-upd.apk';
  const apkMB = (() => { try { return Math.round(statSync(apkPath).size / 1048576); } catch { return 0; } })();
  await prog(25, `APK cihaza yükleniyor (${apkMB} MB)`, 'RUNNING');
  await adbT(serial, ['push', apkPath, tmp], 120000);
  await prog(60, `Kuruluyor — hesap/mesaj korunuyor (${before || '?'} → ${target || 'yeni'})`, 'RUNNING');
  const res = String(await adbT(serial, ['shell', 'pm', 'install', '-r', '-d', tmp], 180000) || '');
  await adb(serial, ['shell', 'rm', '-f', tmp]).catch(() => undefined);
  const ok = /Success/i.test(res);
  await prog(90, 'Sürüm doğrulanıyor', 'RUNNING');
  const after = await readVer();
  const status = ok ? (before === after ? 'AYNI_KALDI' : 'GUNCELLENDI') : 'BASARISIZ';
  await prog(100, ok ? `Tamamlandı: ${before || '?'} → ${after || '?'}` : `Başarısız: ${res.trim().slice(0, 80)}`,
    ok ? 'COMPLETED' : 'FAILED');
  return { ok, status, before, after, target, install: res.trim().slice(0, 140) };
}

// ★SURUM-AGNOSTIK (kullanici uyarisi): ayarlar YENI surumde "You" sekmesinde,
// ESKI surumde ⋮ menusunde "Settings" altinda. Ikisi de denenir. Landmark
// (metin) tabanli — koordinat DEGIL.
async function waSetAutoDownload(serial /*, payload */) {
  const h = waHelpers(serial);
  await h.ensureTouch();
  const PREF = '/data/data/com.whatsapp/shared_prefs/com.whatsapp_preferences_light.xml';
  const readMasks = async () =>
    (await adbSu(serial, `grep -ohE 'autodownload[a-z_]*" value="[0-9-]+' ${PREF} 2>/dev/null`)) || '';

  // ★2026-08-15 (kullanici): SADECE roaming yeterli — cihazlar Waydroid'de ethernet
  // uzerinden ROAMING olarak algilaniyor (networkType=3). 3 satir yerine tek satir:
  // daha az hata yuzeyi. Idempotent: roaming zaten 15 ise dokunma.
  const before = await readMasks();
  if (/autodownload_roaming_mask" value="15/.test(before)) {
    return { ok: true, status: 'ZATEN_ACIK', masks: before.trim().split('\n') };
  }

  // ★★★SURUM-AGNOSTIK ACILIS: "Storage and data" ekranina DOGRUDAN intent ile git.
  // Aktivite adi (.settings.SettingsDataUsageActivity) surumler arasi SABIT; boylece
  // You/⋮/Settings/Storage navigasyonu (surumden surume DEGISEN) tamamen ATLANIR.
  // Canli: hem yeni (mi235) hem eski (mi186) hem 3. varyant (mi7) surumde acildi.
  const onStorage = async () =>
    Boolean(await h.pollNode(['Media auto-download', 'Medya otomatik indirme', 'When roaming', 'Dolaşımdayken'], 6000, 'any'));
  await adb(serial, ['shell', 'am', 'start', '-n', `${WA_PKG}/.settings.SettingsDataUsageActivity`]).catch(() => undefined);
  let ready = await onStorage();
  // Dogrudan intent tutmazsa (nadir/cok eski surum) navigasyona dus.
  if (!ready) {
    let opened = await waOpenSettings(serial, h).catch(() => false);
    if (!opened) {
      await adb(serial, ['shell', 'am', 'start', '-n', `${WA_PKG}/.home.ui.HomeActivity`]).catch(() => undefined);
      const you = await h.pollNode(['You', 'Sen', 'Siz'], 6000, 'any');
      if (you) { await h.tapSynNode(you); await h.sleep(1500); }
      opened = Boolean(await h.pollNode(['Account', 'Hesap', 'Storage and data', 'Depolama ve veriler'], 7000, 'any'));
    }
    if (opened) {
      let depo = await h.pollNode(['Storage and data', 'Depolama ve veriler', 'Depolama ve Veriler'], 4000, 'any');
      if (!depo) { await adb(serial, ['shell', 'input', 'swipe', '540', '1500', '540', '700', '400']).catch(() => undefined); await h.sleep(900); depo = await h.pollNode(['Storage and data', 'Depolama ve veriler'], 4000, 'any'); }
      if (depo) { await h.tapSynNode(depo); ready = await onStorage(); }
    }
  }
  if (!ready) return { ok: false, status: 'DEPOLAMA_EKRANI_ACILMADI' };
  await adb(serial, ['shell', 'input', 'swipe', '540', '1500', '540', '800', '400']).catch(() => undefined);
  await h.sleep(800);

  // SADECE roaming (kullanici istegi — cihaz zaten roaming'de algilanıyor).
  const satirlar = [
    ['When roaming', 'Dolaşımdayken', 'Dolaşımda']
  ];
  const turler = [['Photos', 'Fotoğraflar'], ['Audio', 'Ses', 'Ses dosyaları'], ['Videos', 'Videolar'], ['Documents', 'Belgeler', 'Dokümanlar']];

  // ★★★KOORDINAT-TABANLI DOGRULAMALI-TOGGLE (a11y/synthetic tap YOK).
  // 4 denemede non-deterministik sonuc (14/15/1→0/1/15) ciktı; kok neden:
  // a11yClickText yanlis elemana gidiyor + tapSynNode kaciriyor + prefs STALE.
  // Cozum: dump'tan HER node'un checked'ini VE bounds'unu AYNI node'dan oku
  // (kanit: text+checked+bounds ayni node'da), SADECE kapali olanin bounds
  // ORTASINA `input tap` (koordinat). Zamanlama guvenli, hedefleme kesin.
  const tap = (cx, cy) => adb(serial, ['shell', 'input', 'tap', String(Math.round(cx)), String(Math.round(cy))]).catch(() => undefined);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nodeInfo = (dump, labels) => {
    for (const x of labels) {
      const m = new RegExp(`<node[^>]*\\btext="${esc(x)}"[^>]*?/?>`).exec(dump);
      if (!m) continue;
      const node = m[0];
      const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
      if (!b) continue;
      return { checked: /checked="true"/.test(node), cx: (Number(b[1]) + Number(b[3])) / 2, cy: (Number(b[2]) + Number(b[4])) / 2 };
    }
    return null;
  };

  let done = 0;
  for (const row of satirlar) {
    // Satiri AC: pollNode+tapSynNode (satir tiklanabilir PARENT'i bulur; metin
    // node'unun bounds'una koordinat-tap satiri ACMIYORDU — ayarlanan=0 kaldi).
    let node = await h.pollNode(row, 2500, 'any');
    if (!node) { await adb(serial, ['shell', 'input', 'swipe', '540', '1500', '540', '800', '400']).catch(() => undefined); await h.sleep(900); node = await h.pollNode(row, 3000, 'any'); }
    if (!node) continue;
    await h.tapSynNode(node);
    await h.sleep(1800);
    // Diyalog acildi mi — pollNode ile (calisan yontem; nodeInfo diyalog kontrolunde
    // Photos'u bulamiyor ve satiri islenmemis sayip ayarlanan=0 birakiyordu).
    if (!(await h.pollNode(turler[0], 5000, 'any'))) continue;
    // 3 tur: kapali kutulari isaretle (once a11y — script'te calisan yontem —
    // olmazsa koordinat-tap), dump ile dogrula. Kutu checked ise DOKUNMA.
    for (let pass = 0; pass < 3; pass++) {
      const dd = await h.dumpOrRetry();
      let allOn = true;
      for (const t of turler) {
        const tn = nodeInfo(dd, t);
        if (!tn || tn.checked) continue;   // yok veya zaten acik
        allOn = false;
        let hit = false;
        for (const x of t) { if (await h.a11yClickText(x).catch(() => false)) { hit = true; break; } }
        if (!hit) await tap(tn.cx, tn.cy);  // a11y tutmazsa koordinat
        await h.sleep(450);
      }
      if (allOn) break;
    }
    // OK
    let okd = false;
    for (const x of ['OK', 'TAMAM', 'Tamam']) { if (await h.a11yClickText(x).catch(() => false)) { okd = true; break; } }
    if (!okd) { const okn = nodeInfo(await h.dumpOrRetry(), ['OK', 'TAMAM', 'Tamam']); if (okn) await tap(okn.cx, okn.cy); }
    await h.sleep(800);
    done++;
  }
  // ★Gercek sonuc: WhatsApp'i kapat -> prefs FLUSH olur -> guncel maskeyi oku.
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  await h.sleep(1800);
  const after = await readMasks();
  const roamOk = /autodownload_roaming_mask" value="15/.test(after);   // sadece roaming
  return { ok: roamOk, status: roamOk ? 'AYARLANDI' : 'KISMI', ayarlanan: done, masks: after.trim().split('\n') };
}

async function whatsappMyNumber(serial /*, payload */) {
  const h = waHelpers(serial);
  await h.ensureTouch();
  const looksPhone = (t) => /^\+?\d[\d\s()+-]{8,}$/.test(String(t || '').trim());

  // ── ★ROOT FAST PATH (~1s, 100% reliable): read the registered number straight from
  // WhatsApp's own prefs file. The UI paths below are FRAGILE — the self-chat "(You)"
  // row only exists if the account ever messaged itself, and the Settings→Profile walk
  // often fails to find the number on the new WA layout → "okunamadı" (the #1 error in
  // the live logs). registration_jid holds the full E.164 (VERIFIED across mi9/mi22/mi27:
  // 905394660382 / 905392555512 / 355683175346). No UI navigation → no screen change →
  // zero ban surface. Falls through to the UI paths only if root/prefs are unavailable.
  {
    const prefs = await adbSu(
      serial,
      "cat /data/data/com.whatsapp/shared_prefs/com.whatsapp_preferences_light.xml 2>/dev/null"
    ).catch(() => '');
    const jid = (String(prefs).match(/registration_jid">(\d{8,15})/) || [])[1];
    if (jid) return { status: 'OK', number: `+${jid}` };
    // Secondary: assemble from cc + ph if registration_jid is absent on some builds.
    const cc = (String(prefs).match(/"cc">(\d{1,4})/) || [])[1];
    const ph = (String(prefs).match(/"ph">(\d{6,14})/) || [])[1];
    if (cc && ph) return { status: 'OK', number: `+${cc}${ph}` };
  }

  // ── FAST PATH (~5s vs ~22s): the chat list shows the account's own number as a
  // self-chat row "＋90 … (You)". Open Home, take ONE dump, and read it directly —
  // no Settings navigation (which costs ~5 extra ~2.2s dumps). Falls through to the
  // Settings path below if the self-chat row isn't present (user never messaged
  // themselves), so nothing is lost. VERIFIED: text="+57 310 8228143 (You)".
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  await h.sleep(800);
  await adb(serial, ['shell', 'am', 'start', '-n', `${WA_PKG}/.home.ui.HomeActivity`]).catch(() => undefined);
  await h.pollNode(['More options', 'Diğer seçenekler'], 8000, 'desc'); // chat list is up
  {
    const home = await h.dumpOrRetry({ tries: 2, gapMs: 400 });
    // Self-chat row suffix is "(You)" (EN) or "(Sen)" (TR).
    const selfRe = /\((You|Sen)\)/i;
    const youNode = home.find((n) => selfRe.test(n.text || '') && looksPhone((n.text || '').replace(/\s*\((You|Sen)\)\s*/i, '')));
    if (youNode) {
      const num = youNode.text.replace(/\s*\((You|Sen)\)\s*/i, '').trim();
      if (num) return { status: 'OK', number: num };
    }
  }

  // ── FALLBACK: Settings → profile row ("You") → Profile screen "Phone" number.
  const ok = await waOpenSettings(serial, h);
  if (!ok) return { status: 'NOT_FOUND', note: 'Ayarlar ekranı açılamadı' };
  // The profile row at the very top has content-desc="You". Tapping it opens the
  // Profile screen. (Fallback: some builds label it with the account name only.)
  // Use synthetic taps throughout Settings (consistent with the menu behaviour).
  const youRow = await h.pollNode(['You', 'Sen'], 5000, 'desc');
  if (youRow) await h.tapSynNode(youRow);
  else {
    // Fallback: tap the top profile card by coordinate (~top of the list).
    const { sw, sh } = await wmSize(serial);
    await h.tapSyn(Math.round(sw * 0.5), Math.round(sh * 0.16));
  }
  // Wait for the Profile screen ("Phone"/"Telefon" label is the landmark) then read
  // the number that follows it.
  await h.pollNode(['Phone', 'Telefon'], 6000, 'text');
  await h.sleep(600);
  const nodes = await h.dumpOrRetry({ tries: 3, gapMs: 500 });
  if (!nodes.length) return { status: 'NOT_FOUND', note: 'Profil ekranı okunamadı (boş dump)' };
  // Prefer the node right after the "Phone"/"Telefon" label; else any phone-like text
  // that is NOT the "(You)"/"(Sen)" self-chat entry.
  let number = '';
  const phoneIdx = nodes.findIndex((n) => /^(phone|telefon)$/i.test((n.text || '').trim()));
  if (phoneIdx >= 0) {
    const after = nodes.slice(phoneIdx + 1).find((n) => looksPhone(n.text));
    if (after) number = after.text.trim();
  }
  if (!number) {
    const any = nodes.find((n) => looksPhone(n.text) && !/\((You|Sen)\)/i.test(n.text));
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
    // ★2026-08-12: cihaz-tarafı sh yeniden ayrıştırması — `dest` medya URL'sinden
    // türeyen bir ad taşıyor, tırnaklanmadan gitmemeli (bkz. shArg yorumu).
    await adb(serial, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', shArg(`file://${dest}`)]).catch(() => undefined);
  } finally {
    await safeRm(local);
  }
  // Give the media scanner a beat to index the new file before we open the grid.
  await h.sleep(1500);

  // 2) Open the chat (force-stop for a clean cold open).
  await adb(serial, ['shell', 'am', 'force-stop', WA_PKG]).catch(() => undefined);
  await h.sleep(800);
  if (!(await waOpenChat(serial, h, { to }))) {
    return { status: 'NO_CHAT', note: 'Sohbet açılamadı (numara geçersiz / hesap kısıtlı / ANR)', to, mediaUrl };
  }

  // 3) Tap the compose Attach (📎) button. Prefer its node (content-desc="Attach"),
  //    fall back to the known compose-bar position. Synthetic tap (overlay opens).
  const attachNode = findNode(await h.dump().catch(() => []), ['Attach', 'Ekle'], 'desc');
  if (attachNode) await h.tapSynNode(attachNode);
  else await h.tapScaled(864, 2198, 1080, 2400); // scaled ~80%/91.6% (was raw sw/sh)
  // Wait for the attach sheet (its Gallery/Document labels are the landmark; EN/TR).
  await h.pollNode(['Gallery', 'Galeri', 'Document', 'Belge'], 4000, 'any');

  // 4) Documents go through the Document row; images use the inline photo grid.
  if (kind === 'document') {
    await h.tapSynIf(['Document', 'Belge'], 'any').catch(() => false);
    await h.sleep(2500);
    // Document picker: prefer the entry whose name EXACTLY matches the file we just
    // pushed (fileName) — don't grab "the top-most .pdf" which could be an unrelated
    // older document (wrong-file send reported as SENT). Fall back to any doc-like row
    // only if the exact match isn't visible; last-resort a scaled coordinate tap.
    const docNodes = await h.dumpOrRetry({ tries: 2, gapMs: 500 });
    const exact = docNodes.find((n) => (n.text || '').trim() === fileName || (n.desc || '').includes(fileName));
    const anyDoc = docNodes.find((n) => /\.(pdf|docx?|txt|xlsx?)$/i.test(n.text || ''));
    const pick = exact || anyDoc;
    if (pick) await h.tapSynNode(pick);
    else await h.tapScaled(540, 600, 1080, 2400); // scaled last-resort (was fixed 0.5/0.25)
    await h.sleep(2000);
  } else {
    // Pick the NEWEST photo tile from the inline grid. Tiles carry content-desc
    // "Photo, date <when>…"; our just-pushed file is the freshest, so among matching
    // tiles prefer the top-LEFT one (smallest cy, then smallest cx) — the grid orders
    // newest-first, and picking by position is more robust than "first in doc order"
    // when the dump order doesn't match visual order. Retrying dump (grid may still
    // be indexing). The media preview + SEND_UNCONFIRMED guard downstream catches a
    // wrong/failed pick, so this only needs to be best-effort correct.
    const gridNodes = await h.dumpOrRetry({ tries: 3, gapMs: 600 });
    const tiles = gridNodes
      .filter((n) => /^Photo,|^Fotoğraf,/i.test((n.desc || '').trim()))
      .sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx));
    if (tiles.length) {
      await h.tapSynNode(tiles[0]);
      await h.sleep(2000);
    } else {
      // No inline grid — open Gallery and take the first (top-left) item.
      await h.tapSynIf(['Gallery', 'Galeri'], 'any').catch(() => false);
      await h.sleep(2500);
      // ★2026-07-29: Galeri uygulaması İLK AÇILIŞTA kendi runtime izin diyaloğunu
      // gösterir ("Allow Gallery to access photos…"). Eskiden bu ele alınmıyordu:
      // izinler yalnızca WA_PKG'ye veriliyordu, diyalog ekranda kalıyor, aşağıdaki
      // düğüm araması boşa düşüyor ve iş cihazı O DİYALOGDA bırakıp ölüyordu
      // (canlı olarak 6 cihaz böyle takılı bulundu). Önce diyaloğu onayla.
      await dismissPermissionDialog(serial, { tries: 2 }).catch(() => undefined);
      const galNodes = await h.dumpOrRetry({ tries: 2, gapMs: 500 });
      const first = galNodes
        .filter((n) => /^Photo,|^Fotoğraf,|^Image|image_thumb/i.test((n.desc || '') + (n.resId || '')))
        .sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx))[0];
      if (first) await h.tapSynNode(first); else await h.tapScaled(194, 672, 1080, 2400); // scaled ~18%/28%
      await h.sleep(2000);
    }
  }

  // 5) We should now be on the media preview (a caption field + a send FAB). Confirm
  //    we actually reached it: the preview has a "Add a caption…" field or a Send
  //    button with content-desc="Send".
  let onPreview = Boolean(await h.pollNode(['Send', 'Gönder'], 3500, 'desc'))
    || Boolean(findNode(await h.dump().catch(() => []), ['caption', 'Add a caption', 'Açıklama ekle'], 'any'));
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
  // Verify with a retrying dump: we require POSITIVE evidence the send happened —
  // the preview's Send button gone AND the chat compose bar (entry) back. A single
  // blank dump would make both findNode()s return null → stillPreview=false → a FALSE
  // SENT. So if every retry is empty we can't confirm → SEND_UNCONFIRMED, not SENT.
  const after = await h.dumpOrRetry({ tries: 3, gapMs: 500 });
  if (!after.length) {
    return { status: 'SEND_UNCONFIRMED', note: 'Gönderim doğrulanamadı (ekran okunamadı)', to, mediaUrl, ...(caption ? { caption } : {}) };
  }
  const backOnChat = Boolean(findNode(after, 'com.whatsapp:id/entry', 'id'));
  const stillPreview = Boolean(findNode(after, 'Send', 'desc')) && !backOnChat;
  if (stillPreview || !backOnChat) {
    return { status: 'SEND_UNCONFIRMED', note: 'Gönder sonrası sohbet ekranına dönülmedi', to, mediaUrl, ...(caption ? { caption } : {}) };
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
  if (!(await waOpenChat(serial, h, { to }))) {
    return { status: 'NO_CHAT', note: 'Sohbet açılamadı — silme yapılmadı (numara geçersiz / hesap kısıtlı / ANR)', to, scope };
  }

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
      // matchText was requested but NOT found among the visible bubbles. Do NOT fall
      // through to "delete the newest bubble" — that silently deletes the WRONG
      // message (irreversible data loss) when the target scrolled off-screen or the
      // text differs. Signal not-found so the caller returns NOT_FOUND instead.
      return null;
    }
    const texts = nodes.filter(isRealBubble);
    const last = texts[texts.length - 1];
    if (last) return { x: last.cx, y: last.cy };
    // No matchText and no real bubble found → don't blind-tap a fixed coordinate
    // (that could long-press a chat-list row and open the wrong CAB). Signal not-found.
    return null;
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
    const bubble = await pickBubble();
    if (!bubble) return { notFound: true }; // matchText not visible / no bubble → don't blind-tap
    await h.longPress(bubble.x, bubble.y, 750);
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
  // Target bubble not found → report NOT_FOUND rather than deleting the wrong message.
  if (deleteNode && deleteNode.notFound) {
    return { status: 'NOT_FOUND', note: matchText ? `"${matchText}" içeren mesaj ekranda bulunamadı` : 'Silinecek mesaj bulunamadı', to, scope };
  }
  if (!deleteNode) { await h.sleep(500); deleteNode = await openCab(); }
  if (deleteNode && deleteNode.notFound) {
    return { status: 'NOT_FOUND', note: matchText ? `"${matchText}" içeren mesaj ekranda bulunamadı` : 'Silinecek mesaj bulunamadı', to, scope };
  }
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
  if (!chosen) {
    await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
    return { status: 'ATTEMPTED', to, scope, note: 'Onay düğmesi bulunamadı', dialogTexts };
  }
  // VERIFY-AFTER-ACTION: the synthetic confirm tap can miss/be swallowed (the CAB
  // overlay ignores vtouch) while `chosen` is truthy merely because the button node
  // EXISTED. Confirm the deletion really happened BEFORE reporting DELETED: the
  // confirm dialog must be gone AND the bubble must show the tombstone ("You deleted
  // this message" / "Bu mesaj silindi"). A retrying dump so a blank read isn't taken
  // as "dialog closed". If we can't confirm → ATTEMPTED, not DELETED.
  const afterDel = await h.dumpOrRetry({ tries: 3, gapMs: 500 });
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
  const actualScope = chosen === 'everyone' ? 'everyone' : 'me';
  if (!afterDel.length) {
    return { status: 'ATTEMPTED', to, scope: actualScope, note: 'Silme doğrulanamadı (ekran okunamadı)' };
  }
  const dialogGone = !afterDel.some((n) => /delete for|delete message|mesajı sil|sil\?/i.test((n.text || '').trim()));
  const tombstone = afterDel.some((n) => /you deleted this message|this message was deleted|bu mesaj silindi|mesajı sildiniz/i.test((n.text || '').trim()));
  // 'me'/'plain' scope removes the bubble locally (no tombstone) — dialog-gone is the
  // best signal there; 'everyone' leaves a tombstone we can positively confirm.
  const confirmed = actualScope === 'everyone' ? (tombstone || dialogGone) : dialogGone;
  if (!confirmed) {
    return { status: 'ATTEMPTED', to, scope: actualScope, note: 'Onay sonrası silme doğrulanamadı (diyalog hâlâ açık olabilir)' };
  }
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
  if (!(await waOpenChat(serial, h, { to }))) {
    return { status: 'NO_CHAT', note: 'Sohbet açılamadı — temizleme yapılmadı (numara geçersiz / hesap kısıtlı / ANR)', to };
  }

  // Open the chat overflow (⋮, top-right). Prefer the node; fall back to its known
  // fixed center. Synthetic tap so the popup stays open. Locale-safe (EN/TR desc).
  const overflow = findNode(await h.dump().catch(() => []), 'More options', 'desc')
    || findNode(await h.dump().catch(() => []), 'Diğer seçenekler', 'desc');
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
  // Verify the dialog actually closed (confirm button gone) → real CLEARED. Use a
  // retrying dump: a single blank dump ([]) would make [].some(isConfirmBtn)===false
  // and report a FALSE CLEARED even though nothing was cleared. If every retry comes
  // back empty we can't confirm the dialog closed → report ATTEMPTED, not CLEARED.
  const afterClear = await h.dumpOrRetry({ tries: 3, gapMs: 500 });
  await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK']).catch(() => undefined);
  if (!afterClear.length) return { status: 'ATTEMPTED', note: 'Temizleme doğrulanamadı (ekran okunamadı)', to };
  const dialogStillOpen = afterClear.some(isConfirmBtn);
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
  // ★2026-08-12: `comp`/`pkg` iş yükünden (EMULATOR_OPEN_APP → packageName/activity)
  // gelebiliyor ve cihazın sh'inde yeniden ayrıştırılıyor → tırnaklanmadan
  // `com.x;id` gibi bir değer cihazda komut çalıştırırdı (bkz. shArg yorumu).
  if (comp) return adb(serial, ['shell', 'am', 'start', '-n', shArg(comp)]);
  // Last resort: ask am to start the package's default launcher intent.
  return adb(serial, ['shell', 'monkey', '-p', shArg(pkg), '-c', 'android.intent.category.LAUNCHER', '1']);
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
  // 5s dump timeout (was 12s): on this build uiautomator either returns quickly or
  // HANGS; a long timeout just stalls the state machine when a11y is momentarily
  // unreadable. Since state detection now leads with dumpsys-window (curFocus, which
  // never hangs) and actions use raw coordinate taps, a short dump timeout keeps the
  // loop responsive and lets it fall back to focus/coordinate paths fast.
  await adbT(serial, ['shell', 'uiautomator', 'dump', '/sdcard/uidump.xml'], 5000).catch(() => undefined);
  return adbExecOutText(serial, ['cat', '/sdcard/uidump.xml'], 4000).catch(() => '');
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
      checked: attr(a, 'checked') === 'true',
      bounds: [x1, y1, x2, y2],
      cx: Math.round((x1 + x2) / 2),
      cy: Math.round((y1 + y2) / 2)
    });
  }
  // Clickable-parent resolution (opendroid technique, adapted for our ADB flow):
  // a matched leaf (an icon/label) is often clickable=false while a wrapping
  // container is the real tap target. For each node, precompute tapX/tapY = the
  // SMALLEST clickable node whose bounds fully contain it (itself if clickable).
  // tapNode falls back to these when a node isn't directly clickable, which fixes
  // blind-tap misses on WhatsApp icon leaves — purely additive (cx/cy untouched).
  for (const n of nodes) {
    n.tapX = n.cx;
    n.tapY = n.cy;
    if (n.clickable) continue;
    const [ax1, ay1, ax2, ay2] = n.bounds;
    let best = null, bestArea = Infinity;
    for (const c of nodes) {
      if (!c.clickable) continue;
      const [bx1, by1, bx2, by2] = c.bounds;
      if (bx1 <= ax1 && by1 <= ay1 && bx2 >= ax2 && by2 >= ay2) {
        const area = (bx2 - bx1) * (by2 - by1);
        if (area < bestArea) { bestArea = area; best = c; }
      }
    }
    if (best) { n.tapX = best.cx; n.tapY = best.cy; }
  }
  return nodes;
}

// Find a node whose text/desc/resId matches (substring, case-insensitive).
// `field` picks which attribute(s) to match: 'text' | 'desc' | 'id' | 'any'.
// `query` may be a single string OR an array of candidates tried in order — the
// resource-id fallback chain (opendroid technique): e.g.
//   findNode(nodes, ['com.whatsapp:id/send', 'com.whatsapp:id/send_button'], 'id')
// so a stable resource-id survives resolution/theme changes and app updates that
// only shift coordinates. Single-string callers are unaffected.
function findNode(nodes, query, field = 'any') {
  const candidates = Array.isArray(query) ? query : [query];
  for (const cand of candidates) {
    const q = String(cand).toLowerCase();
    const hit = (v) => v && v.toLowerCase().includes(q);
    const found = nodes.find((n) => {
      if (field === 'text') return hit(n.text);
      if (field === 'desc') return hit(n.desc);
      if (field === 'id') return hit(n.resId);
      return hit(n.text) || hit(n.desc) || hit(n.resId);
    });
    if (found) return found;
  }
  return null;
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

// Install a repo-bundled APK (from APK_DIR) onto this job's instance via
// host-mount + `pm install`. The container's /data/local/tmp is directly visible
// on the host under the instance's userdata dir; copying there (then pm install
// via lxc-attach) is the only reliable path for the 137 MB WhatsApp APK — adb
// push/install both stall on fresh ARM Waydroid. Mirrors the manual recipe.
async function installBundledApk(job, apkFile) {
  const instance = String(p(job.payload || {}, 'instance', '')).trim();
  if (!instance) throw new Error('bundled install: instance yok (device meta.instance gerekli)');
  return installBundledApkTo(instance, apkFile);
}

// Core: install a repo-bundled APK onto a named instance. Used both by the
// EMULATOR_INSTALL_APK job (via installBundledApk) and directly by the provision
// recipe's root/apks steps.
async function installBundledApkTo(instance, apkFile) {
  if (!instance) throw new Error('bundled install: instance gerekli');
  if (!apkFile || apkFile.includes('/') || apkFile.includes('..')) throw new Error(`geçersiz apkFile: ${apkFile}`);
  const src = join(APK_DIR, apkFile);
  await execFileAsync('test', ['-f', src]).catch(() => { throw new Error(`APK bulunamadı: ${src}`); });

  // The container's /data maps to one of two host layouts (full recipe vs LITE).
  const candidates = [
    `/root/.local/share-${instance}/waydroid/data/local/tmp`,
    `/root/.local/share/waydroid.${instance}/data/local/tmp`
  ];
  let hostTmp = '';
  for (const c of candidates) {
    const base = c.replace(/\/local\/tmp$/, '');
    if (await execFileAsync('test', ['-d', base]).then(() => true).catch(() => false)) { hostTmp = c; break; }
  }
  if (!hostTmp) throw new Error(`instance data dizini yok: ${instance}`);

  const dest = join(hostTmp, apkFile);
  await execFileAsync('mkdir', ['-p', hostTmp]);
  // #8 APK-share: hardlink instead of copying 137MB per provision. The bundled APK
  // (APK_DIR) and the instance data dir live on the SAME host filesystem (/), so a
  // hardlink is instant + costs zero extra disk (just another dirent to the same
  // inode). Falls back to a real copy if the link fails (e.g. cross-fs). We hardlink
  // to a temp name then rename so a stale dest never blocks the link.
  await execFileAsync('rm', ['-f', dest]).catch(() => undefined);
  const linked = await execFileAsync('ln', ['-f', src, dest]).then(() => true).catch(() => false);
  if (!linked) await execFileAsync('cp', ['-f', src, dest]);
  await execFileAsync('chmod', ['666', dest]).catch(() => undefined);
  await execFileAsync('chown', ['2000:2000', dest]).catch(() => undefined);

  // ROOT CAUSE of "install fails during provision but works manually minutes
  // later": Waydroid's suspend_action=freeze FREEZES the container when it looks
  // idle, which stalls a long `pm install` (the 137 MB WhatsApp APK) mid-flight.
  // Keep the container thawed for the whole install with a background unfreeze
  // loop (best-effort; harmless if suspend_action is already none).
  const lxcp = `/var/lib/waydroid.${instance}/lxc`;
  let thawing = true;
  const thaw = (async () => {
    while (thawing) {
      await execFileAsync('lxc-unfreeze', ['-n', 'waydroid', '-P', lxcp]).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 2000));
    }
  })();

  // pm install via lxc-attach (root, stable). Big APK → generous timeout. Wrap in
  // `sh -c ... 2>&1; true` so a non-zero exit (pm prints warnings to stderr and
  // exits non-zero on some ARM Waydroid builds even when the install lands) does
  // NOT throw before we can verify — we trust `pm path` below, not the exit code.
  let out = '';
  let installed = false;
  try {
    // `sh -c` doesn't inherit Android's PATH, so `pm` alone is "not found" — use
    // its absolute path. (Direct `lxc-attach -- pm` resolved it, `sh -c 'pm'` does not.)
    out = await lxcAttach(instance, ['/system/bin/sh', '-c',
      `export PATH=/system/bin:/system/xbin:$PATH; pm install -r -g /data/local/tmp/${apkFile} 2>&1; true`], 240000);
    // `pm install` printing "Success" IS the authoritative signal — trust it first.
    // The old code re-checked with `pm path`, which returns nothing when the
    // container briefly freezes between install and probe, so a genuinely-installed
    // APK read as FAILED and the whole step re-installed it 3–10× (VERIFIED: log
    // spam "FAIL: Success", provision dragged past 6 min). Only fall back to `pm
    // path` when the output is ambiguous (no clear Success/Failure line).
    if (/\bSuccess\b/i.test(out)) installed = true;
    else if (/\bFailure\b|INSTALL_FAILED/i.test(out)) installed = false;
    else {
      const pkgLine = pkgFor(apkFile);
      installed = pkgLine
        ? (await lxcAttach(instance, ['/system/bin/pm', 'path', pkgLine], 15000).catch(() => '')).includes('package:')
        : false;
    }
  } catch (e) {
    out = `EXC:${e.message}`;
  } finally {
    thawing = false;
    await thaw.catch(() => undefined);
  }
  await execFileAsync('rm', ['-f', dest]).catch(() => undefined);
  if (!installed) {
    log(`installBundledApk ${apkFile} FAIL: ${out.slice(0, 160)}`);
    throw new Error(`pm install başarısız (${apkFile}): ${out.slice(0, 160)}`);
  }
  // ★CACHE-INVALIDATION: detectTelegramPkg() caches `null` (NOT_INSTALLED) per-serial.
  // If a device was probed BEFORE Telegram was installed (e.g. an early telegramSend that
  // returned NOT_INSTALLED, or a provision that installs Telegram after some other send),
  // that stale `null` would make every subsequent send keep reporting NOT_INSTALLED even
  // though the APK is now present. installBundledApkTo works on an INSTANCE (host-side),
  // not a serial, and one instance can be reached via several serial forms, so we can't
  // map instance→serial reliably here. The tgPkgCache is tiny (one entry per serial in
  // this session), so on a Telegram install we simply drop the WHOLE cache — the next
  // detectTelegramPkg() re-probes `pm list packages` and finds the freshly-installed pkg.
  // (Same fix registerTelegram already applies with tgPkgCache.delete(serial) after its
  // own apkUrl side-load; this covers the provision/bundled-install path too.)
  if (apkFile === 'telegram.apk' || pkgFor(apkFile) === 'org.telegram.messenger.web') tgPkgCache.clear();
  return { stdout: out.trim(), apkFile, instance };
}

// Map a bundled APK file name → its package (for post-install verification).
function pkgFor(apkFile) {
  return ({
    'whatsapp.apk': 'com.whatsapp',
    'magisk.apk': 'io.github.huskydg.magisk',
    'fleet-a11y.apk': 'com.fleet.a11y',
    'adbkeyboard.apk': 'com.android.adbkeyboard',
    // The bundled telegram.apk is the direct-website build (org.telegram.messenger.web);
    // the Play build is org.telegram.messenger. detectTelegramPkg() probes for either at
    // runtime, so this entry only drives the post-install `pm path` verification below —
    // point it at the package the bundled APK actually installs. If a future bundle swaps
    // to the Play APK, change this to 'org.telegram.messenger' (or verify by pkgFor→detect).
    'telegram.apk': 'org.telegram.messenger.web'
  })[apkFile] || '';
}

// Write integrity-spoof props into the instance's waydroid_base.prop + waydroid.prop
// BEFORE boot, so the container comes up looking like a real, locked Samsung phone
// (WhatsApp shows "Login not available for security reasons" on a Waydroid device
// that reports model="WayDroid arm64 Device"/tags=test-keys). This is the ROOT-LESS
// path: Waydroid's *.prop files are read by init at boot and DO override ro.* (like
// ro.hardware.egl), so we don't need resetprop/root (which doesn't work headless —
// Magisk's su-approval handshake can't be answered). Per-device fingerprint via fp
// so WhatsApp can't link the fleet; falls back to a Galaxy S21. VERIFIED live on mi5.
// Per-model coherent device profiles (device/name/fingerprint/description that
// actually go with each model), so every provisioned phone spoofs a DISTINCT and
// INTERNALLY-CONSISTENT identity. Picking model="Pixel 8 Pro" but writing a Samsung
// build fingerprint is a dead giveaway WhatsApp uses to link/ban the fleet — so we
// key the whole build off the model the control-plane chose. Unknown model → Galaxy
// S21 profile (matches the SM-G991B default elsewhere).
const DEVICE_PROFILES = {
  'SM-S918B':      { brand: 'samsung',  manufacturer: 'samsung',  device: 'dm3q',     name: 'dm3qxxx', fp: 'samsung/dm3qxxx/dm3q:14/UP1A.231005.007/S918BXXS4CWL2:user/release-keys' },
  'SM-A546B':      { brand: 'samsung',  manufacturer: 'samsung',  device: 'a54x',     name: 'a54xnaxx', fp: 'samsung/a54xnaxx/a54x:14/UP1A.231005.007/A546BXXU7CWL1:user/release-keys' },
  'SM-G991B':      { brand: 'samsung',  manufacturer: 'samsung',  device: 'o1s',      name: 'o1seea',  fp: 'samsung/o1seea/o1s:13/TP1A.220624.014/G991BXXU5CVK1:user/release-keys' },
  'Pixel 8 Pro':   { brand: 'google',   manufacturer: 'Google',   device: 'husky',    name: 'husky',   fp: 'google/husky/husky:14/AP2A.240805.005/12025142:user/release-keys' },
  'Pixel 7':       { brand: 'google',   manufacturer: 'Google',   device: 'panther',  name: 'panther', fp: 'google/panther/panther:14/AP2A.240805.005/12025142:user/release-keys' },
  'Redmi Note 12': { brand: 'Redmi',    manufacturer: 'Xiaomi',   device: 'tapas',    name: 'tapas',   fp: 'Redmi/tapas/tapas:13/TKQ1.221114.001/V14.0.3.0.TMGMIXM:user/release-keys' },
  '2210132G':      { brand: 'Xiaomi',   manufacturer: 'Xiaomi',   device: 'fuxi',     name: 'fuxi',    fp: 'Xiaomi/fuxi/fuxi:14/UKQ1.230804.001/V816.0.8.0.UMCMIXM:user/release-keys' },
  'CPH2449':       { brand: 'OnePlus',  manufacturer: 'OnePlus',  device: 'OP5943L1', name: 'CPH2449', fp: 'OnePlus/CPH2449/OP5943L1:14/UKQ1.230924.001/R.202405xx:user/release-keys' },
  'CPH2451':       { brand: 'OPPO',     manufacturer: 'OPPO',     device: 'OP5761L1', name: 'CPH2451', fp: 'OPPO/CPH2451/OP5761L1:13/TP1A.220905.001/R.202312xx:user/release-keys' },
  'V2230':         { brand: 'vivo',     manufacturer: 'vivo',     device: 'V2230',    name: 'V2230',   fp: 'vivo/V2230/V2230:13/TP1A.220624.014/compiler05061933:user/release-keys' },
  'moto g84 5G':   { brand: 'motorola', manufacturer: 'motorola', device: 'bangkk',   name: 'bangkk',  fp: 'motorola/bangkk_g/bangkk:14/U1TDS34.66-24-10/xxxxx:user/release-keys' }
};

async function applyIntegritySpoof(instance, fp = {}) {
  const model = fp.model || 'SM-G991B';
  const prof = DEVICE_PROFILES[model] || DEVICE_PROFILES['SM-G991B'];
  // Trust the control-plane fp when it provides these; otherwise use the coherent
  // profile for the chosen model (NEVER the fixed Samsung strings for a non-Samsung).
  const brand = fp.brand || prof.brand;
  const manufacturer = fp.manufacturer || prof.manufacturer;
  const device = fp.device || prof.device;
  const name = fp.name || prof.name;
  // Use the model's coherent build fingerprint. Only accept fp.fingerprint if it's a
  // REAL E.164-style build fingerprint (brand/device:ver/id:type/tag); the control-
  // plane's fp.buildNumber is a short display string (e.g. "SAMSUNG.14.640105") that
  // must NOT be used as ro.build.fingerprint — an invalid/inconsistent fingerprint is
  // itself a ban signal. So: real fingerprint from fp → use it; else the profile's.
  const looksLikeFingerprint = (s) => typeof s === 'string' && /\/.+:.+\/.+:.+\//.test(s);
  const fingerprint = looksLikeFingerprint(fp.fingerprint) ? fp.fingerprint : prof.fp;
  const description = fp.description ||
    fingerprint.replace(/^[^/]+\//, '').replace(':', '-').replace(/\//g, ' ');
  const lines = [
    `ro.product.model=${model}`,
    `ro.product.manufacturer=${manufacturer}`,
    `ro.product.brand=${brand}`,
    `ro.product.name=${name}`,
    `ro.product.device=${device}`,
    'ro.build.tags=release-keys',
    'ro.build.type=user',
    `ro.build.fingerprint=${fingerprint}`,
    `ro.build.description=${description}`,
    // Locked-bootloader / verified-boot signals WhatsApp's "custom ROM" check reads.
    'ro.boot.verifiedbootstate=green',
    'ro.boot.flash.locked=1',
    'ro.boot.veritymode=enforcing',
    'ro.secure=1',
    'ro.debuggable=0',
    // ADB authorization OFF (fleet phones sit on an isolated subnet). Without this,
    // a fresh boot answers "unauthorized" over ADB every time and the RSA-key dance
    // is fragile — settings put/am/ime (which MUST go over ADB) then fail. Scaleway's
    // working devices use ro.adb.secure=0 too; it does NOT affect WhatsApp integrity
    // (that reads ro.secure/ro.debuggable/verifiedbootstate, not ro.adb.secure).
    'ro.adb.secure=0'
  ].join('\n') + '\n';
  const dir = `/var/lib/waydroid.${instance}`;
  for (const f of [`${dir}/waydroid_base.prop`, `${dir}/waydroid.prop`]) {
    // Only append if not already spoofed (idempotent across re-provisions).
    const cur = await readFile(f, 'utf8').catch(() => null);
    if (cur === null) continue;                    // file not created yet (skip)
    if (cur.includes('ro.product.model=' + model)) continue;
    // Strip any prior ro.product/ro.build override we may have added, then append.
    const cleaned = cur.split('\n').filter((l) =>
      !/^ro\.(product\.(model|manufacturer|brand|name|device)|build\.(tags|type|fingerprint|description)|boot\.(verifiedbootstate|flash\.locked|veritymode)|secure|debuggable|adb\.secure)=/.test(l)
    ).join('\n').replace(/\n+$/, '\n');
    await writeFile(f, cleaned + lines).catch((e) => log('spoof write', f, e.message));
  }
  return true;
}

// Root the instance ROOT-LESSLY from the host, BEFORE boot, by injecting Magisk the
// way Waydroid-script does: the su binary + magisk binaries + a bootanim.rc go into
// the OverlayFS system layer, and magisk.db/magisk dir into the instance's userdata.
// On boot, bootanim.rc's `on post-fs-data` runs magiskpolicy + starts magiskd, so
// `su -c …` works with NO su-approval UI handshake (which can't be answered headless).
// This is what makes vtouch (real touch, needs uinput=root) AND wa-bringup's
// resetprop possible. Source files live in MAGISK_DIR (shipped with the agent),
// pulled from a working Scaleway device. Best-effort: a missing file → skip (device
// still boots, just without root — automation degrades to synthetic-tap only).
const MAGISK_DIR = process.env.FLEET_MAGISK_DIR || '/opt/fleet-agent/magisk';
async function applyRoot(instance) {
  const su = `${MAGISK_DIR}/su`;
  const initTar = `${MAGISK_DIR}/magisk-init.tar.gz`;   // bootanim.rc + magisk/{magisk64,magiskinit,magiskpolicy}
  const dbFile = `${MAGISK_DIR}/magisk.db`;
  const dirTar = `${MAGISK_DIR}/magisk-dir.tar.gz`;      // /data/adb/magisk contents
  if (!(await execFileAsync('test', ['-f', su]).then(() => true).catch(() => false))) {
    log(`applyRoot: ${su} yok — root atlanıyor (${instance})`);
    return false;
  }
  const wd = `/var/lib/waydroid.${instance}`;
  // Instance /data host-mount (full-recipe vs LITE layouts).
  let data = '';
  for (const d of [`/root/.local/share-${instance}/waydroid/data`, `/root/.local/share/waydroid.${instance}/data`]) {
    if (await execFileAsync('test', ['-d', d]).then(() => true).catch(() => false)) { data = d; break; }
  }
  try {
    // 1) su → overlay/system/bin + xbin (becomes /system/bin/su at boot via OverlayFS).
    await execFileAsync('mkdir', ['-p', `${wd}/overlay/system/bin`, `${wd}/overlay/system/xbin`]);
    for (const dst of [`${wd}/overlay/system/bin/su`, `${wd}/overlay/system/xbin/su`]) {
      await execFileAsync('cp', ['-f', su, dst]);
      await execFileAsync('chmod', ['0755', dst]).catch(() => undefined);
      await execFileAsync('chown', ['0:2000', dst]).catch(() => undefined);
    }
    // 2) bootanim.rc + magisk binaries → overlay/system/etc/init (boot-time magisk init).
    await execFileAsync('mkdir', ['-p', `${wd}/overlay/system/etc/init`]);
    await execFileAsync('tar', ['xzf', initTar, '-C', `${wd}/overlay/system/etc`]).catch((e) => log('applyRoot init tar:', e.message));
    await execFileAsync('sh', ['-c', `chmod 0755 ${shArg(wd)}/overlay/system/etc/init/magisk/* 2>/dev/null; chmod 0644 ${shArg(wd)}/overlay/system/etc/init/bootanim.rc 2>/dev/null; chown -R 0:0 ${shArg(wd)}/overlay/system/etc/init 2>/dev/null`]).catch(() => undefined);
    // 3) magisk.db (su policy) + /data/adb/magisk → instance userdata.
    if (data) {
      await execFileAsync('mkdir', ['-p', `${data}/adb`]);
      await execFileAsync('tar', ['xzf', dirTar, '-C', `${data}/adb`]).catch(() => undefined);
      await execFileAsync('cp', ['-f', dbFile, `${data}/adb/magisk.db`]).catch(() => undefined);
      await execFileAsync('sh', ['-c', `chmod 660 ${shArg(data)}/adb/magisk.db 2>/dev/null; chown -R 0:0 ${shArg(data)}/adb 2>/dev/null`]).catch(() => undefined);
    }
    return true;
  } catch (e) { log('applyRoot:', e.message); return false; }
}

// Pre-authorize ADB for an instance: write the agent's ADB public key into the
// container's /data/misc/adb/adb_keys and restart adbd. Without this, a freshly
// booted Waydroid returns "unauthorized" over ADB, so waitBoot() can't read
// sys.boot_completed and provisioning FAILS at the boot step even though Android
// booted fine (VERIFIED root cause on mi5). Idempotent + best-effort.
async function authorizeAdb(instance) {
  // Write ALL of the agent's candidate ADB public keys — the `adb` binary the
  // agent shells out to may use the key it generated on first run
  // (~/.android/adbkey.pub) rather than the recipe's host key, so if we write only
  // one we can pick the wrong one and every `adb` call stays "unauthorized". That
  // breaks not just waitBoot but ALL identity-bearing shell commands (settings
  // put / am / ime), which must run over ADB (lxc-attach loses the Binder caller
  // identity → getCallingPackage()==null → AppOpsService NPE). VERIFIED root cause.
  const keys = [];
  for (const k of ['/root/.android/adbkey.pub', '/opt/fleet-agent/waydroid/host-adbkey.pub']) {
    const body = await readFile(k, 'utf8').catch(() => '');
    if (body.trim()) keys.push(body.trim());
  }
  if (!keys.length) return false;
  const pub = keys.join('\n');
  // The container's /data maps to one of two host layouts (full recipe vs LITE).
  const bases = [
    `/root/.local/share-${instance}/waydroid/data`,
    `/root/.local/share/waydroid.${instance}/data`
  ];
  for (const base of bases) {
    if (!(await execFileAsync('test', ['-d', base]).then(() => true).catch(() => false))) continue;
    const adbDir = `${base}/misc/adb`;
    const keysFile = `${adbDir}/adb_keys`;
    // Write via `sh -c ... > file` (not fs.writeFile — which was silently landing a
    // 0-byte file here). Verify non-empty; adbd reads adb_keys as owner 1000:2000.
    try {
      await execFileAsync('mkdir', ['-p', adbDir]);
      await execFileAsync('sh', ['-c', `printf '%s\\n' ${shArg(pub)} > ${shArg(keysFile)}`]);
      await execFileAsync('chown', ['1000:2000', keysFile]).catch(() => undefined);
      await execFileAsync('chmod', ['644', keysFile]).catch(() => undefined);
      const written = await readFile(keysFile, 'utf8').catch(() => '');
      if (!written.trim()) { log(`authorizeAdb: adb_keys empty after write (${instance})`); return false; }
    } catch (e) { log('authorizeAdb write:', e.message); return false; }
    // ★2026-07-28: adbd'yi RESTART ETME. Bu cagri aylarca ciplak 'setprop' ile SESSIZCE
    // dusuyordu (servis PATH'inde /bin yok -> "Failed to exec") ve sistem sorunsuz
    // calisiyordu: adbd adb_keys'i her auth denemesinde yeniden okur, restart GEREKMEZ.
    // Mutlak yola cevirince cagri GERCEKTEN calisti ve adbd'yi BOOT ORTASINDA yeniden
    // baslatti -> ADB koptu -> boot_completed okunamadi -> provision 'boot' adimi 150s
    // TIMEOUT. CANLI KANIT: mi36 ADB@89s FAILED, mi37 ADB@132s FAILED; ayni kodun
    // oncesinde mi29 ADB@70s + DONE 150s. Kaldirildi (anahtar yazimi yeterli).
    return true;
  }
  return false;
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
// ★★★2026-08-13 SUBNET -> IP ÖNEKİ (238 tavanı kaldırıldı — operatör: "filo büyüyecek").
//
// Subnet numarası doğrudan IP'nin üçüncü oktetine yazılıyordu (`192.168.<S>.x`), bu da
// filoyu **238 cihazla** sınırlıyordu. ÖLÇÜM (13 Ağu): 145 subnet kullanımda, 140 canlı
// cihaz. Tavan yaklaşıyordu.
//
// Eşleme:  S <= 239 -> "192.168.<S>"        (mevcut cihazlar AYNEN kalır, taşıma YOK)
//          S >= 240 -> "10.10.<S-239>"      (10.10.1.x … 10.10.254.x → +254 subnet)
//
// ★ÇAKIŞMA DENETİMİ (canlı, host'un tüm IPv4'leri): bond0.2 10.0.0.11/24 ·
//   bond0.3 125.253.73.45/31 · docker0 172.17.0.1/16 → 10.10.0.0/16 BOŞ, çakışma yok.
//   (Host'un 10.0.0.0/24'ü farklı bir /16'da olduğu için etkilenmez.)
//
// ⚠️ Bu fonksiyon net-head.sh ve wd-run.sh'teki `subnet_prefix()` ile AYNI mantığı
// uygular — üçü birlikte değişmeli, biri geride kalırsa yeni cihazlar yanlış adrese
// kurulur.
function subnetPrefix(subnetId) {
  const s = Number(subnetId);
  return s >= 240 ? `10.10.${s - 239}` : `192.168.${s}`;
}

// live eth0 address. Returns null if neither is available yet.
async function resolveLeaseIp(instance, subnetId) {
  const leaseFile = `/var/lib/misc/dnsmasq.waydroid-${instance}.leases`;
  try {
    const raw = await readFile(leaseFile, 'utf8');
    // lease line: "<expiry> <mac> <ip> <name> <clientid>" — take the last (newest).
    const lines = raw.trim().split('\n').filter(Boolean);
    const last = lines[lines.length - 1];
    const ip = last && last.split(/\s+/)[2];
    if (ip && ip.startsWith(`${subnetPrefix(subnetId)}.`)) return ip;
  } catch { /* lease file may not exist yet */ }
  try {
    const out = await lxcAttach(instance, ['/system/bin/ip', '-4', 'addr', 'show', 'eth0'], 15000);
    // ★2026-08-13: önek artık 10.10.x olabilir → noktaları KAÇIRARAK regex'e göm
    // (aksi halde "10.10.5" içindeki nokta herhangi bir karakteri eşler).
    const pfxRe = subnetPrefix(subnetId).replace(/\./g, '\\.');
    const m = new RegExp(`inet (${pfxRe}\\.\\d+)`).exec(out);
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
    // Path A: push into the container's /data and `pm install` via lxc-attach.
    await adb(dstSerial, ['push', local, '/data/local/tmp/_clone.apk']).catch(() => undefined);
    const out = await lxcAttach(instance, ['/system/bin/sh', '-c',
      'pm install -r -g /data/local/tmp/_clone.apk; rm -f /data/local/tmp/_clone.apk'], 120000).catch((e) => e.message || '');
    let ok = /Success/i.test(out) || (await adb(dstSerial, ['shell', 'pm', 'path', pkg]).catch(() => '')).includes('package:');
    // Path B (fallback): `adb install` straight from the host-side pulled APK.
    // VERIFIED on mi6: lxc-attach `pm install` hit "Unable to open /data/..." /
    // Binder errors, while `adb install -r -g` streamed the APK and succeeded.
    if (!ok) {
      await execFileAsync(ADB, ['-s', dstSerial, 'install', '-r', '-g', local], { maxBuffer: 64 * 1024 * 1024, timeout: 180000 }).catch(() => undefined);
      ok = (await adb(dstSerial, ['shell', 'pm', 'path', pkg]).catch(() => '')).includes('package:');
    }
    if (!ok) throw new Error(`install ${pkg} failed: ${String(out).trim().slice(0, 200)}`);
    return true;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Best-effort progress report; never blocks the flow. `note` doubles as a live
// log line (the dashboard streams these into a terminal); `status` lets us push
// a terminal FAILED line the instant a step throws, before reportComplete.
// extra: optional { accountId?, shot? } — WhatsApp register correlates by
// accountId and can attach a downscaled base64 screenshot for the live panel.
async function reportProgress(jobId, step, percent, note, status, extra) {
  try {
    // ★ API yaniti { data: { ok, cancelled } } — operator 'Iptal Et'e basmissa cancelled:true.
    // Doner deger cagirana iptal'i bildirir (provision step() bunu gorup abort eder).
    const body = await api(`/agent/jobs/${jobId}/progress`, {
      method: 'POST',
      body: JSON.stringify({ step, percent, ...(note ? { note } : {}), ...(status ? { status } : {}), ...(extra || {}) })
    });
    return { cancelled: !!(body && body.data && body.data.cancelled) };
  } catch (e) {
    log('progress report failed:', e.message);
    return { cancelled: false };
  }
}

// Downscale a PNG to `width` px (keeping aspect), return base64 JPEG for a small
// live-panel thumbnail. Uses the same optional sharp path as the stream JPEG
// encoder; returns null if sharp isn't available so callers degrade gracefully.
async function shrinkPng(png, width) {
  const sharp = await loadSharp();
  if (!sharp) return null;
  const jpg = await sharp(png).resize({ width, withoutEnlargement: true }).jpeg({ quality: 55 }).toBuffer();
  return jpg.toString('base64');
}

// Read the pixel width/height from a PNG's IHDR chunk (zero-dep). Android's
// screencap always emits a standard IHDR at offset 8. Returns {w,h} or null.
function pngSize(png) {
  try {
    const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!png || png.length < 24 || !png.subarray(0, 8).equals(SIG)) return null;
    // First chunk after the signature is IHDR: length(4)+type(4)+data. width/height
    // are the first two uint32 of the data (offset 16 and 20 from file start).
    if (png.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
  } catch { return null; }
}

// ── Vision fallback (uiautomator-dump replacement) ──────────────────────────
//
// Some Waydroid builds return an empty/garbled uiautomator dump on certain
// screens, so findNode() can't locate a button by resource-id/text. When that
// happens, capture the screen, downscale it, and ask the control-plane vision
// endpoint (server-side Claude, key stays there) WHERE to tap. Coordinates come
// back in the DOWNSCALED image's pixel space; we scale them back to real device
// pixels using the original PNG size vs. the downscale width. Returns
// { found, x, y, screen, note } with x/y in REAL device coordinates, or null if
// unavailable (no sharp, no capture, API/AI down) so callers degrade to their
// existing coordinate/dump paths.
const VISION_WIDTH = 720; // downscale target; keeps JPEG ~20-50KB, plenty for locating buttons
async function visionLocate(serial, target, hint) {
  try {
    const png = await grabPng(serial, 12000);
    if (!png) return null;
    const size = pngSize(png);
    const b64 = await shrinkPng(png, VISION_WIDTH);
    if (!b64) return null; // sharp not available → no vision fallback
    // Scale factor from the downscaled image back to real device pixels.
    const scale = size && size.w > 0 ? size.w / Math.min(VISION_WIDTH, size.w) : 1;
    let out;
    try {
      out = await api('/agent/vision/analyze', {
        method: 'POST',
        body: JSON.stringify({ image: b64, target: String(target).slice(0, 300), ...(hint ? { hint: String(hint).slice(0, 300) } : {}) })
      });
    } catch (e) {
      log('visionLocate api failed:', e.message);
      return null;
    }
    const r = (out && out.data) || {};
    if (!r || typeof r !== 'object') return null;
    return {
      found: r.found === true,
      x: Math.round((Number(r.x) || 0) * scale),
      y: Math.round((Number(r.y) || 0) * scale),
      screen: typeof r.screen === 'string' ? r.screen : 'unknown',
      note: typeof r.note === 'string' ? r.note : ''
    };
  } catch (e) {
    log('visionLocate error:', e.message);
    return null;
  }
}

// Tap a target by resource-id/text/desc first (fast, exact); if the dump can't
// find it, fall back to vision. `queries` is what findNode accepts (string or
// array of candidates). `visionTarget` is the natural-language description for
// the vision fallback. Returns true if a tap was issued, false otherwise.
async function tapByOrVision(serial, dumpFn, tapNodeFn, queries, field, visionTarget, hint) {
  const n = findNode(await dumpFn(), queries, field);
  if (n) { await tapNodeFn(n); return true; }
  const v = await visionLocate(serial, visionTarget, hint);
  if (v && v.found) {
    await adb(serial, ['shell', 'input', 'tap', String(v.x), String(v.y)]);
    log(`vision tap "${visionTarget}" @ ${v.x},${v.y} (screen=${v.screen})`);
    return true;
  }
  return false;
}

async function provisionDevice(job) {
  const jobId = job.id;
  const payload = job.payload || {};
  const instance = String(payload.instance || '').trim();
  if (!instance) throw new Error('provision: instance name required');
  const srcSerial = String(payload.srcSerial || process.env.FLEET_WD_SRC || '192.168.248.112:5555');
  const fp = payload.fingerprint || {};
  // The ONE authoritative model for this device. applyIntegritySpoof writes it to
  // waydroid.prop AND wa-bringup.sh resetprops it at runtime — they MUST agree, or
  // wa-bringup's default (SM-G991B) silently overrides the prop file and every
  // device ends up looking identical (fleet-linkable). Force it into fp.model so
  // both paths read the same value even when the control-plane omitted it.
  const DEFAULT_MODEL = 'SM-G991B';
  if (!fp.model) fp.model = DEFAULT_MODEL;
  const proxy = payload.proxy || null;
  // ★Opsiyonel Telegram kurulumu. WhatsApp her provision'da ZORUNLU kurulur (cihazın
  // amacı "WhatsApp-hazır"); Telegram ise yalnızca control-plane istediğinde eklenir
  // (payload.installTelegram === true). Bayrak yoksa Telegram atlanır — bu davranış
  // geriye dönük uyumludur (mevcut provision çağrıları bu alanı göndermiyor). Bundled
  // APK yoksa (APK_DIR'de telegram.apk bulunmuyorsa) adım best-effort uyarı bırakıp
  // devam eder; Telegram'ın yokluğu provision'ı FAILED yapmaz.
  const installTelegram = payload.installTelegram === true;

  // Current step context so log() lines below carry the right step/percent.
  let curStep = 'infra';
  let curPct = 5;
  // Emit a live log line to the dashboard terminal (best-effort).
  const logLine = (text) => reportProgress(jobId, curStep, curPct, text);

  // ★OBSERVABILITY (PL1) — provisionDevice wrote NOTHING to /var/log/fleet-agent.log on
  // the happy path (only reportProgress → WS/Job.result). A tail during a stall showed
  // just "claimed job PROVISION_DEVICE" → "completed", with no step trace or timing. Add
  // a device-tagged plog() (console.log → stdout → log file) + a per-step timing map so a
  // tail tells the whole story. Reuses data already in hand; no host/ADB calls.
  const provTag = `[prov ${instance}]`;
  const plog = (m) => { try { log(`${provTag} ${m}`); } catch { /* logging must never break the flow */ } };
  // ★2026-07-25: mark this instance as provisioning so adbRecoveryTick/healInstanceEth0
  // don't race provisionDevice's own eth0 management (concurrent IP-assign corrupts boot).
  provisioningInstances.add(instance);
  const provT0 = Date.now();
  const timings = {};            // { stepKey: ms }
  let _stepAt = provT0;
  const timingSummary = () => Object.entries(timings).map(([k, v]) => `${k}=${(v / 1000).toFixed(0)}s`).join(' ');

  const step = async (key, percent, note, fn) => {
    // Close out the previous step's timer + log its duration (skip the very first call).
    if (curStep !== key) {
      const dt = Date.now() - _stepAt;
      if (_stepAt !== provT0) { timings[curStep] = (timings[curStep] || 0) + dt; plog(`step '${curStep}' ${(dt / 1000).toFixed(1)}s done`); }
      _stepAt = Date.now();
    }
    curStep = key;
    curPct = percent;
    plog(`step '${key}' ${percent}% — ${note}`);   // per-step text trace to /var/log
    // ★ Iptal-check: operator 'Iptal Et'e basmissa reportProgress cancelled:true doner → abort.
    const pr = await reportProgress(jobId, key, percent, note);
    if (pr && pr.cancelled) {
      plog(`step '${key}' IPTAL — operator kurulumu iptal etti, provision durduruluyor`);
      throw new Error('PROV_CANCEL: kurulum iptal edildi (operator)');
    }
    // ★ Adim-timeout: bir adim asiri uzun surerse (takilma) FAILED bildir — modal sonsuza
    // "calisiyor" kalmasin. infra agir (userdata klon ~4GB) → 6dk; digerleri → 150s.
    // boot: DHCP'ye gercek sans vermek icin (DNS ancak DHCP ile gelir) 150s -> 240s.
    //
    // ★2026-08-04 boot 240s → 360s. CANLI: eszamanli kurulumda DHCP fazi 114s surdu
    // (saglikli cihazda 25s) ve geri kalan butce ADB yetkilendirmesine YETMEDEN sinir
    // doldu → mi78/mi80 FAILED. Cihazlar aslinda saglikliydi, sadece gec basladilar.
    // Asil duzeltme eszamanliligi 4→2 dusurmek (MAX_CONCURRENT_PROVISIONS); bu ise
    // ikinci emniyet: DHCP yine gecikirse kurulum HAKSIZ yere kesilmesin.
    const stepTimeoutMs = (key === 'infra') ? 6 * 60 * 1000 : (key === 'boot' ? 360 * 1000 : 150 * 1000);
    try {
      return await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`PROV_TIMEOUT: '${key}' adimi ${Math.round(stepTimeoutMs/1000)}s icinde bitmedi (takildi)`)), stepTimeoutMs))
      ]);
    } catch (e) {
      // ★log the technical error to /var/log WITH the step name + elapsed, so raw stack
      // traces aren't the only (ungrouped) signal.
      plog(`step '${key}' FAILED after ${((Date.now() - _stepAt) / 1000).toFixed(1)}s: ${e.message}`);
      // Push a terminal FAILED line with the full technical detail immediately.
      await reportProgress(jobId, key, percent, `❌ HATA: ${e.message}`, 'FAILED');
      throw new Error(`provision ${key}: ${e.message}`);
    }
  };

  // 1) infra — build the isolated instance (host-level). The script's ip= is a
  //    best-guess (.112); the container actually gets its address from DHCP, so
  //    we resolve the REAL ip from the dnsmasq lease after boot (step 2).
  const infra = await step('infra', 8, 'İzole altyapı kuruluyor', async () => {
    // Stop any leftover session of the SAME name first so wd-provision starts clean.
    // ★DO NOT delete the waydroid-<name> bridge — Waydroid's waydroid-net.sh creates
    // it once during session bring-up and does NOT recreate it if removed; deleting
    // it leaves the container with no IPv4 forever (VERIFIED: manual `ip link delete`
    // broke every subsequent provision → LXC "bridge interface doesn't exist").
    await hostSh('wd-stop.sh', [instance], 60000).catch(() => undefined);
    await execFileAsync('rm', ['-f', `/var/lib/misc/dnsmasq.waydroid-${instance}.leases`]).catch(() => undefined);
    // ★Clear the stale `network_up` marker. waydroid-net.sh short-circuits with
    // "already running" when it exists, so if the bridge is somehow gone the script
    // never rebuilds it and every boot fails at "bridge doesn't exist". Removing the
    // marker forces waydroid-net.sh to (re)create the bridge on the next session
    // start — cheap and idempotent, the marker is rewritten immediately after.
    await execFileAsync('rm', ['-f', `/run/waydroid-${instance}-lxc/network_up`]).catch(() => undefined);
    // net-head.sh needs to WRITE the subnet map; a root-only map file makes it fall
    // back to subnet 240 for every instance (collisions). Ensure it's writable.
    await execFileAsync('sh', ['-c',
      'f=/var/lib/waydroid-subnets.map; touch "$f" 2>/dev/null; chmod 666 "$f" 2>/dev/null; true']).catch(() => undefined);
    await logLine(`Instance "${instance}" için izole altyapı kuruluyor (binderfs + bridge + userdata klon ~4GB)…`);
    const { stdout } = await hostSh('wd-provision.sh', [instance], 600000);
    const m = /PROVISION_RESULT\s+subnet=(\d+)\s+ip=(\S+)\s+port=(\d+)/.exec(stdout);
    if (!m) throw new Error(`no PROVISION_RESULT in output: ${stdout.trim().slice(-300)}`);
    // Spoof device integrity into the instance's prop files BEFORE boot (root-less;
    // WhatsApp bans a device that reports model="WayDroid arm64 Device"/test-keys).
    await applyIntegritySpoof(instance, fp).catch((e) => log('integrity spoof:', e.message));
    // Inject Magisk (su + bootanim.rc) into the overlay BEFORE boot so the container
    // comes up rooted → enables real-touch vtouch + resetprop (WhatsApp companion
    // menu items reject synthetic taps; only real touch works).
    const rooted = await applyRoot(instance).catch((e) => { log('applyRoot:', e.message); return false; });
    await logLine(`✓ Altyapı hazır — subnet 192.168.${m[1]}.0/24, kimlik: ${fp.model || 'SM-G991B'}${rooted ? ' (root)' : ''}`);
    return { subnetId: Number(m[1]), ip: m[2], adbPort: Number(m[3]) };
  });
  const subnetId = infra.subnetId;
  const adbPort = infra.adbPort;
  let ip = infra.ip;
  let serial = `${ip}:${adbPort}`;

  // ★P1 (leak fix): infra just wrote ~4.4GB (images + userdata clone) + a systemd unit +
  // dbus policy + subnet-map line to disk. If ANY step below throws (boot never gets IPv4,
  // WhatsApp APK fails, etc.), that half-built instance was previously NEVER cleaned up —
  // it leaked permanently (no wd-destroy / teardown existed anywhere), silently eating the
  // host's disk headroom a few failed provisions at a time. Wrap the post-infra body so a
  // failure tears the instance down before re-throwing. Best-effort teardown; the original
  // error is always what propagates (a teardown failure never masks the real cause).
  try {
  // 2) boot — start the session DETACHED (wd-run never returns), then verify boot
  //    over ADB and resolve the real DHCP ip.
  await step('boot', 18, 'Cihaz açılışı bekleniyor', async () => {
    // ★boot sub-timing: boot is ~45s (the longest step) but was a black box. Stamp each
    // sub-phase (DHCP bind / ADB authorize / waitBoot / svcUp) so a tail shows WHICH part
    // of boot dominates before we try to shorten it. bootT0 is boot-step-relative.
    const bootT0 = Date.now();
    const bootMs = () => ((Date.now() - bootT0) / 1000).toFixed(0);
    await logLine('Android boot ediliyor (weston + container + session)…');
    hostShDetached('wd-run.sh', [instance]); // fire-and-forget: keeps session alive
    // ★PH1: 2s (was 8s) — just enough for the container process to spawn before the poll
    // loop starts. The loop below tolerates early "no address" reads (retries), so the
    // extra 6s of the old blind wait was dead time on the common (fast-boot) case.
    await new Promise((r) => setTimeout(r, 2000));
    // Wait for eth0 to actually get an IPv4 address bound INSIDE the container.
    // ROOT CAUSE of "boot_completed not reached within 300s" on a healthy-looking
    // container: Android's netd sometimes leaves eth0 with only an IPv6 link-local
    // address (no IPv4), so the DHCP lease exists on the host but the container is
    // unreachable — ADB can't connect, waitBoot reads nothing, provision FAILS at 300s
    // even though `getprop sys.boot_completed`=1 over lxc-attach. A clean boot binds IPv4
    // within a few seconds so the loop exits on probe 1-2; the DHCP-kick only fires on a
    // genuinely-stuck boot. ★PH2: kick EARLIER (i===3, ~8-10s in) instead of i===12 (~24s)
    // — a clean boot never reaches the kick regardless, so an earlier kick doesn't slow the
    // happy path, it only shortens the stuck path. Probe timeout 6s→3s (an `ip addr show`
    // that will answer answers in <1s; 6s only bit when the container was unreachable).
    // ★DHCP-KICK REPEAT (measured LIVE, mi8): the whole 45s "boot" step was eth0 waiting
    // for IPv4 — ADB/waitBoot/svcUp were all 0s once IPv4 bound. A SINGLE kick at i===3
    // (~8s) wasn't enough: netd then took ~37s more to bind on its own. So RE-KICK on a
    // cadence (every ~5 probes ≈ every ~10s) until IPv4 appears — each kick re-runs the dhcp
    // request, nudging netd instead of passively waiting out its slow self-timer. Kicks are
    // idempotent (down/up + dhcptool, all silenced), and a clean boot binds on probe 1-2 so
    // it never reaches even the first kick — zero cost on the happy path, big win on the
    // slow-IPv4 path this code exists for. Raised to 30 probes to keep the ~60s safety cap.
    const dhcpKick = () => lxcAttach(instance, ['/system/bin/sh', '-c',
      // ★HIZ-FIX 2026-07-28: eskiden `ifconfig eth0 DOWN; up; ndc network interface add;
      // dhcptool eth0` idi. OLCULDU: bu imajda /system/bin/dhcptool YOK ve `ndc` komutlari
      // "Command not recognized" -> kick'in DHCP-ISTEME kismi HIC calismiyordu. Geriye
      // sadece link'i DOWN/UP etmek kaliyordu ve bu, Android'in DEVAM EDEN DHCP'sini her
      // 10s'de yeniden baslatiyordu. Artik SADECE 'up' (link kapaliysa acar, DHCP'yi bozmaz).
      'export PATH=/system/bin:$PATH; ifconfig eth0 up 2>/dev/null; true'], 12000).catch(() => undefined);
    // ★2026-07-25: STATİK-IP FALLBACK. DHCP netd'nin yavaş self-timer'ına bağlıydı ve
    // bazen 400s+ sürüyordu (canlı: mi12 boot=403s, mi13=411s — kullanıcı "tek tık takıldı").
    // Kök: Waydroid boot'ta netd eth0'a IPv4 bind etmiyor (sadece IPv6 link-local), DHCP
    // kick'leri de netd'yi hızlandırmıyor. ÇÖZÜM: subnet zaten biliniyor (net-head → .112),
    // birkaç DHCP denemesi (16s) sonra IPv4 hâlâ yoksa STATİK ata (healInstanceEth0 ile aynı
    // fix, anında çalışır). Bu provision-boot'u 400s→~20s'ye indirir. Temiz boot yine 1-2
    // probe'ta bind eder → statik-fallback'e hiç ulaşmaz (mutlu yolda sıfır maliyet).
    // ★2026-07-27: statik-IP fallback SADECE `ip addr add` + main-tablo default-route
    // yapıyordu — ama Android netstack fwmark-tabanlı ROUTE TABLOLARINI (main/eth0/
    // legacy_system) kullanır; bunlara default-route eklenmezse cihaz internete ÇIKAMAZ
    // (TCP 000). CANLI-KANIT: mi14 statik-IP aldı ama default-route TABLOLARDA yoktu →
    // WhatsApp "Couldn't connect" (OTP-doğrulama çıkamadı). FIX: addInstanceRoutes gibi
    // TÜM tablolara default-route ekle. (DHCP başarılı olsaydı bunu otomatik yapardı.)
    const staticEth0 = () => lxcAttach(instance, ['/system/bin/sh', '-c',
      `export PATH=/system/bin:$PATH; ` +
      `ip addr add ${subnetPrefix(subnetId)}.112/24 dev eth0 2>/dev/null; ip link set eth0 up 2>/dev/null; ` +
      // ★addInstanceRoutes ile AYNI tablolar: main/local_network/eth0 (legacy_system DEĞİL).
      `for T in main local_network eth0; do ip route add default via ${subnetPrefix(subnetId)}.1 dev eth0 proto static table $T 2>/dev/null; done; ` +
      `for T in eth0 local_network; do ip route add ${subnetPrefix(subnetId)}.0/24 dev eth0 scope link src ${subnetPrefix(subnetId)}.112 table $T 2>/dev/null; done; ` +
      `ip route add default via ${subnetPrefix(subnetId)}.1 dev eth0 2>/dev/null; true`], 12000).catch(() => undefined);
    const dhcpT0 = Date.now();
    let eth0Ip = '';
    let kicks = 0;
    let staticApplied = false;
    // ★★KOK-FIX 2026-07-28 (DNS / tek-tik WhatsApp): statik-IP fallback ESKIDEN i===8'de
    // (~16s) vuruyordu. Android'in ag yigini (EthernetService/IpClient) ise ~50-70s'de
    // DHCP'yi tamamlar ve DNS'i SADECE DHCP getirir. eth0'da ZATEN adres varken Android
    // DHCP'yi tamamlamiyor -> DnsAddresses BOS -> cihaz isim cozemiyor -> IP ile HTTP/HTTPS
    // calisir ("internet var" gorunur) ama web.whatsapp.com cozulemez -> tek-tik WhatsApp
    // kaydi KIRILIR. CANLI OLCUM: 31 cihazin 9'unda DNS yoktu; hepsi bu fallback'e dusenler.
    // Fallback artik GERCEK son-care (~90s): DHCP'ye once sans verilir.
    // ⚠️ Bunun ASIL kosulu firewall'dur: ufw, 0.0.0.0'dan gelen DHCP broadcast'ini
    // dusuruyordu -> lease HIC gelmiyordu. Bkz. waydroid/wd-firewall-dhcp.sh (ONCE o).
    const DHCP_TICKS = Number(process.env.FLEET_PROV_DHCP_TICKS || 55);      // 55 x 2s = 110s
    const STATIC_AFTER = Number(process.env.FLEET_PROV_STATIC_AFTER || 45);  // ~90s
    // ★★HIZ-FIX 2026-07-28 (boot 114s -> 31s): IP'yi ONCE host-tarafi dnsmasq LEASE
    // dosyasindan oku. OLCULDU (dnsmasq logu): DHCPACK boot'un ~22. saniyesinde geliyor,
    // yani DHCP ZATEN HIZLI. Sorun tespitteydi: container-ici `lxc-attach ... ip addr`
    // yogun boot sirasinda 3s timeout'a takilip BOS donuyordu -> provision mevcut IP'yi
    // GOREMIYOR -> 92s'de gereksiz statik fallback -> boot 114s. Lease dosyasi host
    // tarafinda: okumasi ANINDA ve container yukune bagimsiz.
    // ⚠️ wd-run.sh'in TOHUMLADIGI kayit (expiry 4102444800) SAYILMAZ — o sadece dnsmasq'a
    // ".112'yi ver" demek icin; IP'nin GERCEKTEN alindigini yalnizca gercek lease kanitlar.
    const NLC = String.fromCharCode(10), TABC = String.fromCharCode(9);
    const realLeaseIp = async () => {
      try {
        const raw = await readFile(`/var/lib/misc/dnsmasq.waydroid-${instance}.leases`, 'utf8');
        for (const line of String(raw).trim().split(NLC)) {
          const f = line.split(TABC).join(' ').trim().split(' ').filter(Boolean);
          if (f[0] === '4102444800') continue;               // tohum -> gercek DHCP degil
          if (f[2] && f[2].startsWith(`${subnetPrefix(subnetId)}.`)) return f[2];
        }
      } catch { /* lease dosyasi henuz yok */ }
      return '';
    };
    for (let i = 0; i < DHCP_TICKS; i++) {
      const li = await realLeaseIp();
      if (li) { eth0Ip = li; plog(`eth0 IPv4 DHCP-lease ile ${((Date.now() - dhcpT0) / 1000).toFixed(1)}s -> ${li}`); break; }
      eth0Ip = String(await lxcAttach(instance, ['/system/bin/sh', '-c',
        "ip -4 addr show eth0 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}'"], 3000).catch(() => '')).trim();
      if (/^192\.168\.\d+\.\d+$/.test(eth0Ip)) break;
      // ★i===8 (~16s): DHCP hâlâ vermediyse STATİK ata + BEKLE (400s beklemektense hemen
      // çöz). Statik atandıktan SONRA dhcpKick ÇALIŞTIRMA — kick'in `ifconfig eth0 down/up`'ı
      // statik IP'yi FLUSH eder (canlı-bug: statik@22s atandı ama kick#3-6 sildi, boot 69s
      // sürdü). Statik-sonrası: sadece IP'nin bind olmasını poll et, kick'e dokunma.
      if (i === STATIC_AFTER && !staticApplied) {
        staticApplied = true;
        await staticEth0();
        plog(`eth0 statik-IP fallback → ${subnetPrefix(subnetId)}.112 @ ${((Date.now() - dhcpT0) / 1000).toFixed(0)}s`);
        await logLine('⚙ eth0 statik IP atanıyor (DHCP gecikti)…');
      } else if (!staticApplied && (i === 3 || (i > 3 && (i - 3) % 5 === 0))) {
        // İlk kick i===3 (~8s), sonra ~10s'de bir — SADECE statik atanmadan ÖNCE.
        await dhcpKick();
        kicks++;
        plog(`eth0 IPv4 gecikti — DHCP re-kick #${kicks} @ ${((Date.now() - dhcpT0) / 1000).toFixed(0)}s`);
        if (kicks === 1) await logLine('⚠ eth0 IPv4 gecikti — DHCP yeniden tetikleniyor…');
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (/^192\.168\.\d+\.\d+$/.test(eth0Ip)) plog(`eth0 IPv4 bound in ${((Date.now() - dhcpT0) / 1000).toFixed(1)}s → ${eth0Ip}`);
    plog(`boot@${bootMs()}s: DHCP phase done`);
    if (/^192\.168\.\d+\.\d+$/.test(eth0Ip)) {
      if (eth0Ip !== ip) { await logLine(`DHCP → ${eth0Ip} (container eth0 IPv4)`); ip = eth0Ip; serial = `${ip}:${adbPort}`; }
    } else {
      // Fall back to the host-side lease file if the in-container read failed.
      const leased = await resolveLeaseIp(instance, subnetId).catch(() => null);
      if (leased && leased !== ip) { await logLine(`DHCP → ${leased} (lease dosyası)`); ip = leased; serial = `${ip}:${adbPort}`; }
    }
    // Pre-authorize ADB so waitBoot() can actually read sys.boot_completed — a
    // fresh Waydroid answers "unauthorized" otherwise and boot appears to hang.
    // The instance /data dir (where adb_keys lives) only appears a bit after the
    // container starts, so retry until authorizeAdb succeeds AND the device shows
    // "device" (not "unauthorized"). Up to ~90s.
    for (let i = 0; i < 30; i++) {
      const ok = await authorizeAdb(instance).catch(() => false);
      await ensureConnected(serial).catch(() => undefined);
      const st = await adbT(serial, ['get-state'], 6000).catch(() => '');
      if (ok && /device/.test(st)) { await logLine('✓ ADB yetkilendirildi'); break; }
      await new Promise((r) => setTimeout(r, 2000)); // ★PH3: 2s (was 3s) — adb_keys usually appears within a few s once /data mounts; loop stays condition-gated + 30-cap
    }
    plog(`boot@${bootMs()}s: ADB authorized`);
    await ensureConnected(serial).catch(() => undefined); // ★S4: guard for message consistency — a wedged adb server shouldn't throw a raw error over the intended "boot not reached" one
    // 300s (not 180s): on a busy host (several instances software-rendering at
    // once) the first boot routinely takes 3-5 min. A 180s cap FAILED provision
    // mid-boot even though boot completed seconds later, leaving the device half
    // set up (VERIFIED on mi6). Re-resolve the DHCP ip mid-wait in case it changed.
    let booted = await waitBoot(serial, 300000);
    if (!booted) {
      // Last-ditch: the container may be up under a different DHCP lease than the
      // one we first resolved — re-resolve and try a short final wait.
      const released = await resolveLeaseIp(instance, subnetId).catch(() => null);
      if (released && released !== ip) { ip = released; serial = `${ip}:${adbPort}`; await ensureConnected(serial); booted = await waitBoot(serial, 30000); }
    }
    if (!booted) throw new Error('boot_completed not reached within 300s');
    plog(`boot@${bootMs()}s: boot_completed=1 (waitBoot done)`);
    // boot_completed=1 is NOT enough: on ~1 in 3 GPU-less boots hwcomposer.waydroid.so's
    // wayland thread aborts (VERIFIED in crash logs), taking system_server down — the
    // framework services (package/settings) then NEVER publish, so every later step
    // (root install, APKs, a11y) silently fails and the device ships broken. Detect
    // that half-boot HERE (before any heavy step) by waiting for `service check
    // package`=found, and if it never comes, reboot ONCE for a clean boot. Doing it
    // here (not in apks at 84%) keeps the whole provision inside the job timeout.
    // On a clean boot the package service publishes within ~10s, so this exits
    // almost immediately. A single missed probe (container in a transient state)
    // must NOT trigger a needless reboot — require TWO consecutive misses across
    // the whole window before declaring the boot dead, and check over ADB too
    // (lxc-attach can time out spuriously and read as a false "not found").
    // ★PH3: probe lxc + adb in PARALLEL (was sequential lxc-then-adb → up to 12s per miss).
    // Either "found" is authoritative, so race them and take the first positive.
    const pkgUp = async () => {
      const results = await Promise.all([
        lxcAttach(instance, ['/system/bin/sh', '-c', 'service check package 2>&1'], 6000).catch(() => ''),
        adbT(serial, ['shell', 'service', 'check', 'package'], 6000).catch(() => '')
      ]);
      return results.some((r) => /: found/.test(String(r)));
    };
    const svcUp = async () => {
      for (let i = 0; i < 24; i++) {
        if (await pkgUp()) return true;
        await new Promise((r) => setTimeout(r, 2000)); // ★PH3: 2s (was 3s)
      }
      return false;
    };
    if (!(await svcUp())) {
      await logLine('⚠ Grafik katmanı çöktü (hwcomposer) — cihaz bir kez yeniden başlatılıyor…');
      await hostSh('wd-stop.sh', [instance], 60000).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 3000));
      hostShDetached('wd-run.sh', [instance]);
      const reup = await waitBoot(serial, 150000).catch(() => false);
      await ensureConnected(serial).catch(() => undefined);
      await addInstanceRoutes(instance, subnetId, ip).catch(() => undefined);
      if (reup) await svcUp();
    }
    plog(`boot@${bootMs()}s: framework services up (svcUp done)`);
    await logLine(`✓ boot_completed=1 — Android hazır (${serial})`);
    // ★P3 (spoof verification): applyIntegritySpoof/applyRoot in the infra step are
    // best-effort (their catch only log()s), so a device could boot reporting the generic
    // model (fleet-linkable → WhatsApp-ban risk) while provision still marches to a green
    // "hazır". Read the model back now that Android is up and WARN loudly if it doesn't
    // match the intended fp.model. Not fatal (the device still works) — but the operator
    // MUST see it, since a fleet-linkable device is exactly what the spoof machinery
    // exists to prevent. Best-effort read; never throws.
    const gotModel = (await adbT(serial, ['shell', 'getprop', 'ro.product.model'], 6000).catch(() => '')).trim();
    if (gotModel) {
      const wantModel = String(fp.model || DEFAULT_MODEL).trim();
      if (gotModel === wantModel) plog(`spoof OK model=${gotModel}`);
      else { plog(`⚠ SPOOF MISMATCH model=${gotModel} beklenen=${wantModel} — cihaz fleet-linkable olabilir`); await logLine(`⚠ Kimlik uyuşmazlığı: model=${gotModel} (beklenen ${wantModel}) — spoof tam uygulanamamış olabilir`); }
    }
  });

  // 3) root — install the real Magisk from the repo-bundled APK. This runs right
  //    after boot when PackageManager may not accept installs yet, so wait for PM
  //    to be ready (probe with the tiny adbkeyboard) and retry Magisk a few times.
  await step('root', 35, 'Root / Magisk kuruluyor', async () => {
    await logLine('PackageManager hazırlanıyor…');
    for (let i = 0; i < 24; i++) {
      try { await installBundledApkTo(instance, 'adbkeyboard.apk'); break; }
      catch { await new Promise((r) => setTimeout(r, 5000)); }
    }
    await logLine('Gerçek Magisk (~12.7MB) repo APK\'sından kuruluyor…');
    let magiskOk = false;
    for (let attempt = 1; attempt <= 3 && !magiskOk; attempt++) {
      try { await installBundledApkTo(instance, 'magisk.apk'); magiskOk = true; }
      catch (e) { if (attempt === 3) await logLine(`⚠ Magisk kurulamadı: ${e.message.slice(0, 100)}`); else await new Promise((r) => setTimeout(r, 6000)); }
    }
    // DO NOT leave the Magisk app in the foreground — on headless Waydroid it shows
    // a "Requires Additional Setup / reboot?" dialog and spams "Shell was denied
    // Superuser rights" toasts, so the device appears to boot into Magisk instead of
    // the launcher (confuses operators watching the live screen). Force-stop it and
    // go HOME. Also try to grant su non-interactively via magisk.db (silences the
    // toast + makes ADB-shell su work) — but sqlite3 may be absent on the host, so
    // this is best-effort; the force-stop below is what the operator actually sees.
    if (magiskOk) {
      const dbPath = `/root/.local/share/waydroid.${instance}/data/adb/magisk.db`;
      const sql =
        'CREATE TABLE IF NOT EXISTS policies (uid INT, policy INT, until INT, logging INT, notification INT, PRIMARY KEY(uid));' +
        'INSERT OR REPLACE INTO policies (uid,policy,until,logging,notification) VALUES (2000,2,0,0,0);' +
        'INSERT OR REPLACE INTO policies (uid,policy,until,logging,notification) VALUES (0,2,0,0,0);';
      await execFileAsync('sh', ['-c', `command -v sqlite3 >/dev/null 2>&1 && sqlite3 ${shArg(dbPath)} ${shArg(sql)} 2>/dev/null; true`]).catch(() => undefined);
      // Close Magisk + return to the launcher (VERIFIED: focus → launcher3).
      await lxcAttach(instance, ['/system/bin/sh', '-c',
        'am force-stop io.github.huskydg.magisk 2>/dev/null; input keyevent KEYCODE_HOME 2>/dev/null; true'], 12000).catch(() => undefined);
      await adb(serial, ['shell', 'input keyevent KEYCODE_HOME']).catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, 2000));
    // Root is best-effort on headless Waydroid. Don't fail the whole provision if su
    // is denied — WhatsApp/Instagram automation works root-less via a11y + real touch.
    const id = await lxcAttach(instance, ['/system/bin/sh', '-c',
      'export PATH=/system/bin:/system/xbin:$PATH; /system/bin/su -c id 2>&1'], 20000).catch(() => '');
    if (/uid=0/.test(id)) await logLine('✓ Root doğrulandı — su → uid=0(root)');
    else await logLine('⚠ Root otomatik onaylanmadı (headless) — otomasyon root\'suz devam eder');
  });

  // 4) screen — recipe coordinates need 1080x2400 @ density 421. Over ADB (wm is
  //    identity-bearing; lxc-attach's null caller identity makes it a no-op).
  await step('screen', 47, 'Ekran ayarları (1080x2400@421)', async () => {
    await ensureConnected(serial).catch(() => undefined);
    await adb(serial, ['shell', 'wm size 1080x2400']).catch((e) => log('screen:', e.message));
    await adb(serial, ['shell', 'wm density 421']).catch((e) => log('screen:', e.message));
    // ★2026-07-24: disable all UI animations. GPU-less Waydroid renders animations in
    // software (swiftshader) — a spinning EULA/loading animation costs 3-4 CPU cores.
    // Zeroing the three scales removes that render cost fleet-wide without affecting
    // WhatsApp function or the agent's tap/a11y automation. (Runtime devices got this
    // applied live; this bakes it into every new provision so it survives from boot.)
    await adb(serial, ['shell', 'settings put global window_animation_scale 0']).catch(() => undefined);
    await adb(serial, ['shell', 'settings put global transition_animation_scale 0']).catch(() => undefined);
    await adb(serial, ['shell', 'settings put global animator_duration_scale 0']).catch(() => undefined);
    vtouchCache.delete(serial);
    await logLine('✓ Ekran 1080x2400 @ 421 dpi + animasyonlar kapalı');
  });

  // 5) vtouch + unique identity — stream vtouch into the container, spoof a
  //    UNIQUE device so WhatsApp can't link the fleet.
  await step('vtouch', 58, 'Gerçek dokunma + benzersiz kimlik', async () => {
    // Copy vtouch + wa-bringup.sh into the container's /data/local/tmp via HOST-MOUNT
    // (not ADB push — that stalls/needs auth), then run wa-bringup as ROOT via
    // lxc-attach `su -c`. wa-bringup creates the uinput vtouch node (real touch —
    // WhatsApp's companion menu rejects synthetic taps, only real touch works) AND
    // applies the resetprop integrity spoof. Root now exists (applyRoot in infra).
    let hostTmp = '';
    for (const c of [`/root/.local/share-${instance}/waydroid/data/local/tmp`, `/root/.local/share/waydroid.${instance}/data/local/tmp`]) {
      const base = c.replace(/\/local\/tmp$/, '');
      if (await execFileAsync('test', ['-d', base]).then(() => true).catch(() => false)) { hostTmp = c; break; }
    }
    if (hostTmp) {
      await execFileAsync('mkdir', ['-p', hostTmp]).catch(() => undefined);
      const vtSrc = join(APK_DIR, 'vtouch');
      if (await execFileAsync('test', ['-f', vtSrc]).then(() => true).catch(() => false)) {
        await execFileAsync('cp', ['-f', vtSrc, `${hostTmp}/vtouch`]).catch(() => undefined);
      }
      await execFileAsync('cp', ['-f', join(WD_DIR, 'wa-bringup.sh'), `${hostTmp}/wa-bringup.sh`]).catch(() => undefined);
      await execFileAsync('sh', ['-c', `chmod 0755 ${shArg(hostTmp)}/vtouch ${shArg(hostTmp)}/wa-bringup.sh 2>/dev/null; chown 2000:2000 ${shArg(hostTmp)}/vtouch ${shArg(hostTmp)}/wa-bringup.sh 2>/dev/null`]).catch(() => undefined);
    } else {
      await logLine('⚠ instance data dizini yok — vtouch atlanıyor');
    }
    // Re-pin screen (over ADB — identity-bearing) and clear the vtouch cache.
    await ensureConnected(serial).catch(() => undefined);
    await adb(serial, ['shell', 'wm size 1080x2400']).catch(() => undefined);
    await adb(serial, ['shell', 'wm density 421']).catch(() => undefined);
    vtouchCache.delete(serial);
    // Write the unique-identity env to a FILE that wa-bringup.sh sources, instead of
    // inlining it into the `su -c "..."` string. ROOT CAUSE of every device ending
    // up as SM-G991B (fleet-linkable): a model with a space ("moto g84 5G", "Pixel 8
    // Pro") breaks the nested `su -c "WA_MODEL='moto g84 5G' ..."` quoting ("no
    // closing quote"), so the env is dropped and wa-bringup falls back to its
    // SM-G991B default. A sourced env file has NO quoting hazard — each value is a
    // literal shell assignment.
    if (hostTmp) {
      const envFile = [
        `WA_MODEL=${shArg(fp.model || 'SM-G991B')}`,
        fp.brand ? `WA_BRAND=${shArg(fp.brand)}` : '',
        fp.manufacturer ? `WA_MANUFACTURER=${shArg(fp.manufacturer)}` : '',
        fp.buildNumber ? `WA_FINGERPRINT=${shArg(fp.buildNumber)}` : '',
        fp.serialNo ? `WA_SERIAL=${shArg(fp.serialNo)}` : '',
        fp.androidId ? `WA_ANDROID_ID=${shArg(fp.androidId)}` : ''
      ].filter(Boolean).map((l) => `export ${l}`).join('\n') + '\n';
      await writeFile(`${hostTmp}/wa-env.sh`, envFile).catch(() => undefined);
      await execFileAsync('chmod', ['0644', `${hostTmp}/wa-env.sh`]).catch(() => undefined);
    }
    // Create /dev/uinput (major 10, minor 223) BEFORE wa-bringup — the node doesn't
    // exist on a fresh Waydroid boot, and vtouch can't register its virtual
    // touchscreen without it ("vtouch not in sysfs"). Then run wa-bringup as root
    // (sourcing wa-env.sh first): it starts vtouch (real touch) + applies the
    // resetprop integrity spoof with the DEVICE-UNIQUE identity.
    // `/system/bin/sh -c` doesn't inherit Android's PATH → call su by absolute path.
    await lxcAttach(instance, ['/system/bin/sh', '-c',
      `export PATH=/system/bin:/system/xbin:$PATH; /system/bin/su -c '. /data/local/tmp/wa-env.sh 2>/dev/null; mknod /dev/uinput c 10 223 2>/dev/null; chmod 666 /dev/uinput; sh /data/local/tmp/wa-bringup.sh' 2>&1; true`], 40000).catch((e) => log('wa-bringup:', e.message));
    await new Promise((r) => setTimeout(r, 2000));
    // Verify vtouch registered (real touch active) via the input node.
    const vt = await lxcAttach(instance, ['/system/bin/sh', '-c', 'ls /dev/input/ 2>&1'], 10000).catch(() => '');
    const model = fp.model || 'SM-G991B';
    await logLine(/event/.test(vt)
      ? `✓ Gerçek dokunma (vtouch) aktif + kimlik (${model}) uygulandı`
      : `• Kimlik (${model}) uygulandı — vtouch son adımda (persist) yeniden kurulacak`);
  });

  // 6) route — Android netstack leaves fwmark tables empty every boot.
  await step('route', 68, 'Ağ yönlendirme', async () => {
    await addInstanceRoutes(instance, subnetId, ip);
    await logLine(`✓ Ağ yönlendirme eklendi (gw ${subnetPrefix(subnetId)}.1)`);
  });

  // 7) proxy — country-matched residential exit (only if requested).
  if (proxy && proxy.country && proxy.username && proxy.host) {
    await step('proxy', 76, `Proxy (${proxy.country})`, async () => {
      await logLine(`${proxy.country} residential proxy'ye yönlendiriliyor (redsocks + iptables)…`);
      await logLine(`📡 Upstream: ${proxy.host}:${proxy.port || 9999} (${proxy.country})`);
      const out = await hostSh('wd-proxy.sh', [
        instance, String(proxy.country), String(proxy.username),
        String(proxy.password || ''), String(proxy.host), String(proxy.port || 9999)
      ], 60000);
      // wd-proxy.sh prints "PROXY_RESULT ... redsocks=<port>" only when the iptables
      // REDIRECT rules were actually installed. If we DON'T see it, the routing didn't
      // take (e.g. iptables needs root and was silently skipped) — surface that instead
      // of the old always-green "yönlendirildi" that hid a US-exit bug.
      const applied = /PROXY_RESULT[^\n]*redsocks=\d+/.test(String(out.stdout || ''));
      if (!applied) {
        // ★FATAL: a proxy was REQUESTED but the REDIRECT did not install (not root /
        // xt_REDIRECT missing / port busy). Previously this only logged a warning and
        // fell through, so the device was provisioned "READY" while still exiting on the
        // host's datacenter IP — a TR number registered on it then hit "Login not
        // available". Mirror EMULATOR_SET_PROXY (which throws on the same condition):
        // THROW so step() marks the provision FAILED instead of a silent fake-success.
        await logLine('⚠ Proxy kuralları uygulanamadı (iptables REDIRECT eklenmedi) — çıkış IP host olurdu, provision DURDURULUYOR!');
        const tail = String(out.stdout || out.stderr || '').trim().split('\n').pop() || 'wd-proxy.sh REDIRECT doğrulamadı';
        throw new Error(`proxy apply failed (${proxy.country}): ${tail}`);
      }
      await logLine('✓ redsocks + iptables REDIRECT aktif');
      // VERIFY the real exit country the way WhatsApp sees it (app-uid traffic through
      // redsocks), not a root curl (root bypasses the REDIRECT and shows the host IP).
      // This is the check that catches a "US IP with a TR number" before registration.
      const exit = await verifyExitCountry(serial).catch(() => null);
      if (exit && exit.country) {
        const match = String(exit.country).toUpperCase() === String(proxy.country).toUpperCase();
        await logLine(
          `${match ? '✓' : '⚠'} Gerçek çıkış IP: ${exit.ip || '—'} (${exit.country}${exit.city ? ', ' + exit.city : ''})` +
          `${match ? ' — numara ülkesiyle EŞLEŞTİ' : ` — İSTENEN ${proxy.country} DEĞİL, uyuşmuyor!`}`
        );
        // ★A verified country MISMATCH is as dangerous as no proxy: the number would
        // register on the wrong country's IP. Fail the provision rather than mark the
        // device ready on a mismatched exit. (Only fail when we actually resolved a
        // country; an unverifiable exit below stays non-fatal — the REDIRECT is in.)
        if (!match) {
          throw new Error(`exit country mismatch: istenen ${proxy.country}, gerçek ${exit.country} (${exit.ip || '—'})`);
        }
      } else {
        await logLine(`✓ Çıkış IP ${proxy.country} ülkesine yönlendirildi (IP doğrulaması atlandı)`);
      }
    });
  } else {
    await logLine('Proxy istenmedi — atlanıyor (datacenter IP)');
  }

  // 8) apks — install the WhatsApp-automation app set from repo-bundled APKs
  //    (host-mount + pm install). GApps/Play Services ship inside system.img, so
  //    only the extra apps are installed here. No source device required.
  await step('apks', 84, 'Uygulamalar kuruluyor', async () => {
    // sys.boot_completed=1 fires ~1 min before PackageManager will accept an
    // install — a `pm install` right after boot returns Failure/empty. `pm path`
    // answering is NOT enough (VERIFIED: probe passes but install still fails).
    // Probe with a REAL install of the smallest APK, retrying until it succeeds.
    await logLine('PackageManager hazırlanıyor…');
    // The boot step already healed a half-boot (hwcomposer crash) by rebooting
    // until `service check package`=found, so framework services are up here.
    // Just confirm PM accepts installs with a real probe install of the tiny APK.
    // ★PERF (FIRSAT 4): the ROOT step already installed adbkeyboard while proving PM
    // is ready. If it's already present, PM demonstrably accepts installs → skip the
    // whole 24×5s re-probe (a redundant reinstall that cost seconds on every provision).
    let pmReady = (await adb(serial, ['shell', 'pm', 'path', 'com.android.adbkeyboard']).catch(() => '')).includes('package:');
    if (pmReady) {
      await logLine('✓ PackageManager hazır (adbkeyboard zaten kurulu)');
    } else {
      for (let i = 0; i < 24 && !pmReady; i++) {
        try { await installBundledApkTo(instance, 'adbkeyboard.apk'); pmReady = true; }
        catch { await new Promise((r) => setTimeout(r, 5000)); }
      }
      await logLine(pmReady ? '✓ PackageManager hazır' : '⚠ PackageManager hazır olmadı (yine de denenecek)');
    }

    const apks = [
      ['com.whatsapp', 'whatsapp.apk', 'WhatsApp'],
      ['com.fleet.a11y', 'fleet-a11y.apk', 'Erişilebilirlik']
      // adbkeyboard installed above as the PM-readiness probe.
    ];
    const installed = {};
    for (const [pkg, file, name] of apks) {
      // Use lxc-attach for the "already installed?" probe — ADB shell hangs on
      // fresh ARM Waydroid (the same reason installs use host-mount + lxc-attach).
      const has = (await lxcAttach(instance, ['/system/bin/pm', 'path', pkg], 15000).catch(() => '')).includes('package:');
      if (has) { installed[pkg] = true; await logLine(`• ${name} zaten kurulu`); continue; }
      await logLine(`${name} kuruluyor…`);
      let done = false;
      for (let attempt = 1; attempt <= 3 && !done; attempt++) {
        try { await installBundledApkTo(instance, file); done = true; installed[pkg] = true; await logLine(`✓ ${name} kuruldu`); }
        catch (e) {
          if (attempt === 3) { plog(`apks: ${name} (${pkg}) install FAILED after 3 tries: ${e.message.slice(0, 160)}`); await logLine(`⚠ ${name} kurulamadı: ${e.message.slice(0, 120)}`); }
          else await new Promise((r) => setTimeout(r, 6000));
        }
      }
    }
    // ★Opsiyonel: Telegram (payload.installTelegram === true). WhatsApp/fleet-a11y'nin
    // AKSİNE best-effort — kurulamazsa provision FAIL OLMAZ, yalnızca uyarı düşer. Bundled
    // telegram.apk yoksa (APK_DIR'de değilse) installBundledApkTo "APK bulunamadı" atar;
    // bunu yakalayıp atlarız. Kurulum SONRASI tgPkgCache.clear() installBundledApkTo içinde
    // otomatik olur (stale NOT_INSTALLED cache'ini temizler), o yüzden burada ek iş yok.
    if (installTelegram) {
      const tgPkgs = ['org.telegram.messenger.web', 'org.telegram.messenger'];
      let tgHas = false;
      for (const tp of tgPkgs) {
        if ((await lxcAttach(instance, ['/system/bin/pm', 'path', tp], 15000).catch(() => '')).includes('package:')) { tgHas = true; break; }
      }
      let tgReady = false;   // installed (already or now) → run first-launch priming
      if (tgHas) {
        await logLine('• Telegram zaten kurulu');
        tgReady = true;
      } else {
        // Bundled APK gerçekten mevcut mu? (Erken bir "APK bulunamadı" atışından kaçın —
        // best-effort adımda gürültülü stack yerine tek satır bilgi vermek isteriz.)
        const tgSrc = join(APK_DIR, 'telegram.apk');
        const tgExists = await execFileAsync('test', ['-f', tgSrc]).then(() => true).catch(() => false);
        if (!tgExists) {
          await logLine('• Telegram APK paketi bulunamadı (telegram.apk) — atlanıyor');
        } else {
          await logLine('Telegram kuruluyor…');
          for (let attempt = 1; attempt <= 3 && !tgReady; attempt++) {
            try { await installBundledApkTo(instance, 'telegram.apk'); tgReady = true; await logLine('✓ Telegram kuruldu'); }
            catch (e) {
              if (attempt === 3) { plog(`apks: Telegram install FAILED after 3 tries: ${e.message.slice(0, 160)}`); await logLine(`⚠ Telegram kurulamadı: ${e.message.slice(0, 120)}`); }
              else await new Promise((r) => setTimeout(r, 6000));
            }
          }
        }
      }
      // İlk-açılış hazırlığı (izin ön-verme + SMS appops + cold-open + bildirim önizleme +
      // HOME). Best-effort ve idempotent — asla throw etmez, bu yüzden provision'ı riske
      // atmadan hem "zaten kurulu" hem "yeni kuruldu" durumunda çalıştırılır. detectTelegramPkg
      // burada re-probe eder (installBundledApkTo kurulumda tgPkgCache.clear() yaptı).
      if (tgReady) {
        try {
          const primed = await primeTelegram(serial);
          await logLine(primed.status === 'PRIMED'
            ? '✓ Telegram ilk-açılış hazırlığı tamam (izinler + bildirim önizleme)'
            : `• Telegram hazırlığı atlandı (${primed.status})`);
        } catch (e) {
          plog(`apks: primeTelegram error: ${(e && e.message || e).toString().slice(0, 120)}`);
          await logLine('⚠ Telegram ilk-açılış hazırlığı tamamlanamadı (yine de kurulu)');
        }
      }
    }

    // ★P7 (false-success fix): WhatsApp is REQUIRED — the whole point of provisioning is a
    // "WhatsApp-hazır" device. Previously a 3x-failed install was downgraded to a ⚠ log and
    // the step returned normally, so provision reported "WhatsApp-hazır" at 100% while
    // com.whatsapp was absent (the source of the raw PackageManager stack trace + green
    // success). Re-probe and THROW if WhatsApp is missing so the provision FAILS honestly.
    // (fleet-a11y stays best-effort — a device without it is degraded, not broken.)
    const waPresent = installed['com.whatsapp'] ||
      (await lxcAttach(instance, ['/system/bin/pm', 'path', 'com.whatsapp'], 15000).catch(() => '')).includes('package:');
    if (!waPresent) throw new Error('WhatsApp kurulamadı (APK yüklenemedi) — cihaz WhatsApp-hazır değil');
  });

  // 9) a11y + keyboard — enable the accessibility service + ADBKeyboard IME + pin
  //    screen. These are IDENTITY-BEARING commands (settings put / ime / am), which
  //    ONLY work over ADB — lxc-attach loses the Binder caller identity, so
  //    getCallingPackage()==null → AppOpsService NPE and the write silently fails.
  //    ADB is already pre-authorized in the boot step (authorizeAdb). VERIFIED.
  await step('a11y', 92, 'Erişilebilirlik + klavye', async () => {
    await ensureConnected(serial).catch(() => undefined);
    // sys.boot_completed=1 fires BEFORE system_server publishes settings/window/
    // package/input_method. Running `settings put`/`wm`/`ime` too early throws
    // "Can't find service: settings". Wait for the settings service to answer
    // (up to ~60s) before touching any of them, so this step never has to fail.
    for (let i = 0; i < 30; i++) {
      const ready = String(await adb(serial, ['shell', 'service check settings']).catch(() => '') || '');
      if (/: found/.test(ready)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const sh = async (cmd) => adb(serial, ['shell', cmd]).catch((e) => log('a11y:', cmd.slice(0, 40), e.message));
    await sh('settings put secure enabled_accessibility_services com.fleet.a11y/com.fleet.a11y.FleetA11yService');
    await sh('settings put secure accessibility_enabled 1');
    await sh('ime enable com.android.adbkeyboard/.AdbIME');
    await sh('ime set com.android.adbkeyboard/.AdbIME');
    await sh('wm size 1080x2400');
    await sh('wm density 421');
    // ★2026-08-04: bu OPSIYONEL bir optimizasyon (GMS'in arka plan bildirim servisini
    // kapatir). Bircok GApps imajinda bu bilesen HIC YOK → `pm disable` "Unknown
    // component" ile doner ve `sh()` her kurulumda bir uyari basardi (LOGDA 209 KEZ).
    // Kurulumu etkilemiyor (hatayi alan cihazlarin hepsi COMPLETED) — bu yuzden
    // yalnizca BU komutun hatasi sessizce yutuluyor; digerlerinin uyarisi KORUNUYOR.
    await adb(serial, ['shell', 'pm disable com.google.android.gms/.chimera.PersistentDirectBootAwareApiService'])
      .catch(() => undefined);
    // Verify a11y actually stuck (ADB is required for this write to land).
    // NEVER throw here — a verification read failing must not fail the whole
    // provision (the device is already usable; automation falls back to tap).
    const a11y = String(await adbT(serial, ['shell', 'settings', 'get', 'secure', 'enabled_accessibility_services'], 8000).catch(() => '') || '').trim();
    await logLine(/fleet/i.test(a11y)
      ? '✓ Erişilebilirlik servisi + ADB klavye + ekran (1080x2400) etkinleştirildi'
      : '⚠ a11y/IME ayarlanamadı (ADB yetkisi?) — otomasyon input-tap ile devam');
  });

  // 10) persist — verify the full stack is up.
  const checks = await step('persist', 97, 'Kalıcılık doğrulanıyor', async () => {
    const boot = String(await adbT(serial, ['shell', 'getprop', 'sys.boot_completed'], 8000) || '').trim() === '1';
    // `/system/bin/sh -c` doesn't inherit Android's PATH → bare `su` is "not found",
    // which made this read root=✗ even though `su -c id`=uid=0 (the log then lied).
    // Call su by absolute path with PATH exported (same fix as the bring-up sites).
    const rootOk = /uid=0/.test(await lxcAttach(instance, ['/system/bin/sh', '-c',
      'export PATH=/system/bin:/system/xbin:$PATH; /system/bin/su -c id 2>&1'], 15000).catch(() => ''));
    // Re-assert vtouch LAST — the a11y step's `wm size/density` resets SurfaceFlinger
    // and drops the vtouch input node created back in step 5. Re-run bring-up via
    // lxc-attach (the proven path — ADB `su -c` may hang on Magisk manager approval).
    // /dev/uinput is gone after the reset, so recreate it first. CRITICAL: keep the
    // container THAWED for the whole bring-up — Waydroid's suspend_action=freeze
    // freezes an idle container, and a frozen container makes wa-bringup (~15s of
    // InputReader probing) silently no-op. This is exactly why the manual run works
    // (I unfreeze first) but the in-provision run left vtouch=0.
    const lxcpVt = `/var/lib/waydroid.${instance}/lxc`;
    let thawingVt = true;
    const thawVt = (async () => {
      while (thawingVt) {
        await execFileAsync('lxc-unfreeze', ['-n', 'waydroid', '-P', lxcpVt]).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    let vtOut = '';
    try {
      // `/system/bin/sh -c` does NOT inherit Android's PATH, so a bare `su` is
      // "inaccessible or not found" (VERIFIED via debug log) even though `su -c id`
      // works when invoked directly. Export PATH + call su by absolute path.
      vtOut = await lxcAttach(instance, ['/system/bin/sh', '-c',
        `export PATH=/system/bin:/system/xbin:$PATH; /system/bin/su -c '. /data/local/tmp/wa-env.sh 2>/dev/null; mknod /dev/uinput c 10 223 2>/dev/null; chmod 666 /dev/uinput; sh /data/local/tmp/wa-bringup.sh' 2>&1; true`], 45000)
        .catch((e) => `LXCATTACH_ERR: ${e.message}`);
    } finally { thawingVt = false; await thawVt; }
    vtouchCache.delete(serial);
    let vt = /vtouch node ready|InputReader sees vtouch/.test(vtOut);
    if (!vt) vt = /event/.test(await lxcAttach(instance, ['/system/bin/sh', '-c', 'ls /dev/input/ 2>&1'], 10000).catch(() => ''));
    // ★ KOK-FIX (route persist): Android netd boot sirasinda fwmark route tablolarini
    // TEMIZLER (bkz. addInstanceRoutes yorumu). Route adim-6da (%68) eklendi ama buraya
    // (%97, boot_completed sonrasi) gelene kadar netd onu silmis olabilir -> cihaz READY
    // ama route YOK -> internete cikamaz -> heal 90s sonra toplar (yavas). COZUM: burada
    // (netd stabilize) route yeniden ekle + DOGRULA. READY isaretlenince route GARANTI.
    // ★ persist TAS-GIBI receten: route(table eth0) + redsocks GARANTI + 1 kisa dogrula.
    // Android fwmark uygulama-trafigi table eth0 kullanir; netd boot sonrasi table eth0'i
    // temizleyebilir. Burada (netd stabilize) route ekle + redsocks daemon'i garantile
    // (REDIRECT hedef-portu dinleyen redsocks yoksa cihaz TCP 000 verir — mi31 canli kanit).
    // Tutmazsa heal (provisioningInstances'ten cikinca ilk tick) toplar. Dongu YOK -> hizli.
    // ★2026-07-27 INTERNET-CIKIS FIX (script-sureci YOK, retry): Android netd boot sonrasi
    // table eth0'i (uygulama-trafigi orayi kullanir) TEMIZLER → internet YOK (TCP 000).
    // Cihaz GERCEKTEN cikana kadar route ekle + redsocks garantile + dogrula (max ~10 tur/
    // ~50s, netd sakinlesince tutar). Kalicilik: agent heal (adbRecoveryTick) sonrasi da
    // table eth0'i korur → reboot/netd-silme sonrasi otomatik geri gelir.
    let provExitOk = false, provTcp = '';
    const rsConf = `/etc/redsocks-inst-${instance}.conf`;
    const rsPort = 12500 + subnetId;
    for (let att = 0; att < 4; att++) { // proto-static route ILK turda tutar; cikinca break, kalan turlar sadece redsocks-tazele icin
      // 1) table eth0 (+ main/local_network) route garantile — uygulama-trafigi table eth0 kullanir.
      await addInstanceRoutes(instance, subnetId, ip).catch(() => undefined);
      // 2) redsocks: 502/000 (upstream tikali) -> ZORLA tazele (daemon var-yok fark etmez).
      //    Ilk tur daemon-var ise dokunma; sonraki turlarda (cikamiyorsa) fuser+restart.
      if (proxy) {
        const forceRs = att > 0; // ilk tur nazik, sonra zorla-tazele
        await execFileAsync('bash', ['-c', forceRs
          ? `test -f ${rsConf} && { fuser -k ${rsPort}/tcp >/dev/null 2>&1; sleep 0.4; redsocks -c ${rsConf} >/dev/null 2>&1; }; true`
          : `test -f ${rsConf} && { pgrep -f 'redsocks -c ${rsConf}' >/dev/null 2>&1 || redsocks -c ${rsConf} >/dev/null 2>&1; }; true`
        ]).catch(() => undefined);
      }
      // 3) gercek cikis dogrula (DNS-siz ham-TCP). 2xx/30x = cikiyor.
      provTcp = await adbT(serial, ['shell', 'su', '-c', 'curl -s -o /dev/null -w %{http_code} --max-time 6 http://1.1.1.1'], 9000).then((o) => String(o || '').trim()).catch(() => '');
      if (/^(2\d\d|30\d)$/.test(provTcp)) { provExitOk = true; break; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    await logLine(`${provExitOk ? '✓ Ag yonlendirme: cihaz internete CIKIYOR (dogrulandi)' : '⚠ Ag yonlendirme: cikis heal-tick ile tamamlanacak (route+proxy kuruldu)'}`);
    await logLine(`Kontrol: boot=${boot ? '✓' : '✗'} root=${rootOk ? '✓' : '✗'} vtouch=${vt ? '✓' : '✗'} proxy=${proxy ? '✓' : '—'}`);
    return { boot, root: rootOk, vtouch: vt, proxy: !!proxy };
  });

  // 11) done — flush the final step's timer + emit ONE summary line so a tail of the log
  // tells the whole timing story (e.g. "infra=42s boot=31s root=8s ...").
  timings[curStep] = (timings[curStep] || 0) + (Date.now() - _stepAt);
  const elapsedMs = Date.now() - provT0;
  plog(`DONE ${instance} ${(elapsedMs / 1000).toFixed(0)}s | ${timingSummary()}`);
  await reportProgress(jobId, 'done', 100, `✓ Kurulum tamamlandı — ${instance} WhatsApp-hazır (${serial})`);
  provisioningInstances.delete(instance); // artık heal serbest (cihaz canlı)
  return { instance, serial, ip, adbPort, subnetId, ready: true, checks, timings, elapsedMs };
  } catch (e) {
    // ★P1: a post-infra step threw — tear down the half-built instance so its ~4.4GB clone
    // (+ systemd unit / dbus policy / subnet-map line) doesn't leak on disk. Best-effort:
    // the ORIGINAL error always propagates; a teardown failure is logged, never masks it.
    provisioningInstances.delete(instance); // teardown başlıyor — heal-koruması kalksın
    plog(`provision FAILED — tearing down ${instance}: ${e.message}`);
    await hostSh('wd-destroy.sh', [instance], 120000).catch((te) => plog(`teardown error (leaked): ${te.message}`));
    throw e;
  }
}

// Re-add the fwmark routes an Android netstack drops on every boot (else "no
// internet"). Shared by provision + wake.
//
// ★★2026-07-28 KOK-FIX — container-ici binary'ler MUTLAK yolla cagrilmali.
// lxc-attach host'un PATH'ini container'a gecirir. systemd'nin varsayilan servis PATH'i
// (/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin) /bin ve /sbin ICERMEZ; Android'de
// ip/pm/setprop /system/bin altinda ve oraya sadece /bin -> /system/bin symlink'i ile
// ulasilir. Sonuc: agent'in HER `lxc-attach -- ip ...` cagrisi
//   lxc-attach: Failed to exec "ip" - No such file or directory
// ile SESSIZCE dusuyordu (tum cagrilar .catch()/2>/dev/null ile yutuluyor). Etkisi:
//   1) provision route adimi hicbir sey eklemiyordu -> YENI cihaz internete CIKAMIYOR
//      (panel "kurulum tamamlandi" der, cihaz TCP 000 -> WhatsApp "Couldn't connect"),
//   2) heal'in route-KONTROLU de ayni sekilde dusup 0 donuyordu -> her tick "route YOK"
//      (35 cihaz x 2 tick/dk = ~66 satir/dk sonsuz spam) ve heal HICBIR cihazi onaramiyordu.
// Elle test edilince calisiyor gorunuyordu cunku interaktif/sudo PATH'inde /bin VAR.
// KANIT: agent PATH'i ile `Failed to exec "ip"`, /system/bin/ip ile route listesi geldi.
// Fix iki katmanli: (a) burada mutlak yol, (b) servise PATH drop-in (pm/setprop vb. icin).
async function addInstanceRoutes(instance, subnetId, ip) {
  const gw = `${subnetPrefix(subnetId)}.1`;
  const cidr = `${subnetPrefix(subnetId)}.0/24`;
  for (const table of ['main', 'local_network', 'eth0']) {
    await lxcAttach(instance, ['/system/bin/ip', 'route', 'add', 'default', 'via', gw, 'dev', 'eth0', 'proto', 'static', 'table', table], 15000).catch(() => undefined);
  }
  for (const table of ['eth0', 'local_network']) {
    await lxcAttach(instance, ['/system/bin/ip', 'route', 'add', cidr, 'dev', 'eth0', 'proto', 'static', 'scope', 'link', 'src', ip, 'table', table], 15000).catch(() => undefined);
  }
}

// Compute an instance's subnet third-octet the same way net-head.sh does
// (md5(name) -> 241..256), so wake/sleep can resolve the gateway without the
// provision result. Zero-dep (node:crypto).
function subnetIdForInstance(instance) {
  const hex = createHash('md5').update(instance).digest('hex').slice(0, 8);
  return (parseInt(hex, 16) % 16) + 241;
}

// DEVICE_WAKE — really start a stopped Waydroid instance (EMULATOR_START only
// ack'd). payload: { deviceId, instance }. Boots via wd-run.sh (detached), waits
// for boot, re-adds routes, returns the live ADB endpoint so the API marks the
// device ONLINE.
async function wakeDevice(job) {
  const payload = job.payload || {};
  const instance = String(payload.instance || '').trim();
  if (!instance) throw new Error('wake: instance name required');
  const subnetId = subnetIdForInstance(instance);
  const lxcp = `/var/lib/waydroid.${instance}/lxc`;

  // Already running? Just re-assert routes + report the endpoint.
  const state = await execFileAsync('lxc-info', ['-P', lxcp, '-n', 'waydroid', '-sH'], { timeout: 10000 })
    .then((r) => String(r.stdout || '').trim())
    .catch(() => 'UNKNOWN');
  if (state !== 'RUNNING') {
    hostShDetached('wd-run.sh', [instance]);
    await new Promise((r) => setTimeout(r, 8000));
  }

  const ip = (await resolveLeaseIp(instance, subnetId).catch(() => null)) || `${subnetPrefix(subnetId)}.112`;
  const serial = `${ip}:5555`;
  await ensureConnected(serial);
  // ★2026-07-24: erişilemiyorsa (container RUNNING ama ADB "No route") eth0-IP kaybı
  // olabilir — 180s boşuna waitBoot beklemek yerine ÖNCE eth0-heal dene, sonra reconnect.
  // (canlı-teşhiste mi19/idilcall bu yüzden DEVICE_WAKE 180s-timeout'a düşüyordu.)
  const reachable = await isSerialReachable(serial).catch(() => false);
  if (!reachable) {
    const r = await healInstanceEth0(instance).catch(() => ({ healed: false }));
    if (r.healed) { log(`wake: ${instance} eth0-heal uygulandı → ${r.ip}`); await ensureConnected(serial).catch(() => undefined); }
  }
  const booted = await waitBoot(serial, 180000);
  if (!booted) throw new Error('wake: boot_completed not reached within 180s');
  await addInstanceRoutes(instance, subnetId, ip);
  return { instance, serial, ip, adbPort: 5555, status: 'ONLINE', awakened: true };
}

// DEVICE_SLEEP — cleanly stop a Waydroid instance. payload: { deviceId, instance }.
async function sleepDevice(job) {
  const payload = job.payload || {};
  const instance = String(payload.instance || '').trim();
  if (!instance) throw new Error('sleep: instance name required');
  const out = await hostSh('wd-stop.sh', [instance], 60000).catch((e) => ({ stdout: '', stderr: e.message }));
  return { instance, status: 'OFFLINE', stopped: true, note: out.stdout.trim().split('\n').pop() || out.stderr };
}

// DEVICE_DESTROY — FULLY tear down a Waydroid instance when its device is deleted:
// stop it (wd-stop) then destroy its userdata/container/bridge (wd-destroy). payload:
// { instance }. Carries NO deviceId — the Device row is deleted right after this is
// dispatched, so we key on the instance NAME only. FIX (2026-07-24): delete used to
// leave the host instance running forever (orphan burning CPU/RAM/disk); this makes
// "delete" actually free the box. Idempotent: destroying an already-gone instance is a
// no-op. Best-effort per step so a partial teardown still frees most resources.
async function destroyDevice(job) {
  const payload = job.payload || {};
  const instance = String(payload.instance || '').trim();
  if (!instance) throw new Error('destroy: instance name required');
  // 1) stop the running session/container first so destroy isn't fighting a live lock.
  await hostSh('wd-stop.sh', [instance], 60000).catch(() => undefined);
  // 2) destroy userdata + container + bridge (full cleanup, reclaims disk).
  const out = await hostSh('wd-destroy.sh', [instance], 120000).catch((e) => ({ stdout: '', stderr: e.message }));
  return { instance, status: 'DESTROYED', destroyed: true, note: (out.stdout || '').trim().split('\n').pop() || out.stderr || 'destroyed' };
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
    case 'shell': {
      // Fail-closed defense-in-depth: a raw shell step runs an arbitrary command on
      // the device. AI-generated flows never produce these (the API strips `shell`
      // from model output), but a flow could still carry one via an older record, a
      // webhook, or a compromised source. Refuse by default; an operator who really
      // needs shell in a hand-authored flow sets FLEET_RPA_ALLOW_SHELL=1 explicitly.
      if (process.env.FLEET_RPA_ALLOW_SHELL !== '1') {
        throw new Error('shell adımı devre dışı (güvenlik) — FLEET_RPA_ALLOW_SHELL=1 ile açılabilir');
      }
      return adb(serial, ['shell', String(step.command ?? '')]);
    }
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
// ── SSRF guard (zero-dep: node:net + node:dns only) ─────────────────────────
// Blocks fetches that reach private/loopback/link-local/reserved addresses,
// including the tricks a string-prefix check misses: decimal/octal/hex IPv4
// (http://2130706433/ = 127.0.0.1), IPv4-mapped IPv6 ([::ffff:127.0.0.1]), and
// hostnames that RESOLVE to an internal IP (DNS is checked, not just the literal).

// Return true if a numeric IPv4 (as a 32-bit unsigned) is in a blocked block.
function isBlockedV4(n) {
  const a = (n >>> 24) & 0xff, b = (n >>> 16) & 0xff;
  if (a === 0) return true;                       // 0.0.0.0/8 "this network"
  if (a === 10) return true;                      // 10/8 private
  if (a === 127) return true;                     // 127/8 loopback
  if (a === 169 && b === 254) return true;        // 169.254/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true;        // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 192 && b === 0 && ((n >>> 8) & 0xff) === 0) return true; // 192.0.0/24 IETF
  if (a >= 224) return true;                       // 224/4 multicast + 240/4 reserved
  return false;
}

// Parse any IPv4 literal form (dotted, decimal, octal, hex, or 2-3 part) to a
// 32-bit number, or return null if it isn't an IPv4 literal.
function parseV4(host) {
  const parts = host.split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const nums = [];
  for (const p of parts) {
    if (p === '') return null;
    let v;
    if (/^0x[0-9a-f]+$/i.test(p)) v = parseInt(p, 16);
    else if (/^0[0-7]+$/.test(p)) v = parseInt(p, 8);
    else if (/^\d+$/.test(p)) v = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(v) || v < 0) return null;
    nums.push(v);
  }
  // Fold the compressed forms (a, a.b, a.b.c, a.b.c.d) into a 32-bit value.
  if (nums.length === 1) return nums[0] >>> 0;
  if (nums.length === 2) return (((nums[0] & 0xff) << 24) | (nums[1] & 0xffffff)) >>> 0;
  if (nums.length === 3) return (((nums[0] & 0xff) << 24) | ((nums[1] & 0xff) << 16) | (nums[2] & 0xffff)) >>> 0;
  if (nums.some((x) => x > 0xff)) return null;
  return (((nums[0]) << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

// True if a literal address string (IPv4 or IPv6) is private/reserved.
function isBlockedAddress(addr) {
  const v = String(addr).toLowerCase();
  const kind = isIP(v);
  if (kind === 4) return isBlockedV4(parseV4(v) ?? 0);
  if (kind === 6) {
    // IPv4-mapped / -compatible (::ffff:127.0.0.1 or ::ffff:7f00:1) — check the v4 part.
    const m = /(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/.exec(v);
    if (m) return isBlockedV4(parseV4(m[1]) ?? 0);
    const m2 = /::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
    if (m2) return isBlockedV4((((parseInt(m2[1], 16)) << 16) | parseInt(m2[2], 16)) >>> 0);
    if (v === '::1' || v === '::') return true;          // loopback / unspecified
    if (/^(fc|fd)[0-9a-f]{2}:/.test(v)) return true;     // fc00::/7 unique-local
    if (/^fe80:/.test(v)) return true;                   // link-local
    if (/^ff[0-9a-f]{2}:/.test(v)) return true;          // multicast
    return false;
  }
  // Not a recognized IP literal — but it may still be a decimal/hex IPv4 that
  // isIP() rejects (e.g. "2130706433"); try our tolerant parser.
  const n = parseV4(v);
  if (n !== null) return isBlockedV4(n);
  return false;
}

function assertPublicUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new Error(`Invalid URL: ${raw}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${u.protocol}`);
  }
  if (u.username || u.password) throw new Error('Blocked URL with embedded credentials');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase(); // strip IPv6 brackets
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error(`Blocked private/loopback host: ${host}`);
  }
  if (isBlockedAddress(host)) throw new Error(`Blocked private/loopback host: ${host}`);
  return u;
}

// DNS-aware check: resolve the hostname and reject if ANY resolved address is
// internal (defeats a public host with an A record pointing at 169.254.169.254).
// Literal IPs are already covered by assertPublicUrl; this adds the name lookup.
async function assertPublicResolved(u) {
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host)) return; // literal — assertPublicUrl already vetted it
  let addrs;
  try {
    addrs = await dnsLookup(host, { all: true });
  } catch {
    return; // unresolvable — let fetch fail naturally; nothing internal reached
  }
  for (const a of addrs) {
    if (isBlockedAddress(a.address)) {
      throw new Error(`Blocked host resolving to internal address: ${host} → ${a.address}`);
    }
  }
}

// ★2026-08-11 GÜVENLİK (CRITICAL): dosya adı ASLA hedef dizinin dışına çıkamaz.
// Önceden `join(dir, name)` ham `name` ile çağrılıyordu; `EMULATOR_PUSH_FILE` işinin
// `fileName` alanı API'de yalnızca `z.string().optional()` ile doğrulanıyor (içerik
// denetimi YOK) ve agent'a olduğu gibi ulaşıyordu. Agent bu host'ta ROOT çalıştığı için
// `fileName: "../../../etc/cron.d/x"` göndermek kök dosya sistemine yazma demekti
// = tam sistem ele geçirme. Sanitizasyon bilerek `download()` içinde: böylece
// bugünkü 6 çağrının hepsi ve ileride eklenecekler otomatik korunur.
function safeFileName(name, fallback = 'file') {
  // Ters eğik çizgiyi de normalize et — POSIX `basename` onu ayraç saymaz,
  // dolayısıyla "..\\..\\x" tek parça olarak geçerdi.
  const base = basename(String(name ?? '').replace(/\\/g, '/')).trim();
  if (!base || base === '.' || base === '..') return fallback;
  // Kontrol karakterleri ve kabuk/dosya sistemi için riskli işaretleri sadeleştir.
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 120);
  return clean || fallback;
}

async function download(url, name) {
  let u = assertPublicUrl(url);
  await assertPublicResolved(u);
  // Follow redirects manually so each hop is re-validated (a public URL can 302
  // to an internal one → SSRF). Cap the chain to avoid loops.
  let current = String(url);
  let res;
  for (let hop = 0; hop < 5; hop++) {
    res = await fetch(current, { redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      u = assertPublicUrl(current);
      await assertPublicResolved(u);
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`Download failed (${res ? res.status : 'no response'}) for ${url}`);
  const dir = await mkdtemp(join(tmpdir(), 'fleet-'));
  const local = join(dir, safeFileName(name));
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
// ★2026-07-23 (S-3): AbortSignal timeout on EVERY request. Node's fetch has no default
// timeout — if the control plane hangs (network blip, API wedged), a bare fetch never
// settles. The dispatch-loop watchdog only catches this after WATCHDOG_STALL_MS (5min),
// during which the whole host's devices sit idle. A 35s per-request cap (above the API's
// long-poll hold for /jobs/next-batch) makes a stuck request reject in seconds so the
// loop turns. Callers may pass a smaller timeout for short calls (complete/heartbeat).
const API_DEFAULT_TIMEOUT = Number(process.env.FLEET_API_TIMEOUT_MS || 35000);
async function signedFetch(path, init, timeoutMs = API_DEFAULT_TIMEOUT) {
  const method = (init && init.method) || 'GET';
  const bodyString = (init && typeof init.body === 'string') ? init.body : '';
  const { ts, sign } = signRequest(method, path, bodyString);
  const mergedHeaders = { ...headers, ...(init && init.headers ? init.headers : {}), 'x-agent-ts': ts, 'x-agent-sign': sign };
  const signal = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  return fetch(`${API_URL}${path}`, { ...init, headers: mergedHeaders, ...(signal ? { signal } : {}) });
}

async function api(path, init, opts) {
  const res = await signedFetch(path, init, opts && opts.timeoutMs);
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

// ★2026-07-23 (S-2): api() with bounded retry for transient failures (network / 5xx /
// abort). A COMPLETED job's result must NOT be lost to a single API blip — otherwise the
// job stays RUNNING and the reaper later marks a genuinely-successful send FAILED. Retries
// only on transient errors (not 4xx, which are deterministic). Short backoff; caller sets
// tries. Used for reportComplete / progress where losing the write is expensive.
async function apiRetry(path, init, tries = 3, opts) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await api(path, init, opts);
    } catch (err) {
      lastErr = err;
      const msg = String(err && err.message);
      // 4xx = deterministic client error → don't retry (would just fail again).
      if (/->\s*4\d\d\b/.test(msg)) throw err;
      if (i < tries - 1) await sleep(800 * (i + 1)); // 0.8s, 1.6s backoff
    }
  }
  throw lastErr;
}

async function claimNext() {
  const { data } = await api('/agent/jobs/next', { method: 'GET' });
  return data; // job or null
}

// Batch claim: ask for up to `max` jobs in ONE round-trip. Kills the poll-Hz
// bottleneck — a burst of light root-DB jobs used to be gated by one /jobs/next
// per job (≈ N × POLL_MS wall-clock); now we drain them in ⌈N/max⌉ round-trips
// and run them concurrently. Falls back to the single /jobs/next endpoint if the
// API is older (404/param error) so a new agent still works against an old API.
let batchClaimUnsupported = false;
async function claimBatch(max) {
  if (batchClaimUnsupported) {
    const one = await claimNext();
    return one ? [one] : [];
  }
  try {
    const { data } = await api(`/agent/jobs/next-batch?max=${max | 0}`, { method: 'GET' });
    return Array.isArray(data) ? data : data ? [data] : [];
  } catch (err) {
    // Old API without the batch route → remember and use the single endpoint.
    if (/->\s*404\b/.test(String(err && err.message))) {
      batchClaimUnsupported = true;
      const one = await claimNext();
      return one ? [one] : [];
    }
    throw err;
  }
}

async function reportComplete(jobId, status, payload) {
  // ★2026-07-23 (S-2): retry — a finished job's result is expensive to lose. A single
  // API/DB blip here would leave the job RUNNING until the reaper FAILs it (up to 15min),
  // turning a successful send into a "failed" bubble. Short timeout (10s) + 3 tries.
  await apiRetry(`/agent/jobs/${jobId}/complete`, { method: 'POST', body: JSON.stringify({ status, ...payload }) }, 3, { timeoutMs: 10000 });
}

// The ADB serials currently reporting "device" (reachable — not offline/
// unauthorized/missing). The API uses this exact set to mark only the phones
// that are truly up as ONLINE, instead of assuming every bound device is live.
// ★2026-07-23 (P-1): short TTL CACHE. Three tickers (inbox 3s, capture 5s, metrics per
// heartbeat) each ran `adb devices` independently every tick — a needless extra ADB
// round-trip several times a second. The reachable set barely changes second-to-second,
// so cache it for ~2.5s and let all callers share one result. `adb devices` failures
// return the last good set (not empty) so a transient blip doesn't flap devices offline.
let _reachCache = { at: 0, val: [] };
const REACH_TTL_MS = 2500;
async function reachableSerials() {
  const nowMs = Date.now();
  if (nowMs - _reachCache.at < REACH_TTL_MS) return _reachCache.val;
  try {
    const out = await adb(null, ['devices']);
    const val = out
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => /\sdevice$/.test(l))
      .map((l) => l.split(/\s+/)[0])
      .filter(Boolean);
    _reachCache = { at: nowMs, val };
    return val;
  } catch {
    // Keep the last good set on a transient failure rather than flapping to empty.
    return _reachCache.val;
  }
}

// ★2026-07-23 (P-6): purge per-serial state for devices that no longer exist. Several
// Maps/Sets are keyed by ADB serial (waSeen, waCaptureSeen, waReceiptState, waLastSentPeer,
// adbKbReady). When a device is removed or re-provisioned its subnet (hence serial)
// changes, and the OLD key is never deleted → a slow memory leak over a long-running agent
// (dozens of dead serials × several maps). This drops any key not in the current reachable
// set. Called periodically from the heartbeat; only runs against a NON-EMPTY reachable set
// so a transient `adb devices` blip can't wipe live state.
async function purgeStaleSerialState() {
  const live = new Set(await reachableSerials());
  if (live.size === 0) return; // don't purge on an empty/failed read
  for (const m of [waSeen, waCaptureSeen, waReceiptState, waLastSentPeer]) {
    for (const k of m.keys()) if (!live.has(k)) m.delete(k);
  }
  for (const k of adbKbReady) if (!live.has(k)) adbKbReady.delete(k);
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
// ★2026-07-23 (P-1): 3s → 5s default. With the re-entrancy guard preventing overlap, a
// slightly longer interval cuts steady-state ADB/dumpsys volume across ~25 devices with
// only a ~2s worst-case extra latency on inbound capture (still near-real-time). Override
// with FLEET_WA_INBOX_MS if a faster poll is wanted.
const WA_INBOX_MS = Number(process.env.FLEET_WA_INBOX_MS || 5000);
const WA_INBOX_ENABLED = process.env.FLEET_WA_INBOX !== '0';
// ── Media auto-capture: poll the WhatsApp Media folder as root and report any NEW
// file the moment it lands — before a view-once is opened or a message is deleted.
// OFF by default (opt-in via FLEET_WA_CAPTURE=1) since it scans the filesystem every
// tick. Reports metadata only (name/type/size/folder) to /agent/whatsapp/media-captured;
// the operator pulls the bytes with fetch-media. serial -> Set of seen file paths.
const WA_CAPTURE_MS = Number(process.env.FLEET_WA_CAPTURE_MS || 5000);
const WA_CAPTURE_ENABLED = process.env.FLEET_WA_CAPTURE === '1';
const waCaptureSeen = new Map();
const WA_CAPTURE_SEEN_MAX = 2000;
const WA_MEDIA_ROOT = '/data/media/0/Android/media/com.whatsapp/WhatsApp/Media';
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
// Dedup outbound receipts so we POST a given (serial|peer|status) transition only
// once. Keyed by serial → last status reported for the newest bubble of each peer.
const waReceiptState = new Map();
// Last phone number we SENT to on each serial. The open chat's title bar shows a
// contact NAME (not the number) when the peer is saved, and the API matches
// receipts by number — so we report the receipt against this remembered number
// instead of the scraped title. Cleared implicitly by being overwritten per send.
const waLastSentPeer = new Map();

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
    // ★2026-08-15: MEDYA-PLACEHOLDER bildirimlerini ATLA. Bildirimde bir foto/video
    // "📷 Photo" / "① Photo" / "🎥 Video" / "🎤 0:07" gibi metinle gorunur; dosyanin
    // KENDISI bildirimden alinamaz. Artik gercek dosyayi ayri medya izleyici
    // (msgstore.message_media) yakalayip yolluyor, bu yuzden placeholder metni
    // gondermek YANILTICI + mukerrer olurdu. Env ile kapatilabilir (eski davranis).
    // Sadece SIRF placeholder olan bildirimleri atlariz; yazili caption'lar gecer.
    if (process.env.FLEET_WA_SKIP_MEDIA_NOTIF !== '0') {
      const t = text.trim();
      // circled/emoji + tek kelime medya turu (opsiyonel sure "0:07" ekiyle)
      if (/^[①-⑳📷🎥🎤🎙📎🖼●•\s]*(Photo|Video|GIF|Sticker|Voice message|Audio|Document|Location|Contact|View once|Foto[ğg]raf|Video|Ses|Belge|Konum|Ki[şs]i|\d+:\d{2})[\s•]*$/i.test(t)) {
        continue;
      }
    }
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

// ── Telegram inbound message capture ────────────────────────────────────────
//
// Twin of the WhatsApp inbound path (parseWaNotifications + scrapeIncomingBubbles),
// but Telegram's notification + UI shapes differ enough that it is NOT a copy-paste.
//
// ★NOTIFICATION FORMAT (mapped from org.telegram.messenger.NotificationsController,
//  DrKLO/Telegram master — VERIFIED-LIVE markers are TODO; confirm against a live
//  `dumpsys notification --noredact` on the target build before fully trusting the
//  group/preview detectors):
//   • pkg is runtime-detected (org.telegram.messenger / .web / thunderdog.challegram),
//     NEVER hard-coded — the same reason detectTelegramPkg exists for sends.
//   • ONE-TO-ONE chat: android.title = sender display name, android.text = message
//     body. Multiple unread from the same peer collapse into a MessagingStyle
//     notification whose lines land in android.text.lines / android.messages
//     ("Alice: hi", "Alice: are you there") — we take the LAST line as newest.
//   • GROUP chat: android.title = GROUP name, android.text (or each messages line)
//     is prefixed with the sender, e.g. "Alice: hello everyone". Telegram also sets
//     android.subText / android.conversationTitle to the group name. We split the
//     "Sender: body" prefix so `from` is the actual sender and tag the group name.
//   • PREVIEW-OFF ("In-app notifications → Message preview" disabled, or lock-screen
//     hidden): the body is replaced by a generic "You have a new message" /
//     "%d new messages" / TR "Yeni mesajınız var" / "%d yeni mesaj". There is no real
//     text to capture, so we surface a sentinel body (see PREVIEW_OFF_RE) rather than
//     pushing the placeholder as if it were the message.
//   • SERVICE/CALL/summary notices (ongoing "Telegram is running"/"Connecting…",
//     incoming-call, "N new messages from M chats" summary) carry no real 1 message
//     body → skipped, mirroring parseWaNotifications' summary/service filters.
const tgSeen = new Map();          // serial -> Set of recent message-key hashes
const TG_SEEN_MAX = 400;
const tgScrapeState = new Map();   // serial -> { sig } for the foreground bubble-scrape
// Telegram's preview-off / aggregate placeholder bodies (EN + TR). When the body is
// only one of these there is no real message text to forward.
const TG_PREVIEW_OFF_RE = /^(you have a new message|new message|\d+\s+new messages?|\d+\s+messages?|message|yeni mesaj(ınız)? var|\d+\s+yeni mesaj|mesaj)$/i;
// Telegram's own non-conversational notices (service, call, sync). Never a message body.
const TG_SERVICE_RE = /^(telegram( is running| web)?|connecting|updating|checking for messages|incoming call|calling|missed call|arıyor|gelen arama|cevapsız arama|bağlanıyor|güncelleniyor)\b/i;

function tgSeenSet(serial) {
  let s = tgSeen.get(serial);
  if (!s) { s = new Set(); tgSeen.set(serial, s); }
  return s;
}

// Pull a MessagingStyle notification's per-message lines. Telegram publishes them as
// `android.text.lines` (array) and/or `android.messages` (parcelled bundles that
// dumpsys prints as `Bundle[{... text=..., ...}]`). dumpsys renders string-array
// extras as `android.text.lines=String[N] ("a", "b", ...)` and messages as a
// bracketed bundle list. We extract each line's visible text, newest last. Returns
// [] when neither is present (caller falls back to android.text / bigText).
function pickNotifLines(block) {
  const lines = [];
  // Form A: android.text.lines=String[2] ("Alice: hi", "Alice: are you there?")
  const arr = /android\.text\.lines=[^\n(]*\(([^\n]*)\)/.exec(block);
  if (arr && arr[1]) {
    // Split top-level comma-separated quoted items; tolerate commas inside a line
    // (they're inside quotes) by matching quoted runs first, else naive split.
    const quoted = arr[1].match(/"((?:[^"\\]|\\.)*)"/g);
    if (quoted && quoted.length) {
      for (const q of quoted) lines.push(q.slice(1, -1).replace(/\\"/g, '"'));
    } else {
      for (const part of arr[1].split(/,\s*/)) { const t = part.trim().replace(/^"|"$/g, ''); if (t) lines.push(t); }
    }
  }
  // Form B: android.messages=[Bundle[{ ... text=Hi there ... }], Bundle[{ ... }]]
  // Each MessagingStyle Message bundle carries a `text=` field; grab them in order.
  if (!lines.length) {
    const msgs = /android\.messages=\[([\s\S]*?)\]\s*(?:\n|android\.)/.exec(block);
    if (msgs && msgs[1]) {
      const re = /\btext=([^,}\n]+)/g;
      let m;
      while ((m = re.exec(msgs[1])) !== null) { const t = m[1].trim(); if (t && t !== 'null') lines.push(t); }
    }
  }
  return lines.map((l) => l.trim()).filter(Boolean);
}

// Parse `dumpsys notification --noredact` for Telegram message notifications, for the
// runtime-detected package `tgPkg` (one of org.telegram.messenger[.web] /
// org.thunderdog.challegram). Returns [{ from, text, whenMs, group? }] shaped like
// parseWaNotifications so the caller can merge/dedup/push both channels uniformly.
function parseTgNotifications(dump, tgPkg) {
  const out = [];
  if (!tgPkg) return out;
  // Match the exact installed package (escape dots) so we don't latch a different app.
  const pkgRe = new RegExp('pkg=' + tgPkg.replace(/\./g, '\\.') + '\\b');
  const blocks = String(dump).split(/NotificationRecord\(/).slice(1);
  for (const b of blocks) {
    const head = b.slice(0, 300);
    if (!pkgRe.test(head)) continue;
    const title = pickExtra(b, 'android.title');
    if (!title) continue;
    // Group name (if this is a group chat): Telegram sets conversationTitle/subText to
    // the group; a one-to-one chat leaves them empty. Used both to tag the thread and
    // to know we must strip the "Sender: " prefix from each body line.
    const groupName = (pickExtra(b, 'android.conversationTitle') || pickExtra(b, 'android.subText') || '').trim();
    const isGroup = Boolean(groupName) && groupName.toLowerCase() !== title.trim().toLowerCase();

    // Prefer the per-message MessagingStyle lines (multi-line unread); newest is last.
    // Fall back to bigText, then the single-line text.
    const lines = pickNotifLines(b);
    const bodies = lines.length
      ? lines
      : [pickExtra(b, 'android.bigText') || pickExtra(b, 'android.text')].filter(Boolean);
    if (!bodies.length) continue;

    const whenMs = Number(/when=(\d+)/.exec(b)?.[1] || 0);
    for (const raw of bodies) {
      let text = String(raw).trim();
      if (!text) continue;
      // Service / call / sync notices are not messages.
      if (TG_SERVICE_RE.test(text)) continue;
      // Summary aggregate lines ("N new messages from M chats").
      if (/new messages? from .* chats?$/i.test(text) || /\d+\s+sohbette(n)? .* mesaj/i.test(text)) continue;

      let from = title.trim();
      let group;
      if (isGroup) {
        group = groupName;
        // Group lines are "Sender: body" — split once so `from` is the real sender and
        // the group name is carried separately. If there's no "Name: " prefix (rare —
        // e.g. a service message in the group), keep the group as the sender.
        const mm = /^([^:]{1,64}):\s([\s\S]+)$/.exec(text);
        if (mm) { from = mm[1].trim(); text = mm[2].trim(); }
        else { from = groupName; }
      }
      // Preview-off / placeholder → surface a sentinel so the operator sees "a message
      // arrived" without us forwarding Telegram's generic string as if it were content.
      if (TG_PREVIEW_OFF_RE.test(text)) text = '[önizleme kapalı — yeni mesaj]';
      out.push({ from, text, whenMs, ...(group ? { group } : {}) });
    }
  }
  return out;
}

// Scrape INCOMING message bubbles from an OPEN Telegram Conversation (foreground —
// where Telegram suppresses the notification, same blind spot WhatsApp has). Telegram
// is fully custom-drawn: chat rows are ChatMessageCell with NO resource-id and NO
// per-bubble text node in the a11y tree — the bubble text surfaces as the cell's
// content-desc instead (ChatMessageCell.getAccessibilityNodeInfo sets contentDescription
// to the message text; incoming cells sit LEFT-anchored, outgoing RIGHT). So unlike WA
// (which reads message_text NODES) we read content-desc off the left-half cells.
// Returns [{from, text, whenMs}] shaped like the notification path for uniform merging.
async function scrapeTelegramIncoming(serial) {
  let nodes = [];
  try { nodes = parseUiNodes(await uiDumpXml(serial)); } catch { return []; }
  if (!nodes.length) return [];
  // Screen width to split incoming (left) from outgoing (right).
  let sw = 720;
  try {
    const wm = await adb(serial, ['shell', 'wm', 'size']);
    const ov = /Override size:\s*(\d+)x/.exec(wm);
    const ph = /Physical size:\s*(\d+)x/.exec(wm);
    const m = ov || ph; if (m) sw = Number(m[1]) || sw;
  } catch { /* keep default */ }
  // Peer/group name from the action bar. Telegram's toolbar title has no stable id;
  // it's the top-most TextView above the message area with a non-empty text.
  const topNodes = nodes.filter((n) => n.text && n.cy < (nodes.reduce((mx, x) => Math.max(mx, x.cy), 0)) * 0.18);
  const peer = (topNodes.sort((a, b) => a.cy - b.cy)[0]?.text || 'Telegram').trim();
  // Incoming bubbles: left-anchored cells whose readable text lives in content-desc
  // (custom-draw) or, on some builds, a plain text node inside the cell. We take
  // content-desc when present (the whole bubble text), else text. Skip the toolbar,
  // the compose box, and outgoing (right-half) cells.
  const incoming = [];
  for (const n of nodes) {
    const body = (n.desc || n.text || '').trim();
    if (!body) continue;
    if (/(^|\.)EditText$/i.test(n.cls || '')) continue;        // compose box
    if (n.cy < sw * 0) continue;                               // (noop guard placeholder)
    if (typeof n.cx === 'number' && n.cx > sw * 0.5) continue; // outgoing → skip
    // Only cell-sized nodes (a bubble spans a meaningful width) — filters out tiny
    // status icons/timestamps that also sit on the left.
    const w = (n.bounds?.[2] ?? 0) - (n.bounds?.[0] ?? 0);
    if (w < sw * 0.12) continue;
    // Cell content-desc / text that is just a timestamp or read-state is not a message.
    if (/^\d{1,2}:\d{2}(\s?[AP]M)?$/i.test(body)) continue;
    incoming.push({ text: body, cy: typeof n.cy === 'number' ? n.cy : 0 });
  }
  if (!incoming.length) return [];
  incoming.sort((a, b) => a.cy - b.cy); // top→bottom = oldest→newest
  const texts = incoming.map((b) => b.text).filter(Boolean);
  if (!texts.length) return [];
  const newest = texts[texts.length - 1];
  const prev = tgScrapeState.get(serial);
  // Twin of scrapeIncomingBubbles' fix: change-detection sig = newest+count (so a
  // burst whose last bubble repeats the previous text still registers), anchor =
  // last-emitted text (for the slice). Keying on `newest` alone dropped whole bursts.
  const sig = `${newest}${texts.length}`;
  if (prev && prev.sig === sig) return []; // nothing changed since last tick

  let toEmit;
  if (prev && prev.anchor) {
    const idx = texts.lastIndexOf(prev.anchor);
    toEmit = idx >= 0 ? texts.slice(idx + 1) : [newest];
    if (!toEmit.length) toEmit = [newest];
  } else {
    toEmit = [newest];
  }
  tgScrapeState.set(serial, { sig, anchor: newest });
  return toEmit.map((text) => ({ from: peer, text, whenMs: 0 }));
}

// Scrape INCOMING message bubbles from an open WhatsApp Conversation. Incoming
// bubbles sit on the LEFT half of the screen (outgoing are on the right), so we
// use each message_text node's horizontal center to keep only received ones.
// Returns [{from, text, whenMs}] shaped like parseWaNotifications for merging.
// Returns the parsed inbound messages AND exposes the (nodes, sw) it computed on
// `_ctx`, so pollWhatsappInbox can hand them to pushOutgoingReceipt instead of paying
// for a SECOND uiautomator dump + `wm size` round-trip on the same open chat. On this
// GPU-less Waydroid host that duplicate capture was a leading contention source in
// multi-device parallel runs — halving it directly helps parallel stability.
async function scrapeIncomingBubbles(serial, _ctx) {
  // parseUiNodes is SYNCHRONOUS (returns an array, not a Promise) — the old
  // `...).catch()` threw a TypeError and killed the whole poll. Guard the (async)
  // uiDumpXml + (sync) parse together and bail cleanly on any failure.
  let nodes = [];
  try { nodes = parseUiNodes(await uiDumpXml(serial)); } catch { return []; }
  if (!nodes.length) return [];
  // Screen width to split left/right — use the cached wmSize (no extra adb round-trip).
  let sw = 720;
  try { const wm = await wmSize(serial); if (wm && wm.sw) sw = wm.sw; } catch { /* keep default */ }
  if (_ctx) { _ctx.nodes = nodes; _ctx.sw = sw; }
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
  // Change-detection signature: newest text + visible count. Keying on `newest`
  // ALONE was wrong — if a burst's LAST bubble happened to equal the previously
  // emitted text (e.g. two "ok" replies bracketing a new "gel"), the whole batch
  // (including the new middle bubbles) got skipped and lost forever. Including the
  // count makes a burst that adds bubbles register as a change even when the newest
  // text repeats; the anchor-slice below then emits only the genuinely-new ones and
  // the (from|text) seen-set dedups any overlap.
  const sig = `${newest}${texts.length}`;
  if (prev && prev.sig === sig) return [];

  // `anchor` = the last text we emitted (tracked separately from the change-detection
  // sig, which now also carries the count). Find it in the current list and emit
  // everything after it; if it scrolled off, fall back to the newest only.
  let toEmit;
  if (prev && prev.anchor) {
    const idx = texts.lastIndexOf(prev.anchor);
    toEmit = idx >= 0 ? texts.slice(idx + 1) : [newest];
    if (!toEmit.length) toEmit = [newest]; // anchor was the visible newest
  } else {
    toEmit = [newest]; // first sighting on this serial → only the newest
  }
  waScrapeState.set(serial, { sig, anchor: newest });
  // whenMs stays 0 → the push uses Date.now(). Dedup by from|text in the seen-set.
  return toEmit.map((text) => ({ from: peer, text, whenMs: 0 }));
}

// PASSIVE delivery-receipt read. When a WhatsApp Conversation is already open in
// the foreground (e.g. the operator is mid-reply, or an inbound scrape just ran),
// the SAME ui dump also carries our OUTGOING bubbles' tick state in their status
// marker's content-desc: "Sent" (✓), "Delivered" (✓✓), "Read" (blue). We read
// the newest outgoing bubble's tick and report DELIVERED/READ to the control
// plane. This is DELIBERATELY passive — it NEVER opens a chat or taps anything,
// so Fix9 (HOME-after-send, ban protection) is untouched. Receipts only surface
// for chats that happen to be open; that's the accepted trade-off for zero
// ban-risk. Reuses the nodes already parsed by scrapeIncomingBubbles' caller.
// Returns { peer, status } | null. status ∈ { 'DELIVERED', 'READ' }.
function readOutgoingReceipt(nodes, sw) {
  const peer = (nodes.find((n) => n.resId.includes('conversation_contact_name'))?.text
    || nodes.find((n) => n.resId.includes('conversation_contact'))?.text
    || '').trim();
  if (!peer) return null;
  // Status markers carry a content-desc describing tick state. WhatsApp uses the
  // resource-id "status" (ImageView) next to each outgoing bubble; the human-
  // readable state lives in content-desc and is locale-dependent, so we match the
  // English strings AND common glyph fallbacks. Only OUTGOING markers matter, so
  // keep right-half nodes (cx > 50% of screen width).
  const markers = [];
  for (const n of nodes) {
    const d = (n.desc || '').toLowerCase();
    if (!d) continue;
    // Locale-inclusive: WhatsApp's tick content-desc is EN ("Read"/"Delivered") or
    // TR ("Okundu"/"İletildi"/"Teslim edildi"). Without the TR strings, receipts were
    // NEVER reported on Turkish-locale devices (silent miss). Diacritic-tolerant.
    const isRead = /\bread\b|okundu/.test(d);
    const isDelivered = /\bdelivered\b|iletildi|teslim/.test(d);
    if (!isRead && !isDelivered) continue;
    if (typeof n.cx === 'number' && n.cx < sw * 0.5) continue; // incoming side → not our receipt
    markers.push({ status: isRead ? 'READ' : 'DELIVERED', cy: typeof n.cy === 'number' ? n.cy : 0 });
  }
  if (!markers.length) return null;
  // Newest bubble = largest cy (bottom-most). Its marker is the freshest receipt.
  markers.sort((a, b) => a.cy - b.cy);
  return { peer, status: markers[markers.length - 1].status };
}

// Read the open chat's newest outgoing receipt and POST it to the control plane,
// deduped so a SENT→DELIVERED→READ progression fires at most one webhook per step.
// Monotonic ordering (DELIVERED < READ) is enforced server-side too, so a stale
// re-read never regresses; here we just avoid re-POSTing an unchanged status.
async function pushOutgoingReceipt(serial, preNodes, preSw) {
  // Reuse the nodes/sw the inbound scrape just computed on the same open chat when
  // provided (HIZ-1: avoids a duplicate dump + wm-size). Fall back to our own capture
  // only when called standalone.
  let nodes = preNodes;
  let sw = preSw;
  if (!nodes) {
    try { nodes = parseUiNodes(await uiDumpXml(serial)); } catch { return; }
    if (!nodes.length) return;
    try { const wm = await wmSize(serial); if (wm && wm.sw) sw = wm.sw; } catch { /* keep default */ }
  }
  if (!nodes || !nodes.length) return;
  if (!sw) sw = 720;
  const receipt = readOutgoingReceipt(nodes, sw);
  if (!receipt) return;
  // Report against the number we last SENT to on this serial (API matches receipts
  // by number). Only when a send happened here — otherwise we can't reliably tie the
  // scraped tick to a phone number, so skip rather than push a name the API won't match.
  const sent = waLastSentPeer.get(serial);
  if (!sent) return;
  const to = sent.to;
  // ★ATTRIBUTION GUARD: the open chat may NOT be the one we sent to — the operator
  // could have navigated to a different conversation, whose READ tick would then be
  // wrongly POSTed against `to`. Only attribute the tick when the open chat's title
  // plausibly matches the number we sent to: either the title's digits contain the
  // sent number (title shows a raw number) OR the send was very recent AND no other
  // chat has been seen since (best-effort for saved-contact titles that show a name).
  const peerDigits = String(receipt.peer || '').replace(/[^\d]/g, '');
  const titleMatches = peerDigits.length >= 7 && (to.endsWith(peerDigits) || peerDigits.endsWith(to.slice(-9)));
  const recentSameChat = (Date.now() - (sent.at || 0) < 5 * 60 * 1000) && sent.peerName && sent.peerName === receipt.peer;
  if (!titleMatches && !recentSameChat) return; // can't safely tie this tick to `to`
  const key = `${to}|${receipt.status}`;
  if (waReceiptState.get(serial) === key) return; // unchanged since last tick → skip
  try {
    await api('/agent/whatsapp/receipt', {
      method: 'POST',
      body: JSON.stringify({ serial, to, status: receipt.status, ts: Date.now() }),
    });
    waReceiptState.set(serial, key);
    log(`wa receipt ${serial}: ${to} -> ${receipt.status}`);
  } catch (err) {
    log('wa receipt push failed:', err.message);
  }
}

// ── WhatsApp GELEN MEDYA yakalama (foto/video/belge + TEK GOSTERIMLIK) ─────────
//
// ★NEDEN: gelen medya bildirimde sadece "📷 Photo" olarak gorunur; dosyanin KENDISI
//   bildirimden alinamaz. Dosya ancak WhatsApp onu diske indirdiginde olusur ve
//   msgstore.message_media.file_path'e yazilir.
//
// ★ONKOSUL (15 Agu canli kanit): WhatsApp rehberde OLMAYAN numaradan gelen medyayi
//   INDIRMEZ (log: isAutoDownloadEligible/false reason=notReliableContact) ve okundu
//   bilgisini kapatir. Bu yuzden medya beklenirken bilinmeyen gonderen once REHBERE
//   eklenir (ensureContacts). O andan SONRAKI medyasi otomatik iner.
//
// ★TEK GOSTERIMLIK farki (15 Agu): message_type=42, dosyasi genel medya klasorunde
//   DEGIL /data/user/0/com.whatsapp/files/ViewOnce/ altinda (MUTLAK yol), ve
//   GORULDUKTEN SONRA SILINIR -> first_viewed_timestamp=0 iken yakalanmali.
//   Ayrimi message_view_once_media JOIN'i ile yapiyoruz.
//
// ★YUK: dosya sistemi TARANMAZ. Tek SQL sorgusu (yeni _id > pozisyon). Agent'in
//   ZATEN yaptigi inbound tur'una eklenir -> yeni adb baglantisi / dongu YOK.
//   Rehber tamamlama SADECE yeni medya gorulunce calisir (bos turda deymez).
//   FLEET_WA_MEDIA=0 ile tamamen kapatilabilir.
const WA_MEDIA_ENABLED = process.env.FLEET_WA_MEDIA !== '0';
const WA_MEDIA_POS = new Map();          // serial -> son islenen message _id
const WA_INBOX_POS = new Map();          // serial -> son islenen (from_me=0) message._id (msgstore-tabanli inbound)
const WA_CONTACTS_AT = new Map();        // serial -> son rehber-tamamlama zamani (throttle)
const WA_MEDIA_MAXBYTES = Number(process.env.FLEET_WA_MEDIA_MAXBYTES || 45 * 1024 * 1024);
// Goreceli file_path'ler "Media/WhatsApp Images/..." formatinda -> kok "...WhatsApp/".
// (WA_MEDIA_ROOT yukarida ".../WhatsApp/Media" olarak tanimli; bir ust dizini alalim.)
const WA_MEDIA_APPROOT = WA_MEDIA_ROOT.replace(/\/Media$/, '');

// Bilinmeyen gonderenleri cihaz rehberine ekle (medyanin inmesi icin onkosul).
// content-provider yazimi WRITE_CONTACTS ister; `su -c content` uid=1000 olarak
// SecurityException verir -> izni com.android.shell'e verip su OLMADAN yaziyoruz.
async function ensureContacts(serial, selfNumber) {
  const rows = await waSql(serial, 'msgstore',
    `SELECT DISTINCT user FROM jid WHERE server='s.whatsapp.net' AND length(user) BETWEEN 10 AND 15`);
  if (!rows || !rows.length) return 0;
  await adbT(serial, ['shell', 'pm', 'grant', 'com.android.shell', 'android.permission.WRITE_CONTACTS'], 6000).catch(() => undefined);
  await adbT(serial, ['shell', 'pm', 'grant', 'com.android.shell', 'android.permission.READ_CONTACTS'], 6000).catch(() => undefined);
  // ★2026-08-15: cihazin KENDI numarasini rehbere EKLEME. Caller selfNumber
  // vermezse WhatsApp'in registration_jid prefs'inden oku (kendi E.164 numarasi).
  // Aksi halde cihaz kendi numarasini "kisi" olarak ekliyordu (kozmetik kirlilik).
  let self = String(selfNumber || '').replace(/[^\d]/g, '');
  if (!self) {
    const reg = await adbSu(serial,
      `grep -ohE 'registration_jid">[0-9]+' /data/data/com.whatsapp/shared_prefs/*.xml 2>/dev/null | head -1`).catch(() => '');
    self = (/(\d{10,15})/.exec(String(reg || '')) || [])[1] || '';
  }
  let added = 0;
  for (const n0 of rows) {
    const n = String(n0).replace(/[^\d]/g, '');
    if (!n || n === self) continue;
    const has = await adbT(serial, ['shell',
      `content query --uri content://com.android.contacts/data --projection data1 --where "data1='+${n}'" 2>/dev/null`], 6000).catch(() => '');
    if (String(has).includes('data1=')) continue;
    // ★★★2026-08-15 IKI GERCEK HATA DUZELTILDI (canli kanit: 113.230 rehberinde
    // "display_name=+905327329497, data1=+905349636768" — ISIM BASKA KISININ):
    //  (1) YANLIS EŞLEŞME: raw_contact id'si `--sort '_id DESC'` ile TAHMIN ediliyordu;
    //      ardisik eklemelerde/baska bir yazar araya girince YANLIS kaydin uzerine
    //      isim+telefon yaziliyordu -> kisiler birbirine karisiyordu. Artik HER kisi
    //      icin account_name'e numarayi gomup (fleet:<numara>) o kaydin id'sini
    //      SORGUYLA kesin buluyoruz (tahmin YOK).
    //  (2) ISIM FORMATI: isim "+<numara>" yapilmisti (kozmetik); WhatsApp numara-
    //      formatli ismi GERCEK isim saymiyor -> kisi "guvenilmez" kaliyor ve gelen
    //      medyayi OTOMATIK INDIRMIYOR. Calisan cihazda (147.235) isim "Kisi<numara>"
    //      ve medya otomatik iniyor; calismayanda isim bos/numara -> inmiyor.
    const acct = `fleet${n}`;
    await adbT(serial, ['shell',
      `content insert --uri content://com.android.contacts/raw_contacts --bind account_name:s:${acct} --bind account_type:s:fleet`], 6000).catch(() => undefined);
    const rq = await adbT(serial, ['shell',
      `content query --uri content://com.android.contacts/raw_contacts --projection _id --where "account_name='${acct}'" --sort '_id DESC'`], 6000).catch(() => '');
    const rid = (/(_id=)(\d+)/.exec(String(rq)) || [])[2];
    if (!rid) continue;
    await adbT(serial, ['shell',
      `content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:${rid} --bind mimetype:s:vnd.android.cursor.item/name --bind data1:s:Kisi${n}`], 6000).catch(() => undefined);
    await adbT(serial, ['shell',
      `content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:${rid} --bind mimetype:s:vnd.android.cursor.item/phone_v2 --bind data1:s:+${n} --bind data2:i:2`], 6000).catch(() => undefined);
    added++;
  }
  return added;
}

async function pollWhatsappMedia(serial) {
  if (!WA_MEDIA_ENABLED) return;
  // İlk turda pozisyonu MEVCUT en son MESAJA kur (gecmis medyayi TG'ye bosaltma,
  // ama bundan SONRA gelen ILK medya da yakalansin). Referans: son message._id
  // (medya degil) — boylece agent restart'i sonrasi gelen ilk foto atlanmaz.
  if (!WA_MEDIA_POS.has(serial)) {
    const seed = await waSql(serial, 'msgstore', `SELECT coalesce(max(_id),0) FROM message`);
    WA_MEDIA_POS.set(serial, seed && seed[0] ? Number(seed[0]) || 0 : 0);
    return; // ilk tur sadece seed
  }
  const pos = WA_MEDIA_POS.get(serial) || 0;

  // ★★★2026-08-15 REHBER TETIKLEME — KISIR DONGU DUZELTMESI.
  // WhatsApp rehberde OLMAYAN gonderenin medyasini INDIRMEZ (notReliableContact).
  // Eski kod rehberi yalnizca INMIS medya gorunce tamamliyordu; ama ilk medya
  // ZATEN inmiyor (rehber bos) -> file_path bos -> rehber hic eklenmez -> kisir
  // dongu. Cozum: INMEMIS gelen medya mesaji varsa (belirti: gonderen rehberde
  // degil) rehberi tamamla ki SONRAKI medyasi otomatik insin. Cihaz basina 3 dk
  // throttle (content-query'ler pahali; bos turda hic degmez).
  const pend = await waSql(serial, 'msgstore',
    `SELECT count(*) FROM message m JOIN message_media mm ON mm.message_row_id=m._id ` +
    `WHERE m.from_me=0 AND (mm.file_path IS NULL OR mm.file_path='') AND m._id>${pos}`);
  if (pend && Number(pend[0]) > 0) {
    const last = WA_CONTACTS_AT.get(serial) || 0;
    if (Date.now() - last > 180000) {
      WA_CONTACTS_AT.set(serial, Date.now());
      const added = await ensureContacts(serial).catch(() => 0);
      if (added) log(`wa media: ${serial} rehbere ${added} kisi eklendi (medya insin diye)`);
    }
  }

  // GONDERIM: inmis (file_path dolu) medyalari yolla. tek-gosterimlik bayragiyla.
  // ★GONDEREN: chat jid'i LID olabilir (174256...@lid = ic kimlik, gercek numara
  // DEGIL) -> jid_map ile gercek s.whatsapp.net numarasina cevir.
  const rows = await waSql(serial, 'msgstore',
    `SELECT m._id||'|'||m.message_type||'|'||mm.file_path||'|'||coalesce(rj.user, j.user, '?')||'|'||` +
    `CASE WHEN v.message_row_id IS NULL THEN '0' ELSE '1' END ` +
    `FROM message m JOIN message_media mm ON mm.message_row_id=m._id ` +
    `LEFT JOIN chat c ON c._id=m.chat_row_id LEFT JOIN jid j ON j._id=c.jid_row_id ` +
    `LEFT JOIN jid_map jm ON jm.lid_row_id=c.jid_row_id LEFT JOIN jid rj ON rj._id=jm.jid_row_id ` +
    `LEFT JOIN message_view_once_media v ON v.message_row_id=m._id ` +
    `WHERE m.from_me=0 AND m._id>${pos} AND mm.file_path IS NOT NULL AND mm.file_path<>'' ORDER BY m._id`);
  if (!rows || !rows.length) return;

  let maxId = pos;
  for (const line of rows) {
    const [idS, tip, yol, gonderen, tekg] = String(line).split('|');
    const id = Number(idS) || 0;
    if (id > maxId) maxId = id;
    if (!yol) continue;
    // ★ESKI/YENI CIHAZ farki: file_path bazen MUTLAK (ViewOnce, /data/user/0/...),
    // bazen GORECELI ("Media/WhatsApp Images/..."). Goreceli ise medya koku
    // surume/Android'e gore degisir (scoped-storage oncesi /sdcard/WhatsApp,
    // sonrasi .../Android/media/com.whatsapp/WhatsApp). Bu yuzden birden fazla kok
    // DENENIR — ilk VAR olan kullanilir. Birkac ucuz `-f` testi (tarama DEGIL).
    const yolQ = yol.replace(/'/g, "'\\''");
    const b64 = await adbT(serial, ['exec-out', 'su', '-c',
      `rel='${yolQ}'; f=''; ` +
      `case "$rel" in /*) f="$rel";; esac; ` +
      `if [ -z "$f" ]; then for r in ` +
      `/data/media/0/Android/media/com.whatsapp/WhatsApp ` +
      `/data/media/0/WhatsApp ` +
      `/sdcard/Android/media/com.whatsapp/WhatsApp ` +
      `/sdcard/WhatsApp ` +
      `/storage/emulated/0/WhatsApp; do ` +
      `[ -f "$r/$rel" ] && { f="$r/$rel"; break; }; done; fi; ` +
      `[ -z "$f" ] && exit 0; ` +
      `sz=$(stat -c %s "$f" 2>/dev/null||echo 0); ` +
      `if [ "$sz" -gt 0 ] && [ "$sz" -le ${WA_MEDIA_MAXBYTES} ]; then base64 "$f"; fi`], 60000).catch(() => '');
    const buf = b64 ? Buffer.from(String(b64).replace(/\s+/g, ''), 'base64') : Buffer.alloc(0);
    if (!buf.length) { log(`wa media #${id}: cekilemedi/buyuk (${yol})`); continue; }
    try {
      await api('/agent/whatsapp/media', {
        method: 'POST',
        body: JSON.stringify({
          serial, msgId: id, mediaType: Number(tip), from: gonderen,
          viewOnce: tekg === '1', fileName: yol.split('/').pop(),
          dataB64: buf.toString('base64')
        }),
      });
      log(`wa media #${id} pushed (${buf.length}b${tekg === '1' ? ' view-once' : ''})`);
    } catch (err) {
      log('wa media push failed:', err.message);
      // pozisyonu ilerletme — sonraki tur tekrar dener
      WA_MEDIA_POS.set(serial, id - 1 > pos ? id - 1 : pos);
      return;
    }
  }
  WA_MEDIA_POS.set(serial, maxId);
}

// ★★★2026-08-15 MSGSTORE-TABANLI (root) INBOUND — eksiksiz + hizli + taş gibi.
// ESKI yontem notification (dumpsys) + acik-chat scrape idi. İKİ zaafi vardi:
//   1) EKSIK: WhatsApp AYNI sohbetin ARDISIK mesajlarini TEK bildirimde toplar
//      -> ilk mesaj ("Test") bastirilir, kacar. (msgstore'da VAR, panele DUSMEZ.)
//   2) YAVAS: dumpsys+dump her cihazda yuzlerce ms; 155 cihaz sirayla -> tur 2-5 dk
//      -> mesaj 2 dk gec duser.
// YENI: msgstore.db'den from_me=0 yeni mesajlari DOGRUDAN oku (medya ile ayni yontem).
// Bastirma YOK (DB'de her mesaj ayri satir), tek hafif SQL, pozisyon takibi ile kayipsiz.
// Giden mesajin okundu-bilgisi (receipt) acik-chat'te AYNEN korunur.
async function pollWhatsappInbox(serial) {
  await pollInboxFromStore(serial);
  // Acik chat'te: giden mesajin okundu-bilgisi (receipt) — mevcut mantik korunur.
  try {
    const top = await adb(serial, ['shell', 'dumpsys', 'activity', 'activities']);
    if (/com\.whatsapp\/\S*Conversation/.test(top)) {
      const ctx = {};
      await scrapeIncomingBubbles(serial, ctx).catch(() => undefined); // ctx.nodes doldur (yalnizca receipt icin)
      await pushOutgoingReceipt(serial, ctx.nodes, ctx.sw).catch(() => undefined);
    }
  } catch { /* best-effort */ }
}

// msgstore.db'den from_me=0 YENI metin mesajlarini okuyup panele/TG'ye yollar.
// Pozisyon (WA_INBOX_POS) son islenen _id'de; ilk tur SEED (gecmisi bosaltmaz).
async function pollInboxFromStore(serial) {
  // İlk tur: pozisyonu MEVCUT en son mesaja kur -> gecmis mesajlar API'ye bosaltilmaz,
  // ama bundan SONRAKI ilk mesaj yakalanir. (root/db yoksa null -> sessiz gec.)
  if (!WA_INBOX_POS.has(serial)) {
    const seed = await waSql(serial, 'msgstore', `SELECT coalesce(max(_id),0) FROM message`);
    if (seed === null) return;
    WA_INBOX_POS.set(serial, seed[0] ? Number(seed[0]) || 0 : 0);
    return;
  }
  const pos = WA_INBOX_POS.get(serial) || 0;
  // from_me=0 yeni metin mesajlari. Gonderen: chat jid LID ise jid_map ile gercek numara
  // (medya sorgusuyla ayni JOIN). Newline'lari bosluga cevir (waSql satir-bazli parse eder).
  // Alan sirasi: id|from|ts|text -> text SON; icinde '|' olsa da ilk 3 '|' ile guvenli ayrilir.
  const rows = await waSql(serial, 'msgstore',
    `SELECT m._id||'|'||coalesce(rj.user,j.user,'')||'|'||m.timestamp||'|'||` +
    `replace(replace(m.text_data,char(10),' '),char(13),' ') ` +
    `FROM message m ` +
    `LEFT JOIN chat c ON c._id=m.chat_row_id LEFT JOIN jid j ON j._id=c.jid_row_id ` +
    `LEFT JOIN jid_map jm ON jm.lid_row_id=c.jid_row_id LEFT JOIN jid rj ON rj._id=jm.jid_row_id ` +
    `WHERE m.from_me=0 AND m._id>${pos} AND m.text_data IS NOT NULL AND m.text_data<>'' ORDER BY m._id`);
  if (rows === null) return;   // root/db gecici erisilemez -> pozisyonu koru, sonraki tur dener
  if (rows.length === 0) return;
  let maxId = pos;
  for (const line of rows) {
    const a = line.indexOf('|');
    const b = line.indexOf('|', a + 1);
    const d = line.indexOf('|', b + 1);
    if (a < 0 || b < 0 || d < 0) continue;
    const id = Number(line.slice(0, a)) || 0;
    const from = line.slice(a + 1, b);
    const ts = Number(line.slice(b + 1, d)) || Date.now();
    const text = line.slice(d + 1);
    if (id > maxId) maxId = id;
    if (!text) continue;
    // ★2026-08-15 WHATSAPP SISTEM MESAJLARINI ELE. msgstore'a WhatsApp'in KENDI
    // bilgi kartlari da yaziliyor (gonderen jid.user='0' — gercek kisi DEGIL), orn.
    // "Sync your contacts to instantly find your favorite people...". Bunlar operator
    // icin gurultu (canli: 3 cihazdan ayni anda TG'ye dustu) ve cevaplanacak bir mesaj
    // degil. Not: cihazlar KILITLENMIYOR — ekranda modal YOK, izin zaten granted.
    // Gercek numaralar en az 10 haneli; '0'/bos gonderen = sistem.
    if (!/^\d{10,15}$/.test(from)) continue;
    try {
      // Push by ADB serial; control plane maps it to the workspace-scoped deviceId.
      await api('/agent/whatsapp/inbound', {
        method: 'POST',
        body: JSON.stringify({ serial, from, text, ts }),
      });
      log(`wa inbound ${serial}: ${from} -> ${text.slice(0, 40)}`);
    } catch (err) {
      log('wa inbound push failed:', err.message);
      // Pozisyonu bu mesajin ONUNE al -> sonraki tur buradan devam (kayip yok, kopya yok).
      WA_INBOX_POS.set(serial, id - 1 > pos ? id - 1 : pos);
      return;
    }
  }
  WA_INBOX_POS.set(serial, maxId);
}

// Poll every reachable device for new WhatsApp notifications. Devices without
// root / WhatsApp simply return nothing (adbSu → '' on failure).
// ★2026-07-23 (P-1): RE-ENTRANCY GUARD. This tick scans every idle device SERIALLY
// (dumpsys per device — hundreds of ms each on a busy host); with 25 devices it can't
// finish in WA_INBOX_MS (3s), so the interval would fire again and pile OVERLAPPING ADB
// storms on top of each other — a leading driver of load 100. The flag makes a tick skip
// if the previous one is still running; it resumes cleanly on the next interval.
let _inboxRunning = false;
async function whatsappInboxTick() {
  if (!WA_INBOX_ENABLED) return;
  if (_inboxRunning) return; // previous tick still draining — skip this fire
  _inboxRunning = true;
  try {
  // Skip the inbox poll ONLY for devices that currently have a job running. A job's
  // WhatsApp RPA (uiautomator dump / screencap / taps) and the inbox poll's own
  // dumpsys/screencap on the SAME device race each other on this Waydroid host — that
  // contention is a leading cause of the "job hangs / dump comes back blank"
  // instability. With per-device concurrency the poll now yields PER DEVICE
  // (busyDevices.has(serial)) instead of stopping for the whole host whenever any job
  // runs — so inbound capture keeps working on idle devices during parallel sends.
    // ★2026-08-15 PARALEL BATCH — 155 cihazi SIRAYLA gezmek turu 2-5 dk yapiyordu
    // (mesaj 2 dk gec duser). Artik N'erli PARALEL: her cihaz TEK hafif msgstore SQL'i
    // (/proc TARAMASI YOK -> kilit riski yok). Tur saniyelere iner; hangi cihazdan kac
    // mesaj gelirse gelsin ayni turda toplanir. BATCH env ile ayarlanabilir (varsayilan 10).
    const serials = (await reachableSerials()).filter((s) => !busyDevices.has(s));
    // ★2026-08-15 CANLI OLCUM — BATCH 25 CIHAZ DUSURDU: 25'erli paralel msgstore
    // okumasi ADB'yi doyurdu; wd-health-watch'un 12 sn'lik `adb shell echo ok`
    // yoklamasi timeout'a dustu -> SAGLAM cihazlar "ZOMBIE" sanilip yeniden
    // baslatildi (bugun 8 kill / onceki iki gun 0; ilk kill deploy'dan ~25 dk sonra).
    // 12 hem turu kisa tutuyor (~20-25 sn) hem health-watch'i yaniltmiyor.
    const BATCH = Math.max(1, Number(process.env.FLEET_WA_INBOX_BATCH || 12));
    for (let i = 0; i < serials.length; i += BATCH) {
      await Promise.all(serials.slice(i, i + BATCH).map(async (serial) => {
        await pollWhatsappInbox(serial).catch(() => undefined);
        // medya yakalama AYNI tura: bos turda tek SQL -> olculebilir yuk yok. FLEET_WA_MEDIA=0 kapali.
        await pollWhatsappMedia(serial).catch(() => undefined);
      }));
    }
  } catch (err) {
    log('wa inbox tick failed:', err.message);
  } finally {
    _inboxRunning = false;
  }
}

// ── ★2026-08-05 OTONOM WA SAĞLIK TARAMASI ────────────────────────────────────────
// SORUN: ban/kısıt YALNIZCA bir mesaj gönderilirken fark ediliyordu (job sonucundaki
// ACCOUNT_BANNED/RESTRICTED → agent.service HEALTH_MAP). Mesaj göndermeyen bir hesap
// banlansa panel onu ACTIVE sanmaya devam ediyordu.
// CANLI KANIT (2026-08-05): DB'de ACTIVE görünen 5 hesabın 4'ü aslında bozuktu —
// 2 tanesinde BanAppealActivity ("This account can't use WhatsApp"), 2 tanesinde
// "Your account is restricted. You can't start new chats right now." Operatör bunu
// ancak gönderim denediğinde öğreniyordu; o ana kadar panel yanlış bilgi veriyordu.
//
// ÇÖZÜM: mevcut `waHealthProbe` periyodik olarak çalıştırılır ve sonucu, gönderim
// yolunun kullandığı AYNI uca raporlanır — böylece damgalama/alarm mantığı tek yerde
// kalır (yeni bir API sözleşmesi eklemiyoruz).
//
// MALİYET KONTROLÜ: probe WhatsApp'ı açıp bir sohbete giren PAHALI bir işlem; her tur
// tüm filoyu taramak host'u boğar. Bu yüzden turda EN FAZLA `WA_HEALTH_BATCH` cihaz
// taranır ve her cihaz `WA_HEALTH_MIN_GAP_MS`'den önce tekrar taranmaz (round-robin).
// Meşgul cihazlar atlanır (job ile ADB yarışı = asılı job'ın bilinen sebebi).
// ★2026-08-05 SIKLIK DÜŞÜRÜLDÜ (operatör geri bildirimi): 5 dk × 2 cihaz canlıda çok
// agresifti — kayıt akışıyla aynı anda çalışınca hem bildirim akışını doldurdu hem de
// ADB'de kayıt job'larıyla yarıştı. Ban/kısıt ACİL bir sinyal değil (saatler mertebesinde
// bir durum), o yüzden 20 dk'da bir tur + cihaz başına 3 saat ara yeterli.
const WA_HEALTH_MS = Number(process.env.FLEET_WA_HEALTH_MS || 1200000);       // 20 dk'da bir tur
const WA_HEALTH_BATCH = Number(process.env.FLEET_WA_HEALTH_BATCH || 2);       // tur başına cihaz
const WA_HEALTH_MIN_GAP_MS = Number(process.env.FLEET_WA_HEALTH_GAP_MS || 10800000); // cihaz başına 3 saat
const WA_HEALTH_ENABLED = process.env.FLEET_WA_HEALTH !== '0';
const _waHealthLastRun = new Map();   // serial -> timestamp
let _waHealthRunning = false;

async function waHealthTick() {
  if (!WA_HEALTH_ENABLED) return;
  if (_waHealthRunning) return;       // önceki tur sürüyor
  _waHealthRunning = true;
  try {
    const now = Date.now();
    const serials = await reachableSerials();
    // En uzun süredir taranmamış olanlar önce (hiç taranmamış = en eski).
    const due = serials
      .filter((s) => !busyDevices.has(s))
      .filter((s) => now - (_waHealthLastRun.get(s) || 0) >= WA_HEALTH_MIN_GAP_MS)
      .sort((a, b) => (_waHealthLastRun.get(a) || 0) - (_waHealthLastRun.get(b) || 0))
      .slice(0, WA_HEALTH_BATCH);
    for (const serial of due) {
      _waHealthLastRun.set(serial, Date.now());   // sonuç ne olursa olsun turu tüket
      try {
        const probe = await waHealthProbe(serial);
        const state = String(probe?.state || '');
        // Yalnızca KÖTÜ ve KESİN durumları bildir. 'UNKNOWN' ve `unverified` bilerek
        // atlanır: sağlıklı hesabı yanlışlıkla damgalamak, geç fark etmekten daha kötü.
        if (state !== 'BANNED' && state !== 'RESTRICTED' && state !== 'LOGGED_OUT') continue;
        if (probe?.unverified) continue;
        const statusMap = { BANNED: 'ACCOUNT_BANNED', RESTRICTED: 'ACCOUNT_RESTRICTED', LOGGED_OUT: 'ACCOUNT_LOGGED_OUT' };
        log(`wa-health: ${serial} → ${state} (otonom tarama)`);
        await api('/agent/whatsapp/health-probe', {
          method: 'POST',
          body: JSON.stringify({
            serial,
            status: statusMap[state],
            state,
            evidence: String(probe?.evidence || '').slice(0, 400)
          })
        }).catch(() => undefined);
      } catch (e) {
        log(`wa-health probe failed ${serial}: ${e.message}`);
      }
    }
  } catch (err) {
    log('wa health tick failed:', err.message);
  } finally {
    _waHealthRunning = false;
  }
}

// Scan ONE device's WhatsApp Media folder (root) for files newer than the last tick
// and report any not-yet-seen ones. Metadata only (no bytes) so it stays cheap even at
// a fast poll — the operator pulls the bytes with fetch-media. Returns the count found.
async function pollMediaCapture(serial) {
  // VERIFIED-LIVE: this cihaz's find is minimal (BusyBox/toybox) — NO -printf, NO
  // -newermt "date time", NO -exec, NO `stat -c`. Only plain `find -type f -name` (path
  // list) and `ls -la` work. So we: (1) find candidate media PATHS by extension, then
  // (2) `ls -la` them in ONE xargs call to get size + mtime. `ls -la` output columns:
  //   -rw-rw---- 1 u0 u0  <size> YYYY-MM-DD HH:MM <path>
  // Dedupe by path against waCaptureSeen; freshness is judged by not-seen-before (the
  // seen-set persists across ticks) rather than an mtime window, since -newermt is out.
  // VERIFIED-LIVE on this minimal shell: `-printf`, `-newermt "date time"`, `ls
  // --time-style`, and `tr '\n' '\0'`|`xargs -0` all FAIL — but `find … -exec ls -la {} +`
  // WORKS and prints exactly "perms links user group SIZE YYYY-MM-DD HH:MM /full/path"
  // with spaces-in-path preserved (no pipe/xargs to break "WhatsApp Images"). Use that.
  const findCmd =
    `find '${WA_MEDIA_ROOT}' -type f ` +
    `\\( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' ` +
    `-o -iname '*.mp4' -o -iname '*.opus' -o -iname '*.m4a' -o -iname '*.aac' -o -iname '*.pdf' \\) ` +
    `-exec ls -la {} + 2>/dev/null`;
  const raw = await adbSu(serial, findCmd);
  if (!raw) return 0;
  let seen = waCaptureSeen.get(serial);
  // First tick for this device: PRIME the seen-set with what's already on disk and DON'T
  // report it — otherwise every pre-existing media file would fire as "new" on startup
  // (a burst of stale notifications). Only files that appear AFTER priming are captured.
  const priming = !seen;
  if (!seen) { seen = new Set(); waCaptureSeen.set(serial, seen); }
  const fresh = [];
  // `ls -la`:  -rw-rw---- 1 u0 u0  <SIZE>  YYYY-MM-DD HH:MM  /full/path
  const lsRe = /^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(\/.+)$/;
  for (const line of String(raw).split('\n')) {
    const m = line.match(lsRe);
    if (!m) continue;
    const size = Number(m[1]) || 0;
    const mtime = Date.parse(`${m[2]}T${m[3]}:00Z`) || 0;
    const path = m[4].trim();
    if (seen.has(path)) continue;
    seen.add(path);
    // Derive folder (…/Media/<FOLDER>/…file) + a coarse kind from the extension.
    const folder = (path.match(/\/Media\/([^/]+)\//) || [])[1] || '';
    const ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
    const kind = /jpg|jpeg|png|webp/.test(ext) ? 'image' : /mp4/.test(ext) ? 'video' : /opus|m4a|aac/.test(ext) ? 'audio' : /pdf/.test(ext) ? 'document' : 'other';
    fresh.push({ path, size, mtime, folder, kind });
  }
  // Cap the seen-set memory.
  if (seen.size > WA_CAPTURE_SEEN_MAX) {
    const excess = seen.size - WA_CAPTURE_SEEN_MAX; let i = 0;
    for (const k of seen) { if (i++ >= excess) break; seen.delete(k); }
  }
  // Priming tick just records the baseline — report nothing (avoids a startup burst).
  if (priming) return 0;
  if (!fresh.length) return 0;
  for (const f of fresh) {
    try {
      await api('/agent/whatsapp/media-captured', {
        method: 'POST',
        body: JSON.stringify({ serial, path: f.path, size: f.size, kind: f.kind, folder: f.folder, ts: f.mtime || Date.now() }),
      });
      log(`wa media ${serial}: ${f.kind} ${f.folder}/${f.path.split('/').pop()} (${f.size}b)`);
    } catch (err) {
      seen.delete(f.path); // re-arm on push failure
      log('wa media push failed:', err.message);
    }
  }
  return fresh.length;
}

// Poll every idle device's Media folder for new files (opt-in via FLEET_WA_CAPTURE=1).
// ★2026-07-23 (P-1): re-entrancy guard — a filesystem scan across every device can exceed
// WA_CAPTURE_MS on a busy host; skip if the prior tick is still running (no overlap storm).
let _captureRunning = false;
async function mediaCaptureTick() {
  if (!WA_CAPTURE_ENABLED) return;
  if (_captureRunning) return;
  _captureRunning = true;
  try {
    const serials = await reachableSerials();
    for (const serial of serials) {
      if (busyDevices.has(serial)) continue; // a job owns this device — skip, scan the rest
      await pollMediaCapture(serial).catch(() => undefined);
    }
  } catch (err) {
    log('wa media capture tick failed:', err.message);
  } finally {
    _captureRunning = false;
  }
}

// Host-level disk + RAM so the dashboard can show "how many more devices fit"
// (each Waydroid instance ≈ 8GB disk + 1.5GB RAM). Best-effort; returns {} on any
// failure so the heartbeat never breaks.
async function hostCapacityMetrics() {
  const out = {};
  try {
    const { stdout } = await execFileAsync('sh', ['-c', "df -BG --output=size,avail / | tail -1"], { timeout: 8000 });
    const m = /(\d+)G\s+(\d+)G/.exec(String(stdout));
    if (m) { out.diskTotalGb = Number(m[1]); out.diskFreeGb = Number(m[2]); }
  } catch { /* ignore */ }
  // ★★★2026-08-13 RAM TAVANI ALARMI (operatör: "filo büyürse nerede patlar").
  //
  // ÖLÇÜM (13 Ağu, 163 instance): used 215/250 GB · available 40 GB · cihaz başına
  // 1.32 GB · swap 1.7 GB KULLANILMAYA BAŞLAMIŞ. Yani gerçek tavan ~195 cihaz ve
  // filo ona 30 cihaz uzaktaydı — ama RAM için HİÇBİR alarm yoktu (yalnızca CPU ve
  // disk vardı). RAM biterse Waydroid container'ları OOM ile ölür: cihazlar rastgele
  // düşer, süren kayıtlar yarıda kesilir, numara yanar.
  //
  // ★`free`/`used` DEĞİL `available` ölçülür: buff/cache geri kazanılabilir olduğu için
  // "free" bu makinede daima ~2 GB görünür ve tamamen yanıltıcıdır (ölçüm: free 1.9 GB
  // iken available 40 GB). Toplam + swap da gönderilir ki API yüzde hesaplayabilsin ve
  // "swap'a girdi" erken uyarısını verebilsin.
  try {
    const { stdout } = await execFileAsync('sh', ['-c',
      "free -m | awk '/^Mem:/{print $2, $7} /^Swap:/{print $2, $3}'"], { timeout: 8000 });
    const nums = String(stdout).trim().split(/\s+/).map(Number);
    const [totalMb, availMb, swapTotalMb, swapUsedMb] = nums;
    if (Number.isFinite(availMb)) out.ramFreeGb = Math.round(availMb / 1024);
    if (Number.isFinite(totalMb)) out.ramTotalGb = Math.round(totalMb / 1024);
    if (Number.isFinite(swapUsedMb) && Number.isFinite(swapTotalMb) && swapTotalMb > 0) {
      out.swapUsedPct = Math.round((swapUsedMb / swapTotalMb) * 100);
    }
  } catch { /* ignore */ }
  try {
    // 1-minute load average, normalized to a saturation PERCENT (load / nCPU * 100).
    // On this GPU-less host, software-rendered Waydroid instances pin the CPU — a
    // sustained >~150% is what makes screencap crawl. The dashboard surfaces this so
    // an operator can sleep idle devices; we send the raw 1m load AND the cpu count.
    const [{ stdout: la }, { stdout: nc }] = await Promise.all([
      execFileAsync('sh', ['-c', 'cat /proc/loadavg'], { timeout: 5000 }),
      execFileAsync('sh', ['-c', 'nproc'], { timeout: 5000 })
    ]);
    const load1 = parseFloat(String(la).trim().split(/\s+/)[0]);
    const cpus = parseInt(String(nc).trim(), 10);
    if (Number.isFinite(load1)) out.loadAvg1m = Math.round(load1 * 100) / 100;
    if (Number.isFinite(cpus) && cpus > 0) out.cpuCores = cpus;
  } catch { /* ignore */ }
  // ★2026-08-05 GERCEK CPU MESGULIYETI. Operator gece boyu "CPU yükü 90/80
  // (satürasyon)" alarmi aldi; OLCUM: o anda load 90 iken CPU %96.5 BOSTAYDI ve
  // calisan tek bir is yoktu (sadece hafif WHATSAPP_RECEIPTS).
  // SEBEP: Waydroid'de load, CPU'yu DEGIL uyuyan thread sayisini yansitir —
  // 92 cihaz = ~105.000 thread. Load'a bakan alarm bu yuzden SUREKLI yanlis
  // atesliyordu (bir gecede 13 bildirim).
  // `cpuBusyPct()` /proc/stat'tan GERCEK mesguliyeti okur (provision zaten bunu
  // kullaniyordu, ama API'ye HIC gonderilmiyordu). Artik gonderiliyor ki alarm
  // dogru olcute baksin. loadAvg1m KORUNUYOR (panel/gecmis icin).
  try {
    const busy = await cpuBusyPct();
    if (Number.isFinite(busy)) out.cpuBusyPct = busy;
  } catch { /* ignore */ }
  return out;
}

// ★★★2026-08-13 IP DEGISIMI CIHAZI SONSUZA KADAR "OFFLINE" BIRAKIYORDU.
//
// API bir cihazin ONLINE olup olmadigina `ipAddress:adbPort` serial'i erisilebilir
// serial listesinde VAR MI diye bakarak karar veriyor (agent.service.ts:1143). Ama
// bir instance yeniden baslatildiginda YENI bir subnet/IP alabiliyor ve bunu API'ye
// KIMSE bildirmiyordu -> DB'deki IP bayat kaliyor -> serial hicbir zaman eslesmiyor
// -> cihaz CALISIYOR olmasina ragmen panelde sonsuza kadar OFFLINE goruluyor.
//
// CANLI VAKA (mi81, +905343666957):
//   02:18  dns-heal: "DHCP lease YOK" -> wd-run yeniden basladi
//          eski 192.168.57.112  ->  yeni 192.168.169.72 (net-head yeni subnet verdi)
//   02:27  adb-reconnect: mi81 geri baglandi (cihaz SAGLIKLI: adb=device, boot=1,
//          TR proxy calisiyor) ama DB hala .57.112 diyordu -> panel OFFLINE.
// Operator "bir cihaz neden dustu" diye sordu; cihaz hic dusmemisti.
//
// FIX: heartbeat'e instance -> gercek serial haritasi eklenir. API bunu gorunce
// bayat `ipAddress` kaydini tazeler. Ucuz: veri zaten elimizde (net-head + lease).
async function instanceSerialMap(serials) {
  const map = {};
  try {
    const { stdout } = await execFileAsync('bash', ['-c',
      "pgrep -af 'wd-run.sh' 2>/dev/null | grep -oE 'wd-run.sh mi[0-9]+' | grep -oE 'mi[0-9]+' | sort -u"]);
    const running = String(stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const live = new Set(serials || []);
    for (const inst of running) {
      const ip = await instanceIp(inst);
      if (!ip) continue;
      const serial = `${ip}:5555`;
      // Yalnizca ADB'de GERCEKTEN gorunen ucu bildir — yoksa bayat bir tahmini
      // API'ye dogruymus gibi yazdirmis oluruz.
      if (live.has(serial)) map[inst] = serial;
    }
  } catch { /* best-effort: harita gonderilemezse eski davranis surer */ }
  return map;
}

let _heartbeatPurgeAt = 0;
async function heartbeat() {
  try {
    const serials = await reachableSerials();
    const cap = await hostCapacityMetrics();
    // Send the count (host capacity gauge) + reachable serials (so the API marks
    // only live phones ONLINE) + host disk/RAM (for the "N devices fit" estimate).
    // instanceSerials: bayat ipAddress kayitlarini tazelemek icin (bkz. yukaridaki not).
    const instanceSerials = await instanceSerialMap(serials).catch(() => ({}));
    const hb = await api('/agent/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        runningPhones: serials.length,
        serials,
        ...(Object.keys(instanceSerials).length ? { instanceSerials } : {}),
        ...cap
      })
    });
    // ★2026-07-24: cache the DB's known instance list (returned on the heartbeat) so the
    // orphan-reaper can spot host instances whose Device row is gone. null = unknown
    // (older API / error) → reaper stays disabled that round (never reaps blindly).
    const inst = hb && hb.data && hb.data.instances;
    knownInstances = Array.isArray(inst) ? new Set(inst) : null;
    knownInstancesAt = Date.now();
    // Per-device metrics are best-effort and reported separately so a slow
    // collection never delays/blocks the host heartbeat itself.
    const devices = await collectDeviceMetrics();
    if (devices.length > 0) {
      await api('/agent/device-metrics', { method: 'POST', body: JSON.stringify({ devices }) }).catch(() => undefined);
    }
    // ★2026-07-23 (P-6): every ~5min, drop per-serial state for devices that vanished
    // (removed / re-provisioned to a new subnet) so the seen-sets don't leak forever.
    if (Date.now() - _heartbeatPurgeAt > 5 * 60 * 1000) {
      _heartbeatPurgeAt = Date.now();
      await purgeStaleSerialState().catch(() => undefined);
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
// ★2026-07-30 Yayın döngüsünün "cihaz meşgul" beklemesi için ÜST SINIR. busyDevices
// bellek-içi bir kümedir ve yarı yolda ölen bir iş serial'i orada asılı bırakabilir;
// sınır olmadan yayın sonsuza kadar sessizce bekliyordu (panelde "Bağlanıyor…").
// 20 sn: gerçek işler bundan kısa (en uzun WA adımları bile ~10 sn ADB tutar).
const BUSY_WAIT_MAX_MS = Number(process.env.FLEET_STREAM_BUSY_WAIT_MS || 20_000);

function frameDeviceId(id) {
  // Device ids are cuids (~25 chars); pad/truncate to a fixed 36 so the control
  // plane can slice deterministically.
  return id.padEnd(36, ' ').slice(0, 36);
}

// Optional fast JPEG path. On this software-rendered (GPU-less) Waydroid the
// device-side PNG encode of `screencap -p` costs ~1.7s ON TOP of the ~1.3s raw
// grab (measured: 3s/frame, 562KB). Instead we pull the RAW RGBA framebuffer
// (`screencap`, no -p) and re-encode to a JPEG HOST-side with sharp (~60ms,
// ~40KB at full-res q50) — far faster than the device PNG, ~14x smaller, and it
// moves the encode cost off the device so the ADB transport is freed sooner
// (which is what was starving jobs/heartbeats). Enabled with FLEET_STREAM_JPEG=1.
//
// ⚠️ We send the JPEG at the DEVICE'S NATIVE RESOLUTION (no downscale by default).
// The dashboard maps a click back to device coordinates using the decoded frame's
// pixel size, so a downscaled frame (e.g. 400px) makes taps land in the wrong
// place. Full-res is also FASTER here than resizing (sharp's resize costs more CPU
// than it saves in encode). FLEET_STREAM_JPEG_W>0 opts INTO downscale only if a
// caller accepts the tap-coordinate tradeoff.
//
// sharp is an npm native module, and the agent core is zero-dependency by
// design — so we NEVER hard-import it. We lazy dynamic-import it once; if it's
// not installed (or import fails) we transparently fall back to the PNG path.
const STREAM_JPEG = process.env.FLEET_STREAM_JPEG === '1';
const STREAM_JPEG_W = Number(process.env.FLEET_STREAM_JPEG_W || 0); // 0 = native res
const STREAM_JPEG_Q = Number(process.env.FLEET_STREAM_JPEG_Q || 50);
let sharpMod;          // undefined = not tried, null = unavailable, fn = loaded
async function loadSharp() {
  if (sharpMod !== undefined) return sharpMod;
  // The agent runs as a single file (often /opt/agent.mjs) with NO node_modules
  // next to it, and ESM `import()` ignores NODE_PATH — so a bare `import('sharp')`
  // usually fails on the host. Try the bare specifier first (works if the agent
  // lives inside a package tree), then fall back to known absolute install paths.
  // FLEET_SHARP_PATH lets an operator point at any install explicitly.
  const candidates = [
    'sharp',
    process.env.FLEET_SHARP_PATH,
    '/opt/fleet/node_modules/sharp/lib/index.js',
    '/opt/fleet/apps/api/node_modules/sharp/lib/index.js'
  ].filter(Boolean);
  for (const spec of candidates) {
    try {
      const m = await import(spec);
      sharpMod = m.default || m;
      log(`stream: sharp JPEG path enabled via ${spec} (${STREAM_JPEG_W > 0 ? STREAM_JPEG_W + 'px' : 'native res'} q${STREAM_JPEG_Q})`);
      return sharpMod;
    } catch { /* try next candidate */ }
  }
  sharpMod = null;
  log('stream: sharp unavailable on any known path — falling back to device PNG');
  return sharpMod;
}

// Parse Android `screencap` (no -p) raw output: a small header of little-endian
// uint32s [width, height, format, (colorspace on newer builds)] followed by
// width*height*4 RGBA bytes. The header is 12 or 16 bytes depending on build; we
// detect which by matching the trailing pixel count. Returns {w,h,pixels} or null.
function parseRawScreencap(buf) {
  if (buf.length < 16) return null;
  const w = buf.readUInt32LE(0);
  const h = buf.readUInt32LE(4);
  const body = w * h * 4;
  const hdr = buf.length - body === 16 ? 16 : buf.length - body === 12 ? 12 : 0;
  if (!hdr) return null; // dimensions don't match payload — not a raw RGBA grab
  return { w, h, pixels: buf.subarray(hdr) };
}

// ★2026-07-30 SÜRE SINIRI ŞART. Eskiden aşağıdaki iki `execFileAsync` çağrısının
// HİÇBİRİNDE timeout yoktu. Canlı ölçüm (wa-b0uq/mi46): ham `exec-out screencap`
// (JPEG yolunun kullandığı çağrı) o cihazda SONSUZA KADAR takılıyor — 25 sn'de
// 0 bayt — oysa AYNI cihazda `screencap -p` (PNG yolu) sorunsuz 554 KB döndürüyor.
// Timeout olmadığı için yakalama döngüsü orada asılı kalıyordu: ne kare gönderiyor
// ne hata basıyor → panel sonsuza kadar "Bağlanıyor…" gösteriyordu.
// Artık JPEG yolu süre sınırlı; takılır/başarısız olursa AYNI KARE içinde PNG yoluna
// düşülür (o da süre sınırlı). Böylece tek bir bozuk yol yayını öldürmez.
const CAPTURE_TIMEOUT_MS = Number(process.env.FLEET_STREAM_CAPTURE_TIMEOUT_MS || 8_000);

async function captureFrame(serial) {
  // Fast JPEG path: raw grab + host-side sharp encode.
  if (STREAM_JPEG) {
    const sharp = await loadSharp();
    if (sharp) {
      try {
        const { stdout } = await execFileAsync(ADB, ['-s', serial, 'exec-out', 'screencap'], {
          encoding: 'buffer',
          maxBuffer: 64 * 1024 * 1024,
          timeout: CAPTURE_TIMEOUT_MS,
          killSignal: 'SIGKILL'
        });
        const raw = parseRawScreencap(stdout);
        if (raw) {
          let img = sharp(raw.pixels, { raw: { width: raw.w, height: raw.h, channels: 4 } });
          // Downscale ONLY if explicitly opted in (>0). Default keeps native res so
          // dashboard tap coordinates stay correct — see STREAM_JPEG_W note above.
          if (STREAM_JPEG_W > 0) img = img.resize({ width: STREAM_JPEG_W });
          return await img.jpeg({ quality: STREAM_JPEG_Q }).toBuffer();
        }
        // Unparseable header → fall through to the PNG path this frame.
      } catch {
        // Ham yakalama takıldı/başarısız → PNG yoluna düş. Bu cihazda ham yol KALICI
        // olarak bozuk olabilir (canlı örnek: mi46); PNG yolu yayını ayakta tutar.
      }
    }
  }
  const { stdout } = await execFileAsync(ADB, ['-s', serial, 'exec-out', 'screencap', '-p'], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
    timeout: CAPTURE_TIMEOUT_MS,
    killSignal: 'SIGKILL'
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
      // ADB isolation: a running job (tap/swipe/exec-out cat/uiautomator) shares
      // the SAME adb transport as our screencap. A ~1.7s screencap in flight was
      // starving the job's own adb calls — the root of the "adb kararsızlığı".
      // While a job holds THIS device, PAUSE streaming so the job's ADB calls run
      // uncontended; resume the instant it finishes. Per-device now (busyDevices) so
      // one device's job doesn't freeze every other device's stream. Jobs are short,
      // so the viewer only sees a brief freeze, and control stays responsive.
      // ★2026-07-30 SESSİZ TAKILMA DÜZELTMESİ. Bu bekleme SINIRSIZDI: `busyDevices`
      // bellek-içi bir küme ve bir iş yarı yolda ölürse (timeout, atılan hata, agent
      // yeniden başlatılmadan kalan kalıntı) serial kümede ASILI kalıyor. O zaman bu
      // döngü sonsuza kadar 200 ms bekliyor, TEK BİR KARE göndermiyor ve HİÇ hata
      // basmıyor → panelde "Bağlanıyor…" yazıp öyle kalıyor (CANLI ÖLÇÜM: wa-b0uq'da
      // `stream start` var, `first frame` YOK, hata YOK — tam bu durum).
      // Artık: en fazla BUSY_WAIT_MAX_MS bekleriz; aşarsa (a) durumu LOGLARIZ, (b)
      // kilidin bayat olduğunu varsayıp yakalamayı ZORLARIZ. En kötü durumda kısa bir
      // ADB çekişmesi olur; alternatifi kalıcı olarak siyah bir ekran.
      if (busyDevices.has(serial)) {
        // ⚠️ Paralel şeritler bu sayacı PAYLAŞIR, bu yüzden geçen süreyi saat ile
        // ölçüyoruz (şerit başına +200 ms toplamak, N şeritte eşiği N kat hızlı
        // tetikler ve gerçek bir işi bayat kilit sanardı).
        if (!state.busySince) state.busySince = Date.now();
        state.busyWaitMs = Date.now() - state.busySince;
        if (state.busyWaitMs < BUSY_WAIT_MAX_MS) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        if (!state.loggedBusyStuck) {
          state.loggedBusyStuck = true;
          log(`stream: ${deviceId} ${Math.round(state.busyWaitMs / 1000)}s boyunca MESGUL isaretli — bayat kilit varsayilip yakalama zorlaniyor`);
        }
        // Bayat kilidi temizle: gerçek bir iş varsa kendi bitişinde yine ekler.
        busyDevices.delete(serial);
      }
      try {
        const img = await captureFrame(serial);
        if (state.stopped) break;
        // Başarılı kare → meşgul-bekleme saatini sıfırla (bir sonraki gerçek iş
        // için pencere yeniden baştan ölçülsün).
        state.busySince = 0;
        state.busyWaitMs = 0;
        state.loggedBusyStuck = false;
        if (ws.readyState === 1 && ws.bufferedAmount <= MAX_BUFFERED) {
          ws.send(Buffer.concat([prefix, img]));
          if (!state.loggedFirst) { state.loggedFirst = true; log(`stream first frame ${deviceId} (${img.length}B)`); }
        }
      } catch (e) {
        // ★Hata artık YALNIZCA BİR KEZ değil, periyodik olarak loglanır: tek-seferlik
        // log yüzünden sürekli başarısız bir yayın sessiz görünüyordu.
        state.errCount = (state.errCount || 0) + 1;
        if (state.errCount === 1 || state.errCount % 50 === 0) {
          log(`stream capture error ${deviceId} (#${state.errCount}): ${e.message}`);
        }
        await new Promise((r) => setTimeout(r, 50)); // brief backoff on error
      }
      // Yield so we honor at most the requested fps (but never idle-throttle
      // below the device's own capture rate).
      const minGap = Math.max(0, interval - 5);
      if (minGap) await new Promise((r) => setTimeout(r, minGap === interval ? 0 : 1));
    }
  };
  captures.set(deviceId, state);
  // ★2026-07-30 PARALEL BORU HATTI — fps'i ~2 katına çıkarır.
  //
  // ÖLÇÜM (canlı, mi15): ham `exec-out screencap` TEK başına 185 ms sürüyor
  // (10.4 MB ham piksel ADB üzerinden) → tek döngüyle teorik tavan 5.4 fps, ve
  // operatörün gördüğü de tam olarak 5 fps'ti. Aynı cihazda 2 yakalama PARALEL
  // koşturulduğunda 4 kare 709 ms yerine 422 ms'de tamamlandı (5.6 → 9.4 fps):
  // sürenin çoğu CPU değil ADB transfer beklemesi, yani üst üste bindirilebiliyor.
  //
  // ⚠️ Waydroid'de `screenrecord` (H.264 hızlı yol) ÇALIŞMIYOR — donanım kodlayıcı
  // yok, 5 sn'lik deneme 73 bayt üretti. Panelde WebCodecs kodu hazır olsa da bu
  // ortamda kullanılamaz; bu yüzden JPEG yolunu paralelleştiriyoruz.
  //
  // Şerit sayısı ölçülü tutuldu (2): daha fazlası aynı ADB taşıyıcısında çekişme
  // yaratıp iş (job) ADB çağrılarını açlığa düşürür — "adb kararsızlığı"nın kökü.
  const LANES = Math.max(1, Math.min(4, Number(process.env.FLEET_STREAM_LANES || 2)));
  for (let i = 0; i < LANES; i++) void loop();
  log(`stream start ${deviceId} @ ~${Math.round(1000 / interval)}fps target (${LANES} paralel serit)`);
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
    case 'adb.reconnect':
      // Operator "refresh stream": drop any stale ADB handle and reconnect so a
      // 'device not found' / offline serial recovers before capture restarts.
      if (serial) {
        try { await execFileAsync(ADB, ['disconnect', serial], { maxBuffer: 1024 * 1024 }); } catch { /* not connected */ }
        await ensureConnected(serial).catch(() => undefined);
        log(`adb reconnect requested for ${serial}`);
      }
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
  // ── ZOMBIE SOKET KORUMASI ──────────────────────────────────────────────────
  // Sorun (28 Tem, canlı): API yeniden başlatılınca bu soket YARI-AÇIK kalabiliyor.
  // `onclose`/`onerror` HİÇ tetiklenmiyor, dolayısıyla aşağıdaki 5 sn'lik yeniden
  // bağlanma da çalışmıyor. Agent "bağlı" görünüyor (heartbeat + job long-poll ayrı
  // HTTP yolundan gittiği için filo sağlıklı raporlanıyor) ama tek kare göndermiyor;
  // panelde yayın "Bağlanıyor…"da kalıyor ve ancak agent ELLE restart edilince
  // düzeliyordu.
  // Çözüm: uygulama seviyesinde ping/pong. PING_MS'te bir `agent.ping` yollarız,
  // sunucu `agent.pong` döner. PONG_TIMEOUT_MS boyunca hiç pong gelmezse soket
  // ölüdür → zorla kapat, yeniden bağlan. Ayrıca soket beklenmedik bir durumda
  // (CLOSED ama retry planlanmamış) kalırsa watchdog onu da toparlar.
  const PING_MS = 30_000;
  const PONG_TIMEOUT_MS = 75_000;
  // ★2026-08-04 (CANLI KANIT): agent 1 Ağu 06:19'da bağlandıktan sonra 2.5 GÜN
  // boyunca stream soketi ölü kaldı — logda ne "connected" ne "yeniden bağlanılıyor"
  // vardı, yani watchdog HİÇBİR ŞEY yapmadı. Sebep aşağıdaki CONNECT_TIMEOUT_MS'in
  // yokluğuydu: soket CONNECTING(0) durumunda asılı kalırsa
  //   1) watchdog `readyState !== 1` görüp SÜRESİZ return ediyordu,
  //   2) `connecting` bayrağı true kalıyordu (sıfırlanması yalnızca
  //      onopen/onclose/onerror'a bağlı; hiçbiri ateşlenmiyordu),
  //   3) dolayısıyla connect() de baştaki `if (connecting) return` ile
  //      EBEDİYEN bloklanıyordu → kalıcı ölü kilit, tek çare elle restart.
  // Artık CONNECTING bir süre sınırına tabi: aşarsa soket zorla kapatılıp
  // yeniden bağlanılır. Aynı anahtarla elle test 1 sn'de bağlandığı için
  // 20 sn fazlasıyla cömert bir üst sınır.
  const CONNECT_TIMEOUT_MS = 20_000;
  let lastPongAt = 0;
  let connectStartedAt = 0;   // connect() çağrıldığı an (CONNECTING süre denetimi)
  let watchdog;
  let reconnectTimer;
  // Aynı anda birden fazla soket açılmasını engeller (watchdog + onclose yarışı).
  let connecting = false;

  const scheduleReconnect = (ms) => {
    if (stopping) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect(); }, ms);
  };

  const killSocket = (why) => {
    log(`stream channel ${why} — yeniden bağlanılıyor`);
    try { stream && stream.close(); } catch { /* ignore */ }
    // close olayı gelmeyebilir (zombie): kaptürleri burada da durdur ve retry kur.
    for (const id of [...captures.keys()]) stopCapture(id);
    stream = undefined;
    // ★ `connecting`i BURADA da sıfırla: soket CONNECTING'de asılıyken kill
    // edildiğinde onclose/onerror gelmeyebilir; bayrak true kalırsa connect()
    // sonsuza dek erken return eder (ölü kilidin ikinci yolu).
    connecting = false;
    scheduleReconnect(1000);
  };

  const connect = () => {
    if (stopping || connecting) return;
    // Zaten canlı bir soket varsa ikinci bir tane açma.
    if (stream && (stream.readyState === 0 || stream.readyState === 1)) return;
    connecting = true;
    connectStartedAt = Date.now();
    try {
      stream = new WebSocket(STREAM_URL);
    } catch {
      connecting = false;
      scheduleReconnect(5000);
      return;
    }
    stream.binaryType = 'arraybuffer';
    stream.onopen = () => {
      connecting = false;
      connectStartedAt = 0;    // ★ ŞART: sıfırlanmazsa CONNECT_TIMEOUT_MS bir
                               // sonraki turda AÇIK soketi haksız yere kill eder.
      lastPongAt = Date.now(); // ilk pong'a kadar sayaç açılış anından işler
      log('stream channel connected');
    };
    stream.onmessage = async (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      } catch {
        return;
      }
      // Sunucudan gelen HER mesaj canlılık kanıtıdır (pong'u beklemeye gerek yok).
      lastPongAt = Date.now();
      if (msg.type === 'agent.pong') return;
      if (msg.type === 'stream.start') startCapture(stream, msg.deviceId, msg.serial, msg.fps);
      else if (msg.type === 'agent.dump' || msg.type === 'agent.action') await handleAgentRequest(stream, msg).catch(() => undefined);
      else await handleControl(msg).catch(() => undefined);
    };
    stream.onclose = () => {
      connecting = false;
      connectStartedAt = 0;
      for (const id of [...captures.keys()]) stopCapture(id);
      if (!stopping) scheduleReconnect(5000);
    };
    stream.onerror = () => { connecting = false; connectStartedAt = 0; try { stream.close(); } catch { /* ignore */ } };
  };

  // Watchdog: hem ping atar hem de "soket yok / kapalı ama kimse yeniden bağlamıyor"
  // durumunu yakalar. .unref() ile sürecin kapanmasını engellemez.
  watchdog = setInterval(() => {
    if (stopping) return;
    // ★ CONNECTING/CLOSING SÜRE SINIRI — bu blok watchdog'un ÖNÜNDE olmalı.
    // Eskiden CONNECTING süresiz beklenirdi ve `connecting` bayrağı asılı kalırdı;
    // bağlanma yarıda takılınca kanal 2.5 gün ölü kaldı (canlı olay, 1–4 Ağu).
    // NOT: koşul `connectStartedAt` truthy'liğine BAKMAZ — yalnızca `connecting`e
    // bakar. (0 hem "sıfırlandı" hem geçerli bir zaman damgası olabilirdi; truthy
    // kontrolü zaman aşımını sessizce atlardı.)
    if (connecting && Date.now() - connectStartedAt > CONNECT_TIMEOUT_MS) {
      killSocket('bağlanma zaman aşımı (CONNECTING asılı kaldı)');
      return;
    }
    if (!stream || stream.readyState === 3 /* CLOSED */) {
      // `connecting` true ama ortada soket YOKSA bayrak bayattır (yukarıdaki süre
      // sınırı onu zaten temizler) — burada yalnızca retry planlıysa bekle.
      if (!reconnectTimer && !connecting) connect();
      return;
    }
    if (stream.readyState !== 1 /* OPEN */) return; // CONNECTING/CLOSING: süre sınırı yukarıda
    if (lastPongAt && Date.now() - lastPongAt > PONG_TIMEOUT_MS) {
      killSocket('yanıt vermiyor (pong yok)');
      return;
    }
    try {
      stream.send(JSON.stringify({ type: 'agent.ping', ts: Date.now() }));
    } catch {
      killSocket('gönderim başarısız');
    }
  }, PING_MS);
  if (watchdog.unref) watchdog.unref();

  connect();
}

// --- main loop --------------------------------------------------------------

let stopping = false;
// ── Per-DEVICE concurrency ───────────────────────────────────────────────────
// The agent used to run ONE job at a time across the WHOLE host (a single `jobBusy`
// flag + an await-in-loop): a send to device B waited for device A's send to finish
// even though they're different phones (VERIFIED LIVE 23:29 — three sends to three
// devices queued 1s/12s/25s instead of running together). For the multi-user, many-
// device usage this fleet is built for, that's a hard bottleneck (10 users → 10×
// serial). Now we track busy devices in a SET and dispatch jobs for DIFFERENT devices
// CONCURRENTLY, while still serialising jobs on the SAME device (overlapping ADB/UI
// on one phone corrupts each other). A global cap bounds total parallelism so a burst
// can't exhaust host resources.
const busyDevices = new Set();          // serials with a job currently executing
// ★2026-07-25: instances currently being PROVISIONED (by wd-run.sh → boot → root → …).
// adbRecoveryTick/healInstanceEth0 MUST NOT touch these — provisionDevice manages its own
// eth0 (DHCP + statik fallback) and a concurrent heal race corrupts the boot session
// (canlı: eth0-heal + provision-fallback aynı anda IP atadı → session çöktü → FAILED).
// provisionDevice add's its instance on entry, delete's in finally.
const provisioningInstances = new Set();
// Default 24: the host is an 80-core / 250GB box; measured load sat at ~17-20 (~22%)
// with headroom to spare, so 24 concurrent jobs stays well within limits while giving
// messaging bursts more parallelism. Override with FLEET_MAX_CONCURRENT_JOBS per host.
const MAX_CONCURRENT_JOBS = Number(process.env.FLEET_MAX_CONCURRENT_JOBS || 24);
// PROVISION_DEVICE is HEAVY (full Android boot → CPU spike; measured load 49 when 3
// booted at once). Cap concurrent provisions SEPARATELY from the global job cap so a
// batch of 10 doesn't boot all at once, while light jobs (send/read) still run up to
// MAX_CONCURRENT_JOBS. Staggered boot = fast AND stable. Override via env.
//
// ★2026-08-04: 4 → 2. CANLI ÖLÇÜM (operatör 4 cihazı aynı anda kurdu):
//   tek tek : mi76 108s ✅ · mi77 109s ✅
//   4'lü    : mi79 273s ✅ · mi81 288s ✅ · mi78 FAILED · mi80 FAILED  → %50 KAYIP
// Darboğaz CPU DEĞİL (idle %80, load 4-8/80 çekirdek) — DHCP ve disk:
//   • infra: her cihaz ~4GB userdata klonlar; 4 paralelde mi78'in bu adımı 6 DAKİKA
//     sürdü (tek başına ~40s).
//   • boot : 4 cihaz aynı anda DHCP isteyince lease gecikiyor. mi78/mi80 IP'yi
//     9 re-kick'te alamayıp 91s'de statik fallback'e düştü; DHCP fazı 114s sürdü
//     (sağlıklı mi79'da 25s) ve kalan bütçe ADB yetkilendirmesine yetmeden
//     240s'lik boot sınırı doldu.
// Sınırı büyütmek yerine eşzamanlılığı düşürmek doğrusu: 2'şerli kurulumda hem
// hiçbiri kaybedilmiyor hem cihaz başına süre ~110s'de kalıyor (4'lüde 273-400s+).
const MAX_CONCURRENT_PROVISIONS = Number(process.env.FLEET_MAX_CONCURRENT_PROVISIONS || 2);
const _CPU_COUNT = (() => { try { return osCpus().length || 1; } catch { return 1; } })();
// ★2026-07-24: CPU-IDLE-AWARE boot gate (replaces the old load-average gate).
// WHY: a 5-agent deep analysis proved load-average is a LIE on GPU-less Waydroid — 29
// instances × ~30 daemons = 34K mostly-SLEEPING threads inflate the runnable/vsync queue,
// so os.loadavg() sits at ~98 while the CPU is actually 47% IDLE (no I/O wait, no throttle,
// no swap). The old gate (load1() >= cores*0.7) blocked provisions for up to 10 minutes
// whenever load looked high — even with half the cores free — which is exactly why the
// first device-create this session hung at 0%. The RIGHT signal is real CPU utilisation
// from /proc/stat, not load. We gate on "keep at least PROVISION_IDLE_MIN% of cores free"
// so a boot only waits when the machine is GENUINELY saturated, not when load is cosmetic.
const PROVISION_IDLE_MIN = Number(process.env.FLEET_PROVISION_IDLE_MIN || 15); // need >=15% idle to boot
// Read aggregate CPU busy% from /proc/stat across a short sample. Returns 0..100 (busy).
// Falls back to load-based estimate if /proc/stat is unreadable (non-Linux/edge).
let _cpuPrev = null;
function _readCpuTimes() {
  try {
    const line = readFileSync('/proc/stat', 'utf8').split('\n')[0]; // "cpu  u n s idle iowait irq softirq steal ..."
    const p = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (p[3] || 0) + (p[4] || 0); // idle + iowait
    const total = p.reduce((a, b) => a + (b || 0), 0);
    return { idle, total };
  } catch { return null; }
}
async function cpuBusyPct() {
  const a = _readCpuTimes();
  if (!a) { const l = (loadavg()[0] || 0) / _CPU_COUNT; return Math.min(100, Math.round(l * 100)); }
  await sleep(250);
  const b = _readCpuTimes();
  if (!b || b.total <= a.total) return 0;
  const idleDelta = b.idle - a.idle;
  const totalDelta = b.total - a.total;
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
}
// True when the host has enough real CPU headroom to safely boot another instance.
async function hasBootHeadroom() {
  const busy = await cpuBusyPct();
  return (100 - busy) >= PROVISION_IDLE_MIN;
}
function load1() { try { return loadavg()[0] || 0; } catch { return 0; } }
let activeJobCount = 0;
let activeProvisionCount = 0;
// ★ORPHAN-INSTANCE REAPER state: the DB's known instance set (from the heartbeat) + when
// we last learned it. null = unknown → reaper disabled that round (never reap blind).
let knownInstances = null;
let knownInstancesAt = 0;
// instance → first time we saw it running-but-unknown. Reaped only after a grace window,
// so a just-provisioned instance not yet written to the DB is never destroyed.
const orphanSince = new Map();
// ★ADB-SERVER RECOVERY state: last time we bounced the adb server (cooldown so a genuinely-
// dead fleet doesn't get hammered with kill-server every tick).
let lastAdbBounceAt = 0;
// Back-compat shim: some helpers (otpWatchTick, whatsappInboxTick) historically read
// a global `jobBusy`. They now ask "is ANY job running?" via this getter, but the
// hot path uses busyDevices.has(serial) for per-device decisions.
function anyJobBusy() { return activeJobCount > 0; }
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

// ★OTP-WATCH — keep the live panel view FRESH while a registration is parked at OTP_WAIT.
// When registerWhatsApp reaches the OTP screen it returns via done('otp_wait') → the job
// ends COMPLETED → the in-job heartbeat ticker stops → the panel's live thumbnail FREEZES
// while the operator reads/enters the code (which can take minutes). This registry lets
// the agent keep pushing a ~10s thumbnail for a parked device even though no job is
// running on it. registerWhatsApp adds an entry when it parks; a new continuation job
// (or the deadline) removes it. Keyed by serial. { jobId, accountId, deviceId, until }.
const otpWatch = new Map();
// Serials whose screen is momentarily held by an otpWatchTick screencap. Kept SEPARATE
// from busyDevices so a capture never clears a job's device lock; the dispatcher checks
// both before starting a job on a serial (ORCH-2 same-device concurrency guard).
const otpCapturing = new Set();
// Serials that already have a same-device waiter task pending in the dispatch loop.
// Caps outstanding waiters at one per serial (ORCH-3) so a wedged device can't pile up
// 120s busy-waiters when claim races deliver several jobs for the same serial.
const sameDeviceWaiters = new Set();
const OTP_WATCH_MS = Number(process.env.FLEET_OTP_WATCH_MS || 10000);
const OTP_WATCH_TTL_MS = Number(process.env.FLEET_OTP_WATCH_TTL_MS || 15 * 60 * 1000); // stop after 15 min

// ★EULA-STUCK REAPER (2026-07-24): a device left on WhatsApp's Welcome/registration/EULA
// screen renders the animated spinner at 60fps in software (no GPU) → one such device
// burns 3-4 CPU cores indefinitely. VERIFIED LIVE: 4 devices stuck on
// com.whatsapp.registration.app.EULA for 1-5 DAYS were eating ~12 cores (96% of all
// surfaceflinger CPU) and pushed host load to ~98; force-stopping WhatsApp on them
// dropped load 98→4 and CPU to 95% idle. These are abandoned/failed registrations (WA
// open, spinner spinning, nobody advancing). This ticker catches them structurally so it
// can never recur: any ADB-reachable device whose foreground has been a WA registration/
// EULA screen for longer than the grace window — AND that has NO in-flight job (not in
// busyDevices, so we never interrupt a live registration/OTP flow) — gets a HOME + WA
// force-stop. Idle/launcher/chat screens are untouched; only the stuck-registration case.
const EULA_REAPER_MS = Number(process.env.FLEET_EULA_REAPER_MS || 60000); // check every 60s
const EULA_GRACE_MS = Number(process.env.FLEET_EULA_GRACE_MS || 8 * 60 * 1000); // stuck > 8 min → reap
// serial → first time we saw it stuck on a registration screen (reset when it leaves).
const eulaStuckSince = new Map();
async function eulaReaperTick() {
  let serials;
  try { serials = await reachableSerials(); } catch { return; }
  if (!serials || !serials.length) return;
  const now = Date.now();
  for (const serial of serials) {
    // NEVER touch a device with a live job — a real registration/OTP flow legitimately
    // sits on these screens while the agent drives it. busyDevices is the job lock.
    if (busyDevices.has(serial) || otpCapturing.has(serial)) { eulaStuckSince.delete(serial); continue; }
    let foc = '';
    try { foc = await adb(serial, ['shell', 'dumpsys', 'window'], 8000); } catch { eulaStuckSince.delete(serial); continue; }
    // Is the foreground a WhatsApp registration/EULA/welcome screen? (the CPU-burning states)
    const onReg = /mCurrentFocus[^\n]*com\.whatsapp\/[^\n]*(registration|\.EULA|EulaActivity|verifynumber|RegisterName)/i.test(foc);
    // ★2026-07-29 — KAPSAM GENİŞLETİLDİ. Bu reaper filonun TEK ekran-kurtarma ağıydı ama
    // yalnızca WhatsApp kayıt ekranlarını görüyordu. Canlı ölçümde 6 cihaz izin
    // diyaloğunda, 2'si ContactPicker'da TAKILI kalmıştı (RUNNING job yokken) ve bu
    // regex onları GÖREMEDİĞİ için sonsuza kadar öyle kaldılar — operatör "cihaz kendi
    // kendine galeriye girmiş" diye bildirdi. Artık bırakılmış her modal/picker ekranı
    // da kurtarılıyor: izin diyaloğu, kişi/medya seçici, kırpma ekranı, dosya seçici ve
    // üçüncü parti galeri uygulamaları.
    const onStuckModal = /mCurrentFocus[^\n]*(permissioncontroller|GrantPermissions|packageinstaller|ContactPicker|CropImage|documentsui|\.gallery|gallery3d|SetAsProfilePhoto|ResolverActivity|ChooserActivity)/i.test(foc);
    if (!onReg && !onStuckModal) { eulaStuckSince.delete(serial); continue; }
    const since = eulaStuckSince.get(serial);
    if (!since) { eulaStuckSince.set(serial, now); continue; } // first sighting — start the clock
    if (now - since < EULA_GRACE_MS) continue; // still within grace — give a real registration time
    // Stuck past the grace window with no job → abandoned registration burning CPU. Reap it.
    log(`eula-reaper: ${serial} ${onReg ? 'WA kayit ekraninda' : 'birakilmis modal/picker ekraninda'} ${Math.round((now - since) / 60000)}dk takili → temizleniyor`);
    try {
      // Modal/picker durumunda ÖNCE diyaloğu onayla/kapat: açık bir izin diyaloğu
      // HOME'u yutabiliyor. Kayıt ekranında ise eski davranış (force-stop) korunur —
      // oradaki dert CPU yakan spinner'dır.
      if (onStuckModal && !onReg) {
        await dismissPermissionDialog(serial, { tries: 2 }).catch(() => undefined);
        await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_BACK'], 5000).catch(() => undefined);
      } else {
        await adb(serial, ['shell', 'am', 'force-stop', 'com.whatsapp'], 8000);
      }
      await adb(serial, ['shell', 'input', 'keyevent', 'KEYCODE_HOME'], 5000);
    } catch { /* best-effort; next tick retries */ }
    eulaStuckSince.delete(serial);
  }
}

// ★ORPHAN-INSTANCE REAPER (2026-07-24): destroy Waydroid instances that are RUNNING on the
// host but whose Device row is GONE from the DB. VERIFIED LIVE: deleting a device left its
// instance (lxc-start + weston + surfaceflinger + WhatsApp + redsocks) running forever as an
// orphan burning CPU/RAM/disk. The delete path now dispatches a DEVICE_DESTROY job, but a
// lost job / legacy delete / crash-mid-delete could still strand one — this is the backstop.
// SAFETY (never kill a live device):
//  - knownInstances comes from the heartbeat (the DB's authoritative list for THIS host).
//    If it's null (older API / heartbeat failed) we do NOTHING — never reap on a guess.
//  - a running instance ABSENT from that list starts a grace clock; only after
//    ORPHAN_GRACE_MS of being continuously unknown is it destroyed. This spans several
//    provisions/heartbeats, so a just-booted instance not yet written to the DB is safe.
//  - if it reappears in the DB (or the list) the clock resets.
const ORPHAN_REAPER_MS = Number(process.env.FLEET_ORPHAN_REAPER_MS || 120000); // check every 2min
const ORPHAN_GRACE_MS = Number(process.env.FLEET_ORPHAN_GRACE_MS || 10 * 60 * 1000); // unknown >10min → destroy
async function orphanReaperTick() {
  // Need a FRESH, known DB instance list (from a recent heartbeat). Stale/unknown → skip.
  if (!knownInstances || (Date.now() - knownInstancesAt) > 3 * ORPHAN_REAPER_MS) return;
  // Enumerate instances actually running on the host (one wd-run.sh shell per instance).
  let running;
  try {
    const { stdout } = await execFileAsync('bash', ['-c', "pgrep -af 'wd-run.sh' 2>/dev/null | grep -oE 'wd-run.sh mi[0-9]+' | grep -oE 'mi[0-9]+' | sort -u"]);
    running = String(stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { return; }
  if (!running.length) { orphanSince.clear(); return; }
  const now = Date.now();
  for (const inst of running) {
    if (knownInstances.has(inst)) { orphanSince.delete(inst); continue; } // in DB → healthy
    const since = orphanSince.get(inst);
    if (!since) { orphanSince.set(inst, now); continue; } // first sighting — start grace clock
    if (now - since < ORPHAN_GRACE_MS) continue; // still within grace — a fresh provision is safe
    // Running >10min with NO Device row anywhere on this host → true orphan. Destroy it.
    log(`orphan-reaper: instance ${inst} running but not in DB for ${Math.round((now - since) / 60000)}min → wd-destroy`);
    await hostSh('wd-destroy.sh', [inst], 120000).catch(() => undefined);
    orphanSince.delete(inst);
  }
  // Drop clock entries for instances that stopped running on their own.
  for (const inst of orphanSince.keys()) if (!running.includes(inst)) orphanSince.delete(inst);
}

// ★ADB-SERVER RECOVERY (2026-07-24): the whole fleet can go "offline" not because the
// devices died but because the host's ADB SERVER wedged (VERIFIED: a past "all devices
// offline" incident was fixed by hand with `agent restart → adb connect`). ensureConnected
// only runs `adb connect <serial>` — it never restarts the adb server itself, and the
// self-watchdog only checks that the dispatch loop is PROGRESSING (it is — every connect
// just returns "offline"). This tick detects the wedge: if instances are RUNNING on the
// host but far fewer are ADB-reachable, bounce the adb server once (cooldown'd) and
// Tek bir serial şu an ADB-erişilebilir mi (reachableSerials cache'ini paylaşır).
async function isSerialReachable(serial) {
  try { return (await reachableSerials()).includes(serial); } catch { return false; }
}

// ★2026-07-24: per-instance eth0 self-heal. Bir Waydroid instance boot ettiğinde
// (container RUNNING, "Android ready") bazen container içindeki eth0'a IPv4 ADRESİ
// ATANMIYOR — sadece IPv6 link-local kalıyor. Sonuç: host→192.168.<sub>.112 "No route
// to host" (ARP INCOMPLETE), cihaz kalıcı OFFLINE, adb reconnect boşuna. adb server
// bounce bunu ÇÖZMEZ (sorun adb'de değil, container ağında). ÇÖZÜM: eth0'a statik IP
// (.112/24) elle ata + link up + adb connect. Bu, canlı-teşhiste (mi19/idilcall) elle
// bulunan fix'in otomatiği. Instance'ın nokta-path lxc dizinini kullanır (waydroid.<inst>).
// ★2026-08-12 VAZGEÇME LİMİTİ — kurtarma sonsuza kadar denemez.
// CANLI VAKA (mi46): route ekleme 14 GÜN boyunca, saatte ~500 kez (son 30 dakikada
// 723) tekrarlandı ve HİÇ tutmadı. Kök neden route değildi: Android'in netd'si ağı
// hiç kaydetmemişti (`ip rule`'da `lookup eth0` kuralları yoktu), o yüzden eklenen
// route hiçbir işe yaramıyordu. Bu döngünün iki zararı vardı: (1) boşuna CPU ve log,
// (2) daha kötüsü — operatör logda "route ekleniyor" görüp KURTARMA ÇALIŞIYOR sanıyor,
// gerçekte cihaz 14 gündür ölü. Sessizce sonsuz denemek, arızayı GİZLİYOR.
// Aynı ders `wd-health-watch.sh`'ta zaten uygulanmıştı (WD_ZOMBIE_FAIL_MAX); burada eksikti.
const eth0HealFails = new Map();   // instance -> ardışık başarısız heal sayısı
const eth0HealGaveUp = new Set();  // vazgeçilenler (alarm bir kez gitsin)
// ★2026-08-14 instance -> son heal denemesi (ms). Soğuma penceresi için; aynı cihaza
// saniyeler içinde tekrar tekrar müdahale "heal fırtınası" yaratıp sistemi boğuyordu.
const eth0HealAt = new Map();
const ETH0_HEAL_MAX_FAILS = Number(process.env.FLEET_ETH0_HEAL_MAX_FAILS || 12); // ~6 dk (30sn tick)

// Başarılı heal (ya da zaten sağlıklı) → sayaç sıfırlanır: geçici arızalar limiti yemez.
function eth0HealOk(inst) {
  eth0HealFails.delete(inst);
  eth0HealGaveUp.delete(inst);
}

// Başarısız heal → say; limiti aşarsa VAZGEÇ ve operatöre BİR KEZ alarm gönder.
async function eth0HealFail(inst, reason) {
  const n = (eth0HealFails.get(inst) ?? 0) + 1;
  eth0HealFails.set(inst, n);
  if (n < ETH0_HEAL_MAX_FAILS || eth0HealGaveUp.has(inst)) return;
  eth0HealGaveUp.add(inst);
  log(`eth0-heal: ${inst} ${n} denemede DÜZELMEDİ → VAZGEÇİLDİ (sebep: ${reason}). Elle bakılmalı; ` +
      `container restart netd kaydını yeniler (canlı: mi46 böyle çözüldü).`);
  await api('/agent/health-alert', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'ETH0_HEAL_GAVE_UP',
      instance: inst,
      detail: `eth0 kurtarma ${n} kez denendi, düzelmedi (${reason}). Cihaz büyük ihtimalle ` +
              `ağa çıkamıyor. Otomatik deneme DURDURULDU — sonsuz döngü arızayı gizliyordu.`,
      fixed: false
    })
  }).catch(() => undefined);
}

async function healInstanceEth0(inst, knownReachable) {
  try {
    // ★2026-07-25: provision devam ederken DOKUNMA — provisionDevice kendi eth0'ını
    // yönetiyor (DHCP + statik fallback); paralel heal boot-session'ı bozar (canlı: FAILED).
    if (provisioningInstances.has(inst)) return { healed: false, reason: 'provisioning' };
    // Vazgeçilmiş instance'ı artık deneme — alarm gitti, karar operatörde.
    if (eth0HealGaveUp.has(inst)) return { healed: false, reason: 'vazgecildi' };
    // ★★★2026-08-14 SOGUMA SURESI — heal FIRTINASINI onler.
    // Ayni cihaz saniyeler icinde tekrar tekrar onarilmaya calisiliyordu (canli log:
    // mi297/mi298 6 saniyede 2 kez). Her deneme lxc-attach + route yazimi demek;
    // 155 cihazda bu, sistemi bogan yuke donusuyor. netd zaten ~2-3 dk agresif
    // siliyor, o pencerede tekrar denemek FAYDASIZ. En az 90 sn bekle.
    const _lastHeal = eth0HealAt.get(inst) || 0;
    if (Date.now() - _lastHeal < 90000) return { healed: false, reason: 'soguma' };
    eth0HealAt.set(inst, Date.now());
    const { stdout: subOut } = await execFileAsync('bash', ['-c', `sh /opt/fleet-agent/waydroid/net-head.sh ${inst} 2>/dev/null`]);
    const sub = String(subOut || '').trim();
    if (!sub) return { healed: false, reason: 'no-subnet' };
    const ip = `192.168.${sub}.112`;
    const lxcp = `/var/lib/waydroid.${inst}/lxc`;
    // Container gerçekten RUNNING mi? Değilse bu tick'in işi değil (wd-run başlatır).
    const { stdout: stOut } = await execFileAsync('bash', ['-c', `lxc-info -n waydroid -P ${lxcp} -sH 2>/dev/null`]).catch(() => ({ stdout: '' }));
    if (String(stOut || '').trim() !== 'RUNNING') return { healed: false, reason: 'not-running' };
    // Container eth0'da IPv4 var mı? ★YANLIS-POZITIF onle: lxc-attach agent'in yogun
    // dongusunde ara sira timeout/bos donuyor → heal "IPv4 yok" saniyor → gereksiz IP atiyor
    // → heal-firtinasi (log siser, IP zaten vardi). COZUM: "IP yok" gorursek KARAR VERMEDEN
    // ONCE bir kez daha dogrula (200ms sonra). Gercekten yoksa ikisi de 0; gecici-hataysa
    // ikinci deneme IP'yi gorur → gereksiz onarim yapilmaz. exit-code'u da kontrol et.
    // ★YANLIS-POZITIF onle (KANITLANDI: mi26 IP hep vardi ama heal "yok" gorup gereksiz
    // onardi). lxc-attach agent'in yogun dongusunde exit:0 verip BOS-stdout donuyor (ip
    // komutu container-mesgulken bos ciktı) → grep -c=0 → heal "IP yok" saniyor → firtina.
    // COZUM: 3 deneme, HERHANGI biri IP gorurse "var" say. IP gercekten yoksa 3'u de 0
    // gorur (dogru heal); gecici-bos-cikti ise en az bir deneme IP'yi yakalar (yanlis-heal
    // engellenir). Retry arasi 250ms. IP-varligi icin grep + exit-code birlikte.
    // ★KÖK-FIX (yanlis-pozitif): ADB-reachable cihaz = IP+route KESIN var (reachable olmak
    // icin gerekli). Bu cihazlarda IP-check YAPMA — lxc-attach yogun-donguda ara sira bos
    // donuyor → heal "IP yok" saniyor → gereksiz IP-ata → ensureInstanceProxy → redsocks
    // restart → "Proxy oldu" bildirim SPAM'i + provision'i bloke. knownReachable ise IP-check
    // atla, hasIp=true (sadece route-check yapilir, IP'ye DOKUNULMAZ).
    let hasIp = knownReachable === true;
    if (!hasIp) {
      for (let att = 0; att < 3; att++) {
        const r = await execFileAsync('bash', ['-c', `lxc-attach -n waydroid -P ${lxcp} -- /system/bin/ip -4 addr show eth0 2>/dev/null | grep -oE 'inet [0-9.]+' | head -1`]).catch(() => ({ stdout: '' }));
        if (/inet 192\.168\.\d+\.\d+/.test(String(r.stdout || ''))) { hasIp = true; break; }
        if (att < 2) await sleep(250);
      }
    }
    // ★2026-07-27: IP VAR ama default-route EKSİK olabilir (cihaz internete çıkamaz, TCP 000,
    // WhatsApp "Couldn't connect"). IP varsa DEFAULT-ROUTE'u da kontrol et; yoksa route'ları
    // ekle (heal). CANLI: mi20 statik-IP aldı ama route yok → çıkamadı. IP+route ikisi de tamsa geç.
    if (hasIp) {
      const { stdout: rtOut } = await execFileAsync('bash', ['-c', `lxc-attach -n waydroid -P ${lxcp} -- /system/bin/ip route show table eth0 2>/dev/null | grep -c '^default'`]).catch(() => ({ stdout: '0' }));
      if (Number(String(rtOut || '0').trim()) > 0) { eth0HealOk(inst); return { healed: false, reason: 'already-has-ip-and-route' }; }
      // IP var ama default-route yok → SADECE route ekle (IP'ye dokunma).
      // ★★★2026-08-14 GATEWAY'i CIHAZIN GERCEK IP'sinden TURET.
      // Eski kod `192.168.${sub}.1` kullaniyordu; `sub` net-head.sh'ten geliyor ama
      // cihaz DHCP'den BASKA bir subnet'te olabiliyor (bkz. ".112 varsayimi" dersi).
      // Yanlis gateway ile eklenen route TUTMUYOR -> netd siliyor -> her tick tekrar
      // deneniyor -> `eth0-heal` firtinasi -> her tur yeni wd-run -> YIGILMA.
      // CANLI (14 Agu): mi291..mi298 saniyeler icinde tekrar tekrar denendi, agent
      // 36 wd-run dogurdu, filo 155 -> 117'ye dustu.
      const _devIp = await execFileAsync('bash', ['-c',
        `lxc-attach -n waydroid -P ${lxcp} -- /system/bin/ip -4 addr show eth0 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -1`])
        .then((r) => String(r.stdout || '').trim()).catch(() => '');
      const _gw = /^(\d+\.\d+\.\d+)\.\d+$/.test(_devIp)
        ? `${_devIp.replace(/\.\d+$/, '')}.1`     // GERCEK IP'nin ag gecidi
        : `192.168.${sub}.1`;                      // yedek: eski davranis
      log(`eth0-heal: ${inst} eth0 IP var ama default-route YOK → route ekleniyor (gw=${_gw})`);
      await execFileAsync('bash', ['-c',
        `for T in main local_network eth0; do lxc-attach -n waydroid -P ${lxcp} -- /system/bin/ip route add default via ${_gw} dev eth0 proto static table $T 2>/dev/null; done; ` +
        `lxc-attach -n waydroid -P ${lxcp} -- /system/bin/ip route add default via ${_gw} dev eth0 2>/dev/null; true`]).catch(() => undefined);
      await sleep(800);
      // ★DOGRULA: table eth0 (uygulama-trafigi orayi kullanir) GERCEKTEN tuttu mu? netd
      // boot-sonrasi ~2-3dk agresif siler -> "route-added" yanlis-pozitif olurdu. Tutmadiysa
      // healed:false don (sonraki 30s tick tekrar dener; netd sakinleyince kesin tutar).
      const rtOk = await execFileAsync('bash', ['-c', `lxc-attach -n waydroid -P ${lxcp} -- /system/bin/ip route show table eth0 2>/dev/null | grep -c '^default'`]).then((r) => Number(String(r.stdout || '0').trim()) > 0).catch(() => false);
      if (!rtOk) { await eth0HealFail(inst, 'route-netd-sildi'); return { healed: false, reason: 'route-netd-sildi (tekrar denenecek)' }; }
      await ensureInstanceProxy(inst, sub).catch(() => undefined);
      eth0HealOk(inst);
      return { healed: true, ip, reason: 'route-added' };
    }
    // IP YOK → ata + link up + default-route TÜM tablolara (Android fwmark: main/eth0/
    // legacy_system). ★2026-07-27: route SADECE main-tabloya ekleniyordu → cihaz internete
    // ÇIKAMIYORDU (TCP 000, WhatsApp "Couldn't connect"). fwmark tablolarına da ŞART.
    log(`eth0-heal: ${inst} eth0 IPv4 yok → ${ip}/24 atanıyor`);
    await execFileAsync('bash', ['-c',
      `lxc-attach -n waydroid -P ${lxcp} -- /system/bin/ip addr add ${ip}/24 dev eth0 2>/dev/null; ` +
      `lxc-attach -n waydroid -P ${lxcp} -- /system/bin/ip link set eth0 up 2>/dev/null; ` +
      `for T in main local_network eth0; do lxc-attach -n waydroid -P ${lxcp} -- /system/bin/ip route add default via 192.168.${sub}.1 dev eth0 proto static table $T 2>/dev/null; done; ` +
      `lxc-attach -n waydroid -P ${lxcp} -- /system/bin/ip route add default via 192.168.${sub}.1 dev eth0 2>/dev/null; true`]).catch(() => undefined);
    await sleep(1500);
    await execFileAsync(ADB, ['connect', `${ip}:5555`]).catch(() => undefined);
    // ★2026-07-24: eth0-heal sonrası PROXY zincirini de doğrula (operatör isteği:
    // "cihaz geri açılınca proxy'yi de gömsün"). iptables REDIRECT kuralları subnet-bazlı
    // olduğu için eth0-IP değişiminden ETKİLENMEZ — ama redsocks daemon ölmüş ya da
    // REDIRECT kuralı hiç kurulmamış olabilir (proxy'siz = datacenter-IP sızıntısı = ban).
    // Eksikse per-instance saklı config'ten (redsocks-inst-<inst>.conf) yeniden kur.
    await ensureInstanceProxy(inst, sub).catch(() => undefined);
    return { healed: true, ip };
  } catch (e) { return { healed: false, reason: (e && e.message) || 'error' }; }
}

// Bir instance'ın proxy zinciri (redsocks daemon + iptables REDIRECT) canlı mı doğrula;
// değilse saklı per-instance config'ten yeniden kur. eth0-heal + wake sonrası çağrılır
// ki cihaz asla proxy'siz (datacenter-IP'den) çıkıp WhatsApp banına maruz kalmasın.
async function ensureInstanceProxy(inst, sub) {
  const conf = `/etc/redsocks-inst-${inst}.conf`;
  // Saklı config yoksa bu instance'a proxy hiç atanmamış demektir — dokunma.
  const hasConf = await execFileAsync('bash', ['-c', `test -f ${conf} && echo yes || echo no`]).then((r) => String(r.stdout || '').trim() === 'yes').catch(() => false);
  if (!hasConf) return { ok: false, reason: 'no-conf' };
  // redsocks daemon bu config için çalışıyor mu?
  const redsAlive = await execFileAsync('bash', ['-c', `pgrep -f 'redsocks-inst-${inst}.conf' >/dev/null && echo yes || echo no`]).then((r) => String(r.stdout || '').trim() === 'yes').catch(() => false);
  // iptables REDIRECT kuralı bu subnet için var mı?
  const redirOk = await execFileAsync('bash', ['-c', `iptables -t nat -C PREROUTING -s 192.168.${sub}.0/24 -p tcp -j REDIRECT --to-ports $(grep -oE 'local_port = [0-9]+' ${conf} | grep -oE '[0-9]+') 2>/dev/null && echo yes || echo no`]).then((r) => String(r.stdout || '').trim() === 'yes').catch(() => false);
  if (redsAlive && redirOk) return { ok: true, reason: 'already-healthy' };
  // Eksik → wd-proxy.sh saklı config'in kredensiyelleriyle yeniden kur. Config'ten
  // country/login/pass/host/port çıkarıp wd-proxy.sh <inst> <cc> <user> <pass> <host> <port>.
  log(`eth0-heal: ${inst} proxy eksik (redsocks=${redsAlive} redirect=${redirOk}) → yeniden kuruluyor`);
  // ★Config'te İKİ ip/port var: 'local_ip/local_port' (redsocks dinleme) ve upstream
  // 'ip/port' (thordata). Satır-başı (whitespace sonrası) TAM 'ip ='/'port =' yakala —
  // 'local_' önekini dışla, yoksa 0.0.0.0/local_port alınır (upstream yerine).
  const restore = `
    CONF=${conf}
    CC=$(grep -oE 'country-[A-Z]+' $CONF | head -1 | cut -d- -f2)
    USER=$(grep -oE 'login = "[^"]+"' $CONF | head -1 | sed 's/login = "//;s/"//')
    PASS=$(grep -oE 'password = "[^"]+"' $CONF | head -1 | sed 's/password = "//;s/"//')
    PHOST=$(grep -E '^[[:space:]]*ip = ' $CONF | head -1 | grep -oE '[0-9.]+')
    PPORT=$(grep -E '^[[:space:]]*port = ' $CONF | head -1 | grep -oE '[0-9]+')
    [ -n "$CC" ] && [ -n "$USER" ] && [ -n "$PHOST" ] && bash /opt/fleet-agent/waydroid/wd-proxy.sh ${inst} "$CC" "$USER" "$PASS" "$PHOST" "$PPORT" 2>&1 | tail -1
  `;
  const out = await execFileAsync('bash', ['-c', restore], { timeout: 30000 }).then((r) => String(r.stdout || '').trim()).catch((e) => `err:${e && e.message}`);
  log(`eth0-heal: ${inst} proxy restore → ${out || 'ok'}`);
  return { ok: true, reason: 'restored', out };
}

// reconnect all. Only fires on the "majority running-but-unreachable" signal, so it can't
// disrupt a healthy fleet — it recovers an already-broken one.
const ADB_RECOVERY_MS = Number(process.env.FLEET_ADB_RECOVERY_MS || 30000); // check every 30s (internet-cikis netd-silmesini daha hizli toparla)
const ADB_BOUNCE_COOLDOWN_MS = Number(process.env.FLEET_ADB_BOUNCE_COOLDOWN_MS || 5 * 60 * 1000);
// ★★2026-07-28 DNS SELF-HEAL: bir cihaz IP + route + proxy TAM olsa bile DNS'siz kalabilir
// (GERCEK DHCP lease'i alamadiysa). O halde TCP 301 doner, panelde ONLINE gorunur AMA isim
// cozemez -> web.whatsapp.com cozulemez -> WhatsApp kaydi SESSIZCE kirilir. CANLI: 31
// cihazin 9'u bu durumdaydi ve mevcut kontrollerin HICBIRI yakalamiyordu (hepsi IP/route/
// proxy bakiyordu, DNS'e kimse bakmiyordu).
// UCUZ TESPIT: DNS'i yalnizca DHCP getirir -> host-tarafi lease dosyasinda GERCEK bir lease
// (wd-run.sh'in tohumu expiry=4102444800 HARIC) yoksa cihazin DNS'i de yoktur. Dosya okuma;
// ADB/dumpsys maliyeti yok, container yukunden etkilenmez.
// ONARIM (kanitlanmis tek yol — mi12/mi13/mi14/mi19 uzerinde dogrulandi): lease'i .112 ile
// tohumla + container'i yeniden baslat -> Android acilista GERCEK DHCP yapar, DNS gelir.
// GUVENLIK: is yapan cihaza DOKUNMA (busyDevices), provision surerken DOKUNMA
// (provisioningInstances), tick basina EN FAZLA 1 cihaz, ayni cihaz icin en erken 1 saat sonra.
const dnsHealAt = new Map();   // instance -> son onarim zamani
async function dnsSelfHealTick(running) {
  const NOW = Date.now();
  for (const inst of running) {
    if (provisioningInstances.has(inst)) continue;
    const sub = await execFileAsync('bash', ['-c', `sh /opt/fleet-agent/waydroid/net-head.sh ${inst} 2>/dev/null`])
      .then((r) => String(r.stdout || '').trim()).catch(() => '');
    if (!sub) continue;
    // ★★★2026-08-14 ".112 VARSAYIMI" BU KORUMAYI ETKISIZ KILIYORDU.
    // Cihazlarin cogu DHCP'den BASKA adres aliyor (olcum: mi10 = 192.168.6.248).
    // Bu satir sabit ".112" aradigi icin `busyDevices` eslesmesi HIC tutmuyordu ->
    // IS YAPAN cihaz da yeniden baslatiliyordu. Gercek IP ile bak.
    const _ip = await instanceIp(inst);
    if (_ip && busyDevices.has(`${_ip}:5555`)) continue;         // is yapiyor -> dokunma
    if (busyDevices.has(`192.168.${sub}.112:5555`)) continue;    // (eski kayitlar icin geriye donuk)
    const last = dnsHealAt.get(inst) || 0;
    if (NOW - last < 3600000) continue;                          // saatte en fazla 1 kez
    const leaseFile = `/var/lib/misc/dnsmasq.waydroid-${inst}.leases`;
    let hasReal = false;
    try {
      const raw = await readFile(leaseFile, 'utf8');
      for (const line of String(raw).trim().split(String.fromCharCode(10))) {
        const f = line.split(String.fromCharCode(9)).join(' ').trim().split(' ').filter(Boolean);
        if (f[0] !== '4102444800' && f[2] && f[2].startsWith(`192.168.${sub}.`)) { hasReal = true; break; }
      }
    } catch { /* dosya yok -> lease yok */ }
    if (hasReal) continue;                                       // DNS var -> gec
    dnsHealAt.set(inst, NOW);
    log(`dns-heal: ${inst} GERCEK DHCP lease YOK (DNS'siz, WhatsApp kirilir) -> lease tohumla + yeniden baslat`);
    // ★★★2026-08-14 YIGILMA KOK-FIX: ESKI wd-run SARMALAYICISINI DE OLDUR.
    //
    // Eski kod yalnizca `wd-stop.sh` cagiriyordu — o container'i durdurur ama
    // `wd-run.sh` SARMALAYICI SURECI HAYATTA KALIR. Sonra yeni bir `wd-run`
    // baslatiliyor ve UST USTE biniyor. Her dns-heal turu bir kopya daha ekliyor.
    //
    // CANLI FELAKET (14 Agu): 163 dns-heal -> 617 wd-run (155 olmali) -> 398 surec
    // D-state'te kilitlendi -> `kill -9` bile ise yaramadi -> sunucu REBOOT gerekti.
    // Panel "0 cevrimici" gosterdi, tum filo durdu.
    //
    // FIX: yeniden baslatmadan ONCE bu instance'in TUM wd-run PID'lerini oldur.
    // `pgrep -f "wd-run.sh <inst>$"` TAM ESLESME ile (aksi halde "mi10" kalibi
    // mi100/mi105/mi111'i de yakalar — bu hata bugun teshiste de yasandi).
    await execFileAsync('bash', ['-c',
      `for P in $(pgrep -f "wd-run.sh ${inst}$" 2>/dev/null); do kill -9 "$P" 2>/dev/null; done; ` +
      `/opt/fleet-agent/waydroid/wd-stop.sh ${inst} >/dev/null 2>&1; sleep 2; ` +
      `pkill -f "dnsmasq.*waydroid-${inst}" 2>/dev/null; ` +
      `echo "4102444800 00:16:3e:f9:d3:03 192.168.${sub}.112 Pixel-8-Pro 01:00:16:3e:f9:d3:03" > ${leaseFile}; ` +
      `nohup /opt/fleet-agent/waydroid/wd-run.sh ${inst} >/dev/null 2>&1 & true`]).catch(() => undefined);
    return;                                                      // tick basina TEK cihaz
  }
}

// ★★★2026-08-13 KORUMA LISTESI 10,8 DAKIKA GECIKMELIYDI — reap'in ASIL kok nedeni.
//
// Eskiden `liveSubnets`, her instance icin `net-head.sh` calistirilarak kuruluyordu.
// OLCUM (canli, 123 instance): net-head.sh = 5,26 sn/instance -> 647 sn (10,8 DK),
// ustelik SIRALI. Yavasligin kaynagi mkdir-tabanli kilit (betik atomik subnet TAHSISI
// icin tasarlandi; biz sadece MEVCUT degeri OKUYORUZ — kilide hic ihtiyac yok).
// Yeni kurulan cihaz her zaman EN YUKSEK numarali = listenin EN SONUNDA oldugu icin
// kurban SISTEMATIK olarak hep yeni cihazlardi.
//
// Yeni yol iki UCUZ kaynagi birlestirir (olculdu: harita 4 ms, bridge taramasi ~30 ms):
//   1) /var/lib/waydroid-subnets.map — calisan instance'larin kayitli subnetleri
//   2) canli bridge'ler (`ip -o -4 addr`) — harita kaysa/bayatlasa bile gercek durum
// Ikisinin BIRLESIMI kullanilir: biri eksik olsa digeri korur (fail-safe). Ayni
// "haritaya guvenme, canliyi da tara" dersi 12 Agu subnet-cakismasi fix'inden geliyor.
async function liveSubnetsFast(running) {
  const live = new Set();
  const want = new Set(running);
  // 1) harita — TEK okuma, kilitsiz
  try {
    const raw = await readFile('/var/lib/waydroid-subnets.map', 'utf8');
    for (const line of String(raw).split(String.fromCharCode(10))) {
      const f = line.trim().split(/\s+/).filter(Boolean);
      if (f.length >= 2 && want.has(f[0]) && /^\d+$/.test(f[1])) live.add(String(Number(f[1])));
    }
  } catch { /* harita yoksa bridge taramasi devralir */ }
  // 2) canli bridge'ler — 192.168.<sub>.1/24 seklinde host tarafi adresler
  try {
    const { stdout } = await execFileAsync('bash', ['-c',
      "ip -o -4 addr show 2>/dev/null | grep -oE '192[.]168[.][0-9]+[.]1/' | cut -d. -f3"]);
    for (const s of String(stdout || '').split(String.fromCharCode(10))) {
      const t = s.trim();
      if (/^\d+$/.test(t)) live.add(String(Number(t)));
    }
  } catch { /* best-effort */ }
  return live;
}

// Tek-tek uc kurtarmada tur basina denenecek en fazla instance sayisi. Amac: 100+
// cihazlik bir kopusta tick'in uzamamasi (her deneme ~1-2 sn). Kalanlar sonraki
// tur'da denenir — tick 60-90 sn'de bir kostugu icin tum filo birkac turda taranir.
const ADB_RECONNECT_PER_TICK = Number(process.env.FLEET_ADB_RECONNECT_PER_TICK || 12);
// instance -> subnet (net-head.sh ciktisi). eth0-heal dongusu zaten her instance icin
// bu degeri okuyor; tekrar okumamak icin orada doldurulur.
const instSubnetCache = new Map();

// ★2026-08-13 Bir instance'in GERCEK eth0 IP'sini oku (varsayma!). Once DHCP lease
// dosyasindan (ucuz, container'a girmeden), olmazsa container'in kendi `ip addr`
// ciktisindan. Donen deger "192.168.<sub>.<host>" — son oktet .112 OLMAK ZORUNDA DEGIL.
async function instanceIp(inst) {
  try {
    const { stdout } = await execFileAsync('bash', ['-c',
      `lxc-attach -n waydroid -P /var/lib/waydroid.${inst}/lxc -- /system/bin/ip -4 addr show eth0 2>/dev/null `
      + `| grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -1`], { timeout: 12000 });
    const ip = String(stdout || '').trim();
    if (/^192\.168\.\d+\.\d+$/.test(ip)) return ip;
  } catch { /* container kapali/mesgul olabilir */ }
  return null;
}

async function adbRecoveryTick() {
  // Instances actually running on the host (wd-run shells).
  let running = [];
  try {
    const { stdout } = await execFileAsync('bash', ['-c', "pgrep -af 'wd-run.sh' 2>/dev/null | grep -oE 'wd-run.sh mi[0-9]+' | grep -oE 'mi[0-9]+' | sort -u"]);
    running = String(stdout || '').split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { return; }
  // ★2026-07-28: BAYAT adb-uclarini HER tick'te temizle — silinen cihazlarin kalintisi
  // birikip yeni kurulumlari (subnet geri-donusumunde) bogmasin. Operator elle tespit
  // etmek zorunda kalmaz. running listesindeki instance'larin GERCEK subnetleri korunur.
  try {
    const live = await liveSubnetsFast(running);
    if (live.size) await reapStaleAdbEndpoints(live);
    await dnsSelfHealTick(running).catch(() => undefined);
  } catch { /* best-effort */ }
  if (running.length < 3) return; // too small a fleet to judge; skip
  // How many are ADB-reachable right now?
  let reachable = [];
  try { reachable = await reachableSerials(); } catch { return; }

  // ★2026-07-24: ÖNCE per-instance eth0-heal. Çalışıyor ama ADB-erişilemez HER instance
  // için eth0'da IPv4 var mı bak; yoksa ata (adb-server-bounce'tan bağımsız — tek cihazın
  // eth0-IP kaybını çoğunluk-wedge beklemeden düzeltir). reachableSerials "192.168.<sub>.112:5555"
  // döndürür; instance'ın subnet'iyle eşleştiririz.
  // ★★★2026-08-13 ".112 VARSAYIMI" — 23 CIHAZ KURTARMANIN DISINDA KALIYORDU.
  //
  // Burasi (ve asagidaki reconnect dongusu) IP'nin HEP "192.168.<sub>.112" oldugunu
  // varsayiyordu. DHCP baska adres verdiginde varsayim TUTMUYOR:
  //   OLCUM (canli DB): .112 olan 112 cihaz — .112 OLMAYAN 23 cihaz
  //   ornekler: mi255=.156.184  mi256=.159.121  mi244=.47.53  mi265=.167.128
  // Sonuc: bu 23 cihaz "erisilemez" sayiliyor (eth0-heal bosuna kosuyor) ve ADB ucu
  // dustugunde reconnect YANLIS adrese gidiyor -> uc HIC geri baglanmiyor -> panelde
  // sonsuza kadar "Durduruldu". CANLI: mi255 22:24'te elle baglandi, 22:26'da yine
  // dustu ve kimse geri baglamadi; tek `adb connect` ile ANINDA geri geldi.
  // ★Ayni ders 30 Tem (mi46=.47.112 DEGIL) ve 12 Agu (mi244=.53) yazilmisti — kod
  // iki noktada hala varsayiyordu. Artik SUBNET'e bakiyoruz, son okteti DEGIL.
  const reachSubnets = new Set(reachable.map((s) => {
    const m = /192\.168\.(\d+)\.\d+/.exec(String(s));
    return m ? m[1] : null;
  }).filter(Boolean));
  let healedAny = false;
  for (const inst of running) {
    try {
      const { stdout } = await execFileAsync('bash', ['-c', `sh /opt/fleet-agent/waydroid/net-head.sh ${inst} 2>/dev/null`]);
      const sub = String(stdout || '').trim();
      if (!sub) continue;
      instSubnetCache.set(inst, sub);   // tek-tek uc kurtarma bunu kullanir
      // ★2026-07-27: ERİŞİLEBİLİR cihazları da healInstanceEth0'a ver — IP-var-ama-route-YOK
      // durumunu düzeltir (cihaz ADB-reachable ama internete çıkamaz → WhatsApp "Couldn't
      // connect"). healInstanceEth0 IP+route ikisi de tamsa ucuz-geçer ('already-has-ip-and-
      // route'). Erişilemez cihaz da eth0-IP-yok durumunu düzeltir (önceki davranış korunur).
      const r = await healInstanceEth0(inst, reachSubnets.has(sub));
      if (r.healed) { healedAny = true; log(`eth0-heal: ${inst} → ${r.reason || r.ip} onarıldı`); }
    } catch { /* per-instance best-effort */ }
  }
  if (healedAny) {
    // Onarım yaptıysak reachable sayısını tazele — belki artık yeter, bounce gerekmez.
    try { reachable = await reachableSerials(); } catch { /* keep old */ }
  }

  // ★★★2026-08-13 TEK-TEK UC KURTARMA — EN BUYUK BOSLUK BURASIYDI.
  //
  // Eskiden yeniden-baglama YALNIZCA "filonun yarisindan fazlasi erisilemez" olunca
  // (adb server wedge) calisiyordu. TEK bir cihazin ucu dustugunde HICBIR SEY onu geri
  // baglamiyordu -> cihaz panelde sonsuza kadar "Durduruldu" goruluyordu, oysa CANLIYDI.
  // CANLI KANIT: mi255 elle `adb connect` ile ANINDA geri geldi (state=device, boot=1);
  // filo 123/124 saglikli oldugu icin bounce esigi hic tetiklenmiyordu.
  // Simdi: calisan ama ADB'de gorunmeyen HER instance icin ucuz bir `adb connect`
  // denenir (idempotent; zaten bagliysa "already connected" der). Tur basina LIMIT var
  // ki 100+ cihazlik bir kopusta tick uzamasin.
  {
    const missing = running.filter((inst) => {
      const sub = instSubnetCache.get(inst);
      return sub ? !reachSubnets.has(sub) : true;
    });
    let fixed = 0, tried = 0;
    for (const inst of missing) {
      if (tried >= ADB_RECONNECT_PER_TICK) break;
      tried++;
      const ip = await instanceIp(inst);
      if (!ip) continue;
      const serial = `${ip}:5555`;
      await execFileAsync(ADB, ['connect', serial], { timeout: 10000 }).catch(() => undefined);
      const st = await execFileAsync(ADB, ['-s', serial, 'get-state'], { timeout: 6000 })
        .then((r) => String(r.stdout || '').trim()).catch(() => '');
      if (/^device$/.test(st)) { fixed++; log(`adb-reconnect: ${inst} ${serial} geri baglandi`); }
    }
    if (fixed) {
      try { reachable = await reachableSerials(); } catch { /* keep old */ }
    }
  }

  // Signal: many instances up, but fewer than half are ADB-reachable → adb server wedge.
  if (reachable.length >= Math.ceil(running.length / 2)) return; // healthy enough — do nothing
  if (Date.now() - lastAdbBounceAt < ADB_BOUNCE_COOLDOWN_MS) return; // just bounced; give it time
  lastAdbBounceAt = Date.now();
  log(`adb-recovery: ${running.length} instance up but only ${reachable.length} ADB-reachable → bouncing adb server`);
  try {
    await execFileAsync(ADB, ['kill-server']).catch(() => undefined);
    await sleep(1500);
    await execFileAsync(ADB, ['start-server']).catch(() => undefined);
    await sleep(1500);
    // Reconnect every known instance — GERCEK IP ile (bkz. yukaridaki ".112 varsayimi"
    // notu: 23 cihaz DHCP'den baska adres aliyor ve bu dongu onlara YANLIS adrese
    // baglanmaya calisiyordu, yani kurtarma o cihazlarda HIC calismiyordu).
    for (const inst of running) {
      try {
        const ip = await instanceIp(inst);
        if (ip) await execFileAsync(ADB, ['connect', `${ip}:5555`]).catch(() => undefined);
      } catch { /* per-instance best-effort */ }
    }
    log('adb-recovery: server bounced + reconnect issued');
  } catch (e) { log('adb-recovery failed:', e && e.message); }
}
// Push one downscaled thumbnail per parked device. Skips the device that's currently busy
// with a claimed job (the job's own progress/heartbeat covers it), and drops expired
// entries. Best-effort throughout — a frame error never breaks the loop.
async function otpWatchTick() {
  if (otpWatch.size === 0) return;
  const now = Date.now();
  for (const [serial, w] of otpWatch) {
    if (now > w.until) { otpWatch.delete(serial); continue; }
    if (busyDevices.has(serial) || otpCapturing.has(serial)) continue; // a job or a prior capture owns this device
    // TOCTOU guard (ORCH-2): the busy-check and the ~8s grabPng below are far apart —
    // a job could claim this device in between and run screencap/input CONCURRENTLY
    // with ours (torn/timeout frame → wrong-coordinate taps downstream). Mark the
    // device as capturing in a SEPARATE set (not busyDevices, so we never accidentally
    // clear a job's lock) that the dispatcher also honours before starting a job.
    otpCapturing.add(serial);
    try {
      // Re-check: a job may have claimed the device just before we set the flag.
      if (busyDevices.has(serial)) continue;
      // ★WALL-WHILE-PARKED (VERIFIED LIVE, mi20 +355): WhatsApp can flip the OTP screen
      // into CustomRegistrationBlockActivity ("Download the official WhatsApp") AFTER we
      // parked at OTP_WAIT. The operator then waits forever for an SMS that never comes.
      // While we're here taking a thumbnail anyway, check the foreground activity — if the
      // hard block is up, report FAILED (DEVICE_WALL) and stop watching this device so the
      // panel shows the real reason instead of a frozen "SMS bekleniyor".
      const top = await adb(serial, ['shell', 'dumpsys', 'activity', 'activities']).catch(() => '');
      if (/CustomRegistrationBlock|registration\.app\.parole/i.test(top)) {
        await reportProgress(w.jobId, 'device_wall', 100, '⛔ WhatsApp kaydı engellendi ("resmi uygulama" duvarı) — numara/cihaz reddedildi', 'FAILED', { accountId: w.accountId }).catch(() => undefined);
        otpWatch.delete(serial);
        continue;
      }
      const png = await grabPng(serial, 8000).catch(() => null);
      if (!png) continue;
      const thumb = await shrinkPng(png, 300).catch(() => null);
      if (thumb) {
        // note '🎥 canlı' → the API/panel treat it as a heartbeat frame (does NOT clobber
        // the parked-state OTP prompt note; see wa-register.service isHeartbeatFrame).
        await reportProgress(w.jobId, 'otp_wait', 85, '🎥 canlı', undefined, { accountId: w.accountId, shot: thumb }).catch(() => undefined);
      }
    } catch { /* best-effort */ }
    finally { otpCapturing.delete(serial); }
  }
}

// Run ONE claimed job to completion in isolation. NEVER throws — every failure is
// caught and reported as a FAILED job, so one device's crash/timeout can't break the
// dispatch loop or any other device's job. Marks the device busy for the duration
// (per-device serialisation + stream/inbox yielding) and always frees it in finally.
// `waitForDevice`: if the device is momentarily busy (rare claim race), wait for it
// to free before starting, so same-device jobs never overlap.
async function runJobTask(job, waitForDevice) {
  const serial = job.serial || null;
  const isProvision = job.type === 'PROVISION_DEVICE';
  if (serial && waitForDevice) {
    // Bounded wait for the device to free (max ~2 min); if it never frees, run anyway
    // rather than stranding the job (the API reaper would otherwise fail it). Also wait
    // out an in-flight otpWatch screencap (otpCapturing) so we don't start ADB work
    // while a capture is mid-flight on the same serial (ORCH-2).
    for (let i = 0; i < 240 && (busyDevices.has(serial) || otpCapturing.has(serial)); i++) await sleep(500);
  }
  // ★PROVISION boot-stagger (#3/#9): wait for a provision slot before booting so a big
  // batch doesn't spike CPU by booting every instance at once. Bounded (~10 min) so a
  // wedged provision can't strand the rest; light jobs never enter this gate.
  if (isProvision) {
    // ★2026-07-23 (P-3): wait for BOTH a provision slot AND acceptable host load. Booting
    // when the CPU is GENUINELY saturated (< PROVISION_IDLE_MIN% real idle) just deepens
    // the storm; hold until there's headroom. Gates on REAL CPU idle from /proc/stat, NOT
    // load-average (which lies on Waydroid — 34K sleeping threads inflate it to ~98 while
    // the CPU is 47% idle; the old load-gate blocked boots even with half the cores free).
    // Bounded ~10min so a stuck host can't strand a provision forever (proceeds after the
    // cap rather than failing outright). The idle check samples /proc/stat over ~250ms;
    // the loop cadence is that sample, so we re-measure roughly every ~250ms while waiting.
    for (let i = 0; i < 2400 && (activeProvisionCount >= MAX_CONCURRENT_PROVISIONS || !(await hasBootHeadroom())); i++) {
      if (activeProvisionCount >= MAX_CONCURRENT_PROVISIONS) await sleep(500); // slot-bound: cheap wait
    }
    activeProvisionCount++;
  }
  if (serial) busyDevices.add(serial);
  activeJobCount++;
  // Declared at function scope (not inside try) so the finally can await it: tracks an
  // abandoned (timed-out) runJob whose ADB work is still in flight.
  let pendingSettle = null;
  try {
    log(`claimed job ${job.id} (${job.type}) -> ${serial ?? 'no-serial'} [active=${activeJobCount}]`);
    // ── Automatic retry for TRANSIENT device errors ──────────────────────────
    // On this GPU-less Waydroid host, a device's Android session occasionally
    // restarts (libprocessgroup kills the cgroup) and for a few seconds its system
    // services vanish → ADB returns "Can't find service: activity/input" or a step
    // ANRs. The device recovers on its own within seconds. VERIFIED LIVE (21:52-55).
    // Without retry these surfaced as a hard FAILED and the message was lost — the
    // #1 gap for the multi-user, always-on usage this fleet is built for. So: retry
    // idempotent, safe-to-repeat job types a couple of times with a short backoff.
    // We do NOT retry stateful flows (register/provision) — replaying them mid-flow
    // could double-act; those keep their single-shot semantics.
    const RETRYABLE_TYPES = new Set([
      'WHATSAPP_SEND', 'WHATSAPP_SEND_MEDIA', 'WHATSAPP_READ', 'WHATSAPP_PROFILE',
      'WHATSAPP_BLOCK', 'WHATSAPP_BLOCKLIST', 'WHATSAPP_MYNUMBER',
      // TELEGRAM_SEND confirms delivery (compose box cleared) before returning SENT,
      // and a transient session-restart mid-open leaves the draft un-sent, so a retry
      // re-opens the chat cleanly rather than double-posting. Same safety as WA send.
      'TELEGRAM_SEND'
    ]);
    const isTransient = (msg) => /Can't find service|not found|device offline|closed|no devices|ANR|isn.t responding|zaman aşımı|timed out|Connection reset|protocol fault/i.test(String(msg || ''));
    const MAX_TRIES = RETRYABLE_TYPES.has(job.type) ? 3 : 1;

    let result;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      // Wall-clock cap: a hung job (WhatsApp ANR etc.) rejects here instead of
      // occupying its slot forever.
      const t = withJobTimeout(job.type, runJob(job));
      try {
        result = await t.raced;
        lastErr = null;
        break;
      } catch (err) {
        // If the wall-clock cap fired, the underlying runJob is STILL RUNNING and may
        // still be issuing ADB commands to this device. Remember its settle promise so
        // the finally holds the device busy until it finishes — otherwise the next job
        // for this serial would run concurrent ADB against a half-finished flow.
        if (t.state.timedOut) pendingSettle = t.settled;
        lastErr = err;
        if (attempt < MAX_TRIES && isTransient(err.message)) {
          const backoff = 2500 * attempt; // 2.5s, 5s — give the session time to recover
          log(`job ${job.id} transient fail (try ${attempt}/${MAX_TRIES}): ${err.message} — retry in ${backoff}ms`);
          await sleep(backoff);
          if (serial) await ensureConnected(serial).catch(() => undefined); // re-establish ADB
          continue;
        }
        throw err; // non-transient, or out of tries
      }
    }
    if (lastErr) throw lastErr;
    await reportComplete(job.id, 'COMPLETED', { result });
    log(`completed ${job.id} [active=${activeJobCount - 1}]`);
  } catch (err) {
    log(`job ${job.id} failed:`, err.message);
    try {
      await reportComplete(job.id, 'FAILED', { error: err.message });
    } catch (reportErr) {
      log('failed to report failure:', reportErr.message);
    }
  } finally {
    // If a wall-clock timeout abandoned a runJob mid-flight, its ADB work may still be
    // touching this device. Hold the device BUSY until that settles (bounded cap) before
    // releasing the serial — otherwise the next job for the same serial runs concurrent
    // screencap/input against a half-finished flow → screen-state corruption (fake-SENT,
    // wrong-screen taps). Bounded so a truly-wedged runJob can't hold the slot forever.
    if (pendingSettle) {
      const SETTLE_CAP_MS = 20000;
      try { await Promise.race([pendingSettle, sleep(SETTLE_CAP_MS)]); } catch { /* settle rejected — fine, it's done */ }
    }
    if (serial) busyDevices.delete(serial);
    activeJobCount--;
    if (isProvision) activeProvisionCount--;
  }
}

// ── SELF-WATCHDOG ────────────────────────────────────────────────────────────
// systemd's Restart=always only catches a process that EXITS/crashes. It cannot see a
// process that is alive but WEDGED — the dispatch loop stuck on a hung await (a dead
// ADB socket, a proxy blackhole, a never-resolving fetch). That silent freeze is the
// worst failure mode: the agent looks "active" to systemd while claiming/running no
// jobs, so every device it owns quietly stops working until someone notices.
// Fix: the loop stamps loopAlive every iteration; a separate timer checks that the
// stamp is fresh. If the loop hasn't ticked for WATCHDOG_STALL_MS, we exit(1) so
// systemd restarts us clean. The timer runs on its own — a wedged loop can't block it.
let loopAlive = Date.now();
const WATCHDOG_STALL_MS = 5 * 60 * 1000; // no loop progress for 5 min = wedged
const watchdog = setInterval(() => {
  const stalled = Date.now() - loopAlive;
  if (stalled > WATCHDOG_STALL_MS) {
    log(`WATCHDOG: dispatch loop wedged ${Math.round(stalled / 1000)}s (no progress) — exiting for systemd restart`);
    process.exit(1);
  }
}, 30_000);
watchdog.unref?.();

async function loop() {
  log(`starting — polling ${API_URL} every ${POLL_MS}ms (max ${MAX_CONCURRENT_JOBS} concurrent)`);
  await heartbeat();
  // ★2026-07-23 (S-1): ORPHAN RECOVERY on startup. If we crashed/were restarted mid-run,
  // the jobs we had claimed sit RUNNING in the DB with no worker. Tell the API to release
  // them NOW (retryable → re-queued, stateful → failed) so devices free immediately instead
  // of waiting 4-15min for the reaper. Best-effort: a failure here just falls back to the
  // reaper. Falls back silently on an older API (404).
  try {
    // No body — the API's signature check treats an empty {} body as '' (see
    // agent.signature.ts hasBody), so we must sign '' too: send NO body at all.
    const { data } = await api('/agent/jobs/abandon-claimed', { method: 'POST' }, { timeoutMs: 10000 });
    if (data && (data.requeued || data.failed)) log(`orphan-recovery: ${data.requeued} re-queued, ${data.failed} failed`);
  } catch (err) {
    if (!/->\s*404\b/.test(String(err && err.message))) log('orphan-recovery skipped:', err.message);
  }
  const hb = setInterval(heartbeat, HEARTBEAT_MS);
  // WhatsApp inbound-message poll (notification-based). Best-effort; failures
  // are logged and never block the job loop. Gated on jobBusy so it never contends
  // with a running job on the same device.
  const waInbox = WA_INBOX_ENABLED ? setInterval(() => { whatsappInboxTick().catch(() => undefined); }, WA_INBOX_MS) : null;
  // Media auto-capture poll (opt-in via FLEET_WA_CAPTURE=1) — reports new media files
  // the moment they land, before a view-once is opened or a message deleted.
  const waCapture = WA_CAPTURE_ENABLED ? setInterval(() => { mediaCaptureTick().catch(() => undefined); }, WA_CAPTURE_MS) : null;
  // ★OTONOM WA SAĞLIK TARAMASI: ban/kısıt artık yalnızca gönderim sırasında değil,
  // kendiliğinden de yakalanır (bkz. waHealthTick). Tur başına birkaç cihaz.
  const waHealth = WA_HEALTH_ENABLED ? setInterval(() => { waHealthTick().catch(() => undefined); }, WA_HEALTH_MS) : null;
  // ★OTP-WATCH ticker: keeps the panel's live thumbnail fresh for devices parked at OTP_WAIT.
  const otpWatchT = setInterval(() => { otpWatchTick().catch(() => undefined); }, OTP_WATCH_MS);
  // ★EULA-STUCK REAPER: force-stops WhatsApp on devices abandoned on the registration/EULA
  // screen (60fps software spinner = 3-4 wasted cores each). Skips devices with a live job.
  const eulaReaperT = setInterval(() => { eulaReaperTick().catch(() => undefined); }, EULA_REAPER_MS);
  // ★ORPHAN-INSTANCE REAPER: destroys Waydroid instances running on the host but no longer
  // in the DB (a delete whose DEVICE_DESTROY was lost, or a legacy pre-destroy delete).
  const orphanReaperT = setInterval(() => { orphanReaperTick().catch(() => undefined); }, ORPHAN_REAPER_MS);
  // ★ADB-server recovery: bounces a wedged adb server when the fleet is running but
  // unreachable (the "all devices offline" incident, now self-healing).
  const adbRecoveryT = setInterval(() => { adbRecoveryTick().catch(() => undefined); }, ADB_RECOVERY_MS);
  startStreamClient();

  // Dispatch loop: claim jobs and run them CONCURRENTLY across devices, up to
  // MAX_CONCURRENT_JOBS. Each job runs in its own isolated task (runJobTask) that
  // NEVER throws — a crash/timeout on one device can't touch another. Same-device
  // serialisation is enforced two ways: the API's exclusive-job guard won't hand out
  // a second job for a busy device, AND we skip claiming for a serial already in
  // busyDevices (defensive). Built for 100s of devices: bounded parallelism +
  // per-device isolation + guaranteed cleanup.
  while (!stopping) {
    loopAlive = Date.now(); // watchdog heartbeat: proves the dispatch loop is progressing
    // Backpressure: at the concurrency cap → wait for a slot to free instead of
    // piling up claims. Keeps host ADB/CPU from being swamped by a burst.
    if (activeJobCount >= MAX_CONCURRENT_JOBS) {
      await sleep(POLL_MS);
      continue;
    }

    // Claim as many jobs as we have free slots for, in ONE round-trip (batch),
    // instead of one poll per job. This is the poll-Hz bottleneck fix: a burst of
    // N light jobs now drains in ⌈N/slots⌉ round-trips, not N. Each claimed job is
    // still dispatched fire-and-forget below (true per-device parallelism).
    const freeSlots = Math.max(1, MAX_CONCURRENT_JOBS - activeJobCount);
    let jobs = [];
    try {
      jobs = await claimBatch(Math.min(freeSlots, 12));
    } catch (err) {
      log('claim failed:', err.message);
      await sleep(POLL_MS * 2);
      continue;
    }

    if (!jobs.length) {
      await sleep(POLL_MS);
      continue;
    }

    for (const job of jobs) {
    // ★PROVISION boot-stagger (#3/#9): a provision boots a full Android → CPU spike. If
    // we're already at the provision cap, don't start another boot right now. runJobTask
    // waits for a provision slot (not the whole job cap) before booting, so a batch of 10
    // provisions boots ~MAX_CONCURRENT_PROVISIONS at a time instead of all at once — fast
    // AND stable. Light jobs (send/read) are unaffected and keep filling the global cap.
    // (waitForProvisionSlot is handled inside runJobTask so the loop never blocks.)

    // Defensive same-device guard: if we somehow claimed a job for a device that's
    // already running one (shouldn't happen — API guards it — but claim races or a
    // non-exclusive job type could), run it AFTER the current one by re-queuing the
    // claim intent. Simplest safe behaviour: skip the dispatch this tick; the job
    // stays RUNNING (claimed) and we execute it once the device frees. To avoid
    // losing it, we execute inline-serialised only for the same device.
    if (job.serial && busyDevices.has(job.serial)) {
      // Rare: execute it but wait for the device to free first (serialise on-device).
      // Do NOT block the whole loop — spawn a waiter task. ORCH-3: cap outstanding
      // same-device waiters so a wedged device can't accumulate a pile of 120s
      // busy-waiters (the API has no per-serial exclusivity, so claim races here are
      // routine). If one is already waiting for this serial, drop this claim — the API
      // reaper re-queues it, and we avoid unbounded slot/CPU consumption.
      if (sameDeviceWaiters.has(job.serial)) {
        await sleep(POLL_MS);
        continue;
      }
      sameDeviceWaiters.add(job.serial);
      void runJobTask(job, /*waitForDevice*/ true).finally(() => sameDeviceWaiters.delete(job.serial));
      continue;
    }

    // Fire-and-forget: start the job task WITHOUT awaiting so the loop immediately
    // goes back to claim the NEXT job (for a DIFFERENT device) → true parallelism.
    void runJobTask(job, false);
    } // end for (job of this batch)
  }

  // Graceful drain: let in-flight jobs finish (bounded wait) before tearing down.
  // ★2026-07-23: cap at 8s (was 30s). systemd TimeoutStopSec=15 SIGKILLs us if we drain
  // longer — a 30s drain made every restart hang ~90s and sometimes left the unit
  // 'failed' (VERIFIED this session). 8s lets a quick job finish; anything still RUNNING
  // is re-queued by the API's stale-job reaper, so nothing is lost.
  for (let i = 0; i < 16 && activeJobCount > 0; i++) await sleep(500);

  clearInterval(hb);
  if (waInbox) clearInterval(waInbox);
  if (waCapture) clearInterval(waCapture);
  clearInterval(otpWatchT);
  clearInterval(eulaReaperT);
  clearInterval(orphanReaperT);
  clearInterval(adbRecoveryT);
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
