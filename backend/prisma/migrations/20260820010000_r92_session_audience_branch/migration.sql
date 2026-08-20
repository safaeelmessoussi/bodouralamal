-- SRS Revision 92 — ONE occurrence may draw its audience from several Branches.
--
-- The association occasionally delivers a lesson once instead of twice: the
-- Targa class and the second branch's class meet together, physically at Targa,
-- for that occurrence only. The platform could not express it, and every
-- alternative corrupts something durable — moving an Enrollment's branch,
-- enrolling people into a branch they do not attend, duplicating the Session, or
-- merging two CourseSchedules permanently.
--
-- **This is an OCCURRENCE-LEVEL AUDIENCE OVERRIDE and nothing else.**
--
--   no rows for a Session  →  audience is INHERITED from its CourseSchedule
--   rows exist             →  they ARE the audience's branches for that Session
--
-- *Replaces*, never *adds to*: an additive reading leaves nobody able to say
-- whether the schedule's own branch is still included, and the administrator
-- would have to reason about two rules at once. The interface seeds the override
-- with the inherited branch already selected, so *combine* is expressed by
-- adding the second one — which is the same thing said unambiguously.

CREATE TABLE "session_audience_branch" (
  "session_id" UUID NOT NULL,
  "branch_id"  UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "session_audience_branch_pkey" PRIMARY KEY ("session_id", "branch_id"),
  CONSTRAINT "session_audience_branch_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "session_audience_branch_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The pair IS the fact, so it is the primary key: naming one branch twice for
-- one occurrence is not two statements. No surrogate id, and no soft delete —
-- removing a branch from an occurrence's audience is not an event with a
-- history, it is a correction to a plan, and the audit row records who made it.

CREATE INDEX "session_audience_branch_branch_idx"
  ON "session_audience_branch" ("branch_id");

-- **SCOPE, not a roster.** The override stores which BRANCH POPULATIONS attend,
-- resolved against live Enrollments at read time exactly as §4.4c already
-- resolves every audience. It deliberately does NOT snapshot the people:
-- §20 rule 22 and R43's whole design keep the audience derived, and a stored
-- roster would diverge from the group it came from the moment anybody enrolled
-- or moved. Attendance — who actually came — is §4.7 and is not built.
--
-- **The physical venue is untouched.** A Session happens where its schedule's
-- branch and its own room say; this table says who is expected there. The two
-- were one field for as long as an occurrence had one branch, and R92 separates
-- the facts rather than overloading the column.
