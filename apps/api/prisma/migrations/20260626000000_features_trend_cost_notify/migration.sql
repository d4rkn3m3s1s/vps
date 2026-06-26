-- New features: trend analytics, cost panel (Host.costPerHour), notification channels.
-- Idempotent (IF NOT EXISTS / duplicate_object guards) so it re-applies cleanly.

-- Host.costPerHour — hourly USD cost locked at provision time (Vast.ai dph_total).
ALTER TABLE "Host" ADD COLUMN IF NOT EXISTS "costPerHour" DOUBLE PRECISION;

-- MetricSnapshot — daily time-series rollup of fleet metrics.
CREATE TABLE IF NOT EXISTS "MetricSnapshot" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT,
  "day" DATE NOT NULL,
  "devices" INTEGER NOT NULL DEFAULT 0,
  "onlineDevices" INTEGER NOT NULL DEFAULT 0,
  "jobs" INTEGER NOT NULL DEFAULT 0,
  "jobsCompleted" INTEGER NOT NULL DEFAULT 0,
  "jobsFailed" INTEGER NOT NULL DEFAULT 0,
  "farmAccounts" INTEGER NOT NULL DEFAULT 0,
  "avgHealthScore" INTEGER NOT NULL DEFAULT 0,
  "onlineMinutes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MetricSnapshot_workspaceId_day_key" ON "MetricSnapshot"("workspaceId", "day");
CREATE INDEX IF NOT EXISTS "MetricSnapshot_workspaceId_day_idx" ON "MetricSnapshot"("workspaceId", "day");
DO $$ BEGIN
  ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- NotificationChannel — per-workspace Telegram/Slack/Discord config (encrypted).
CREATE TABLE IF NOT EXISTS "NotificationChannel" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "configEnc" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "lastTestedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationChannel_workspaceId_type_key" ON "NotificationChannel"("workspaceId", "type");
CREATE INDEX IF NOT EXISTS "NotificationChannel_workspaceId_idx" ON "NotificationChannel"("workspaceId");
DO $$ BEGIN
  ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
