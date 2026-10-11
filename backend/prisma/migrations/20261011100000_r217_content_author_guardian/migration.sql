-- R217 (Owner, 2026-10-11) — «صاحب المحتوى» may be a guardian too: the capacity
-- is read off the person's own roles (teacher, then administration, then
-- student, then guardian).
ALTER TYPE "content_author_role" ADD VALUE 'guardian';
