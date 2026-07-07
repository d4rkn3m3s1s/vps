-- Performance/scale indexes for the 100-300 device target. All idempotent
-- (CREATE INDEX IF NOT EXISTS) so they apply cleanly on top of an existing DB.

-- Device: agent hot-path + ticker lookups. The @@index([hostId]) / @@index([groupId])
-- were added to schema.prisma but never materialized in the DB — create them here.
CREATE INDEX IF NOT EXISTS "Device_hostId_idx" ON "Device"("hostId");
CREATE INDEX IF NOT EXISTS "Device_groupId_idx" ON "Device"("groupId");

-- ScheduledTask: scheduler.runDue scans ACTIVE tasks whose nextRunAt has passed every 60s.
CREATE INDEX IF NOT EXISTS "ScheduledTask_status_nextRunAt_idx" ON "ScheduledTask"("status", "nextRunAt");

-- FarmCampaign: farm.tick scans ACTIVE campaigns whose nextRunAt has passed every 60s.
CREATE INDEX IF NOT EXISTS "FarmCampaign_status_nextRunAt_idx" ON "FarmCampaign"("status", "nextRunAt");

-- AuditLog: list is workspace-scoped and ordered by createdAt desc.
CREATE INDEX IF NOT EXISTS "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- DeviceMetricPoint: retention prune deletes rows older than a cutoff across all devices.
CREATE INDEX IF NOT EXISTS "DeviceMetricPoint_capturedAt_idx" ON "DeviceMetricPoint"("capturedAt");
