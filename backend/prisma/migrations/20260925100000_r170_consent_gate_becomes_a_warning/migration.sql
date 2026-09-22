-- SRS Revision 170 §3 (Document Owner, 2026-09-21): THE CONSENT GATE BECOMES A
-- WARNING. Where a class contains a beneficiary whose guardian refused media
-- release, the مؤطِّرة, the Admin and the Super Admin are WARNED; nothing is
-- forced, the default stays public, and switching to private is their act.
-- This reverses BR-2/BR-3's forced-private rule.
--
-- `media_consent_missing` is the warning: «a student in this recording's
-- audience has no media release», maintained by the SAME re-evaluation engine
-- (§4.1a's triggers are unchanged) in BOTH directions — a later grant clears
-- it, because a warning describes the present, unlike the safeguard it
-- replaces, which was one-way by design.
--
-- `consent_forced_private` is RETIRED: never written again, kept so no read of
-- history breaks. Rows the engine had forced become warned — their visibility
-- stays whatever it is (a forced row is private already; staff may now make it
-- public, and are warned when they do). A pending consent migration has nothing
-- left to converge to and is completed with a code that says why.

ALTER TABLE "educational_content"
  ADD COLUMN "media_consent_missing" BOOLEAN NOT NULL DEFAULT false;

UPDATE "educational_content"
   SET "media_consent_missing" = true, "consent_forced_private" = false
 WHERE "consent_forced_private";

UPDATE "storage_retirement"
   SET "completed_at" = now(), "last_error_code" = 'withdrawn_r170'
 WHERE "operation" = 'consent_migrate' AND "completed_at" IS NULL;
