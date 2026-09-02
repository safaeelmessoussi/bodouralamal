-- Remove the StudentSocialProfile processing capability entirely
-- (Owner decision, 2026-09-02 — SRS Revision 120).
--
-- ## Why a table is being dropped rather than left unused
--
-- `student_social_profile` held minors' **health condition**, family situation,
-- home address, siblings count and both parents' names and professions. It was
-- specified by §4.10/BR-16 and implemented behind the platform's most
-- restrictive authorization — and **no product surface ever collected it**: no
-- registration field, no add-child field, no beneficiary profile, no parent,
-- teacher or administrative screen. The frontend contains no reference to it at
-- all.
--
-- A capability nobody uses is not harmless. The table, its routes and its
-- permissions are a live ability to collect health data about children, and the
-- Owner's data-minimisation decision is that the association does not collect
-- personal-data categories its operations do not need. **Withdrawing the
-- feature means removing it, not hiding it** — an unused endpoint is still a
-- capability, and an empty column is still a declared purpose.
--
-- contract-phase: TD-6b — this is a CONTRACT-phase drop with no expand and no
-- migrate step, and deliberately so. There is nothing to migrate: the table was
-- never populated by any product surface, and both installations that exist
-- hold zero rows. There is nothing to deprecate towards either — the Owner's
-- decision is that the association does not collect this category of personal
-- data at all, so a transitional column or a renamed successor would preserve
-- exactly the capability being withdrawn. The reader protection TD-6b asks for
-- is supplied instead by the row-count guard below, which refuses the drop
-- rather than trusting this note (SRS Revision 120).
--
-- ## The guard, and why it is a hard database guard
--
-- This DROP is irreversible and the table is the only place its data ever
-- lived, so the migration **refuses to run against a non-empty table**. It is
-- expressed in SQL rather than in a checklist because a checklist is not
-- executed on the host that actually runs `migrate deploy`.
--
-- Verified read-only before writing this migration: Localhost 0 rows, Staging 0
-- rows (`select count(*) from student_social_profile`). Production is not
-- deployed. If any installation does hold a row, this raises and the deployment
-- stops with the count in the message, so a human decides what happens to it —
-- which is the correct outcome, because nothing here can know whether that row
-- is evidence somebody needs.
--
-- Dropping the table removes its primary key, its unique index on
-- `student_id`, and its foreign key to `"user"` with it; they are named here
-- for the reader rather than dropped separately, because a partial teardown
-- would leave the schema in a state no migration describes.

DO $$
DECLARE
  remaining bigint;
BEGIN
  IF to_regclass('public.student_social_profile') IS NULL THEN
    -- Already absent: a re-run, or an installation created after this revision.
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.student_social_profile' INTO remaining;

  IF remaining > 0 THEN
    RAISE EXCEPTION
      'refusing to drop student_social_profile: % row(s) present. This table held health and family data about minors; a human must decide what happens to it before the capability is withdrawn (SRS Revision 120).',
      remaining;
  END IF;

  -- `student_social_profile_student_id_fkey` and
  -- `student_social_profile_student_id_key` go with the table.
  DROP TABLE public.student_social_profile;
END
$$;
