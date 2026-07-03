-- Free-form operator tags on devices for smart filtering.
ALTER TABLE "Device" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- GIN index so tag-contains filters stay fast on large fleets.
CREATE INDEX IF NOT EXISTS "Device_tags_idx" ON "Device" USING GIN ("tags");
