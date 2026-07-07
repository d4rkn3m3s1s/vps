/**
 * Encryption key-rotation sweep.
 * ---------------------------------------------------------------------------
 * Re-encrypts every encrypted column onto the CURRENTLY ACTIVE key
 * (ENCRYPTION_ACTIVE_KEY_ID). Read each value, decrypt with whatever key wrote
 * it (any registered key — including the historical "legacy" key), then write it
 * back under the active key using reEncryptString().
 *
 * SAFETY
 *   - reEncryptString() returns the input UNCHANGED when it cannot decrypt a
 *     value, so plaintext-legacy or already-current rows are never destroyed.
 *   - needsReEncryption() lets us skip rows that are already on the active key,
 *     so the sweep is idempotent and cheap to re-run.
 *   - Use --dry-run to count what WOULD change without writing.
 *
 * TYPICAL ROTATION
 *   1. Add the new key:      ENCRYPTION_KEYS='{"k1":"<old>","k2":"<new 32+ chars>"}'
 *   2. Activate it:          ENCRYPTION_ACTIVE_KEY_ID=k2
 *   3. Deploy (new writes now use k2; old rows still read via k1/legacy).
 *   4. Run this sweep:       npm run rotate:encryption
 *      (or dry-run first:    npm run rotate:encryption -- --dry-run)
 *   5. Once the sweep reports 0 remaining, the old key can be retired from
 *      ENCRYPTION_KEYS on the next deploy.
 *
 * USAGE
 *   npm run rotate:encryption            # apply
 *   npm run rotate:encryption -- --dry-run
 *
 * NOTE: This intentionally uses generic Prisma model access so adding a new
 * encrypted column only requires one line in ENCRYPTED_COLUMNS below.
 */
import { PrismaClient } from '@prisma/client';
import { needsReEncryption, reEncryptString } from '../src/lib/crypto';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Every encrypted-at-rest column, grouped by Prisma model. `model` is the
 * delegate name on PrismaClient (camelCase). `columns` are the string fields
 * holding AES-GCM ciphertext (or, for a few migrated-in-place columns, possibly
 * legacy plaintext — reEncryptString handles both).
 */
const ENCRYPTED_COLUMNS: Array<{ model: string; columns: string[] }> = [
  { model: 'cloudPhoneProvider', columns: ['apiKeyEnc', 'apiSecretEnc'] },
  { model: 'user', columns: ['twoFactorSecret'] },
  { model: 'notificationChannel', columns: ['configEnc'] },
  { model: 'workspaceSettings', columns: ['vastApiKey'] },
  // Fingerprint identity fields are read via safeDecrypt (plaintext-tolerant).
  { model: 'deviceFingerprint', columns: ['imei', 'androidId', 'serialNo', 'macAddress', 'phoneNumber'] },
  { model: 'socialAccount', columns: ['accessTokenEnc', 'refreshTokenEnc'] },
  { model: 'farmAccount', columns: ['passwordEnc', 'emailPasswordEnc', 'totpSecretEnc'] },
  { model: 'generatedAccount', columns: ['passwordEnc', 'otpCodeEnc'] },
  { model: 'proxy', columns: ['password'] },
  // WhatsApp message bodies are read via safeDecrypt (plaintext-tolerant).
  { model: 'whatsappMessage', columns: ['body'] }
];

async function rotateModel(modelName: string, columns: string[]): Promise<{ scanned: number; changed: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const delegate = (prisma as any)[modelName];
  if (!delegate?.findMany) {
    console.warn(`  ! model "${modelName}" not found on PrismaClient — skipping`);
    return { scanned: 0, changed: 0 };
  }

  const rows: Array<Record<string, unknown>> = await delegate.findMany({
    select: { id: true, ...Object.fromEntries(columns.map((c) => [c, true])) }
  });

  let changed = 0;
  for (const row of rows) {
    const patch: Record<string, string> = {};
    for (const col of columns) {
      const val = row[col];
      if (typeof val !== 'string' || !val) continue;
      if (!needsReEncryption(val)) continue;
      const next = reEncryptString(val);
      if (next !== val) patch[col] = next;
    }
    if (Object.keys(patch).length === 0) continue;
    changed += 1;
    if (!DRY_RUN) {
      await delegate.update({ where: { id: row['id'] }, data: patch });
    }
  }

  return { scanned: rows.length, changed };
}

async function main(): Promise<void> {
  console.log(`Encryption rotation sweep ${DRY_RUN ? '(DRY RUN — no writes)' : '(applying)'}`);
  let totalScanned = 0;
  let totalChanged = 0;
  for (const { model, columns } of ENCRYPTED_COLUMNS) {
    const { scanned, changed } = await rotateModel(model, columns);
    totalScanned += scanned;
    totalChanged += changed;
    console.log(`  ${model.padEnd(22)} scanned ${String(scanned).padStart(6)}  ${DRY_RUN ? 'would re-encrypt' : 're-encrypted'} ${changed}`);
  }
  console.log(`Done. ${totalScanned} rows scanned, ${totalChanged} ${DRY_RUN ? 'pending' : 'updated'}.`);
}

main()
  .catch((err) => {
    console.error('Rotation failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
