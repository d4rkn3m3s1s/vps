import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../lib/errors';

// HMAC request-signature verification for agent→API requests.
//
// The KVM host agent signs every control-plane request with HMAC-SHA256 over a
// canonical string `${ts}.${METHOD}.${path}.${bodyString}`, using its PLAINTEXT
// agent key (the same value it already sends in `x-agent-key`) as the HMAC key.
// requireHostAgent has already run and looked the host up by sha256(x-agent-key),
// so the plaintext key is available on this request; we re-compute the HMAC with
// it here. This gives payload integrity + replay protection with NO extra shared
// secret and NO schema change.
//
// Headers checked:
//   x-agent-key   plaintext agent key (also the HMAC key)  — set by requireHostAgent flow
//   x-agent-ts    millisecond timestamp used in the signed string
//   x-agent-sign  hex HMAC-SHA256 of the canonical string
//
// Replay guard: the timestamp must be within ±SKEW_MS of now.
//
// Backward compatibility: when the signature headers are ABSENT (an old agent
// that predates signing), we log and allow the request UNLESS the environment
// flag FLEET_REQUIRE_AGENT_SIGN=1 forces signatures. Once every host runs a
// signing agent (LIVE), set the flag to reject unsigned requests. If a signature
// IS present it is always verified — a bad/stale signature is rejected (401)
// regardless of the flag.

const SKEW_MS = 5 * 60 * 1000; // ±5 minutes

function signaturesRequired(): boolean {
  const v = String(process.env.FLEET_REQUIRE_AGENT_SIGN || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

// Constant-time comparison of two hex signatures (guards against timing attacks
// and against length-mismatch throwing inside timingSafeEqual).
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function verifyAgentSignature(req: Request, _res: Response, next: NextFunction): void {
  const agentKey = req.header('x-agent-key');
  const sign = req.header('x-agent-sign');
  const ts = req.header('x-agent-ts');

  // Missing signature headers → legacy agent. Enforce or warn per the flag.
  if (!sign || !ts) {
    if (signaturesRequired()) {
      next(new AppError('Agent signature required', 401, 'UNAUTHORIZED'));
      return;
    }
    console.warn(
      `[agent-sign] unsigned request from host ${req.hostAgent?.id ?? 'unknown'} ` +
        `${req.method} ${req.originalUrl} — allowed (set FLEET_REQUIRE_AGENT_SIGN=1 to reject)`
    );
    next();
    return;
  }

  // requireHostAgent guarantees a valid x-agent-key reached here, but re-check.
  if (!agentKey) {
    next(new AppError('Missing agent key', 401, 'UNAUTHORIZED'));
    return;
  }

  // Replay guard: reject timestamps outside the ±SKEW_MS window.
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > SKEW_MS) {
    next(new AppError('Agent signature timestamp out of range', 401, 'UNAUTHORIZED'));
    return;
  }

  // Re-serialize the parsed body to reproduce the exact bodyString the agent
  // signed. The agent builds request bodies with JSON.stringify(...) on flat
  // objects, so JSON.stringify(req.body) reproduces the same bytes (insertion
  // order is preserved by both the parser and the serializer). A GET has no body
  // → the agent signs the empty string, and req.body is `{}` here, so we treat an
  // empty/whitespace-only method-with-no-body as ''.
  const hasBody =
    req.body !== undefined &&
    req.body !== null &&
    !(typeof req.body === 'object' && Object.keys(req.body).length === 0);
  const bodyString = hasBody ? JSON.stringify(req.body) : '';

  const canonical = `${ts}.${req.method.toUpperCase()}.${req.originalUrl}.${bodyString}`;
  const expected = crypto.createHmac('sha256', agentKey).update(canonical).digest('hex');

  if (!safeEqualHex(sign, expected)) {
    next(new AppError('Invalid agent signature', 401, 'UNAUTHORIZED'));
    return;
  }

  next();
}
