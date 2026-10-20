-- SRS Revision 238 — «المسار» as an audience choice: the tracks a class or an
-- activity is addressed to. Empty = no track named (every existing row).
ALTER TABLE "recurring_course_schedule" ADD COLUMN "audience_tracks" "level_track"[] NOT NULL DEFAULT '{}';
ALTER TABLE "event" ADD COLUMN "audience_tracks" "level_track"[] NOT NULL DEFAULT '{}';
