-- R59 lifecycle closure: Partner was introduced as soft-deletable but omitted
-- the actor coordinate carried by every other domain tombstone. Trash and
-- AuditLog already preserve the same actor; this nullable column completes the
-- canonical TD-5 row shape without inventing or backfilling historical data.

ALTER TABLE "partner" ADD COLUMN "deleted_by" UUID;
