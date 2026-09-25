[Documentation](../README.md) › [Development](README.md) › **Quran progress**

# Quran progress — one engine, three surfaces

Cites [`docs/SRS.md`](../SRS.md) §4.5, BR-11, BR-13 and Revisions 43, 73, 88, 91, 92, 95, 107; the SRS wins.

## The model

| Entity | What it is | Source of truth? |
|---|---|---|
| `QuranSurah` | 114 seeded rows; `total_ayahs` is the definitive denominator (§4.5) | reference |
| `QuranProgressLog` | discrete closed ayah ranges, tagged `category` | yes |
| `StudentSurahProgress` | self-healing coverage cache, O(1) reads | never (§4.5) |
| `LevelSurah` | the Surahs a Level's حفظ القرآن syllabus teaches; تفسير القرآن follows the same selection without entering the engine | reference |

- Section C added no table, column or migration: only reach, a curriculum-aware form and one category rule.
- The marker identifies حفظ القرآن, not the Quran domain: القرآن الكريم is a domain, not a Subject row (R107–R108); initial Subjects are أحكام القرآن, حفظ القرآن, ترتيل وتجويد القرآن, تفسير القرآن (may grow). `tracks_quran_progress` belongs only to حفظ القرآن: a current staffing assignment for that Subject authorises memorisation entry for its resolved audience; it classifies nothing else, configures no coverage, is no FK on the log.
- Partial unique index: at most one live marker; absence is a valid fail-closed pre-bootstrap state; the Production seed establishes and asserts exactly one; ambiguity is refused rather than name-matched or moved silently.
- تفسير القرآن is curriculum alignment, not tracking: Tafsir staff gain no حفظ authority, Tafsir never changes BR-13 coverage; the postponed grading-template engine will derive paired per-Surah memorisation and Tafsir components from `LevelSurah`.
- `QuranProgressLog` carries no `level_id`: the form asks a Level, the server validates it, the audit records it, the log does not store it — memorisation is a `(student, surah)` fact; a Level column would fork BR-13's answer (R73 §0 refused `subject_id` likewise; §7 calls storing one a defect). A Surah in two Levels' syllabuses shows the same figure under both, the Level heading naming the context.

## Memorisation is the union of the MEMORISATION logs

- `recalculateFor` merges only `new_memorization` rows; BR-13's merge of non-overlapping closed intervals in `policies/quran-coverage.ts` is untouched.
- Previously every log counted: revising never-memorised ayahs 1–4 created 4 ayahs from nothing, and BR-11 could report a Level complete on revision alone.
- Ratified by SRS Revision 95 (2026-08-20): `new_memorization` intervals are the only inputs to memorization coverage; `revision` intervals never are; BR-13's worked example holds (its three ranges carry no category); BR-11 follows automatically.
- Revision is kept: `revision_log_count` and `last_revised_at` return with every coverage row; the log is preserved and displayed.

## What says a Level is COMPLETED — the administration only (R168 §3)

- BR-11 (every Surah of «مقرر الحفظ» memorised, and an exam of each taken where the Level teaches تفسير) is computed by `policies/level-completion.ts` as the conditions, never the verdict; completion = an Admin or Super Admin recording «تسجيل إتمام المستوى» (`LevelCompletionMark`, R167 §3); neither an exam taken nor passed marks it (closes R166's open question).

| `completion.marked_on` | `completion.complete` | «حفظي» and the مؤطِّرة's Quran screen say |
|---|---|---|
| a date | anything | «أتمّت المستوى — *date*» |
| `null` | `true` | «استوفت شروط الإتمام — بانتظار تسجيل الإدارة» |
| `null` | `false` | «لم تُستوفَ شروط الإتمام بعد», naming the Surahs still to memorise and be examined on |
| `null` | `null` | «لم يُضبط «مقرر الحفظ» لهذا المستوى بعد» |

- Conditions stay on screen beside a recorded completion; the administration may knowingly record a Level whose conditions the platform cannot see met (R167 §3).

## `LevelSurah` is normative for ENTRY

- A Surah may be logged against a Level only if the مستفيدة has a live enrolment in it (`LEVEL_NOT_ENROLLED`, as `NOT_FOUND`, §20 rule 17) and the Level's syllabus configures the Surah (`SURAH_NOT_IN_LEVEL`); the form's narrowing is convenience, the server is the authority.
- A missing `levelId` is refused explicitly: `{ levelId: undefined }` in a Prisma `where` means no filter (the suite passed 27/27 with the field absent).

## Who may enter, and for whom

Authority is [`teaching-authority.md`](teaching-authority.md)'s: `studentsTaughtBy` narrowed by R73's `tracks_quran_progress` marker.

| Caller | Reaches |
|---|---|
| Super Admin | every beneficiary — live enrolment plus R79's `is_beneficiary` |
| Admin | the same, bounded by managed branches |
| مؤطِّرة / assistant | the beneficiaries whose marked حفظ القرآن she teaches, today |

- Staffing أحكام القرآن, ترتيل وتجويد القرآن, تفسير القرآن or another unmarked Subject authorises no memorisation write.
- Beneficiaries, never Users: the Super Admin arm once read `{ deletedAt: null }` and offered parents, مؤطِّرات and administrators.
- R92 correction: the occurrence arm read `audienceWhere(session.schedule)` (inherited audience), ignoring `SessionAudienceBranch`, so a combined Quran lesson's visiting branch could not be logged; it now composes `audienceForSession`, covers the one-off cover and the regular مؤطِّرة, and is bound to the date so the next occurrence narrows again.

## The three surfaces

- `/admin/quran` and `/teacher/quran` render the same `QuranWorkspace`; only `/quran-students`' answer for the token differs (rule C).
- `/admin/quran` is not in §14.1, recorded like `/admin/level-surahs`: the capability is normative since R73, only the node is new.
- `/quran-students` answers `{ students, levels }`, each Level with its syllabus, because `GET /admin/levels/{id}/surahs` answers 403 for a مؤطِّرة (rule O); only the Levels her roster reaches appear.
- حفظي shows the syllabus, not the log: every configured Surah including those at zero, with the shared `ProgressBar`, grouped by `{Category} — {Level}` via `levelLabel` when more than one; raw history below.

## The guards

| Guard | Pins |
|---|---|
| [`policies/quran-coverage.test.ts`](../../backend/src/policies/quran-coverage.test.ts) | BR-13's worked example · adjacency · re-logging never inflating |
| [`services/quran.integration.test.ts`](../../backend/src/services/quran.integration.test.ts) | the engine, R73 subject narrowing, self-heal guard, BR-11 completion |
| [`services/quran-entry.integration.test.ts`](../../backend/src/services/quran-entry.integration.test.ts) | whole-Level · Group · Circle · assistant parity · unrelated Subject · R88 grants nothing · R91 dated authority and one-off cover · R92 combined, not widened · beneficiaries not Users · multi-Level · `LevelSurah` refusals · ayah bounds · revision never inflating · audit actor and level |
| [`services/production-seed.integration.test.ts`](../../backend/src/services/production-seed.integration.test.ts) | fresh Production seed twice · R108 eight-Subject baseline · additive custom/historical preservation · exactly one حفظ marker · marked-vs-unmarked authorization |
| [`components/quran/quran-entry.test.ts`](../../frontend/src/components/quran/quran-entry.test.ts) | one workspace, one writer · curriculum drives the Surah list · no 114 · no `level_ids[0]` · error ≠ empty · ARIA meter contract · no second meter · Level grouping |
| [`scripts/ci/check-progress-css.sh`](../../scripts/ci/check-progress-css.sh) | meter fills by logical size, clips its track, honours `prefers-reduced-motion`; in `scripts/ci/` because `?raw` on a `.css` file yields `''` under vitest |
| [`scripts/dev/browser/verify-quran-entry.mjs`](../../scripts/dev/browser/verify-quran-entry.mjs) | ten identities: Admin, مؤطِّرة, assistant, Group, Circle, Tafseer-only, R91's pair, two beneficiaries reading حفظي |
