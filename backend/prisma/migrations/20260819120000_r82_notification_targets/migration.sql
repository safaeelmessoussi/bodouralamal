-- Revision 82 — a notification may be about a Session, an Event, or a published grade.
--
-- R77 gave `notification` a `session_id` that is NOT NULL, which was right while
-- the only event was a cancelled class. Three nullable foreign keys replace it,
-- with a CHECK requiring **exactly one** to be set: real FKs rather than a
-- `target_type`/`target_id` pair, because a polymorphic pair cannot be
-- constrained by the database and this codebase resolves references through
-- foreign keys everywhere.
--
-- **Every existing row is preserved**, keeps its `session_id`, and is asserted
-- below to satisfy the new constraint before that constraint is added.

-- ── 1. The new targets ──────────────────────────────────────────────────────
ALTER TABLE "notification" ADD COLUMN "event_id" UUID;
ALTER TABLE "notification" ADD COLUMN "exam_id" UUID;

ALTER TABLE "notification"
  ADD CONSTRAINT "notification_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification"
  ADD CONSTRAINT "notification_exam_id_fkey"
  FOREIGN KEY ("exam_id") REFERENCES "exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 2. `session_id` becomes optional ────────────────────────────────────────
--
-- contract-phase: R82 widens the target from *a Session* to *one of three*. No
-- data is dropped and no column is removed — the NOT NULL goes, the column and
-- every value in it stay.
ALTER TABLE "notification" ALTER COLUMN "session_id" DROP NOT NULL;

-- ── 3. Exactly one target, enforced by the database ─────────────────────────
--
-- **Asserted before it is imposed.** Every existing row carries a session and no
-- event or exam, so the count is 1 for all of them; if that is ever untrue the
-- migration must stop rather than let a constraint creation fail halfway with
-- nothing said about which rows disagreed.
DO $$
DECLARE bad INT;
BEGIN
  SELECT COUNT(*) INTO bad
  FROM "notification"
  WHERE (("session_id" IS NOT NULL)::INT + ("event_id" IS NOT NULL)::INT + ("exam_id" IS NOT NULL)::INT) <> 1;
  IF bad > 0 THEN
    RAISE EXCEPTION 'R82: % notification row(s) do not carry exactly one target; migration aborted', bad;
  END IF;
END $$;

ALTER TABLE "notification"
  ADD CONSTRAINT "notification_exactly_one_target"
  CHECK (
    (("session_id" IS NOT NULL)::INT + ("event_id" IS NOT NULL)::INT + ("exam_id" IS NOT NULL)::INT) = 1
  );

-- ── 4. Idempotency per target ───────────────────────────────────────────────
--
-- R77.5's `(user, session, type)` unique index is what makes a repeated write
-- the same row rather than a second copy of the same news. The two new targets
-- need the same protection, and get it as partial unique indexes — a plain
-- unique over nullable columns would not constrain anything, since NULLs never
-- collide in PostgreSQL.
CREATE UNIQUE INDEX "notification_user_event_type_key"
  ON "notification" ("user_id", "event_id", "type")
  WHERE "event_id" IS NOT NULL;
CREATE UNIQUE INDEX "notification_user_exam_type_key"
  ON "notification" ("user_id", "exam_id", "type")
  WHERE "exam_id" IS NOT NULL;

-- ── 5. The new types ────────────────────────────────────────────────────────
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'event_created';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'event_rescheduled';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'event_cancelled';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'grade_published';
