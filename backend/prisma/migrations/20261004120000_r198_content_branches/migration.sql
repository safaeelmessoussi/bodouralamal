-- SRS Revision 198 §2 — an item may be filed for SEVERAL branches (the Owner,
-- 2026-10-04): «بدون فرع» is withdrawn as a choice, choosing no branch means
-- Global, and several may be chosen.
--
-- `educational_content.branch_id` stays the item's HOME branch (NULL is still
-- Global, §4.9): what the upload is authorised against first, what the library
-- orders and groups by. These rows are its OTHER branches, exactly as
-- `educational_content_level` holds its other Levels (R169 §10). Additive: an
-- item with none behaves as before.

CREATE TABLE "educational_content_branch" (
  "content_id" UUID NOT NULL,
  "branch_id"  UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

  CONSTRAINT "educational_content_branch_pkey" PRIMARY KEY ("content_id", "branch_id"),
  CONSTRAINT "educational_content_branch_content_id_fkey"
    FOREIGN KEY ("content_id") REFERENCES "educational_content"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "educational_content_branch_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "educational_content_branch_branch_id_idx" ON "educational_content_branch" ("branch_id");

-- The home branch is never ALSO an additional one, and a Global item (no home
-- branch) has no other branches: one fact, one place.
CREATE FUNCTION "educational_content_branch_not_home"() RETURNS trigger AS $$
DECLARE home UUID;
BEGIN
  SELECT c."branch_id" INTO home FROM "educational_content" c WHERE c."id" = NEW."content_id";
  IF home IS NULL THEN
    RAISE EXCEPTION 'content % is Global and holds no additional branch', NEW."content_id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF home = NEW."branch_id" THEN
    RAISE EXCEPTION 'branch % is already the home branch of content %', NEW."branch_id", NEW."content_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "educational_content_branch_not_home"
  BEFORE INSERT OR UPDATE ON "educational_content_branch"
  FOR EACH ROW EXECUTE FUNCTION "educational_content_branch_not_home"();
