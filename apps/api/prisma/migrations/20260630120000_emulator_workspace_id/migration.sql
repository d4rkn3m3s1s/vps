-- Add workspaceId to Emulator so the list endpoint can be workspace-scoped
-- (closes a cross-tenant IDOR where any API key could enumerate all emulators).
-- Idempotent: safe to re-apply.
ALTER TABLE "Emulator" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;
CREATE INDEX IF NOT EXISTS "Emulator_workspaceId_idx" ON "Emulator"("workspaceId");
