-- SRS Revision 170 §6 and §7 (Document Owner, 2026-09-21).
--
-- §6 — A CATEGORY SAYS WHO HOLDS THE LOGIN, AND ITS AGE RANGE.
--
-- `holds_own_login` closes the gap Revision 64 (7) recorded and left open:
-- §2.1 says adults hold their own accounts and minors never do, yet nothing
-- distinguished the adult Category structurally, and matching on its name would
-- hardcode reference data the association may rename.
--
--   true  → its beneficiaries sign in themselves: offered to a woman registering
--           HERSELF, never on a child application;
--   false → its beneficiaries are registered by a guardian: offered on a child
--           application, never to self-registration;
--   NULL  → not stated: offered to both, exactly as before this revision.
--
-- NULLABLE ON PURPOSE (R64.7's own recommendation). A Category that predates the
-- question, or is created by a fixture that never asked it, must not silently
-- become «children only»; the rule binds where somebody has answered it.
--
-- Existing rows ARE answered here, from the one structural fact already held:
-- `self_attendance_allowed` (R123) is true for exactly the population that may
-- act for itself. The Owner can change either answer on «الفئات».
--
-- `min_age` / `max_age` are INFORMATIONAL — shown on «الفئات» and beside the
-- Category on the registration forms — and gate nothing: R64.7 is explicit that
-- this marker «is not an age gate», and placement stays the approver's decision.

ALTER TABLE "category"
  ADD COLUMN "holds_own_login" BOOLEAN,
  ADD COLUMN "min_age" SMALLINT,
  ADD COLUMN "max_age" SMALLINT;

ALTER TABLE "category"
  ADD CONSTRAINT "category_age_range_check" CHECK (
    ("min_age" IS NULL OR "min_age" BETWEEN 0 AND 120)
    AND ("max_age" IS NULL OR "max_age" BETWEEN 0 AND 120)
    AND ("min_age" IS NULL OR "max_age" IS NULL OR "min_age" <= "max_age")
  );

UPDATE "category" SET "holds_own_login" = "self_attendance_allowed";

-- §7 — EVERY BENEFICIARY CARRIES A SPOKEN REFERENCE CODE, ADULTS INCLUDED.
--
-- R62.5 gave one to children only, minted by the one service that admits a
-- child. A person becomes a beneficiary on SEVERAL write paths (approval, a role
-- request, a child application, a self-managed claim, an administrator's edit,
-- an imported fixture), so the guarantee lives where every one of them ends: the row. The same
-- shape and reasoning as `user_beneficiary_birth_date_fill` (R169 §9).
--
-- The code is the application's own (`lib/reference-code.ts`): `BA-` + five
-- characters of an alphabet without 0/O and 1/I/L, drawn at random — never a
-- sequence, which leaks headcount and invites enumeration. Randomness here is
-- `gen_random_uuid()` (core since PostgreSQL 13, CSPRNG-backed): byte 0 of a
-- fresh UUID is fully random, and bytes ≥ 248 are rejected so that `% 31`
-- carries no modulo bias.
--
-- It identifies; it never authorises (R62.5). Nothing here changes that.

CREATE FUNCTION "generate_reference_code"() RETURNS text AS $$
DECLARE
  alphabet CONSTANT text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  body text := '';
  b int;
BEGIN
  WHILE length(body) < 5 LOOP
    b := get_byte(uuid_send(gen_random_uuid()), 0);
    IF b < 248 THEN
      body := body || substr(alphabet, (b % 31) + 1, 1);
    END IF;
  END LOOP;
  RETURN 'BA-' || body;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE FUNCTION "user_beneficiary_reference_code_fill"() RETURNS trigger AS $$
DECLARE
  candidate text;
  attempts int := 0;
BEGIN
  IF NEW."is_beneficiary" AND NEW."deleted_at" IS NULL AND NEW."reference_code" IS NULL THEN
    LOOP
      candidate := "generate_reference_code"();
      -- Counted regardless of `deleted_at`, as `allocateReferenceCode` does: a
      -- code is never handed to a second person.
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "user" WHERE "reference_code" = candidate);
      attempts := attempts + 1;
      IF attempts >= 8 THEN
        RAISE EXCEPTION 'could not allocate a unique reference code';
      END IF;
    END LOOP;
    NEW."reference_code" := candidate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_beneficiary_reference_code_fill_trigger"
  BEFORE INSERT OR UPDATE ON "user"
  FOR EACH ROW EXECUTE FUNCTION "user_beneficiary_reference_code_fill"();

-- Back-fill: a no-op write on every live beneficiary without a code; the
-- trigger above does the rest, one row at a time, each seeing the last.
UPDATE "user" SET "reference_code" = NULL
 WHERE "is_beneficiary" AND "deleted_at" IS NULL AND "reference_code" IS NULL;

-- A deleted (de-identified) row is exempt: R133 CLEARS its code on purpose.
ALTER TABLE "user"
  ADD CONSTRAINT "user_beneficiary_reference_code_check" CHECK (
    NOT "is_beneficiary" OR "deleted_at" IS NOT NULL OR "reference_code" IS NOT NULL
  );

-- §11 — A REFUSED APPLICANT MAY BE TOLD THE REAL REASON (the Owner: «yes,
-- optionally, to be decided by the super admin/admin»).
--
-- `decline_reason` stays what it is — operator-facing, never sent to her
-- (§5.6). `shared_decline_reason` is the sentence the approver CHOSE to share,
-- written only when she ticked «إبلاغ المتقدّمة بهذا السبب», and it is what
-- `GET /profile/role-requests` shows under the declined request. Two columns,
-- because «what we wrote down» and «what we told her» are two facts, and a
-- reason shared by accident is worse than none. Cleared with the decision on
-- re-opening, like the reason itself.
ALTER TABLE "role_request" ADD COLUMN "shared_decline_reason" VARCHAR(500);
