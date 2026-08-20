-- SRS Revision 96 — EVERY platform person carries one stable, opaque QR identity.
--
-- Not a beneficiary feature. A beneficiary, a child, a teenager, a guardian, a
-- مؤطِّرة, an assistant, an Admin, a Super Admin and somebody holding several of
-- those at once all get exactly one, and it is the SAME one for the whole life
-- of the person.
--
-- **It belongs to the person, not to anything the person currently is.**
-- Independent of role, of `is_beneficiary`, of Enrollment, of FamilyLink, of
-- academic year, of Branch and of Level. Roles change; educational placement
-- changes; families are linked and unlinked. None of that reissues an identity,
-- because none of it makes somebody a different human being.
--
-- **It identifies; it never authenticates.** The value is not secret and grants
-- nothing: scanning it resolves a person, and every operation that follows runs
-- the caller's own authorization exactly as if the person had been named by id.
-- This is R62.5's rule for `reference_code`, restated here because a second
-- opaque identifier must not quietly acquire different powers.
--
-- ## Why a dedicated column rather than reusing `id` or `reference_code`
--
-- `user.id` is already a random UUIDv4 and would have needed no migration at
-- all — but it is referenced by every foreign key in the schema, so a card that
-- has to be reissued could never be reissued: rotation would mean rewriting the
-- person's entire history. Printing the primary key also gives one name to two
-- concepts (§20 rule 22): *the row's identity* and *the value on a physical
-- card* are not the same thing and must be able to diverge.
--
-- `reference_code` (R62) is the right DOCTRINE and the wrong value. It is drawn
-- from a 31-character human alphabet, five characters long, because it is read
-- down a telephone and copied onto paper — 31^5 ≈ 28.6 million, which is ample
-- for that job and small for one exposed as a scannable payload. It also
-- remains, by R62, a students' code. The two identifiers answer two questions:
-- one is SPOKEN, this one is SCANNED.
--
-- ## Why the default lives in the DATABASE
--
-- `gen_random_uuid()` as a column default makes the invariant unforgettable
-- rather than merely documented. Every creation path gets one — registration,
-- child-application approval, staff pre-provisioning, the Super Admin bootstrap,
-- an Admin-created account, every seed and fixture, a raw `INSERT` in a
-- migration, and every path nobody has written yet. A Prisma-side default would
-- have covered only the paths that go through Prisma, which is exactly the kind
-- of "every caller must remember" rule this project has watched go missing
-- before.

-- 1. Add it nullable, so the backfill has something to write into.
ALTER TABLE "user" ADD COLUMN "user_qr_ref" UUID;

-- 2. Backfill EVERY existing row, including soft-deleted ones. A restored
--    person must come back with the identity she had: `deleted_at` is not a
--    reason to be a different human being.
UPDATE "user" SET "user_qr_ref" = gen_random_uuid() WHERE "user_qr_ref" IS NULL;

-- 3. Now the invariant can be unconditional — no "beneficiaries only" predicate,
--    no partial index, nothing to reason about per role.
ALTER TABLE "user" ALTER COLUMN "user_qr_ref" SET NOT NULL;
ALTER TABLE "user" ALTER COLUMN "user_qr_ref" SET DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "user_user_qr_ref_key" ON "user"("user_qr_ref");
