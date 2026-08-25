-- Revision 101 rollout — every live refresh token present at this deployment
-- was issued with Path=/api/v1/auth/refresh. Such a cookie cannot reach logout,
-- so the old API is stopped before this migration and every live chain is
-- invalidated before the new Path=/api/v1/auth issuer starts.
--
-- The audit insert and revocation are one data-modifying statement. If either
-- fails neither remains, preserving §7's attribution invariant. One row per
-- user records every affected session id without storing any raw credential.
WITH legacy_sessions AS (
  SELECT
    "user_id",
    array_agg(DISTINCT "session_id" ORDER BY "session_id") AS session_ids,
    count(*)::integer AS token_count
  FROM "refresh_token"
  WHERE "revoked_at" IS NULL
  GROUP BY "user_id"
), audited AS (
  INSERT INTO "audit_log" (
    "id",
    "actor_user_id",
    "action_type",
    "target_entity",
    "target_id",
    "detail"
  )
  SELECT
    gen_random_uuid(),
    NULL,
    'auth.token_revoked',
    'User',
    "user_id",
    jsonb_build_object(
      'reason', 'cookie_path_migration',
      'session_ids', to_jsonb(session_ids),
      'tokens_revoked', token_count
    )
  FROM legacy_sessions
  RETURNING "target_id"
)
UPDATE "refresh_token" AS token
SET
  "revoked_at" = CURRENT_TIMESTAMP,
  "revoked_reason" = 'cookie_path_migration'
FROM audited
WHERE token."user_id" = audited."target_id"
  AND token."revoked_at" IS NULL;
