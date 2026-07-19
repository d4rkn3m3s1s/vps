// Idempotency-Key support for the public API's on-device write endpoints.
//
// An integrator that retries a POST after a network blip (or a queue that fires the
// same webhook twice) must NOT create two device jobs. The contract mirrors Stripe:
// pass an `Idempotency-Key` header; the FIRST request with a given key does the
// work and records its jobId; every REPLAY with the same key returns that same
// jobId without dispatching again.
//
// Concurrency: the (workspaceId, key) unique index is the single chokepoint. Two
// racing replays both attempt an INSERT — the loser hits the constraint (P2002),
// then reads the winner's row back. We reserve the key BEFORE producing the job so
// even a replay that arrives mid-flight (before the first job's row is written)
// blocks on the reservation instead of double-dispatching.

import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';

// The result an on-device dispatch hands back (batchService.* → { job }). We only
// persist/echo the jobId + status; the caller shapes the HTTP body.
export type IdempotentResult = { jobId: string; status: string };

// How long we'll wait for the in-flight winner to publish its jobId before giving
// up (the replay then returns a 409 telling the caller to poll). Kept short: the
// winning dispatch writes its jobId within ~1s.
const WAIT_TIMEOUT_MS = 5000;
const WAIT_POLL_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Normalise + validate the client-supplied header value. Undefined ⇒ feature off.
export function readIdempotencyKey(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const key = String(raw).trim();
  if (!key) return undefined;
  if (key.length > 255) {
    throw new AppError('Idempotency-Key en fazla 255 karakter olabilir', 400, 'IDEMPOTENCY_KEY_TOO_LONG');
  }
  return key;
}

// Run `produce` at most once per (workspaceId, key, scope). Returns the produced
// result, or the previously-recorded one on a replay. When `key` is undefined the
// guard is a no-op (produce runs unconditionally) — idempotency is opt-in.
export async function withIdempotency(
  workspaceId: string,
  key: string | undefined,
  scope: string,
  produce: () => Promise<IdempotentResult>
): Promise<IdempotentResult & { idempotentReplay: boolean }> {
  if (!key) {
    const r = await produce();
    return { ...r, idempotentReplay: false };
  }

  // Fast path: a completed prior request → return its recorded jobId.
  const existing = await prisma.idempotencyKey.findUnique({
    where: { workspaceId_key: { workspaceId, key } }
  });
  if (existing) return resolveExisting(existing, scope);

  // Reserve the key. If a concurrent request already reserved it, we lose the race
  // on the unique index (P2002) and fall through to reading the winner's row.
  let reserved = false;
  try {
    await prisma.idempotencyKey.create({ data: { workspaceId, key, scope } });
    reserved = true;
  } catch (e) {
    if (!(e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002')) {
      throw e;
    }
  }

  if (!reserved) {
    // Another request holds the reservation. Poll briefly for its jobId, then either
    // return it (replay) or tell the caller to poll (the winner is still in-flight).
    const deadline = Date.now() + WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const row = await prisma.idempotencyKey.findUnique({
        where: { workspaceId_key: { workspaceId, key } }
      });
      if (row?.jobId) return resolveExisting(row, scope);
      await sleep(WAIT_POLL_MS);
    }
    throw new AppError(
      'Aynı Idempotency-Key ile bir istek hâlâ işleniyor. Birkaç saniye sonra tekrar deneyin.',
      409,
      'IDEMPOTENCY_IN_PROGRESS'
    );
  }

  // We own the reservation → do the real work exactly once, then publish the jobId.
  try {
    const r = await produce();
    await prisma.idempotencyKey
      .update({ where: { workspaceId_key: { workspaceId, key } }, data: { jobId: r.jobId } })
      .catch(() => undefined);
    return { ...r, idempotentReplay: false };
  } catch (e) {
    // Producing the job failed — release the reservation so the caller can retry the
    // SAME key rather than being permanently wedged on a key that never produced work.
    await prisma.idempotencyKey
      .deleteMany({ where: { workspaceId, key, jobId: null } })
      .catch(() => undefined);
    throw e;
  }
}

function resolveExisting(
  row: { scope: string; jobId: string | null },
  scope: string
): IdempotentResult & { idempotentReplay: boolean } {
  // Same key, different endpoint ⇒ misuse (the client is reusing a key for unrelated
  // work). Reject rather than silently returning a job from another operation.
  if (row.scope !== scope) {
    throw new AppError(
      'Bu Idempotency-Key farklı bir işlem için kullanılmış',
      409,
      'IDEMPOTENCY_KEY_REUSED'
    );
  }
  if (!row.jobId) {
    // Reserved but the original producer never published (or is still running). Ask
    // the caller to retry — the reservation will have been released if it failed.
    throw new AppError(
      'Aynı Idempotency-Key ile bir istek hâlâ işleniyor. Birkaç saniye sonra tekrar deneyin.',
      409,
      'IDEMPOTENCY_IN_PROGRESS'
    );
  }
  return { jobId: row.jobId, status: 'PENDING', idempotentReplay: true };
}

// Opportunistic TTL sweep so the table stays bounded. Idempotency keys are only
// meaningful for a short retry window; drop anything older than the retention.
const RETENTION_MS = 24 * 60 * 60 * 1000; // 24h
export async function sweepIdempotencyKeys(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const r = await prisma.idempotencyKey.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => ({ count: 0 }));
  return r.count;
}
