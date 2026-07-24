// ★2026-07-24: security-boundary unit tests. Zero new deps — Node's built-in `node:test`
// runner + tsx (already installed). These lock down the two functions whose regression
// silently breaks a security boundary that tsc CANNOT catch:
//   1. crypto envelope round-trip — a break makes encrypted secrets unreadable, or worse,
//      makes safeDecrypt return ciphertext as if it were plaintext.
//   2. getWorkspaceId precedence — a reorder/null here reopens the cross-tenant IDOR that
//      multiple past audits closed.
// Run with: npm test  (from apps/api). CI runs it on every push.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// crypto.ts reads env at import time, so set the key BEFORE importing it. We load the
// modules inside a before() hook (dynamic import) so this runs first without a top-level
// await (unsupported in the CJS transform tsx uses here).
let crypto: typeof import('../src/lib/crypto');
let ws: typeof import('../src/lib/workspaceContext');

before(async () => {
  process.env.SOCIAL_CRYPTO_KEY = process.env.SOCIAL_CRYPTO_KEY || 'test-key-0123456789abcdef0123456789abcdef';
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-jwt-secret-for-unit-tests-only-000';
  crypto = await import('../src/lib/crypto');
  ws = await import('../src/lib/workspaceContext');
});

test('crypto: encrypt→decrypt round-trips exactly', () => {
  for (const s of ['hello', '', 'çğ-ünïcode-🔒', '12345678', 'a'.repeat(4096)]) {
    assert.equal(crypto.decryptString(crypto.encryptString(s)), s, `round-trip failed for: ${JSON.stringify(s).slice(0, 30)}`);
  }
});

test('crypto: two encryptions of the same value differ (random IV)', () => {
  const a = crypto.encryptString('same');
  const b = crypto.encryptString('same');
  assert.notEqual(a, b, 'ciphertexts must differ — a fixed IV would leak equality');
  assert.equal(crypto.decryptString(a), 'same');
  assert.equal(crypto.decryptString(b), 'same');
});

test('crypto: decryptString throws on tampered/garbage input (never silently wrong)', () => {
  const enc = crypto.encryptString('secret');
  const tampered = enc.slice(0, -4) + 'AAAA'; // corrupt the tail
  assert.throws(() => crypto.decryptString(tampered), 'a corrupted ciphertext MUST throw, not decrypt to junk');
});

test('crypto: safeDecrypt returns plaintext unchanged, decrypts real ciphertext', () => {
  // A value that was never encrypted (legacy plaintext row) must pass through as-is…
  assert.equal(crypto.safeDecrypt('plain-legacy-value'), 'plain-legacy-value');
  // …and a real ciphertext must decrypt.
  assert.equal(crypto.safeDecrypt(crypto.encryptString('encd')), 'encd');
});

test('crypto: sha256 is stable + hex', () => {
  assert.match(crypto.sha256('x'), /^[0-9a-f]{64}$/);
  assert.equal(crypto.sha256('x'), crypto.sha256('x'));
  assert.notEqual(crypto.sha256('x'), crypto.sha256('y'));
});

// ── getWorkspaceId: the cross-tenant IDOR chokepoint ────────────────────────
// Minimal fake Request; only the two fields the function reads.
const fakeReq = (auth?: { workspaceId?: string }, apiKey?: { workspaceId?: string }) =>
  ({ auth, apiKey } as unknown as Parameters<typeof import('../src/lib/workspaceContext').getWorkspaceId>[0]);

test('getWorkspaceId: JWT workspace wins over API-key workspace', () => {
  assert.equal(ws.getWorkspaceId(fakeReq({ workspaceId: 'ws-jwt' }, { workspaceId: 'ws-key' })), 'ws-jwt');
});

test('getWorkspaceId: falls back to API-key workspace when no JWT', () => {
  assert.equal(ws.getWorkspaceId(fakeReq(undefined, { workspaceId: 'ws-key' })), 'ws-key');
});

test('getWorkspaceId: returns undefined for a service key with no workspace (never leaks all tenants)', () => {
  // A global/bootstrap key (workspaceId undefined) MUST yield undefined — NOT some
  // default workspace — so a workspace-scoped query gets no rows rather than every tenant's.
  assert.equal(ws.getWorkspaceId(fakeReq(undefined, {})), undefined);
  assert.equal(ws.getWorkspaceId(fakeReq(undefined, undefined)), undefined);
  assert.equal(ws.getWorkspaceId(fakeReq(undefined, { workspaceId: undefined })), undefined);
});
