-- R265 — an image may be a page of several recordings (the Owner, 2026-11-12:
-- «I want to be able to link an image to multiple audio recordings»). The key
-- becomes the pair; every existing link stays as it is.
-- contract-phase: only the KEY is dropped and replaced by a wider one in the
-- same migration — no column, row or link is lost, and the running release
-- (which writes one recording per image) stays valid under the pair key.
ALTER TABLE "recording_slide" DROP CONSTRAINT "recording_slide_pkey";
ALTER TABLE "recording_slide" ADD CONSTRAINT "recording_slide_pkey" PRIMARY KEY ("recording_id", "slide_id");
CREATE INDEX "recording_slide_slide_id_idx" ON "recording_slide" ("slide_id");
