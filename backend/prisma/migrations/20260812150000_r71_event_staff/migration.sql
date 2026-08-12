-- Revision 71 — an event has somebody responsible for it.
--
-- An `event` carried four audience joins and nobody answerable for it, so the
-- association's own description of a celebration — one main responsible مؤطرة
-- and her assistants — could not be recorded. The consequence was
-- authorization: a teacher's event scope derives from TEACHING schedules, so a
-- مؤطرة responsible for a celebration who teaches nothing could manage nothing.
--
-- Additive only: one enum, one table. No existing row is touched.

CREATE TYPE "event_staff_position" AS ENUM ('responsible', 'assistant');

CREATE TABLE "event_staff" (
    "id"         UUID NOT NULL,
    "event_id"   UUID NOT NULL,
    "user_id"    UUID NOT NULL,
    "position"   "event_staff_position" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,

    CONSTRAINT "event_staff_pkey" PRIMARY KEY ("id")
);

-- One person holds one position on one event. Deliberately NOT filtered on
-- `deleted_at` (R59): a returning assistant is revived rather than inserted,
-- and an insert would be refused — which is what makes tombstone-and-revive
-- the only correct reconciliation.
CREATE UNIQUE INDEX "event_staff_event_id_user_id_key"
    ON "event_staff"("event_id", "user_id");

-- "Which events does this مؤطرة answer for" is the scope query (R71.2).
CREATE INDEX "event_staff_user_id_deleted_at_idx"
    ON "event_staff"("user_id", "deleted_at");

ALTER TABLE "event_staff"
    ADD CONSTRAINT "event_staff_event_id_fkey" FOREIGN KEY ("event_id")
    REFERENCES "event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "event_staff"
    ADD CONSTRAINT "event_staff_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
