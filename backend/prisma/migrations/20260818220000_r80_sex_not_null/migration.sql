-- Revision 80 — `user.sex` becomes NOT NULL (§7, R27, R80.5).
--
-- WHY THIS MIGRATION REFUSES RATHER THAN DEFAULTS.
--
-- R27 made `sex` the person-side half of `Level.gender_restriction`, and a NULL
-- has always meant *not eligible* rather than *unknown-but-fine*. R80 closes the
-- capture gap — every creation path now records one, and a missing value is
-- COMPLETED explicitly by an administrator — so the column can finally be
-- required.
--
-- It must never invent a value. Backfilling a default here would be precisely
-- the inference the revision forbids, and it would be indistinguishable
-- afterwards from a value somebody actually recorded. So the migration ASSERTS
-- the precondition and aborts, naming the count, if it does not hold.

DO $$
DECLARE
  missing INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing FROM "user" WHERE "sex" IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION
      'Refusing to contract user.sex to NOT NULL: % row(s) still have no recorded sex. '
      'Complete them through PATCH /admin/users/{id} (SRS Revision 80.3) — an administrator '
      'records what is known. Nothing here may infer a value from a name, a role or a title.',
      missing;
  END IF;
END $$;

-- Soft-deleted rows are included in the check above deliberately: the column is
-- constrained for the whole table, and a restored person must not resurrect a
-- NULL the constraint would then reject.
ALTER TABLE "user" ALTER COLUMN "sex" SET NOT NULL;
