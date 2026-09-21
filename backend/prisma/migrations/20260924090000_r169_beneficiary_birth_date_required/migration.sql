-- SRS Revision 169 §9 — a date of birth for every beneficiary (Document Owner,
-- 2026-09-21: «fill records without birth dates with any dates, just to be
-- able to make birth date mandatory»).
--
-- R130 left `user.birth_date` nullable because some beneficiaries had none and
-- «inventing one would be indistinguishable from a recorded fact». The Owner
-- now wants the rule enforced, and accepts a filled-in date to get there. The
-- one thing that must not happen is the invented date PASSING for a real one:
-- a date of birth decides minor/adult status and who may claim a self-managed
-- account at eighteen (R132), and «completion, never correction» (R130) would
-- stop anybody fixing it.
--
-- So the filled date is MARKED. `birth_date_is_placeholder` says «this is not
-- her date of birth»; the value is one fixed, unmistakable day (1900-01-01);
-- every rule that reads an age treats a placeholder as UNKNOWN, exactly as it
-- treated NULL; and recording the real date replaces it once and clears the
-- mark.

ALTER TABLE "user"
  ADD COLUMN "birth_date_is_placeholder" BOOLEAN NOT NULL DEFAULT false;

-- Every beneficiary who can still be looked at: the live ones, and a
-- soft-deleted one whose Trash entry still exists (she can be restored, and a
-- restore must not trip the CHECK below). A DE-IDENTIFIED account has no Trash
-- entry — de-identification removes it in the same transaction — and keeps its
-- NULL: nothing is invented about a person the platform erased.
UPDATE "user" u
   SET "birth_date" = DATE '1900-01-01',
       "birth_date_is_placeholder" = true
 WHERE u."is_beneficiary"
   AND u."birth_date" IS NULL
   AND (
     u."deleted_at" IS NULL
     OR EXISTS (SELECT 1 FROM "trash" t WHERE t."target_entity" = 'User' AND t."target_id" = u."id")
   );

-- ONE place applies the Owner's rule, and it is here. Whatever path makes a
-- person a beneficiary — an approval, a per-role decision, a child application,
-- a restore from the Trash, a script, a path nobody has written yet — a live
-- beneficiary row that would carry no date gets the MARKED placeholder instead.
-- No service has to remember, and none can forget. It also keeps the mark
-- honest: writing any other date clears it.
CREATE FUNCTION "user_beneficiary_birth_date_fill"() RETURNS trigger AS $$
BEGIN
  IF NEW."is_beneficiary" AND NEW."deleted_at" IS NULL AND NEW."birth_date" IS NULL THEN
    NEW."birth_date" := DATE '1900-01-01';
    NEW."birth_date_is_placeholder" := true;
  ELSIF NEW."birth_date" IS DISTINCT FROM DATE '1900-01-01' THEN
    NEW."birth_date_is_placeholder" := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_beneficiary_birth_date_fill"
  BEFORE INSERT OR UPDATE OF "is_beneficiary", "birth_date", "deleted_at", "birth_date_is_placeholder"
  ON "user"
  FOR EACH ROW EXECUTE FUNCTION "user_beneficiary_birth_date_fill"();

-- The backstops. A deleted row is exempt: de-identification erases the date
-- of birth (R130/R133 — removed, never transformed) and leaves the row.
ALTER TABLE "user"
  ADD CONSTRAINT "user_beneficiary_birth_date_check"
  CHECK (NOT "is_beneficiary" OR "deleted_at" IS NOT NULL OR "birth_date" IS NOT NULL);

-- A mark without its date, or on a real date, would make the mark meaningless.
ALTER TABLE "user"
  ADD CONSTRAINT "user_birth_date_placeholder_check"
  CHECK (NOT "birth_date_is_placeholder" OR "birth_date" = DATE '1900-01-01');
