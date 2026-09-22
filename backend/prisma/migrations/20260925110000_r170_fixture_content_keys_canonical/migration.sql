-- 2026-09-22 — the seed's four fixture library items carried keys of the shape
-- `content/fixture-N/…`, not the canonical `content/<id>/…` every storage
-- obligation requires (TD-9). They could be listed, opened and edited, and
-- could not be DELETED: `DELETE /content/{id}` answered 500 on Staging when the
-- Owner tried. The seed writes canonical keys from now on; the rows it already
-- wrote are repaired here — the same file segment, the row's own id in front.
-- Nothing is stored under either key (fixtures carry no object), so no object
-- moves; the key is repaired, not the file.
UPDATE "educational_content"
   SET "storage_key" = 'content/' || "id"::text || substring("storage_key" from '^content/fixture-[0-9]+(/.*)$')
 WHERE "storage_key" ~ '^content/fixture-[0-9]+/';
