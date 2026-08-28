-- A partner carries a description beside its name (Owner, 2026-08-28).
--
-- NEW N deliberately gave `Partner` a name and nothing else, on the rule that a
-- column exists for a fact the platform holds rather than one it might. The
-- Owner now supplies that fact, so the column follows the decision rather than
-- anticipating it.
--
-- **Nullable, and it stays nullable.** A partner with no description is the
-- ordinary case, not an incomplete row — the same treatment `Category` and
-- `Level` descriptions got, and the Branch contact fields before them.
--
-- `VARCHAR(500)`: a sentence under a name on a public page, not a page of its
-- own. The length is what says so.

ALTER TABLE "partner" ADD COLUMN "description" VARCHAR(500);
