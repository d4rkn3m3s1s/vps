-- Account farm: GeneratedAccount + status enum (idempotent).

DO $$ BEGIN
  CREATE TYPE "GeneratedAccountStatus" AS ENUM (
    'PENDING', 'IDENTITY_READY', 'CONTACT_READY', 'AWAITING_OTP', 'REGISTERING', 'ACTIVE', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "GeneratedAccount" (
  "id"           TEXT NOT NULL,
  "batchId"      TEXT,
  "platform"     TEXT NOT NULL,
  "status"       "GeneratedAccountStatus" NOT NULL DEFAULT 'PENDING',
  "firstName"    TEXT,
  "lastName"     TEXT,
  "gender"       TEXT,
  "birthDate"    TEXT,
  "countryCode"  TEXT,
  "emailAddress" TEXT,
  "username"     TEXT,
  "passwordEnc"  TEXT,
  "phoneNumber"  TEXT,
  "smsRequestId" TEXT,
  "otpCodeEnc"   TEXT,
  "deviceId"     TEXT,
  "error"        TEXT,
  "notes"        TEXT,
  "workspaceId"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeneratedAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GeneratedAccount_workspaceId_idx" ON "GeneratedAccount"("workspaceId");
CREATE INDEX IF NOT EXISTS "GeneratedAccount_batchId_idx" ON "GeneratedAccount"("batchId");
CREATE INDEX IF NOT EXISTS "GeneratedAccount_status_idx" ON "GeneratedAccount"("status");

DO $$ BEGIN
  ALTER TABLE "GeneratedAccount"
    ADD CONSTRAINT "GeneratedAccount_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
