-- Cloud-phone provider adapters: resell rented ARM phones from external vendors
-- (GeeLark/VMOS/DuoPlus/UGPhone) alongside our own SELF fleet. Idempotent.

-- Provider-kind enum.
DO $$ BEGIN
  CREATE TYPE "CloudProviderKind" AS ENUM ('SELF', 'GEELARK', 'VMOS', 'DUOPLUS', 'UGPHONE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Configured external vendor accounts (credentials AES-GCM encrypted).
CREATE TABLE IF NOT EXISTS "CloudPhoneProvider" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "kind"         "CloudProviderKind" NOT NULL,
  "baseUrl"      TEXT,
  "apiKeyEnc"    TEXT,
  "apiSecretEnc" TEXT,
  "enabled"      BOOLEAN NOT NULL DEFAULT true,
  "lastCheckAt"  TIMESTAMP(3),
  "lastCheckOk"  BOOLEAN,
  "lastCheckMsg" TEXT,
  "workspaceId"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CloudPhoneProvider_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CloudPhoneProvider_workspaceId_idx" ON "CloudPhoneProvider"("workspaceId");

DO $$ BEGIN
  ALTER TABLE "CloudPhoneProvider"
    ADD CONSTRAINT "CloudPhoneProvider_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Device → external cloud-phone linkage.
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "cloudProvider"   TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "cloudProviderId" TEXT;
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "externalId"      TEXT;
