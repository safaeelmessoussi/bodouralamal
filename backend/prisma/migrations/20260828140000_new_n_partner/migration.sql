-- NEW N — the association's partners, as data rather than as markup.
--
-- The landing page has no partners section at all today. The reason this is a
-- table and not four lines of copy is the rule the platform already applies to
-- Branches: **§5.1's public sections render what the database holds**, so adding
-- a partner is an administrative act rather than a deployment.
--
-- **`name` and nothing else about them.** No logo, no URL, no description, no
-- contact — the association supplied names, and a column exists for a fact the
-- platform holds rather than one it might. A logo later is a column and a
-- migration; an empty one now is a blank frame on a public page.
--
-- **`is_visible` is not `deleted_at`.** Withholding a partner from the site
-- while a renewal is negotiated is an ordinary thing an association needs, and
-- it is not the same act as removing the record. Two questions, two columns.
--
-- The index is the landing page's exact query: live, visible, in order.

CREATE TABLE "partner" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"          VARCHAR(200) NOT NULL,
  "display_order" INTEGER,
  "is_visible"    BOOLEAN NOT NULL DEFAULT TRUE,
  "version"       INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at"    TIMESTAMPTZ(6),

  -- TD-6: the same non-negative ordering constraint every ordered reference
  -- table carries, so an invalid value is refused by the database and not only
  -- by Zod.
  CONSTRAINT "partner_display_order_non_negative" CHECK ("display_order" IS NULL OR "display_order" >= 0)
);

CREATE INDEX "partner_deleted_at_is_visible_display_order_idx"
  ON "partner" ("deleted_at", "is_visible", "display_order");
