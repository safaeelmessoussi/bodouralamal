-- NEW I — a Branch publishes a SECOND phone number.
--
-- `address`, `phone`, `email`, `opening_hours_ar` and `google_maps_url` have
-- existed since Revision 35; a second number never did. A branch commonly has
-- two — a landline and a mobile, or an office line and the coordinator's — and
-- the only way to record both was to pack them into `phone`.
--
-- **Packing was refused, for the reason §7 refuses every packed field.**
-- «0537… / 0661…» in a `VARCHAR(20)` phone column stops being a phone number:
-- nothing can dial it, validate it, or render it as a `tel:` link, and telling
-- the two apart becomes a parsing problem the first time anybody needs one of
-- them. One fact per column.
--
-- Nullable, and it stays nullable: a branch with one number is the ordinary
-- case rather than a gap — the same treatment Revision 35 gave the other
-- contact fields, and Revision 27 gave `user.sex`. *Required* is a write-
-- boundary question (TD-9), and this one is not required at all.

ALTER TABLE "branch"
  ADD COLUMN "phone_secondary" VARCHAR(20);
