-- R215 (Owner, 2026-10-10) — an educational content may name who made it (a
-- teacher, an assistant, an administrator or a student), shown to every reader
-- under the person's public display name. Optional; existing items name nobody.
-- CreateEnum
CREATE TYPE "content_author_role" AS ENUM ('teacher', 'assistant', 'admin', 'student');

-- AlterTable
ALTER TABLE "educational_content" ADD COLUMN     "author_id" UUID,
ADD COLUMN     "author_role" "content_author_role";

-- CreateIndex
CREATE INDEX "educational_content_author_id_idx" ON "educational_content"("author_id");

-- AddForeignKey
ALTER TABLE "educational_content" ADD CONSTRAINT "educational_content_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A capacity says how a named person made it; with nobody named there is none.
ALTER TABLE "educational_content" ADD CONSTRAINT "educational_content_author_role_check"
  CHECK ("author_id" IS NOT NULL OR "author_role" IS NULL);
