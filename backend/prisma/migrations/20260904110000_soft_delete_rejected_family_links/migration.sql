-- A rejected FamilyLink is soft-deleted, so the pair is free for a corrected
-- request (Owner decision, 2026-09-03 — SRS Revision 128).
--
-- ## What was wrong
--
-- `rejected` links were never soft-deleted, so they stayed LIVE — and the TD-6
-- partial unique index `family_link_student_parent_active_key
-- (student_id, parent_id) WHERE deleted_at IS NULL` therefore made a refusal
-- PERMANENT: the same adult could never make a corrected request for the same
-- child. A REVOKED link, which is the stronger outcome, freed the pair
-- immediately, because revocation soft-deletes. The weaker outcome was the more
-- permanent one.
--
-- The service now decides both outcomes through one helper, so every new
-- rejection carries its decision, its tombstone, its Trash snapshot and its
-- audit row together. This migration brings rows decided BEFORE that change to
-- the same state — otherwise a family rejected last month stays blocked forever
-- while one rejected tomorrow does not, which is the drift a forward-only fix
-- exists to prevent.
--
-- ## What it does, and what it does NOT do
--
-- Each affected row is tombstoned with **its own decision instant**, not with
-- `now()`: the deletion is the decision, and stamping today would claim the
-- refusal happened today. `decided_by` becomes `deleted_by` for the same reason.
-- Rows with no `decided_at` — none should exist, since the status is only ever
-- written with one — fall back to `created_at` rather than being skipped, so no
-- row is left live by an edge case.
--
-- **Nothing is destroyed and no status changes.** The decision, its reason and
-- its decider stay exactly as recorded; only `deleted_at`/`deleted_by` are
-- written. The row remains readable, auditable and historical.
--
-- **A Trash entry is written for each**, so the row is discoverable and follows
-- BR-15's ninety days like every other soft-deleted record. The snapshot carries
-- the decision itself, because the pair alone says nothing about why. `FamilyLink`
-- is absent from the restore plan and blocked as `CASCADE_RELATIONSHIPS`, so a
-- generic restore can never turn one of these back into live authority.
--
-- Rows that ALREADY carry a Trash entry are skipped: R118.3's now-withdrawn purge
-- route never wrote one, but a re-run of this migration would otherwise duplicate.
--
-- No expand/contract phase and no DROP: this writes two nullable columns that
-- already exist, so it is additive and reversible by inspection.
--
-- Verified read-only before this migration was written:
--   Localhost — 3 family links: 1 pending, 1 approved, 1 rejected (all live).
-- Staging was NOT queried in this session and Production is not deployed.

DO $$
DECLARE
  swept bigint;
BEGIN
  -- The Trash rows first, while the links are still identifiable as live
  -- rejections. `purge_after` is BR-15's ninety days from the tombstone the
  -- UPDATE below is about to write, so the two agree by construction.
  INSERT INTO public.trash (id, target_entity, target_id, snapshot, deleted_by, deleted_at, purge_after)
  SELECT
    gen_random_uuid(),
    'FamilyLink',
    fl.id,
    jsonb_build_object(
      'id', fl.id,
      'parentId', fl.parent_id,
      'studentId', fl.student_id,
      'status', 'rejected',
      'decidedAt', COALESCE(fl.decided_at, fl.created_at),
      'decidedById', fl.decided_by,
      'decisionReason', fl.decision_reason,
      'createdAt', fl.created_at
    ),
    fl.decided_by,
    COALESCE(fl.decided_at, fl.created_at),
    COALESCE(fl.decided_at, fl.created_at) + interval '90 days'
  FROM public.family_link fl
  WHERE fl.status = 'rejected'
    AND fl.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.trash t
      WHERE t.target_entity = 'FamilyLink' AND t.target_id = fl.id
    );

  UPDATE public.family_link
     SET deleted_at = COALESCE(decided_at, created_at),
         deleted_by = decided_by
   WHERE status = 'rejected'
     AND deleted_at IS NULL;

  GET DIAGNOSTICS swept = ROW_COUNT;
  RAISE NOTICE 'soft-deleted % rejected family link(s); each pair is now free for a corrected request', swept;
END
$$;
