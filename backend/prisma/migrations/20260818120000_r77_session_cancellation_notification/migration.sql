-- Revision 77 — one notification event returns to the MVP: a class session was
-- cancelled (§4.8 as narrowed by R77).
--
-- R6 removed in-app notifications from the MVP entirely and forbade the schema
-- from pre-creating their tables. R77 narrows that to the *framework*: the
-- five-event catalogue, the critical/normal tiers and `NotificationPreference`
-- stay in §10.1. This table is deliberately the minimum that can carry ONE
-- event — no tier, no preference, no channel — so it is not a head start on the
-- postponed design.
--
-- Additive only: one enum, one table. Nothing existing changes.

CREATE TYPE "notification_type" AS ENUM ('session_cancelled', 'session_restored');

CREATE TABLE "notification" (
    "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id"    UUID NOT NULL,
    "type"       "notification_type" NOT NULL,
    "session_id" UUID NOT NULL,
    -- Null until read. R77.5 turns on this column: an UNREAD notice of
    -- something no longer true is deleted on restore, while a READ one is
    -- answered with `session_restored` instead.
    "read_at"    TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "deleted_at" TIMESTAMPTZ(6),

    -- `RESTRICT` on both, like every other reference to these two: a
    -- cancellation notice whose session or recipient vanished is unreadable,
    -- and the platform soft-deletes rather than removing either (TD-4.8).
    CONSTRAINT "notification_user_fk"
        FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT,
    CONSTRAINT "notification_session_fk"
        FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE RESTRICT
);

-- **What makes the write idempotent** (R77.5). Cancelling twice, or retrying
-- after a dropped response, must produce the same rows rather than a second
-- copy of the same news. Enforced declaratively rather than by a check-then-
-- write in a service, which is what TD-15 says a constraint should replace.
CREATE UNIQUE INDEX "notification_recipient_session_type"
    ON "notification" ("user_id", "session_id", "type");

-- The list read: one user's own, newest first (R77.6).
CREATE INDEX "notification_user_created_idx"
    ON "notification" ("user_id", "created_at");
