-- SRS Revision 97 — a teaching occurrence is delivered IN PERSON or ONLINE.
--
-- The association teaches some classes over the network. Before this, the model
-- could only say *where in the building*, so an online class had to be faked as
-- a Branch or a Room that does not exist — which would have corrupted the two
-- facts those columns actually carry: R92's physical venue and §4.4c's
-- administrative scope. A class delivered online is still a Targa class.
--
-- **The inheritance mechanism is the one that already exists**, not a new one:
--
--   CourseSchedule.delivery_mode   →  the DEFAULT
--   session.materialize            →  SNAPSHOTS it onto each occurrence (R43.4)
--   session.overridden             →  protects a deliberate per-occurrence change
--
-- exactly as `room_id` has behaved since R43.4. There is deliberately no
-- `delivery_overridden` column: a second override marker would give *«did a
-- human decide about this occurrence?»* two answers that drift.
--
-- **Provider-independent.** No `livekit_*` column appears here or anywhere in
-- this revision. The provider decision is recorded in
-- `docs/development/online-class-provider.md`; the domain must outlive it.

CREATE TYPE "delivery_mode" AS ENUM ('in_person', 'online');
CREATE TYPE "online_media_mode" AS ENUM ('audio_video', 'audio_only');

-- **Existing rows are in-person, and that is a statement of fact rather than a
-- convenience.** Every class the association has ever scheduled on this platform
-- met physically at a Branch: the columns that exist are `branch_id` and
-- `room_id`, and no other delivery has ever been representable. The default
-- therefore preserves exactly what is on the screens today, and fabricates
-- nothing — `NOT NULL DEFAULT 'in_person'` backfills every row in one statement.

ALTER TABLE "recurring_course_schedule"
  ADD COLUMN "delivery_mode" "delivery_mode" NOT NULL DEFAULT 'in_person',
  ADD COLUMN "online_media_mode" "online_media_mode";

ALTER TABLE "session"
  ADD COLUMN "delivery_mode" "delivery_mode" NOT NULL DEFAULT 'in_person',
  ADD COLUMN "online_media_mode" "online_media_mode";

-- **The invariant lives in the database as well as at the boundary.**
--
-- `(delivery_mode = 'online') = (online_media_mode IS NOT NULL)` is an
-- equivalence, not an implication: it refuses an online row with no media mode
-- AND an in-person row carrying one. The second half is the one an application
-- check tends to forget, and a stray `audio_only` on an in-person class is
-- exactly the stale field §7 requires be refused rather than ignored.

ALTER TABLE "recurring_course_schedule"
  ADD CONSTRAINT "course_schedule_delivery_check"
  CHECK (("delivery_mode" = 'online') = ("online_media_mode" IS NOT NULL));

ALTER TABLE "session"
  ADD CONSTRAINT "session_delivery_check"
  CHECK (("delivery_mode" = 'online') = ("online_media_mode" IS NOT NULL));

-- **An online occurrence holds NO room, enforced rather than filtered.**
--
-- The alternative was to leave a stale `room_id` on an online row and teach the
-- conflict detector to skip it. That would have put the rule in one query and
-- left every other reader — the calendar, the details dialog, the session list,
-- and whatever is written next — free to render a room for a class that has no
-- venue. Making the state unrepresentable means room-collision detection needs
-- no special case at all: an online session simply has nothing to collide over.
--
-- Staff-time collisions are untouched and remain real: a مؤطِّرة cannot teach an
-- online class and an in-person one at the same hour.

ALTER TABLE "recurring_course_schedule"
  ADD CONSTRAINT "course_schedule_online_no_room_check"
  CHECK ("delivery_mode" = 'in_person' OR "room_id" IS NULL);

ALTER TABLE "session"
  ADD CONSTRAINT "session_online_no_room_check"
  CHECK ("delivery_mode" = 'in_person' OR "room_id" IS NULL);
