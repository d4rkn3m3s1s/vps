import rateLimit from 'express-rate-limit';
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

// Strict limiter for authentication endpoints to blunt brute-force / credential
// stuffing: a handful of attempts per IP per 15 minutes in production. In
// development the dashboard's server-side apiClient logs in (and exchanges
// workspace tokens) on nearly every page render, which would exhaust a strict
// limit, so we relax it heavily for local work. Override with AUTH_RATE_LIMIT_MAX.
const AUTH_LIMIT = Number(process.env.AUTH_RATE_LIMIT_MAX) || (env.nodeEnv === 'production' ? 10 : 1000);
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: AUTH_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'RATE_LIMITED',
    message: 'Too many authentication attempts. Try again later.'
  }
});
