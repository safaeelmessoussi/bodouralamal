-- Remove `exam.access_policy` and the `exam_access_policy` enum — a declared
-- alternative that was never implemented and that R124 contradicted
-- (Owner decision, 2026-09-03 — SRS Revision 127).
--
-- ## Why the column goes rather than gaining an implementation
--
-- `access_policy` has existed since the initial schema, `NOT NULL DEFAULT
-- 'save_and_resume'`, as part of R56/R58's online-exam design — the same family
-- of decisions in which `online` was declared and then refused. Its second
-- value, `single_submission`, was never built:
--
--   * the only writer in the repository is the development seed fixture;
--   * the only reader selects it into `ASSESSMENT_SELECT` and never branches
--     on it;
--   * `SINGLE_SUBMISSION_FINAL` sat in the error catalogue with no thrower;
--   * no write boundary ever accepted the field, and a frontend guard pinned
--     it off the wire.
--
-- R124 then built the assessment flow **without** it and ratified the opposite
-- rule unconditionally — *«a student saves an incomplete draft and returns to
-- it»* — which contradicted §17's *«single_submission exams skip resume»*. The
-- Owner has resolved that contradiction in favour of R124: save-and-resume is
-- the only response policy in v1, SAVE ≠ SUBMIT, and Final Submit is explicit
-- and final.
--
-- **An unused capability is still a capability** (R111 clause 2). An empty
-- alternative is a declared behaviour that a future maintainer will implement
-- by guessing its semantics from the enum name, so the field is removed rather
-- than documented as dormant.
--
-- contract-phase: TD-6b — a CONTRACT-phase drop with no expand and no migrate
-- step, deliberately. There is nothing to migrate towards: the decision is that
-- a second policy does not exist, so a transitional column would preserve
-- exactly the capability being withdrawn. TD-6b's reader protection is supplied
-- by the guard below, which refuses the drop rather than trusting this note.
--
-- ## The guard
--
-- Every row carries a value here, so "is the column empty" is not the question
-- the way it was for `user.notes`. The question is whether anybody ever stated
-- the **withdrawn** intention: a row reading `single_submission` is a person's
-- recorded decision that their exam is one-shot, and destroying it silently
-- would change what that exam is. The migration therefore refuses while any
-- such row exists and reports how many, so a human decides first.
--
-- The default value is not evidence of an intention — it is what every row got
-- for free — so `save_and_resume` rows pass without comment.
--
-- Verified read-only before this migration was written:
--   Localhost — 1 exam, 1 save_and_resume, 0 single_submission.
-- Staging was NOT queried in this session and Production is not deployed; the
-- guard below is what makes the check authoritative wherever this runs.

DO $$
DECLARE
  stated bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'exam' AND column_name = 'access_policy'
  ) THEN
    -- Already absent: a re-run, or an installation created after this revision.
    RETURN;
  END IF;

  EXECUTE $q$SELECT count(*) FROM public.exam WHERE access_policy = 'single_submission'$q$
    INTO stated;

  IF stated > 0 THEN
    RAISE EXCEPTION
      'refusing to drop exam.access_policy: % exam(s) are set to single_submission. That is a recorded decision that those sittings are one-shot, and v1 has no behaviour to carry it; a human must decide what happens to them before the field is withdrawn (SRS Revision 127).',
      stated;
  END IF;

  ALTER TABLE public.exam DROP COLUMN access_policy;
END
$$;

-- The type outlives the column it was created for, so it is dropped in the same
-- step. `IF EXISTS` keeps the pair idempotent on a re-run; nothing else in the
-- schema references it, which is what makes the drop safe rather than merely
-- possible.
DROP TYPE IF EXISTS public.exam_access_policy;
