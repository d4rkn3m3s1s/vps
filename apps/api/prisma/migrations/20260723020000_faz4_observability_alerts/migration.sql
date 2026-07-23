-- Faz-4 observability: new alert triggers + health-watch dead-man's-switch column.
--   ACCOUNT_BANNED     — WhatsApp account detected banned/restricted/logged-out
--   HOST_SATURATED     — host CPU load or disk critically high (was invisible until HOST_OFFLINE)
--   PROXY_UNHEALTHY    — proxy leak / dead redsocks (was mis-mapped to DEVICE_OFFLINE)
--   FLEET_MASS_OFFLINE — a large share of the fleet went offline in one tick (burst)
-- And Host.lastHealthWatchAt so the offline tick can detect a dead monitor (>20min stale).
--
-- Idempotent — bare ADD VALUE (cannot run inside a PL/pgSQL block) + guarded column add.
ALTER TYPE "AlertTrigger" ADD VALUE IF NOT EXISTS 'ACCOUNT_BANNED';
ALTER TYPE "AlertTrigger" ADD VALUE IF NOT EXISTS 'HOST_SATURATED';
ALTER TYPE "AlertTrigger" ADD VALUE IF NOT EXISTS 'PROXY_UNHEALTHY';
ALTER TYPE "AlertTrigger" ADD VALUE IF NOT EXISTS 'FLEET_MASS_OFFLINE';

ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "lastHealthWatchAt" TIMESTAMP(3);
