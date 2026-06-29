-- Proxy health scoring + periodic revalidation.
-- Idempotent (IF NOT EXISTS guards) so it re-applies cleanly.

ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "score" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "failCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Proxy" ADD COLUMN IF NOT EXISTS "checksDue" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Proxy_checksDue_idx" ON "Proxy"("checksDue");
