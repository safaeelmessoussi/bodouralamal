-- SRS Revision 109 — a scheduling item's VISIBILITY is its own fact, on all
-- three kinds.
--
-- Before this, only an `Event` carried a tier. A حصة was public to the world
-- because R43 said so, and an امتحان had no tier at all because §4.6 said it
-- "appears to the audience that can see the level it belongs to" — which is a
-- statement about audience, not about publication. So the association could
-- announce a celebration and not a class, and could not arrange a sitting
-- quietly at all.
--
-- **The inheritance mechanism is the one that already exists**, not a new one —
-- the same three lines R97 wrote for delivery:
--
--   recurring_course_schedule.visibility  →  the DEFAULT (the template)
--   session.materialize                   →  SNAPSHOTS it onto each occurrence
--   session.overridden                    →  protects a per-occurrence decision
--
-- There is deliberately no `visibility_overridden` column: a second override
-- marker would give *«did a human decide about this occurrence?»* two answers
-- that drift.

-- ── The three new columns ──────────────────────────────────────────────────
--
-- **`public` backfills every existing row, and that is a statement of fact
-- rather than a convenience.** §4.4 (Revision 43) made the timetable browsable
-- by anonymous visitors — *"Sessions are PUBLIC"* — and §4.6 put every physical
-- sitting on that same public grid. Every schedule, occurrence and exam in the
-- database today is therefore public in fact, and `NOT NULL DEFAULT 'public'`
-- records exactly what is on the screens rather than changing it.
--
-- The alternative — backfilling `private` — would have removed the public
-- timetable overnight, which is the one outcome a *reconciliation* must not
-- produce.

ALTER TABLE "recurring_course_schedule"
  ADD COLUMN "visibility" "visibility" NOT NULL DEFAULT 'public';

ALTER TABLE "session"
  ADD COLUMN "visibility" "visibility" NOT NULL DEFAULT 'public';

ALTER TABLE "exam"
  ADD COLUMN "visibility" "visibility" NOT NULL DEFAULT 'public';

-- ── The Event default moves, for NEW rows only ────────────────────────────
--
-- `private` was the value an administrator got by not choosing, which made the
-- unchosen outcome *«nobody outside the office can see this»*. The
-- association's activities are announcements far more often than they are
-- secrets, so the unchosen value is now the announcing one.
--
-- **Stored tiers are untouched.** A default governs inserts; rewriting existing
-- rows here would publish activities somebody deliberately hid, and no Owner
-- decision authorises that. This statement therefore has no data effect at all
-- — which is precisely why it is safe.

ALTER TABLE "event"
  ALTER COLUMN "visibility" SET DEFAULT 'public';

-- ── Reading a date window AT A TIER ───────────────────────────────────────
--
-- `event` has carried `("start_date", "visibility")` since it shipped, because
-- that pair is what the calendar actually asks. The other two kinds now answer
-- the same question and get the same index.

CREATE INDEX "session_date_visibility_idx" ON "session" ("date", "visibility");
CREATE INDEX "exam_date_visibility_idx" ON "exam" ("date", "visibility");
