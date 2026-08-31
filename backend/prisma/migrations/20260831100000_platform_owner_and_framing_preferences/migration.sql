-- Platform Owner singleton and framing preferences (Owner, 2026-08-31).
--
-- Existing rows are not guessed or rewritten. `platform_owner` is empty until
-- the production seed establishes the initial owner. Existing registrations
-- have no FramingPreference, and existing availability windows retain a NULL
-- mode meaning legacy/not stated.

CREATE TYPE "framing_mode" AS ENUM ('in_person', 'online', 'both');

CREATE TABLE "platform_owner" (
  "singleton_key" VARCHAR(20) NOT NULL DEFAULT 'platform',
  "owner_user_id" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "platform_owner_pkey" PRIMARY KEY ("singleton_key"),
  CONSTRAINT "platform_owner_singleton_key_check" CHECK ("singleton_key" = 'platform'),
  CONSTRAINT "platform_owner_owner_user_id_key" UNIQUE ("owner_user_id"),
  CONSTRAINT "platform_owner_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "framing_preference" (
  "user_id" UUID NOT NULL,
  "mode" "framing_mode" NOT NULL,
  "all_branches" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "framing_preference_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "framing_preference_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "framing_preference_online_not_all_branches_check"
    CHECK ("mode" <> 'online' OR "all_branches" = false)
);

CREATE TABLE "framing_preference_branch" (
  "user_id" UUID NOT NULL,
  "branch_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "framing_preference_branch_pkey" PRIMARY KEY ("user_id", "branch_id"),
  CONSTRAINT "framing_preference_branch_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "framing_preference"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "framing_preference_branch_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "framing_preference_branch_branch_id_idx"
  ON "framing_preference_branch"("branch_id");

ALTER TABLE "teacher_availability"
  ADD COLUMN "mode" "framing_mode";

-- Cross-table framing semantics must be true at COMMIT, not halfway through a
-- transaction that creates the preference and its branch rows.
CREATE OR REPLACE FUNCTION "assert_framing_preference_complete"("candidate_user_id" UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  preference_mode "framing_mode";
  preference_all BOOLEAN;
  branch_count INTEGER;
BEGIN
  SELECT "mode", "all_branches"
    INTO preference_mode, preference_all
    FROM "framing_preference"
    WHERE "user_id" = "candidate_user_id";

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) INTO branch_count
    FROM "framing_preference_branch"
    WHERE "user_id" = "candidate_user_id";

  IF preference_mode = 'online' AND (preference_all OR branch_count <> 0) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'framing_preference_online_has_no_branches',
      MESSAGE = 'online framing preference cannot carry branch willingness';
  END IF;

  IF preference_mode IN ('in_person', 'both')
     AND ((preference_all AND branch_count <> 0)
       OR (NOT preference_all AND branch_count = 0)) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'framing_preference_physical_branch_choice',
      MESSAGE = 'physical framing preference requires either all branches or explicit branches';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION "framing_preference_constraint_trigger"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM "assert_framing_preference_complete"(OLD."user_id");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM "assert_framing_preference_complete"(NEW."user_id");
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "framing_preference_complete_deferred"
AFTER INSERT OR UPDATE OR DELETE ON "framing_preference"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "framing_preference_constraint_trigger"();

CREATE CONSTRAINT TRIGGER "framing_preference_branch_complete_deferred"
AFTER INSERT OR UPDATE OR DELETE ON "framing_preference_branch"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "framing_preference_constraint_trigger"();

-- The owner relationship validates eligibility independently of application
-- code. Locks make an ownership transfer serialize with role/status mutation.
CREATE OR REPLACE FUNCTION "platform_owner_validate_eligibility"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."singleton_key" <> 'platform' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'invalid Platform Owner singleton key';
  END IF;

  PERFORM 1
    FROM "user"
    WHERE "id" = NEW."owner_user_id"
      AND "account_status" = 'active'
      AND "deleted_at" IS NULL
    FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'platform_owner_active_user',
      MESSAGE = 'Platform Owner must be an active, undeleted user';
  END IF;

  PERFORM 1
    FROM "user_branch_role" ubr
    JOIN "role" r ON r."id" = ubr."role_id"
    WHERE ubr."user_id" = NEW."owner_user_id"
      AND ubr."branch_id" IS NULL
      AND ubr."user_status" = 'active'
      AND ubr."deleted_at" IS NULL
      AND r."name" = 'super_admin'
    FOR KEY SHARE OF ubr, r;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'platform_owner_global_super_admin',
      MESSAGE = 'Platform Owner must hold an active global Super Admin assignment';
  END IF;

  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "platform_owner_validate_eligibility_trigger"
BEFORE INSERT OR UPDATE ON "platform_owner"
FOR EACH ROW EXECUTE FUNCTION "platform_owner_validate_eligibility"();

CREATE OR REPLACE FUNCTION "platform_owner_prevent_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    CONSTRAINT = 'platform_owner_cannot_be_removed',
    MESSAGE = 'Platform Owner status can only be transferred';
END;
$$;

CREATE TRIGGER "platform_owner_prevent_delete_trigger"
BEFORE DELETE ON "platform_owner"
FOR EACH ROW EXECUTE FUNCTION "platform_owner_prevent_delete"();

CREATE OR REPLACE FUNCTION "protect_platform_owner_user"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW."account_status" = 'active'
     AND NEW."deleted_at" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
    FROM "platform_owner"
    WHERE "owner_user_id" = OLD."id"
    FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'platform_owner_user_lifecycle_protected',
      MESSAGE = 'Platform Owner cannot be suspended, deleted, or de-identified';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "protect_platform_owner_user_trigger"
BEFORE UPDATE OF "account_status", "deleted_at" OR DELETE ON "user"
FOR EACH ROW EXECUTE FUNCTION "protect_platform_owner_user"();

CREATE OR REPLACE FUNCTION "protect_platform_owner_role_assignment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_is_global_super_admin BOOLEAN;
  new_is_global_super_admin BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "role"
    WHERE "id" = OLD."role_id" AND "name" = 'super_admin'
  ) AND OLD."branch_id" IS NULL
    AND OLD."user_status" = 'active'
    AND OLD."deleted_at" IS NULL
    INTO old_is_global_super_admin;

  IF NOT old_is_global_super_admin THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT EXISTS (
      SELECT 1 FROM "role"
      WHERE "id" = NEW."role_id" AND "name" = 'super_admin'
    ) AND NEW."user_id" = OLD."user_id"
      AND NEW."branch_id" IS NULL
      AND NEW."user_status" = 'active'
      AND NEW."deleted_at" IS NULL
      INTO new_is_global_super_admin;
    IF new_is_global_super_admin THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM 1
    FROM "platform_owner"
    WHERE "owner_user_id" = OLD."user_id"
    FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'platform_owner_global_super_admin_protected',
      MESSAGE = 'Platform Owner cannot lose the active global Super Admin assignment';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "protect_platform_owner_role_assignment_trigger"
BEFORE UPDATE OF "user_id", "role_id", "branch_id", "user_status", "deleted_at" OR DELETE
ON "user_branch_role"
FOR EACH ROW EXECUTE FUNCTION "protect_platform_owner_role_assignment"();

CREATE OR REPLACE FUNCTION "protect_platform_owner_super_admin_role"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."name" <> 'super_admin'
     OR (TG_OP = 'UPDATE' AND NEW."name" = 'super_admin') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  PERFORM 1 FROM "platform_owner" WHERE "singleton_key" = 'platform' FOR SHARE;
  IF FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'platform_owner_super_admin_role_protected',
      MESSAGE = 'the Super Admin role is required by Platform Owner';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "protect_platform_owner_super_admin_role_trigger"
BEFORE UPDATE OF "name" OR DELETE ON "role"
FOR EACH ROW EXECUTE FUNCTION "protect_platform_owner_super_admin_role"();
