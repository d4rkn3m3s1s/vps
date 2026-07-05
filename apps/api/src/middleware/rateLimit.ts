import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import { env } from '../config/env';

// Endpoints that are legitimately high-frequency and authenticated by their own
// keys (the host agent long-polls /agent/jobs/next every couple seconds and
// heartbeats; /health is for probes; /stream tokens fire per live viewer). The
// global IP limiter must NOT count these or a single host (all of localhost/WSL
// shares one IP) trips the limit and the agent stops claiming jobs → the whole
// console/AI/device pipeline goes dead.
function isExemptPath(path: string): boolean {
  return (
    path === '/health' ||
    path.startsWith('/agent') ||      // host-agent poll/heartbeat/complete (x-agent-key authed)
    path.startsWith('/stream')        // per-viewer stream tokens
  );
}

export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isExemptPath(req.path),
  message: {
    error: 'RATE_LIMITED',
    message: 'Too many requests'
  }
});

// Small helper: read a positive-int env override, else fall back to a
// prod/dev-aware default. Dev defaults are deliberately loose because the
// dashboard's server-side apiClient hammers auth on nearly every page render.
function limitFrom(envKey: string, prod: number, dev: number): number {
  const raw = Number(process.env[envKey]);
  return Number.isFinite(raw) && raw > 0 ? raw : env.nodeEnv === 'production' ? prod : dev;
}

// Strict limiter for the LOGIN endpoint to blunt brute-force / credential
// stuffing: a handful of attempts per IP per 15 minutes in production. In
// development the dashboard's server-side apiClient logs in (and exchanges
// workspace tokens) on nearly every page render, which would exhaust a strict
// limit, so we relax it heavily for local work. Override with AUTH_RATE_LIMIT_MAX.
const AUTH_LIMIT = limitFrom('AUTH_RATE_LIMIT_MAX', 300, 5000);
const AUTH_WINDOW = (() => {
  const raw = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60 * 1000; // 5 min
})();
export const authRateLimiter = rateLimit({
  windowMs: AUTH_WINDOW,
  limit: AUTH_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  // Skip successful logins so the dashboard's server-side apiClient (which logs
  // in on nearly every page render) can't exhaust the anti-brute-force budget —
  // only failed attempts count toward the limit. The per-account lockout below
  // still stops real credential stuffing.
  skipSuccessfulRequests: true,
  message: {
    error: 'RATE_LIMITED',
    message: 'Too many authentication attempts. Try again later.'
  }
});

// Refresh gets its OWN, much looser limiter, kept separate from login on
// purpose: a multi-tab user (or the dashboard's per-workspace token cache)
// legitimately refreshes far more often than they log in, and sharing login's
// tight bucket would spuriously log them out. Override with REFRESH_RATE_LIMIT_MAX.
const REFRESH_LIMIT = limitFrom('REFRESH_RATE_LIMIT_MAX', 60, 5000);
export const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: REFRESH_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'RATE_LIMITED',
    message: 'Too many token refresh attempts. Try again later.'
  }
});

// 2FA verification endpoints (enable/disable confirm a TOTP code) are a
// brute-force target — 6-digit codes are guessable if unthrottled. Tight bucket
// per IP. Override with TWOFA_RATE_LIMIT_MAX.
const TWOFA_LIMIT = limitFrom('TWOFA_RATE_LIMIT_MAX', 15, 1000);
export const twoFactorRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: TWOFA_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'RATE_LIMITED',
    message: 'Too many verification attempts. Try again later.'
  }
});

// Expensive/abusable POST endpoints (bulk generation, provider-cost operations)
// that can be turned into a DoS or a bill-runner. Keyed per authenticated user
// when we have one (so one tenant can't starve another sharing an egress IP),
// else per IP. Override with HEAVY_RATE_LIMIT_MAX / HEAVY_RATE_LIMIT_WINDOW_MS.
const HEAVY_LIMIT = limitFrom('HEAVY_RATE_LIMIT_MAX', 20, 1000);
const HEAVY_WINDOW = (() => {
  const raw = Number(process.env.HEAVY_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000;
})();
export const heavyOperationRateLimiter = rateLimit({
  windowMs: HEAVY_WINDOW,
  limit: HEAVY_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  // Prefer the JWT subject; fall back to the API key id; finally the IP. The
  // IPv6-safe helper is required by express-rate-limit v8 when we build a key
  // from the address ourselves.
  keyGenerator: (req: Request) =>
    req.auth?.userId ?? req.apiKey?.id ?? ipKeyGenerator(req.ip ?? ''),
  message: {
    error: 'RATE_LIMITED',
    message: 'Too many requests for this operation. Slow down and try again shortly.'
  }
});

// ---------------------------------------------------------------------------
// Login brute-force lockout (in-memory, single-instance).
// ---------------------------------------------------------------------------
// The authRateLimiter above blunts raw request volume per IP, but a distributed
// or slow credential-stuffing attempt against a SPECIFIC account can stay under
// it. This tracks consecutive failures per (IP + email) and applies a temporary
// lockout with a capped cooldown after a threshold. A successful login clears the
// counter. State is a plain Map — fine for the single API instance this runs as;
// if we ever scale out this must move to Redis.
const BRUTE_THRESHOLD = limitFrom('LOGIN_BRUTE_THRESHOLD', 5, 100000);
const BRUTE_BASE_COOLDOWN_MS = (() => {
  const raw = Number(process.env.LOGIN_BRUTE_COOLDOWN_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 60_000; // 1 min base
})();
const BRUTE_MAX_COOLDOWN_MS = (() => {
  const raw = Number(process.env.LOGIN_BRUTE_MAX_COOLDOWN_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 30 * 60_000; // 30 min cap
})();
// Entries idle longer than this are garbage-collected so the Map can't grow
// unbounded from one-off failures across many IP/email pairs.
const BRUTE_TTL_MS = Math.max(BRUTE_MAX_COOLDOWN_MS * 2, 60 * 60_000);

type BruteEntry = { fails: number; lockedUntil: number; last: number };
const bruteMap = new Map<string, BruteEntry>();

function bruteKey(ip: string | undefined, email: string | undefined): string {
  return `${ip ?? 'unknown'}|${(email ?? '').trim().toLowerCase()}`;
}

// Occasional sweep of stale entries (amortized; runs at most ~once/min).
let lastSweep = 0;
function sweepBruteMap(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of bruteMap) {
    if (now - v.last > BRUTE_TTL_MS && v.lockedUntil < now) bruteMap.delete(k);
  }
}

// Returns remaining lockout in ms (0 = not locked). Call before verifying creds.
export function getLoginLockoutMs(ip: string | undefined, email: string | undefined): number {
  const now = Date.now();
  sweepBruteMap(now);
  const entry = bruteMap.get(bruteKey(ip, email));
  if (!entry) return 0;
  return entry.lockedUntil > now ? entry.lockedUntil - now : 0;
}

// Record a failed attempt; escalates the cooldown exponentially once the
// threshold is crossed (base * 2^(fails - threshold)), capped.
export function recordLoginFailure(ip: string | undefined, email: string | undefined): void {
  const now = Date.now();
  const key = bruteKey(ip, email);
  const entry = bruteMap.get(key) ?? { fails: 0, lockedUntil: 0, last: now };
  entry.fails += 1;
  entry.last = now;
  if (entry.fails >= BRUTE_THRESHOLD) {
    const over = entry.fails - BRUTE_THRESHOLD;
    const cooldown = Math.min(BRUTE_BASE_COOLDOWN_MS * 2 ** over, BRUTE_MAX_COOLDOWN_MS);
    entry.lockedUntil = now + cooldown;
  }
  bruteMap.set(key, entry);
}

// Clear the counter after a successful login.
export function clearLoginFailures(ip: string | undefined, email: string | undefined): void {
  bruteMap.delete(bruteKey(ip, email));
}
