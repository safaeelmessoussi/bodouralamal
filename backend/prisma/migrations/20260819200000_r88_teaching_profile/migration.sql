-- Revision 88 — the teaching profile: what a مؤطِّرة CAN teach and WHEN.
--
-- **Planning data, and nothing else.** It helps the administration choose
-- assignments before the year starts; it grants no operational authority
-- whatever it says. Authority remains `CourseScheduleStaff`/`SessionStaff`,
-- unchanged by this migration.
--
-- Three tables rather than columns on `user`, because the project models
-- reference-data relationships relationally everywhere else and each of these
-- is genuinely many-per-person.

-- ── Subjects she declares she can teach ─────────────────────────────────────
CREATE TABLE "teacher_subject_capability" (
  "user_id"    UUID NOT NULL REFERENCES "user"("id")    ON DELETE RESTRICT ON UPDATE CASCADE,
  "subject_id" UUID NOT NULL REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- The pair IS the fact, so it is the key: declaring the same Subject twice is
  -- not a second declaration.
  PRIMARY KEY ("user_id", "subject_id")
);
CREATE INDEX "teacher_subject_capability_subject_idx" ON "teacher_subject_capability" ("subject_id");

-- ── Categories she is interested in teaching ────────────────────────────────
CREATE TABLE "teacher_category_capability" (
  "user_id"     UUID NOT NULL REFERENCES "user"("id")     ON DELETE RESTRICT ON UPDATE CASCADE,
  "category_id" UUID NOT NULL REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "category_id")
);
CREATE INDEX "teacher_category_capability_category_idx" ON "teacher_category_capability" ("category_id");

-- ── When she is available, as real clock ranges ─────────────────────────────
--
-- Wall-clock times (TD-11), never instants: *available Thursday 15:00–18:00* is
-- true at each branch's own clock, exactly as a class's times are. Precise
-- ranges rather than morning/afternoon, because start/end IS the scheduling
-- primitive and a coarser store could not answer *does this class fit*.
CREATE TABLE "teacher_availability" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "user_id"    UUID NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "weekday"    "day_of_week" NOT NULL,
  "start_time" TIME(0) NOT NULL,
  "end_time"   TIME(0) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  -- A range that ends before it starts is not a range.
  CONSTRAINT "teacher_availability_order_check" CHECK ("start_time" < "end_time"),
  -- **The same range twice is one range.** Overlaps are refused in the service,
  -- where a helpful message can name the range that conflicts; the database
  -- catches only the exact duplicate, which is what a unique index can express.
  CONSTRAINT "teacher_availability_unique" UNIQUE ("user_id", "weekday", "start_time", "end_time")
);
CREATE INDEX "teacher_availability_user_idx" ON "teacher_availability" ("user_id", "weekday");
