-- Revision 79 — beneficiary status becomes a durable fact (§7, §4.1, §4.3).
--
-- WHY A COLUMN AND NOT A LOOKUP.
--
-- Nothing in the model could answer "is this person a beneficiary". The role
-- cannot: a minor beneficiary holds no role row at all (§4.3) and one account
-- may hold both `teacher` and `student`. An `Enrollment` cannot either, and the
-- reason is circular rather than incidental — enrolment would be the
-- precondition for being enrollable, and a beneficiary between enrolments would
-- cease to be one. `requested_role` and `intended_category_id` are cleared at
-- approval by design, because they are REQUEST fields consumed by the decision.
--
-- Additive and safe on a populated table: non-null with a `false` default, so
-- every existing row is valid the instant the column exists. The backfill below
-- then raises only the rows for which there is CONCLUSIVE evidence.

ALTER TABLE "user"
    ADD COLUMN "is_beneficiary" BOOLEAN NOT NULL DEFAULT false;

-- **Enrolment is EVIDENCE for the backfill, never the runtime DEFINITION**
-- (R79.6). A live or soft-deleted enrolment proves the institute already
-- treated this person as a beneficiary — that is a fact about the past and is
-- conclusive. Reading it at runtime would be the circularity above.
--
-- Soft-deleted rows count deliberately: a beneficiary whose enrolment ended is
-- still a beneficiary (R79.4), and excluding them would re-create the very
-- coupling this revision removes.
UPDATE "user" u
   SET "is_beneficiary" = true
 WHERE EXISTS (SELECT 1 FROM "enrollment" e WHERE e."student_id" = u."id");

-- Rows with no such evidence stay `false` and are REPORTED rather than guessed:
-- a staff account, a guardian and a never-yet-enrolled beneficiary are
-- indistinguishable from here, and inventing a rule to separate them is exactly
-- what R79 exists to stop.
