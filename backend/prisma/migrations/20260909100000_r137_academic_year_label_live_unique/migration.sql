-- R137 — `academic_year_label_key` predates soft-delete on this table
-- (`20260724194811_init_schema`) and was never revisited when
-- `20260909090100_r137_academic_year_soft_delete` added `deleted_at`. Left
-- as a plain unique index, a label stays permanently unusable the moment
-- its year is soft-deleted, even inside TD-5's own seven-day undo window —
-- the identical gap `scheduling_type_name_live_key`
-- (`20260826140000_r110_scheduling_type_catalogue`) exists to close for the
-- same shape of row. A year created in error and removed must be
-- re-creatable under its own correct label, not haunted by a label its
-- deleted self still holds.
--
-- contract-phase: R137 is a direct Document Owner decision, negotiated and
-- ratified before this migration, exactly as R43's and R137's own prior
-- contract-phase drops in this same revision record.
DROP INDEX "academic_year_label_key";

CREATE UNIQUE INDEX "academic_year_label_live_key"
  ON "academic_year" ("label")
  WHERE "deleted_at" IS NULL;
