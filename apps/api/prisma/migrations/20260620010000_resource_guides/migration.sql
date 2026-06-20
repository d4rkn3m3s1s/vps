-- Resources page: DB-backed FAQ/how-to guides so help content is curatable per
-- workspace instead of hardcoded in the dashboard.
CREATE TABLE IF NOT EXISTS "ResourceGuide" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceGuide_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ResourceGuide_workspaceId_idx" ON "ResourceGuide" ("workspaceId");

DO $$ BEGIN
  ALTER TABLE "ResourceGuide" ADD CONSTRAINT "ResourceGuide_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
