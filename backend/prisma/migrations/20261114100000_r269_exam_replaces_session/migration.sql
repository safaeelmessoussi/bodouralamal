-- R269 — a class occurrence changed into an exam («تعديل الحصة» → النوع).
--
-- The exam REPLACES the class: it targets that Session (`target_kind =
-- 'session'`, so its audience is the class's own) and keeps its date, times,
-- branch and room. The Session row stays — its recordings, files and online
-- room are still its own — and every calendar hides it while a live exam
-- replaces it. Deleting the exam brings the class back.
ALTER TABLE "exam" ADD COLUMN "replaces_session" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "exam"
  ADD CONSTRAINT "exam_replaces_session_target_check"
  CHECK (NOT "replaces_session" OR ("target_kind" = 'session' AND "session_id" IS NOT NULL));

-- One live replacement per class.
CREATE UNIQUE INDEX "exam_replaces_session_live_key"
  ON "exam" ("session_id")
  WHERE "replaces_session" AND "deleted_at" IS NULL;

-- A class delivered عن بُعد has no room (`session_online_no_room_check`), so the
-- exam that replaces it has none either: its place is the class's own call.
-- contract-phase: the CHECK is dropped only to be re-added at once below with
-- one more accepted arm; no column or data is removed, and every row the old
-- CHECK accepted the new one accepts too.
ALTER TABLE "exam" DROP CONSTRAINT "exam_physical_place_all_or_none_check";
ALTER TABLE "exam"
  ADD CONSTRAINT "exam_physical_place_all_or_none_check"
  CHECK (
    "mode" <> 'physical'
    OR (
      ("branch_id" IS NOT NULL AND "room_id" IS NOT NULL
       AND "start_time" IS NOT NULL AND "end_time" IS NOT NULL)
      OR
      ("branch_id" IS NULL AND "room_id" IS NULL
       AND "start_time" IS NULL AND "end_time" IS NULL)
      OR
      ("replaces_session" AND "branch_id" IS NOT NULL AND "room_id" IS NULL
       AND "start_time" IS NOT NULL AND "end_time" IS NOT NULL)
    )
  );
