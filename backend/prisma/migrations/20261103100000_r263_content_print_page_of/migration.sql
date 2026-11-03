-- R263 — an image cut from a «مطبوع» names the PDF it is a page of. A reader
-- sees such a page only beside a recording it is attached to; NULL for every
-- other item.
ALTER TABLE "educational_content" ADD COLUMN "print_page_of" UUID;
ALTER TABLE "educational_content"
  ADD CONSTRAINT "educational_content_print_page_of_fkey" FOREIGN KEY ("print_page_of")
  REFERENCES "educational_content"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "educational_content"
  ADD CONSTRAINT "educational_content_print_page_of_check" CHECK ("print_page_of" IS NULL OR "print_page_of" <> "id");
CREATE INDEX "educational_content_print_page_of_idx" ON "educational_content"("print_page_of") WHERE "print_page_of" IS NOT NULL;
