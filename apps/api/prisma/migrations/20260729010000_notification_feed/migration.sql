-- Bildirim merkezi icin KALICI besleme.
-- Bildirimler eskiden yalnizca tarayici bellegindeydi -> sayfa yenilenince kayboluyordu,
-- "okundu" bilgisi de uculuyordu ve operator panelde degilken biten isler hic gorunmuyordu.
-- Proje konvansiyonu: migration'lar idempotent uygulanir (IF NOT EXISTS guard'lari).

CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "refType" TEXT,
    "refId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Feed sorgusu "workspace + en yeni"; okunmamis sayaci icin ayri indeks.
CREATE INDEX IF NOT EXISTS "Notification_workspaceId_createdAt_idx" ON "Notification"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_workspaceId_read_idx" ON "Notification"("workspaceId", "read");

DO $$
BEGIN
  ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
