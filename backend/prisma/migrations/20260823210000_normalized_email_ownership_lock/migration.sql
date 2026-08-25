-- One normalized email can be owned through either User.pre_provisioned_email
-- or an active UserIdentity.email. Those separate uniqueness domains cannot
-- serialize the absent-row race between registration and staff provisioning,
-- so this table supplies one stable row-lock target without duplicating the
-- owner itself.
CREATE TABLE "normalized_email_lock" (
  "email" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "normalized_email_lock_pkey" PRIMARY KEY ("email"),
  CONSTRAINT "normalized_email_lock_lowercase_check"
    CHECK ("email" = lower("email"))
);

-- Refuse to bless an already-ambiguous upgrade. One account may legitimately
-- appear in both arms after first binding because pre_provisioned_email is
-- retained as provenance; only two DISTINCT users for one address are invalid.
DO $$
BEGIN
  IF EXISTS (
    SELECT "email"
    FROM (
      SELECT "id" AS "user_id", "pre_provisioned_email" AS "email"
      FROM "user"
      WHERE "pre_provisioned_email" IS NOT NULL

      UNION ALL

      SELECT "user_id", "email"
      FROM "user_identity"
      WHERE "is_active" = TRUE
    ) AS "email_owner"
    GROUP BY "email"
    HAVING COUNT(DISTINCT "user_id") > 1
  ) THEN
    RAISE EXCEPTION
      'normalized email is already claimed by more than one user';
  END IF;
END $$;

-- Backfill every current authoritative address. Future absent addresses create
-- their lock row transactionally before deciding which ownership path wins.
INSERT INTO "normalized_email_lock" ("email")
SELECT "pre_provisioned_email"
FROM "user"
WHERE "pre_provisioned_email" IS NOT NULL
UNION
SELECT "email"
FROM "user_identity"
WHERE "is_active" = TRUE
ON CONFLICT ("email") DO NOTHING;
