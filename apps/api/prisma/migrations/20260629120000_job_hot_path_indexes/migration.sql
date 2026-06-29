-- Hot-path indexes for the Job table.
-- 1) Agent claim query: WHERE status=PENDING AND claimedByHostId IS NULL ORDER BY createdAt
--    runs every ~2s per host agent — index it so it's a seek, not a table scan.
-- 2) Per-workspace newest-jobs list (ORDER BY createdAt DESC).
CREATE INDEX IF NOT EXISTS "Job_status_claimedByHostId_createdAt_idx"
  ON "Job" ("status", "claimedByHostId", "createdAt");

CREATE INDEX IF NOT EXISTS "Job_workspaceId_createdAt_idx"
  ON "Job" ("workspaceId", "createdAt");
