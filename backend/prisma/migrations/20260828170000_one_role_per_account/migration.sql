-- A role is held ONCE per account (Owner decision, 2026-08-28).
--
-- ## The hole this closes
--
-- `UNIQUE (user_id, role_id, branch_id)` already existed and did not prevent the
-- duplicate, because **PostgreSQL treats NULLs as distinct in a unique index**.
-- `branch_id IS NULL` is the all-branches scope (§7 R24) and is the ordinary
-- case, so two identical unscoped assignments of the same role satisfied that
-- constraint. The platform's own Super Admin held `super_admin` twice.
--
-- The service could produce it too: `applyRoleAssignments` reads the existing
-- rows once and then iterates the submitted list, so the same role submitted
-- twice found no prior row either time and inserted two.
--
-- ## Why (user_id, role_id) and not (user_id, role_id, branch_id)
--
-- The Owner's rule is that **a role is never received twice**, and the role-add
-- control offers only roles the account does not already hold. Under that rule a
-- second row of the same role is unreachable by design, so the constraint states
-- it directly.
--
-- **This narrows the model deliberately.** Branch scope was expressible as
-- several assignments of one role — an Admin over مقر تاركة *and* مقر أمرشيش but
-- not a third. That is withdrawn: a role now carries **one** scope, either a
-- single branch or all of them (`NULL`). No account used the multi-branch form
-- (measured before the change), and §4.2's visibility rule reads a scope per
-- assignment either way, so nothing that exists today changes meaning.
--
-- ## Live rows only
--
-- Partial on `deleted_at IS NULL`, like every other soft-delete unique index
-- here: revoking a role and granting it again must stay possible, and the
-- service revives the tombstoned row rather than inserting beside it.

-- Existing duplicates are RETIRED, not deleted: the oldest live row of each
-- (user, role) is kept and the rest are soft-deleted, so the assignment history
-- survives and no id is destroyed.
UPDATE "user_branch_role" ubr
   SET "deleted_at" = now()
 WHERE ubr."deleted_at" IS NULL
   AND EXISTS (
     SELECT 1 FROM "user_branch_role" keep
      WHERE keep."deleted_at" IS NULL
        AND keep."user_id" = ubr."user_id"
        AND keep."role_id" = ubr."role_id"
        AND (keep."created_at", keep."id") < (ubr."created_at", ubr."id")
   );

CREATE UNIQUE INDEX "user_branch_role_one_live_role_per_user"
    ON "user_branch_role" ("user_id", "role_id")
 WHERE "deleted_at" IS NULL;
