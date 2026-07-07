import crypto from 'node:crypto';
import { env } from '../config/env';

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function createKeyPair(prefixLabel: string): { plain: string; prefix: string; hash: string } {
  const secret = crypto.randomBytes(32).toString('hex');
  const prefix = crypto.randomBytes(8).toString('hex');
  const plain = `${prefixLabel}_${prefix}.${secret}`;
  return {
    plain,
    prefix,
    hash: sha256(plain)
  };
}

// ---------------------------------------------------------------------------
// Versioned, key-rotation-aware envelope encryption
// ---------------------------------------------------------------------------
//
// WIRE FORMAT
//   Legacy / v0 (backward-compatible):  base64(iv[12] | tag[16] | ciphertext)
//     - No prefix. Every row written before this change looks like this.
//     - Decrypted with SOCIAL_KEY (the single historical key).
//   v1+ (rotation-aware):               "k<keyId>:" + base64(iv[12] | tag[16] | ct)
//     - The "k<id>:" ASCII prefix is unambiguous: base64 output NEVER contains
//       a ':' character, so presence of ':' means "new format" and its absence
//       means "legacy". keyId is a short opaque id from ENCRYPTION_KEYS.
//     - The leading 'k' is LITERAL and separate from the id, so a key id of
//       "1" produces prefix "k1:" and a key id of "2026a" produces "k2026a:".
//       (Naming an id "k2" would yield the harmless-but-ugly "kk2:"; prefer
//       ids like "1"/"2"/"2026q3".)
//
// KEY REGISTRY
//   - Historical single key ("legacy"): SOCIAL_KEY = socialCryptoKey ?? jwtAccessSecret.
//     This is ALWAYS registered so pre-existing rows keep reading. Its AES key is
//     derived exactly as before: sha256(SOCIAL_KEY).
//   - Optional rotation keys via env.encryptionKeys (id -> secret map). Each id's
//     AES key is sha256(secret), same KDF, so a rotation key can equal SOCIAL_KEY.
//   - env.encryptionActiveKeyId selects which key NEW encryptions use. If unset,
//     new writes use the legacy key WITHOUT a prefix -> byte-identical to the old
//     behavior (fully backward-compatible when no rotation env is configured).
//
// ROTATION MODEL
//   1. Add a new key to ENCRYPTION_KEYS (e.g. {"k2":"<64+ hex>"}).
//   2. Set ENCRYPTION_ACTIVE_KEY_ID=k2 and redeploy. New writes -> "k2:...".
//   3. Old rows (legacy or "k1:") still decrypt because every registered key is
//      tried on read, selected by the row's own prefix.
//   4. Optionally run the re-encrypt tool (scripts/rotate-encryption.ts) to lift
//      old rows onto the active key. Once nothing references an old key, retire it.
//
// GUARANTEE: decryptString accepts BOTH formats and safeDecrypt additionally
// tolerates raw plaintext. No existing row can become unreadable by this change.

const LEGACY_KEY_ID = 'legacy';
const SOCIAL_KEY = env.socialCryptoKey ?? env.jwtAccessSecret;

/** Derive a 32-byte AES key from a secret. Identical KDF for every key id so a
 *  rotation key may reuse the legacy secret and stays compatible. */
function deriveAesKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

/** id -> raw secret. Legacy is always present; env rotation keys are layered on. */
function buildKeyRegistry(): Map<string, string> {
  const reg = new Map<string, string>();
  reg.set(LEGACY_KEY_ID, SOCIAL_KEY);
  for (const [id, secret] of Object.entries(env.encryptionKeys)) {
    if (id && secret) reg.set(id, secret);
  }
  return reg;
}

const KEY_REGISTRY = buildKeyRegistry();

// Cache derived AES keys (KDF is cheap but this runs on every crypto op).
const AES_KEY_CACHE = new Map<string, Buffer>();
function aesKeyFor(keyId: string): Buffer | undefined {
  const cached = AES_KEY_CACHE.get(keyId);
  if (cached) return cached;
  const secret = KEY_REGISTRY.get(keyId);
  if (!secret) return undefined;
  const key = deriveAesKey(secret);
  AES_KEY_CACHE.set(keyId, key);
  return key;
}

/** Which key id new encryptions use. When ENCRYPTION_ACTIVE_KEY_ID is unset (or
 *  points at "legacy"), we emit the historical prefix-less format for maximum
 *  compatibility. Otherwise we emit "k<id>:" + payload. */
function activeKeyId(): string | null {
  const id = env.encryptionActiveKeyId;
  if (!id || id === LEGACY_KEY_ID) return null; // legacy, prefix-less
  if (!KEY_REGISTRY.has(id)) {
    // Misconfigured active id: fail closed to legacy so we never write with an
    // unknown key that could not be read back.
    return null;
  }
  return id;
}

function aesGcmEncrypt(plain: string, key: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function aesGcmDecrypt(blob: Buffer, key: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const encrypted = blob.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Encrypt with the active key. Signature UNCHANGED (string -> string). */
export function encryptString(plain: string): string {
  const id = activeKeyId();
  if (id === null) {
    // Legacy, prefix-less format — byte-compatible with the original impl.
    const key = aesKeyFor(LEGACY_KEY_ID)!;
    return aesGcmEncrypt(plain, key).toString('base64');
  }
  const key = aesKeyFor(id)!;
  return `k${id}:${aesGcmEncrypt(plain, key).toString('base64')}`;
}

/** Split a stored value into (keyId, base64Payload). base64 never contains ':',
 *  so the first ':' unambiguously delimits the "k<id>:" prefix. Returns the
 *  legacy key id when there is no prefix. */
function parseEnvelope(enc: string): { keyId: string; payload: string } {
  const colon = enc.indexOf(':');
  if (colon > 0 && enc[0] === 'k') {
    return { keyId: enc.slice(1, colon), payload: enc.slice(colon + 1) };
  }
  return { keyId: LEGACY_KEY_ID, payload: enc };
}

/** Decrypt either format. Signature UNCHANGED (string -> string).
 *  Selects the key by the value's own prefix; falls back to trying every
 *  registered key so a value that lost/malformed its prefix (or was written
 *  under a since-renamed id) can still be recovered. Throws only when NO key
 *  works — same throwing contract the original had. */
export function decryptString(enc: string): string {
  const { keyId, payload } = parseEnvelope(enc);
  const blob = Buffer.from(payload, 'base64');

  // 1) Try the key the value claims.
  const primary = aesKeyFor(keyId);
  if (primary) {
    try {
      return aesGcmDecrypt(blob, primary);
    } catch {
      /* fall through to exhaustive attempt */
    }
  }

  // 2) Exhaustive fallback across all registered keys (rotation-safe recovery).
  for (const id of KEY_REGISTRY.keys()) {
    if (id === keyId) continue;
    const key = aesKeyFor(id);
    if (!key) continue;
    try {
      return aesGcmDecrypt(blob, key);
    } catch {
      /* try next */
    }
  }

  throw new Error('decryptString: no registered key could decrypt the value');
}

// Backward-compatible decrypt: for columns that were rolled out as plaintext and
// are now encrypted-at-rest, existing rows still hold raw plaintext. Try to
// decrypt; if it isn't a valid AES-256-GCM blob (legacy plaintext, wrong key,
// tampered), fall back to returning the value unchanged so old data still reads.
// Use ONLY on such migrated-in-place columns — never to silently swallow a
// genuine decrypt failure on a field that must be encrypted.
export function safeDecrypt(value: string): string {
  if (!value) return value;
  try {
    return decryptString(value);
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------
// Re-encryption helper (used by scripts/rotate-encryption.ts)
// ---------------------------------------------------------------------------

/** True when a stored value is NOT already under the active key — i.e. it would
 *  benefit from re-encryption during a rotation sweep. */
export function needsReEncryption(enc: string): boolean {
  if (!enc) return false;
  const active = activeKeyId();
  const { keyId } = parseEnvelope(enc);
  if (active === null) return keyId !== LEGACY_KEY_ID; // active is legacy
  return keyId !== active;
}

/** Decrypt (any format) then re-encrypt under the active key. Safe on values
 *  that are already current (returns an equivalent fresh envelope). Returns the
 *  input unchanged when it cannot be decrypted (mirrors safeDecrypt's tolerance,
 *  so a rotation sweep never destroys an unreadable-but-real value). */
export function reEncryptString(enc: string): string {
  if (!enc) return enc;
  let plain: string;
  try {
    plain = decryptString(enc);
  } catch {
    return enc; // don't touch values we can't decrypt
  }
  return encryptString(plain);
}

// ---------------------------------------------------------------------------
// Envelope-per-workspace (SCAFFOLD ONLY — not yet wired into call sites)
// ---------------------------------------------------------------------------
//
// The functions above use one active key for the whole deployment. A stronger
// model gives each workspace its own Data Encryption Key (DEK) that is itself
// encrypted with a Master/Key-Encryption-Key (KEK) and stored per-workspace.
// Compromise of one workspace's DEK then exposes only that workspace.
//
// To adopt WITHOUT touching every call site, the plan is:
//   1. Add a Workspace.dekCiphertext column (KEK-encrypted random 32-byte DEK).
//   2. On first use, generate a DEK: crypto.randomBytes(32); store
//      encryptString(dek.toString('base64')) (KEK = the active key above).
//   3. deriveWorkspaceKey(workspaceId) loads + KEK-decrypts that DEK (cached).
//   4. Add encryptForWorkspace(workspaceId, plain) / decryptForWorkspace(...)
//      that use the DEK, and migrate call sites incrementally. The version
//      prefix can carry the workspace/DEK id (e.g. "w<workspaceId>:") so mixed
//      global- and workspace-scoped ciphertext coexist during migration.
//
// deriveWorkspaceKey is intentionally left unimplemented here (needs a DB read,
// which crypto.ts must stay free of). Below is the pure-crypto seam it would use:

/** Pure-crypto seam for envelope encryption. Given a workspace's decrypted DEK
 *  (raw bytes), produce/consume ciphertext bound to that DEK. No DB access here
 *  by design; the caller supplies the DEK (loaded + KEK-decrypted elsewhere).
 *  NOTE: not yet used by any module — provided so the DB/access layer can adopt
 *  envelope encryption without reworking this file. */
export function encryptWithDek(plain: string, dek: Buffer): string {
  return aesGcmEncrypt(plain, dek).toString('base64');
}
export function decryptWithDek(enc: string, dek: Buffer): string {
  return aesGcmDecrypt(Buffer.from(enc, 'base64'), dek);
}
/** Generate a fresh 32-byte DEK for a new workspace (envelope encryption). */
export function generateDek(): Buffer {
  return crypto.randomBytes(32);
}
