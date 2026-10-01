-- SRS Revision 191 (Owner, 2026-10-01) — every element in «سلة المحذوفات» can
-- be restored. A restored library item owes its bytes back at the canonical
-- key: `restore_quarantined_object`, the reverse of `quarantine_retired_object`,
-- performed by the same durable obligation worker (TD-7). The CHECK is
-- re-created with the new value; nothing stored changes.

-- contract-phase: the operation CHECK is replaced in place to admit one more value (TD-6b: additive).
ALTER TABLE "storage_retirement" DROP CONSTRAINT "storage_retirement_operation_check";
ALTER TABLE "storage_retirement"
  ADD CONSTRAINT "storage_retirement_operation_check" CHECK ("operation" IN (
    'quarantine_retired_object', 'manual_permanent_delete', 'discard_unreferenced',
    'placement_attempt', 'retire_public', 'consent_migrate', 'restore_quarantined_object'));
