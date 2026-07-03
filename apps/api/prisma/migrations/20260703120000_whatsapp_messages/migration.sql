-- Inbound + outbound WhatsApp messages per device/account.
-- Inbound rows: written by the host agent's notification poll
--   (POST /agent/whatsapp/inbound). Outbound rows: written when a WHATSAPP_SEND
--   job completes. Surfaced via the messages API, a live WS event, a webhook,
--   and a Telegram/Slack/Discord notification.
-- Idempotent: safe to re-apply.

CREATE TABLE IF NOT EXISTS "WhatsappMessage" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT,
  "deviceId"    TEXT NOT NULL,
  "direction"   TEXT NOT NULL DEFAULT 'IN',
  "peer"        TEXT NOT NULL,
  "body"        TEXT NOT NULL,
  "waTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhatsappMessage_workspaceId_deviceId_createdAt_idx"
  ON "WhatsappMessage" ("workspaceId", "deviceId", "createdAt");

CREATE INDEX IF NOT EXISTS "WhatsappMessage_deviceId_createdAt_idx"
  ON "WhatsappMessage" ("deviceId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "WhatsappMessage"
    ADD CONSTRAINT "WhatsappMessage_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add the WHATSAPP_MESSAGE value to the WebhookEvent enum (before ALL, ordering
-- is cosmetic). Guarded so re-apply is a no-op.
DO $$ BEGIN
  ALTER TYPE "WebhookEvent" ADD VALUE IF NOT EXISTS 'WHATSAPP_MESSAGE';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
