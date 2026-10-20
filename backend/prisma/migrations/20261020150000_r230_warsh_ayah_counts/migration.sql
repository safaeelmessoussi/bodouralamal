-- R230 (Owner, 2026-10-20 — «we are using رواية ورش عن نافع not hafs, so update
-- everything in the platform to follow رواية ورش عن نافع»). The Surahs' verse
-- counts become Warsh's (the later Madani count, 6214 verses — King Fahd
-- Complex Warsh data): البقرة 285, النساء 175, المائدة 122, الأنعام 167…
-- Teachers record from their Warsh mushaf, so a range already in the logs
-- keeps its numbers; a range that ran to a Hafs end beyond the Warsh one
-- («the whole Surah» recorded as 286) ends at the Surah's Warsh end, and the
-- stored coverage is recomputed from the clamped intervals.
UPDATE "quran_surah" q SET "total_ayahs" = w.n
FROM (VALUES
  (1, 7),
  (2, 285),
  (3, 200),
  (4, 175),
  (5, 122),
  (6, 167),
  (7, 206),
  (8, 76),
  (9, 130),
  (10, 109),
  (11, 121),
  (12, 111),
  (13, 44),
  (14, 54),
  (15, 99),
  (16, 128),
  (17, 110),
  (18, 105),
  (19, 99),
  (20, 134),
  (21, 111),
  (22, 76),
  (23, 119),
  (24, 62),
  (25, 77),
  (26, 226),
  (27, 95),
  (28, 88),
  (29, 69),
  (30, 59),
  (31, 33),
  (32, 30),
  (33, 73),
  (34, 54),
  (35, 46),
  (36, 82),
  (37, 182),
  (38, 86),
  (39, 72),
  (40, 84),
  (41, 53),
  (42, 50),
  (43, 89),
  (44, 56),
  (45, 36),
  (46, 34),
  (47, 39),
  (48, 29),
  (49, 18),
  (50, 45),
  (51, 60),
  (52, 47),
  (53, 61),
  (54, 55),
  (55, 77),
  (56, 99),
  (57, 28),
  (58, 21),
  (59, 24),
  (60, 13),
  (61, 14),
  (62, 11),
  (63, 11),
  (64, 18),
  (65, 12),
  (66, 12),
  (67, 31),
  (68, 52),
  (69, 52),
  (70, 44),
  (71, 30),
  (72, 28),
  (73, 18),
  (74, 55),
  (75, 39),
  (76, 31),
  (77, 50),
  (78, 40),
  (79, 45),
  (80, 42),
  (81, 29),
  (82, 19),
  (83, 36),
  (84, 25),
  (85, 22),
  (86, 17),
  (87, 19),
  (88, 26),
  (89, 32),
  (90, 20),
  (91, 15),
  (92, 21),
  (93, 11),
  (94, 8),
  (95, 8),
  (96, 20),
  (97, 5),
  (98, 8),
  (99, 9),
  (100, 11),
  (101, 10),
  (102, 8),
  (103, 3),
  (104, 9),
  (105, 5),
  (106, 5),
  (107, 6),
  (108, 3),
  (109, 6),
  (110, 3),
  (111, 5),
  (112, 4),
  (113, 5),
  (114, 6)
) AS w(id, n)
WHERE q."surah_id" = w.id;

UPDATE "quran_progress_log" l
SET "end_ayah" = q."total_ayahs", "start_ayah" = LEAST(l."start_ayah", q."total_ayahs")
FROM "quran_surah" q
WHERE q."surah_id" = l."surah_id" AND l."end_ayah" > q."total_ayahs";

WITH clamped AS (
  SELECT p."id",
         COALESCE(jsonb_agg(jsonb_build_object('start', s, 'end', LEAST(e, q."total_ayahs")) ORDER BY s)
                  FILTER (WHERE s <= q."total_ayahs"), '[]'::jsonb) AS intervals,
         COALESCE(SUM(LEAST(e, q."total_ayahs") - s + 1) FILTER (WHERE s <= q."total_ayahs"), 0) AS merged,
         q."total_ayahs" AS total
  FROM "student_surah_progress" p
  JOIN "quran_surah" q ON q."surah_id" = p."surah_id"
  LEFT JOIN LATERAL (
    SELECT (iv->>'start')::int AS s, (iv->>'end')::int AS e FROM jsonb_array_elements(p."merged_intervals") iv
  ) i ON true
  GROUP BY p."id", q."total_ayahs"
)
UPDATE "student_surah_progress" p
SET "merged_intervals" = c.intervals,
    "merged_ayah_count" = c.merged,
    "coverage_percent" = ROUND(c.merged * 100.0 / c.total, 2)
FROM clamped c
WHERE c."id" = p."id";
