-- Prove every Revision 43 constraint REJECTS the row it exists to reject.
-- A guard nobody has watched fail is a guard nobody has.
\set ON_ERROR_STOP off
\timing off

-- Fixtures.
BEGIN;
INSERT INTO category (id, name, created_at, updated_at)
  VALUES ('11111111-1111-1111-1111-111111111111', 'الكبار', now(), now());
INSERT INTO level (id, name, category_id, gender_restriction, created_at, updated_at)
  VALUES ('22222222-2222-2222-2222-222222222222', 'المستوى 1',
          '11111111-1111-1111-1111-111111111111', 'any', now(), now()),
         ('22222222-2222-2222-2222-222222222223', 'المستوى 2',
          '11111111-1111-1111-1111-111111111111', 'any', now(), now());
INSERT INTO branch (id, name, operational_start_date, created_at, updated_at)
  VALUES ('33333333-3333-3333-3333-333333333333', 'أمرشيش', '2026-01-01', now(), now());
INSERT INTO subject (id, name, created_at, updated_at)
  VALUES ('44444444-4444-4444-4444-444444444444', 'حفظ القرآن', now(), now()),
         ('44444444-4444-4444-4444-444444444445', 'ترتيل وتجويد القرآن', now(), now());
INSERT INTO "user" (id, name_arabic, sex, account_status, created_at, updated_at)
  VALUES ('55555555-5555-5555-5555-555555555555', 'خديجة بنعلي', 'female', 'active', now(), now());
INSERT INTO administrative_group (id, name, level_id, branch_id, created_at, updated_at)
  VALUES ('66666666-6666-6666-6666-666666666666', 'المجموعة 1',
          '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333', now(), now());
INSERT INTO teaching_group (id, name, subject_id, level_id, created_at, updated_at)
  VALUES ('77777777-7777-7777-7777-777777777777', 'مجموعة حفظ القرآن 1',
          '44444444-4444-4444-4444-444444444444',
          '22222222-2222-2222-2222-222222222222', now(), now()),
         ('77777777-7777-7777-7777-777777777778', 'مجموعة ترتيل وتجويد القرآن 1',
          '44444444-4444-4444-4444-444444444445',
          '22222222-2222-2222-2222-222222222222', now(), now());
COMMIT;

\echo '--- 1. composite FK: enrollment.level_id disagreeing with its group''s MUST fail'
INSERT INTO enrollment (id, student_id, administrative_group_id, level_id, branch_id)
  VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555',
          '66666666-6666-6666-6666-666666666666',
          '22222222-2222-2222-2222-222222222223',
          '33333333-3333-3333-3333-333333333333');

\echo '--- 2. the same row with the CORRECT level must succeed'
INSERT INTO enrollment (id, student_id, administrative_group_id, level_id, branch_id)
  VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555',
          '66666666-6666-6666-6666-666666666666',
          '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333');

\echo '--- 3. a SECOND live enrollment in the same level MUST fail (BR-21)'
INSERT INTO enrollment (id, student_id, administrative_group_id, level_id, branch_id)
  VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555',
          '66666666-6666-6666-6666-666666666666',
          '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333');

\echo '--- 4. teaching group: Hifz seat succeeds'
INSERT INTO student_teaching_group (id, student_id, teaching_group_id, subject_id, level_id)
  VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555',
          '77777777-7777-7777-7777-777777777777',
          '44444444-4444-4444-4444-444444444444',
          '22222222-2222-2222-2222-222222222222');

\echo '--- 5. INDEPENDENCE: a Tartil/Tajweed seat for the SAME student and level must SUCCEED'
INSERT INTO student_teaching_group (id, student_id, teaching_group_id, subject_id, level_id)
  VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555',
          '77777777-7777-7777-7777-777777777778',
          '44444444-4444-4444-4444-444444444445',
          '22222222-2222-2222-2222-222222222222');

\echo '--- 6. a SECOND Hifz seat for that student MUST fail (BR-22)'
INSERT INTO student_teaching_group (id, student_id, teaching_group_id, subject_id, level_id)
  VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555555',
          '77777777-7777-7777-7777-777777777777',
          '44444444-4444-4444-4444-444444444444',
          '22222222-2222-2222-2222-222222222222');

\echo '--- 7. lying about the subject on a teaching-group seat MUST fail (composite FK)'
-- A FRESH student, so this can only fail on the FK and not on the unique index.
INSERT INTO "user" (id, name_arabic, sex, account_status, created_at, updated_at)
  VALUES ('55555555-5555-5555-5555-555555555556', 'فاطمة', 'female', 'active', now(), now());
INSERT INTO student_teaching_group (id, student_id, teaching_group_id, subject_id, level_id)
  VALUES (gen_random_uuid(), '55555555-5555-5555-5555-555555555556',
          '77777777-7777-7777-7777-777777777777',
          '44444444-4444-4444-4444-444444444445',
          '22222222-2222-2222-2222-222222222222');

\echo '--- 8. schedule with mode=teaching_group but an ADMIN GROUP target MUST fail'
INSERT INTO recurring_course_schedule
  (id, title, subject_id, teaching_mode, administrative_group_id, branch_id,
   start_time, end_time, recurrence, weekdays, academic_year_id, created_at, updated_at)
  VALUES (gen_random_uuid(), 'وضع مستهدف غير صالح',
          '44444444-4444-4444-4444-444444444444', 'teaching_group',
          '66666666-6666-6666-6666-666666666666', '33333333-3333-3333-3333-333333333333',
          '09:00', '10:00', 'weekly', ARRAY['saturday']::day_of_week[],
          (SELECT id FROM academic_year LIMIT 1), now(), now());

\echo '--- 9. schedule with TWO targets MUST fail'
INSERT INTO recurring_course_schedule
  (id, title, subject_id, teaching_mode, level_id, administrative_group_id, branch_id,
   start_time, end_time, recurrence, weekdays, academic_year_id, created_at, updated_at)
  VALUES (gen_random_uuid(), 'مستهدفان غير صالحين',
          '44444444-4444-4444-4444-444444444444', 'entire_level',
          '22222222-2222-2222-2222-222222222222', '66666666-6666-6666-6666-666666666666',
          '33333333-3333-3333-3333-333333333333',
          '09:00', '10:00', 'weekly', ARRAY['saturday']::day_of_week[],
          (SELECT id FROM academic_year LIMIT 1), now(), now());

\echo '--- 10. schedule with recurrence = none MUST fail (that is an Event)'
INSERT INTO recurring_course_schedule
  (id, title, subject_id, teaching_mode, level_id, branch_id,
   start_time, end_time, recurrence, weekdays, academic_year_id, created_at, updated_at)
  VALUES (gen_random_uuid(), 'تكرار غير صالح',
          '44444444-4444-4444-4444-444444444444', 'entire_level',
          '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333',
          '09:00', '10:00', 'none', ARRAY[]::day_of_week[],
          (SELECT id FROM academic_year LIMIT 1), now(), now());

\echo '--- 11. biweekly_alternating with NO anchor_date MUST fail'
INSERT INTO recurring_course_schedule
  (id, title, subject_id, teaching_mode, level_id, branch_id,
   start_time, end_time, recurrence, weekdays, academic_year_id, created_at, updated_at)
  VALUES (gen_random_uuid(), 'مرساة مفقودة',
          '44444444-4444-4444-4444-444444444444', 'entire_level',
          '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333',
          '09:00', '10:00', 'biweekly_alternating', ARRAY['tuesday']::day_of_week[],
          (SELECT id FROM academic_year LIMIT 1), now(), now());

\echo '--- 12. a VALID entire-level weekly schedule must SUCCEED'
INSERT INTO recurring_course_schedule
  (id, title, subject_id, teaching_mode, level_id, branch_id,
   start_time, end_time, recurrence, weekdays, academic_year_id, created_at, updated_at)
  VALUES ('88888888-8888-8888-8888-888888888888',
          'حصة أسبوعية صالحة',
          '44444444-4444-4444-4444-444444444444', 'entire_level',
          '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333',
          '09:00', '10:00', 'weekly', ARRAY['saturday']::day_of_week[],
          (SELECT id FROM academic_year LIMIT 1), now(), now());

\echo '--- 13. end_time before start_time MUST fail'
INSERT INTO session (id, schedule_id, date, start_time, end_time, created_at, updated_at)
  VALUES (gen_random_uuid(), '88888888-8888-8888-8888-888888888888',
          '2026-09-12', '10:00', '09:00', now(), now());

\echo '--- 14. R83: cancelled session with NO reason must SUCCEED'
INSERT INTO session (id, schedule_id, date, start_time, end_time, status, created_at, updated_at)
  VALUES (gen_random_uuid(), '88888888-8888-8888-8888-888888888888',
          '2026-09-12', '09:00', '10:00', 'cancelled', now(), now());

\echo '--- 15. a valid session must SUCCEED, and a DUPLICATE (schedule, date) must fail'
INSERT INTO session (id, schedule_id, date, start_time, end_time, created_at, updated_at)
  VALUES (gen_random_uuid(), '88888888-8888-8888-8888-888888888888',
          '2026-09-13', '09:00', '10:00', now(), now());
INSERT INTO session (id, schedule_id, date, start_time, end_time, created_at, updated_at)
  VALUES (gen_random_uuid(), '88888888-8888-8888-8888-888888888888',
          '2026-09-13', '09:00', '10:00', now(), now());

\echo '--- 16. room capacity of 0 MUST fail (shape only — it constrains nothing else)'
INSERT INTO room (id, name, branch_id, capacity, created_at, updated_at)
  VALUES (gen_random_uuid(), 'قاعة 1', '33333333-3333-3333-3333-333333333333', 0, now(), now());

\echo '--- 17. blank group name MUST fail'
INSERT INTO administrative_group (id, name, level_id, branch_id, created_at, updated_at)
  VALUES (gen_random_uuid(), '   ', '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333', now(), now());

\echo '--- 18. ar-x-icu collation is on both name columns'
SELECT c.relname AS table, a.attname AS column, co.collname
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_collation co ON co.oid = a.attcollation
 WHERE c.relname IN ('administrative_group','teaching_group') AND a.attname = 'name';
