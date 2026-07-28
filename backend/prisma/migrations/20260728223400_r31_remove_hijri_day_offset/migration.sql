-- SRS Revision 31 — the global Hijri day-offset is removed.
--
-- The offset was a uniform ±2-day adjustment to an algorithmic base. It cannot
-- reproduce the official Moroccan calendar, because the Ministry's divergence
-- from Umm al-Qura varies month to month; `hijri_month_start` records the
-- official dates directly and is now the sole source of every Hijri value.
--
-- Intentional DROP (TD-6b): this removes a CHECK constraint and one settings
-- row, both of which the revision retires. No column or table is dropped and no
-- data that anything still reads is lost — the calendar no longer consults this
-- key at all, so leaving it would be a stale value inviting a future reader.

-- contract-phase: SRS Revision 31 retires the Hijri day-offset outright. The
-- constraint guards a key no code writes or reads any more, so nothing depends
-- on it; the expand phase (hijri_month_start) shipped in the two migrations
-- immediately preceding this one.
ALTER TABLE "system_setting"
  DROP CONSTRAINT IF EXISTS "system_setting_hijri_offset_range_check";

DELETE FROM "system_setting" WHERE "key" = 'hijri.day_offset';
