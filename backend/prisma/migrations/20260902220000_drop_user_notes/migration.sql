-- Remove `user.notes` — generic applicant free text with no bounded purpose
-- (Owner decision, 2026-09-02 — SRS Revision 121).
--
-- ## Why the column goes rather than the control
--
-- `notes` was 2 000 characters of unbounded free text rendered as «ملاحظات
-- (اختياري)» on the PUBLIC registration form, so an applicant could volunteer
-- anything into it — a health condition, a custody arrangement, a judicial
-- matter — into a platform that deliberately collects none of those. It was
-- also staff-editable and shown to approvers. What it never had is a **stated
-- operational purpose**: no requirement anywhere says what it is for or who
-- must read it.
--
-- The same reasoning already applied to children: R62.1 excluded `notes` from
-- the child shape in terms, because *"free text about a child, with no stated
-- purpose and no reader, is where a diagnosis or a custody arrangement gets
-- written in good faith"*. The Owner now applies that to every person.
--
-- **Hiding the control would not withdraw the capability.** The column would
-- still accept 2 000 characters through the API, and an empty column is still a
-- declared purpose. So the field is removed.
--
-- contract-phase: TD-6b — a CONTRACT-phase drop with no expand and no migrate
-- step, deliberately. There is nothing to migrate: both installations hold zero
-- values (verified below), and there is nothing to deprecate towards, because
-- the decision is that the association does not collect generic free text at
-- all. A transitional column would preserve exactly the capability being
-- withdrawn. TD-6b's reader protection is supplied instead by the guard below,
-- which refuses the drop rather than trusting this note.
--
-- ## The guard
--
-- A dropped column cannot be recovered, and this one was the only place its
-- content ever lived. The migration therefore refuses to run while any row
-- holds a value that is not NULL and not blank, and reports how many — so a
-- human decides what happens to somebody's words before they are destroyed.
--
-- **Blank-but-not-null is treated as no value**, deliberately: a row holding
-- `''` or whitespace carries nothing anybody wrote, and refusing on it would
-- block the migration over an artefact rather than over content.
--
-- Verified read-only before this migration was written:
--   Localhost — 73 users, 0 non-null, 0 non-empty.
--   Staging   — 14 users, 0 non-null, 0 non-empty.
-- Production is not deployed.

DO $$
DECLARE
  remaining bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'notes'
  ) THEN
    -- Already absent: a re-run, or an installation created after this revision.
    RETURN;
  END IF;

  EXECUTE $q$SELECT count(*) FROM public."user" WHERE btrim(coalesce(notes, '')) <> ''$q$
    INTO remaining;

  IF remaining > 0 THEN
    RAISE EXCEPTION
      'refusing to drop user.notes: % row(s) hold a value. This column was unbounded free text an applicant could write anything into; a human must decide what happens to it before the field is withdrawn (SRS Revision 121).',
      remaining;
  END IF;

  ALTER TABLE public."user" DROP COLUMN notes;
END
$$;
