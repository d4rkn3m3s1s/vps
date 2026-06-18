-- Cloud-phone suite: snapshots/image market, device grants, content calendar,
-- and new job types for snapshot/reset/pull/clipboard operations.

-- ── New JobType enum values ────────────────────────────────────────────────
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'EMULATOR_SNAPSHOT_CREATE';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'EMULATOR_SNAPSHOT_RESTORE';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'EMULATOR_RESET';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'EMULATOR_PULL_FILE';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'EMULATOR_CLIPBOARD_SET';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'EMULATOR_CLIPBOARD_GET';

-- ── New enums ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "SnapshotVisibility" AS ENUM ('PRIVATE', 'WORKSPACE', 'PUBLIC');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SnapshotStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "GrantAccess" AS ENUM ('VIEW', 'CONTROL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ScheduledPostStatus" AS ENUM ('SCHEDULED', 'POSTING', 'POSTED', 'FAILED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── DeviceSnapshot ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DeviceSnapshot" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "artifactRef" TEXT,
  "sizeBytes" BIGINT NOT NULL DEFAULT 0,
  "androidVersion" TEXT,
  "metadata" JSONB,
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "visibility" "SnapshotVisibility" NOT NULL DEFAULT 'PRIVATE',
  "status" "SnapshotStatus" NOT NULL DEFAULT 'PENDING',
  "installs" INTEGER NOT NULL DEFAULT 0,
  "sourceDeviceId" TEXT,
  "workspaceId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeviceSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DeviceSnapshot_workspaceId_idx" ON "DeviceSnapshot"("workspaceId");
CREATE INDEX IF NOT EXISTS "DeviceSnapshot_visibility_idx" ON "DeviceSnapshot"("visibility");

-- ── DeviceGrant ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DeviceGrant" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "grantedToId" TEXT NOT NULL,
  "grantedById" TEXT NOT NULL,
  "access" "GrantAccess" NOT NULL DEFAULT 'VIEW',
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "workspaceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeviceGrant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DeviceGrant_deviceId_idx" ON "DeviceGrant"("deviceId");
CREATE INDEX IF NOT EXISTS "DeviceGrant_grantedToId_idx" ON "DeviceGrant"("grantedToId");

-- ── ScheduledPost ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ScheduledPost" (
  "id" TEXT NOT NULL,
  "caption" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "mediaUrl" TEXT,
  "groupId" TEXT,
  "deviceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "rpaFlowId" TEXT,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" "ScheduledPostStatus" NOT NULL DEFAULT 'SCHEDULED',
  "postedAt" TIMESTAMP(3),
  "error" TEXT,
  "workspaceId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ScheduledPost_workspaceId_idx" ON "ScheduledPost"("workspaceId");
CREATE INDEX IF NOT EXISTS "ScheduledPost_status_scheduledFor_idx" ON "ScheduledPost"("status", "scheduledFor");

-- ── Foreign keys (best-effort; skip if already present) ──────────────────────
DO $$ BEGIN
  ALTER TABLE "DeviceSnapshot" ADD CONSTRAINT "DeviceSnapshot_sourceDeviceId_fkey"
    FOREIGN KEY ("sourceDeviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "DeviceSnapshot" ADD CONSTRAINT "DeviceSnapshot_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "DeviceGrant" ADD CONSTRAINT "DeviceGrant_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
