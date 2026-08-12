-- Revision 68 — the identity-binding review item (§4.3, R62.9).
--
-- When a student who has approved parent links binds their FIRST login, a
-- minor with parents acting for them has become a person with their own
-- account. §4.3 is explicit that the links are NOT revoked automatically: a
-- non-blocking review item is raised and an administrator decides.
--
-- One nullable column, and nothing else. It is a REVIEW MARKER, not a status:
-- `family_link.status` is a decided value (TD-1), and overloading it would make
-- "is this link approved" and "has anyone looked at this" one question.
--
-- Nothing reads it for authorization — the links keep working while it is set,
-- which is what makes the item non-blocking rather than merely called so.
ALTER TABLE "family_link"
  ADD COLUMN "identity_review_raised_at" timestamptz(6) NULL;

-- The approvals queue derives its items from this column, so the lookup that
-- runs on every queue read is indexed. Partial: the overwhelming majority of
-- links are never stamped, and an index over them would be mostly NULLs.
CREATE INDEX "family_link_identity_review_raised_at_idx"
  ON "family_link" ("identity_review_raised_at")
  WHERE "identity_review_raised_at" IS NOT NULL;
