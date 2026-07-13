-- Add AWAITING_MANUAL to GeneratedAccountStatus: an Instagram account that was
-- created but is blocked on a human step (captcha / SMS verification wall).
-- Idempotent: ADD VALUE IF NOT EXISTS is supported on PostgreSQL 12+.
ALTER TYPE "GeneratedAccountStatus" ADD VALUE IF NOT EXISTS 'AWAITING_MANUAL';
