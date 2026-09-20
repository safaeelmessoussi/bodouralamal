-- SRS Revision 165 §2 — the Surahs a class is about (Document Owner
-- decision, 2026-09-20).
--
-- Each Level's Surahs are set in «مقرر الحفظ» (`level_surah`); حفظ القرآن
-- memorises them and تفسير القرآن studies the SAME Surahs. Scheduling a class
-- or an exam of a Subject that works by Surah must therefore say WHICH Surah —
-- and "which Subjects work by Surah" is a fact about the Subject, never a
-- match on its name (R27 made Subjects editable reference data; §4.4b requires
-- rules checked generically).
--
-- 1. `subject.requires_surahs` — the marker. The Subject that authorises
--    memorisation (`tracks_quran_progress`, R73) necessarily works by Surah, so
--    a CHECK ties the two: a tracker that does not name Surahs is
--    unrepresentable.
-- 2. `course_schedule_surah` — the Surahs a class is about, one row each.
-- 3. `session_surah` — ONE occurrence's own Surahs. No rows means *inherit the
--    class's*; rows present REPLACE them for that occurrence (a Surah is what
--    is taught that day, not a population added to another).
--
-- `exam.surah_id` already exists (one Surah per exam; any number of exams may
-- name the same Surah) and needs no change here — it simply becomes writable.
--
-- No soft delete on either join, on the reasoning `session_audience_*` already
-- gives: changing the Surah of a planned class is a correction to a plan, and
-- the audit row records who made it.

ALTER TABLE "subject"
  ADD COLUMN "requires_surahs" BOOLEAN NOT NULL DEFAULT false;

-- The baseline this platform was bootstrapped with (R108): the tracker, and
-- the one Subject the SRS already says "follows that same per-Level Surah
-- selection". A ONE-TIME data statement against the seeded baseline name — no
-- runtime rule reads a Subject's name, before or after this migration.
UPDATE "subject"
   SET "requires_surahs" = true
 WHERE "tracks_quran_progress" = true
    OR "name" = 'تفسير القرآن';

ALTER TABLE "subject"
  ADD CONSTRAINT "subject_tracker_requires_surahs_check"
  CHECK (NOT "tracks_quran_progress" OR "requires_surahs");

CREATE TABLE "course_schedule_surah" (
  "schedule_id" UUID NOT NULL,
  "surah_id"    INTEGER NOT NULL,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "course_schedule_surah_pkey" PRIMARY KEY ("schedule_id", "surah_id"),
  CONSTRAINT "course_schedule_surah_schedule_id_fkey"
    FOREIGN KEY ("schedule_id") REFERENCES "recurring_course_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "course_schedule_surah_surah_id_fkey"
    FOREIGN KEY ("surah_id") REFERENCES "quran_surah"("surah_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "course_schedule_surah_surah_idx"
  ON "course_schedule_surah" ("surah_id");

CREATE TABLE "session_surah" (
  "session_id" UUID NOT NULL,
  "surah_id"   INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "session_surah_pkey" PRIMARY KEY ("session_id", "surah_id"),
  CONSTRAINT "session_surah_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "session_surah_surah_id_fkey"
    FOREIGN KEY ("surah_id") REFERENCES "quran_surah"("surah_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "session_surah_surah_idx"
  ON "session_surah" ("surah_id");
