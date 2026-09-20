-- SRS Revision 161 — R92's per-occurrence audience override, generalised
-- from branches alone to every dimension a `multi_dimension` schedule can
-- already resolve, plus a per-occurrence Subject override (Document Owner
-- instruction, 2026-09-17, extending the batch reported 2026-09-16).
--
-- **The pattern is unchanged from `session_audience_branch` (R92,
-- 2026-08-20) — this migration repeats it four more times, once per
-- dimension.** No rows for a Session on a given table means *inherit that
-- dimension from the schedule*; rows present name that dimension's
-- populations for THIS occurrence, in addition to the schedule's own
-- (never a replacement of the OTHER dimensions, which stay inherited
-- unless they too carry an override row). Naming two Levels, or two
-- Teaching Circles, for one occurrence is exactly this: two rows on the
-- matching table, both counted.
--
-- No soft delete on any of the four, on the identical reasoning
-- `session_audience_branch` already gives: removing a category/level/
-- group/circle from an occurrence's audience is a correction to a plan,
-- not an event with a history, and the audit row (`session.audience`)
-- records who made it.

CREATE TABLE "session_audience_category" (
  "session_id"  UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "session_audience_category_pkey" PRIMARY KEY ("session_id", "category_id"),
  CONSTRAINT "session_audience_category_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "session_audience_category_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "session_audience_category_category_idx"
  ON "session_audience_category" ("category_id");

CREATE TABLE "session_audience_level" (
  "session_id" UUID NOT NULL,
  "level_id"   UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "session_audience_level_pkey" PRIMARY KEY ("session_id", "level_id"),
  CONSTRAINT "session_audience_level_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "session_audience_level_level_id_fkey"
    FOREIGN KEY ("level_id") REFERENCES "level"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "session_audience_level_level_idx"
  ON "session_audience_level" ("level_id");

CREATE TABLE "session_audience_administrative_group" (
  "session_id"              UUID NOT NULL,
  "administrative_group_id" UUID NOT NULL,
  "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "session_audience_administrative_group_pkey"
    PRIMARY KEY ("session_id", "administrative_group_id"),
  CONSTRAINT "session_audience_administrative_group_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "session_audience_administrative_group_group_fkey"
    FOREIGN KEY ("administrative_group_id") REFERENCES "administrative_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "session_audience_administrative_group_group_idx"
  ON "session_audience_administrative_group" ("administrative_group_id");

CREATE TABLE "session_audience_teaching_group" (
  "session_id"        UUID NOT NULL,
  "teaching_group_id" UUID NOT NULL,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "session_audience_teaching_group_pkey" PRIMARY KEY ("session_id", "teaching_group_id"),
  CONSTRAINT "session_audience_teaching_group_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "session_audience_teaching_group_teaching_group_id_fkey"
    FOREIGN KEY ("teaching_group_id") REFERENCES "teaching_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "session_audience_teaching_group_group_idx"
  ON "session_audience_teaching_group" ("teaching_group_id");

-- **A per-occurrence Subject override — a snapshot, not an audience.**
-- `NULL` (the only value `session.materialize` ever writes) means "ask the
-- schedule"; a human override goes through `session.override`, which sets
-- `overridden` exactly as it already does for `room_id`/`delivery_mode`/
-- `visibility` — no second override marker, on the SAME reasoning those
-- three already established.

ALTER TABLE "session" ADD COLUMN "subject_id" UUID;

ALTER TABLE "session" ADD CONSTRAINT "session_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
