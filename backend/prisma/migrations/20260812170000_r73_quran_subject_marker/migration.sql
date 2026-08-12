-- Revision 73 — the structural marker naming which Subject's teaching
-- authorises Quran progress (§4.5, TD-2, §4.4c).
--
-- §4.4c's "own students" is subject-blind: a مؤطرة teaching a مستفيدة only Fiqh
-- could log that مستفيدة's memorization. Matching on the Subject NAME is
-- prohibited (R27 made Subjects editable reference data; §4.4b requires rules
-- checked generically rather than hardcoded against a name), so the rule needs
-- a structural marker.
--
-- Additive only: one column with a safe default, and one invariant.

ALTER TABLE "subject"
    ADD COLUMN "tracks_quran_progress" BOOLEAN NOT NULL DEFAULT false;

-- **At most one LIVE Subject may track Quran progress.**
--
-- §4.5's engine is singular, and two marked Subjects would make *which*
-- teaching authorises a log ambiguous — the invariant is enforced here rather
-- than in a service, because a check-then-write in application code is exactly
-- what TD-15 says a declarative constraint should replace.
--
-- Indexing on a constant is the standard PostgreSQL singleton: every qualifying
-- row collides on the same key. Soft-deleted Subjects are excluded, so the
-- marker can be moved to another Subject after the first is retired.
CREATE UNIQUE INDEX "subject_one_quran_tracker"
    ON "subject" ((true))
    WHERE "tracks_quran_progress" AND "deleted_at" IS NULL;
