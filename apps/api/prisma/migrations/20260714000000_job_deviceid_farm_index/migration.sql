-- Job.deviceId: first-class copy of payload.deviceId so the device-idle guard and
-- agent claim can filter on an indexed column instead of a JSON path.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;

-- Backfill from the existing JSON payload so pre-migration jobs are covered.
UPDATE "Job"
SET "deviceId" = "payload"->>'deviceId'
WHERE "deviceId" IS NULL
  AND "payload" ? 'deviceId'
  AND jsonb_typeof("payload"->'deviceId') = 'string';

-- Index the device-exclusive-job guard + agent claim hot path.
CREATE INDEX IF NOT EXISTS "Job_deviceId_status_idx" ON "Job" ("deviceId", "status");

-- Composite index for FarmActionLog getHealthTrend / listActionLog (device + time).
CREATE INDEX IF NOT EXISTS "FarmActionLog_deviceId_createdAt_idx" ON "FarmActionLog" ("deviceId", "createdAt");
