-- Ratified email-lock design: maintenance only. Stop ALL ownership writers
-- before migrate deploy and provision one identical EMAIL_LOCK_KEY to every
-- writer before restart. This table owns no account/history; never backfill
-- digests or put the key in SQL. Ownership remains in User/UserIdentity.
-- contract-phase: Owner-ratified stopped-writer truncate/re-key removes only
-- ownerless plaintext lock coordinates; R133 removes copied claim credentials
-- only for audit-proven permanent deletions. See docs/development/email-lock-keying.md.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
TRUNCATE TABLE "normalized_email_lock";
ALTER TABLE "normalized_email_lock" DROP CONSTRAINT "normalized_email_lock_pkey";
ALTER TABLE "normalized_email_lock" DROP COLUMN "email";
ALTER TABLE "normalized_email_lock" ADD COLUMN "email_digest" CHAR(64) PRIMARY KEY;
ALTER TABLE "normalized_email_lock" ADD CONSTRAINT "normalized_email_lock_digest_check"
  CHECK ("email_digest" ~ '^[0-9a-f]{64}$');

ALTER TABLE "self_managed_claim" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "self_managed_claim" ALTER COLUMN "provider_subject_id" DROP NOT NULL;

-- Repair only PROVEN permanent deletions. A deleted account alone is still
-- recoverable; a name is not evidence. Require its durable de-identification
-- audit for the current deletion, no credentials and no User recovery entry.
CREATE TEMP TABLE erased_claim_ids ON COMMIT DROP AS
SELECT c.id FROM "self_managed_claim" c JOIN "user" u ON u.id = c.beneficiary_id
WHERE u.deleted_at IS NOT NULL AND u.pre_provisioned_email IS NULL
  AND NOT EXISTS (SELECT 1 FROM user_identity i WHERE i.user_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM trash t WHERE t.target_entity = 'User' AND t.target_id = u.id)
  AND EXISTS (SELECT 1 FROM audit_log a WHERE a.target_entity = 'User'
    AND a.target_id = u.id AND a.action_type = 'user.deidentify' AND a.created_at >= u.deleted_at);
UPDATE self_managed_claim SET email = NULL, provider_subject_id = NULL, decision_reason = NULL,
  deleted_at = CASE WHEN status = 'pending' THEN COALESCE(deleted_at, CURRENT_TIMESTAMP) ELSE deleted_at END
WHERE id IN (SELECT id FROM erased_claim_ids);
DELETE FROM trash WHERE target_entity = 'SelfManagedClaim' AND target_id IN (SELECT id FROM erased_claim_ids);

-- Pending live requests always retain the exact verified identity needed to
-- approve them. Minimized history carries neither part of the credential.
ALTER TABLE "self_managed_claim" ADD CONSTRAINT "self_managed_claim_identity_check"
  CHECK ((email IS NOT NULL AND provider_subject_id IS NOT NULL)
    OR (email IS NULL AND provider_subject_id IS NULL AND (status <> 'pending' OR deleted_at IS NOT NULL)));
COMMIT;
