-- SRS Revision 168 §2 — a recorder that dies mid-class loses nothing recorded.
--
-- The recorder now uploads the recording in ten-second safety segments WHILE
-- the class runs, beside the final file it uploads at the end. When the final
-- file never arrives (a host reboot, an out-of-memory kill), the reconciler
-- assembles the segments into that file and the recording is imported as any
-- other. This column says which recordings reached the library that way, so
-- the library item can say so honestly (its last seconds may be missing) and an
-- operator can count how often it happens.
--
-- It is a fact about how the file was obtained, not a status: the status stays
-- `completed`, and availability stays derived from `educational_content_id`.
ALTER TABLE "session_recording"
  ADD COLUMN "recovered_from_segments" BOOLEAN NOT NULL DEFAULT false;
