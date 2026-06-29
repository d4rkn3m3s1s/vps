-- AI Device Agent: AgentRun + AgentRunStep (Claude driving a phone) and AppMap
-- (BFS app-explore graph), plus the APP_EXPLORE job type and AgentRunStatus enum.
-- Idempotent (IF NOT EXISTS / duplicate_object guards) so it re-applies cleanly.

-- JobType.APP_EXPLORE / AGENT_RUN (bare ADD VALUE — cannot run inside a PL/pgSQL block)
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'APP_EXPLORE';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'AGENT_RUN';

-- AgentRunStatus enum
DO $$ BEGIN
  CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AgentRun
CREATE TABLE IF NOT EXISTS "AgentRun" (
  "id" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "workspaceId" TEXT,
  "userId" TEXT,
  "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
  "stealth" BOOLEAN NOT NULL DEFAULT false,
  "useVision" BOOLEAN NOT NULL DEFAULT false,
  "maxTurns" INTEGER NOT NULL DEFAULT 15,
  "turnsUsed" INTEGER NOT NULL DEFAULT 0,
  "success" BOOLEAN,
  "summary" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AgentRun_workspaceId_idx" ON "AgentRun"("workspaceId");
CREATE INDEX IF NOT EXISTS "AgentRun_deviceId_idx" ON "AgentRun"("deviceId");
DO $$ BEGIN
  ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AgentRunStep
CREATE TABLE IF NOT EXISTS "AgentRunStep" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  "screenTree" TEXT NOT NULL,
  "screenshot" TEXT,
  "toolCalls" JSONB NOT NULL,
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentRunStep_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AgentRunStep_runId_idx" ON "AgentRunStep"("runId");
DO $$ BEGIN
  ALTER TABLE "AgentRunStep" ADD CONSTRAINT "AgentRunStep_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AppMap
CREATE TABLE IF NOT EXISTS "AppMap" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "workspaceId" TEXT,
  "packageName" TEXT NOT NULL,
  "graph" JSONB NOT NULL,
  "screenCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppMap_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AppMap_workspaceId_idx" ON "AppMap"("workspaceId");
CREATE INDEX IF NOT EXISTS "AppMap_deviceId_idx" ON "AppMap"("deviceId");
DO $$ BEGIN
  ALTER TABLE "AppMap" ADD CONSTRAINT "AppMap_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "AppMap" ADD CONSTRAINT "AppMap_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
