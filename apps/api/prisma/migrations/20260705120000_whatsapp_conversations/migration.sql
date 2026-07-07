-- WhatsApp-Web-style conversation list: one row per (device, peer) thread, plus
-- workspace-scoped conversation labels/categories, plus a `read` flag on messages.
-- Upserted from agent.service whenever a message is stored. Idempotent — safe to
-- re-apply.

-- 1) Per-message read flag (inbound starts unread).
ALTER TABLE "WhatsappMessage" ADD COLUMN IF NOT EXISTS "read" BOOLEAN NOT NULL DEFAULT false;

-- Fast per-conversation history lookup (device + peer, newest first).
CREATE INDEX IF NOT EXISTS "WhatsappMessage_deviceId_peer_createdAt_idx"
  ON "WhatsappMessage" ("deviceId", "peer", "createdAt");

-- 2) Conversation threads (the chat list). Denormalised last-message preview +
--    unread count so the list renders without scanning WhatsappMessage.
CREATE TABLE IF NOT EXISTS "WhatsappConversation" (
  "id"              TEXT NOT NULL,
  "workspaceId"     TEXT,
  "deviceId"        TEXT NOT NULL,
  "peer"            TEXT NOT NULL,
  "lastMessageBody" TEXT NOT NULL DEFAULT '',
  "lastDirection"   TEXT NOT NULL DEFAULT 'IN',
  "lastMessageAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unreadCount"     INTEGER NOT NULL DEFAULT 0,
  "favorite"        BOOLEAN NOT NULL DEFAULT false,
  "archived"        BOOLEAN NOT NULL DEFAULT false,
  "labelIds"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsappConversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsappConversation_deviceId_peer_key"
  ON "WhatsappConversation" ("deviceId", "peer");

CREATE INDEX IF NOT EXISTS "WhatsappConversation_workspaceId_deviceId_lastMessageAt_idx"
  ON "WhatsappConversation" ("workspaceId", "deviceId", "lastMessageAt");

CREATE INDEX IF NOT EXISTS "WhatsappConversation_deviceId_lastMessageAt_idx"
  ON "WhatsappConversation" ("deviceId", "lastMessageAt");

DO $$ BEGIN
  ALTER TABLE "WhatsappConversation"
    ADD CONSTRAINT "WhatsappConversation_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3) Conversation labels (categories). Assigned to conversations by id.
CREATE TABLE IF NOT EXISTS "WhatsappLabel" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT,
  "name"        TEXT NOT NULL,
  "color"       TEXT NOT NULL DEFAULT 'slate',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsappLabel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhatsappLabel_workspaceId_idx"
  ON "WhatsappLabel" ("workspaceId");

DO $$ BEGIN
  ALTER TABLE "WhatsappLabel"
    ADD CONSTRAINT "WhatsappLabel_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4) Backfill conversation rows from existing messages so the list isn't empty on
--    first deploy. One row per (device, peer) with the newest message as preview.
INSERT INTO "WhatsappConversation" ("id", "workspaceId", "deviceId", "peer",
  "lastMessageBody", "lastDirection", "lastMessageAt", "unreadCount", "createdAt", "updatedAt")
SELECT
  md5("deviceId" || ':' || "peer"),
  MAX("workspaceId"),
  "deviceId",
  "peer",
  '',                                  -- body stays encrypted at rest; preview filled on next message
  'IN',
  MAX("waTimestamp"),
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "WhatsappMessage"
GROUP BY "deviceId", "peer"
ON CONFLICT ("deviceId", "peer") DO NOTHING;
