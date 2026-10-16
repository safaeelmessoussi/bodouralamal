-- R224 §2 (Owner, 2026-10-16) — a holiday cancels the activity dates it
-- covers, as it cancels classes (R199 §5). An activity's dates are computed
-- from its rule, so a cancelled date is a row of its own; «إعادة البرمجة»
-- sets `restored_at`.
CREATE TABLE "event_date_cancellation" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "cancelled_by_event_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "restored_at" TIMESTAMPTZ(6),
    "restored_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_date_cancellation_pkey" PRIMARY KEY ("id"),
    -- A holiday never cancels itself.
    CONSTRAINT "event_date_cancellation_not_self_check" CHECK ("event_id" <> "cancelled_by_event_id"),
    -- Restored means restored by somebody, at a moment.
    CONSTRAINT "event_date_cancellation_restored_check" CHECK (("restored_at" IS NULL) = ("restored_by" IS NULL))
);
CREATE UNIQUE INDEX "event_date_cancellation_event_id_date_key" ON "event_date_cancellation"("event_id", "date");
CREATE INDEX "event_date_cancellation_cancelled_by_event_id_idx" ON "event_date_cancellation"("cancelled_by_event_id");
ALTER TABLE "event_date_cancellation" ADD CONSTRAINT "event_date_cancellation_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "event_date_cancellation" ADD CONSTRAINT "event_date_cancellation_cancelled_by_event_id_fkey" FOREIGN KEY ("cancelled_by_event_id") REFERENCES "event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
