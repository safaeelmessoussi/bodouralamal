-- R258 — the order of a Subject's items in «محتوى عام», set by the
-- administration (`PUT /content/order`). NULL: no position, the title order.
ALTER TABLE "educational_content" ADD COLUMN "display_order" INTEGER;
ALTER TABLE "educational_content"
  ADD CONSTRAINT "educational_content_display_order_check" CHECK ("display_order" IS NULL OR "display_order" > 0);
