import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  limit: env.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
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
