-- Idempotency-Key support for the public API (send / bulk-send). A first request
-- with a given (workspaceId, key) records the resulting jobId here; a replay with
-- the SAME key returns that stored jobId instead of creating a second device job.
-- Idempotent: guarded so re-applying (the project applies migrations idempotently)
-- is a no-op.
CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  -- The endpoint/scope this key was first used on (e.g. "whatsapp.send"). A replay
  -- of the same key against a DIFFERENT endpoint is rejected as a misuse.
  "scope"       TEXT NOT NULL,
  -- The job this key produced (nullable: reserved the moment we claim the key, set
  -- once the job row exists). Poll it via GET /public/v1/jobs/{jobId}.
  "jobId"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- One row per (workspace, key): the unique index is the concurrency chokepoint —
-- two racing replays both try to INSERT and the loser hits this constraint, then
-- reads back the winner's jobId.
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyKey_workspaceId_key_key"
  ON "IdempotencyKey" ("workspaceId", "key");

-- Reaper/TTL sweep support (keys are only meaningful for a short window).
CREATE INDEX IF NOT EXISTS "IdempotencyKey_createdAt_idx"
  ON "IdempotencyKey" ("createdAt");
