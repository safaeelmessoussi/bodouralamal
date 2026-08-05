-- Revision 49 (proposed) — `User.intended_category_id`.
--
-- WHAT THE APPLICANT ASKED FOR, exactly as `intended_branch_id` (R39) is.
--
-- §4.1 step 1 requires the approval screen to preselect "the first Level of the
-- applicant's Category", and **nothing recorded a Category**: §4.1b step 5
-- collects a branch "and no other organisational value", so the clause was
-- unimplementable. This column is the one fact that was missing.
--
-- **A request, not a placement.** It narrows and preselects the Levels the
-- approver is offered; the approver may choose any Level, and the enrolment is
-- what actually admits the person (§4.1). Nothing follows from this column
-- automatically.
--
-- **RESTRICT, deliberately.** A Category with pending requests pointing at it
-- must not vanish underneath them — the approval screen would be left
-- preselecting from a Category that no longer exists. `category.service`
-- refuses the delete while any PENDING request references it and names the
-- count; once those are decided, the soft delete proceeds and the decided rows
-- keep pointing at a soft-deleted Category, so historical requests stay
-- readable. (Document Owner decision, 2026-08-05.)
ALTER TABLE "user"
  ADD COLUMN "intended_category_id" UUID,
  ADD CONSTRAINT "user_intended_category_id_fkey"
    FOREIGN KEY ("intended_category_id") REFERENCES "category"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- The approval queue reads pending rows and joins this; the deletion guard
-- counts pending rows BY category, which is the query this serves.
CREATE INDEX "user_intended_category_id_idx" ON "user" ("intended_category_id")
  WHERE "intended_category_id" IS NOT NULL;
