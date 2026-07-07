-- WhatsApp "pro" upgrade: delivery-status tracking, contact info (name/notes),
-- pinned threads, saved replies, broadcasts, inbound dedup, and search indexes.
-- Idempotent — safe to re-apply.

-- 1) Message delivery status + failure reason + inbound dedup key.
ALTER TABLE "WhatsappMessage" ADD COLUMN IF NOT EXISTS "status"     TEXT NOT NULL DEFAULT 'SENT';
ALTER TABLE "WhatsappMessage" ADD COLUMN IF NOT EXISTS "statusAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "WhatsappMessage" ADD COLUMN IF NOT EXISTS "failReason" TEXT;
ALTER TABLE "WhatsappMessage" ADD COLUMN IF NOT EXISTS "dedupeKey"  TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsappMessage_dedupeKey_key"
  ON "WhatsappMessage" ("dedupeKey");

CREATE INDEX IF NOT EXISTS "WhatsappMessage_workspaceId_direction_createdAt_idx"
  ON "WhatsappMessage" ("workspaceId", "direction", "createdAt");

-- 2) Conversation: last-status, pin, contact name/notes.
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "lastStatus"  TEXT NOT NULL DEFAULT 'SENT';
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "pinned"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "pinnedAt"    TIMESTAMP(3);
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
ALTER TABLE "WhatsappConversation" ADD COLUMN IF NOT EXISTS "notes"       TEXT;

CREATE INDEX IF NOT EXISTS "WhatsappConversation_deviceId_archived_pinned_lastMessageAt_idx"
  ON "WhatsappConversation" ("deviceId", "archived", "pinned", "lastMessageAt");

-- GIN index for the labelIds text[] `has` filter (label-based list filtering).
CREATE INDEX IF NOT EXISTS "WhatsappConversation_labelIds_gin_idx"
  ON "WhatsappConversation" USING GIN ("labelIds");

-- 3) Saved replies (message templates).
CREATE TABLE IF NOT EXISTS "WhatsappCannedReply" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT,
  "shortcut"    TEXT,
  "title"       TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsappCannedReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WhatsappCannedReply_workspaceId_idx"
  ON "WhatsappCannedReply" ("workspaceId");
DO $$ BEGIN
  ALTER TABLE "WhatsappCannedReply"
    ADD CONSTRAINT "WhatsappCannedReply_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4) Broadcasts (one-to-many throttled sends).
CREATE TABLE IF NOT EXISTS "WhatsappBroadcast" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT,
  "deviceId"    TEXT NOT NULL,
  "message"     TEXT NOT NULL,
  "peers"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "total"       INTEGER NOT NULL DEFAULT 0,
  "sentCount"   INTEGER NOT NULL DEFAULT 0,
  "failCount"   INTEGER NOT NULL DEFAULT 0,
  "status"      TEXT NOT NULL DEFAULT 'QUEUED',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsappBroadcast_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WhatsappBroadcast_workspaceId_idx" ON "WhatsappBroadcast" ("workspaceId");
CREATE INDEX IF NOT EXISTS "WhatsappBroadcast_deviceId_idx" ON "WhatsappBroadcast" ("deviceId");

-- 5) New webhook events for send outcomes.
DO $$ BEGIN
  ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'WHATSAPP_SENT';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'WHATSAPP_FAILED';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
