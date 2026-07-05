-- Add an optional encrypted-plaintext column used ONLY by the per-workspace
-- "API Dokümantasyonu" key, so the docs page can render a real copy-pasteable
-- key in its curl examples. Idempotent so the project's apply-loop can re-run it.
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "docPlaintext" TEXT;
