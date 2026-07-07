-- Normalise WhatsApp peers so the SAME contact maps to ONE conversation thread.
-- Inbound peers arrived as WhatsApp's display form ("+90 546 402 28 35"); outbound
-- peers were the dialled digits ("905464022835") — creating two threads per person.
-- This canonicalises phone-like peers to digits-only (dropping a leading "00"),
-- merges duplicate conversation rows, and rewrites message peers.
-- Idempotent — re-running is a no-op once peers are already canonical.
--
-- A peer is "phone-like" when it has NO letters and ≥7 digits. Only those are
-- normalised; contact/group NAMES (with letters) are left untouched.

-- 1) Rewrite message peers to canonical digits (phone-like only).
UPDATE "WhatsappMessage"
SET "peer" = regexp_replace(regexp_replace("peer", '\D', '', 'g'), '^00', '')
WHERE "peer" !~ '[A-Za-z]'
  AND length(regexp_replace("peer", '\D', '', 'g')) >= 7
  AND "peer" <> regexp_replace(regexp_replace("peer", '\D', '', 'g'), '^00', '');

-- 2) Merge duplicate conversations. For each (deviceId, canonical-peer) group with
--    more than one row: fold aggregate state into the newest row, DELETE the rest
--    FIRST (so the unique index is free), THEN set the survivor's peer to canonical.
DO $$
DECLARE
  grp RECORD;
  keep_id TEXT;
  agg_unread INT;
  agg_fav BOOLEAN;
  agg_pin BOOLEAN;
  agg_arch BOOLEAN;
  agg_labels TEXT[];
BEGIN
  FOR grp IN
    SELECT "deviceId",
           regexp_replace(regexp_replace("peer", '\D', '', 'g'), '^00', '') AS canon
    FROM "WhatsappConversation"
    WHERE "peer" !~ '[A-Za-z]'
      AND length(regexp_replace("peer", '\D', '', 'g')) >= 7
    GROUP BY "deviceId", regexp_replace(regexp_replace("peer", '\D', '', 'g'), '^00', '')
    HAVING count(*) > 1
  LOOP
    -- Aggregate the whole group first.
    SELECT
      sum("unreadCount"),
      bool_or("favorite"),
      bool_or("pinned"),
      bool_and("archived"),
      COALESCE((
        SELECT array_agg(DISTINCT lid)
        FROM "WhatsappConversation" c2, unnest(c2."labelIds") AS lid
        WHERE c2."deviceId" = grp."deviceId"
          AND regexp_replace(regexp_replace(c2."peer", '\D', '', 'g'), '^00', '') = grp.canon
          AND c2."peer" !~ '[A-Za-z]'
      ), ARRAY[]::TEXT[])
    INTO agg_unread, agg_fav, agg_pin, agg_arch, agg_labels
    FROM "WhatsappConversation"
    WHERE "deviceId" = grp."deviceId"
      AND regexp_replace(regexp_replace("peer", '\D', '', 'g'), '^00', '') = grp.canon
      AND "peer" !~ '[A-Za-z]';

    -- Winner = newest lastMessageAt.
    SELECT "id" INTO keep_id
    FROM "WhatsappConversation"
    WHERE "deviceId" = grp."deviceId"
      AND regexp_replace(regexp_replace("peer", '\D', '', 'g'), '^00', '') = grp.canon
      AND "peer" !~ '[A-Za-z]'
    ORDER BY "lastMessageAt" DESC
    LIMIT 1;

    -- Delete the losers FIRST (frees the unique key for the canonical peer).
    DELETE FROM "WhatsappConversation"
    WHERE "deviceId" = grp."deviceId"
      AND regexp_replace(regexp_replace("peer", '\D', '', 'g'), '^00', '') = grp.canon
      AND "peer" !~ '[A-Za-z]'
      AND "id" <> keep_id;

    -- Now set the survivor to the canonical peer + folded state.
    UPDATE "WhatsappConversation"
    SET "peer"        = grp.canon,
        "unreadCount" = COALESCE(agg_unread, 0),
        "favorite"    = COALESCE(agg_fav, false),
        "pinned"      = COALESCE(agg_pin, false),
        "archived"    = COALESCE(agg_arch, false),
        "labelIds"    = agg_labels
    WHERE "id" = keep_id;
  END LOOP;
END $$;

-- 3) Canonicalise any remaining (non-duplicate) phone-like conversation peers.
UPDATE "WhatsappConversation"
SET "peer" = regexp_replace(regexp_replace("peer", '\D', '', 'g'), '^00', '')
WHERE "peer" !~ '[A-Za-z]'
  AND length(regexp_replace("peer", '\D', '', 'g')) >= 7
  AND "peer" <> regexp_replace(regexp_replace("peer", '\D', '', 'g'), '^00', '');
