-- R117: retain the optional child identity details that the public form already
-- accepts so an authorised approver can review the submission faithfully.
-- Nullable by design: older applications did not persist these answers and
-- must remain distinguishable from an applicant who supplied them.
ALTER TABLE "child_application"
  ADD COLUMN "first_name_french" VARCHAR(60),
  ADD COLUMN "last_name_french" VARCHAR(60),
  ADD COLUMN "nickname" VARCHAR(60);
