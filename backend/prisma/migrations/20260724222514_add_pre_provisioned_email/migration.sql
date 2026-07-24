-- AlterTable
ALTER TABLE "user" ADD COLUMN     "pre_provisioned_email" TEXT;

-- ###########################################################################
-- HAND-WRITTEN SQL (SRS TD-6a, §20 rule 5) — Revision 15
--
-- `User.pre_provisioned_email` is the address authorized to claim an account
-- before any external identity exists (§7). Neither guarantee below is
-- expressible in schema.prisma: Prisma has no CHECK constraints and no partial
-- unique indexes.
-- ###########################################################################

-- Lowercase backstop (TD-6). The column is matched against a lowercased OAuth
-- email (TD-12), so a mixed-case row would be permanently unmatchable — the
-- pre-provisioned account would silently never bind — and case variants would
-- slip past the unique index below. Application-layer lowercasing stays the
-- normal path; this makes a missed code path impossible rather than unlikely.
ALTER TABLE "user"
  ADD CONSTRAINT "user_pre_provisioned_email_lowercase_check"
  CHECK ("pre_provisioned_email" = lower("pre_provisioned_email"));

-- Unique among NON-NULL values only (TD-6). Two accounts must never both claim
-- the same address, or a first login would be ambiguous about which account it
-- binds. The predicate is essential: without it, the many login-less minor
-- students and self-registered users — all of whom carry NULL here — would
-- collide with each other on a plain unique index.
CREATE UNIQUE INDEX "user_pre_provisioned_email_key"
  ON "user" ("pre_provisioned_email")
  WHERE "pre_provisioned_email" IS NOT NULL;
