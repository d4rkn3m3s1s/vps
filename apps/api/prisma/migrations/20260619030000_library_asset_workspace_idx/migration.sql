-- Library workspace isolation: the service/controller now always scope assets to
-- a workspace (createAsset sets workspaceId; list/delete filter by it). This
-- migration backstops that at the DB level with a composite index for the
-- workspace-scoped list/delete queries. We intentionally do NOT add a NOT NULL
-- constraint here: pre-existing rows created before isolation may have a null
-- workspaceId, and forcing NOT NULL would fail the migration on those. The schema
-- keeps workspaceId optional; application code guarantees it on all new writes.

CREATE INDEX IF NOT EXISTS "LibraryAsset_workspaceId_createdAt_idx"
  ON "LibraryAsset" ("workspaceId", "createdAt" DESC);
