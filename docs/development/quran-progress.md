[Documentation](../README.md) › [Development](README.md) › **Quran progress**

# Quran progress — one engine, three surfaces

**The page for every question about حفظ.** It cites [`docs/SRS.md`](../SRS.md)
§4.5, BR-11, BR-13 and Revisions 43, 73, 88, 91 and 92 rather than restating
them; where a rule below has an SRS home, the SRS wins.

---

## The model, and why nothing was added to it

| Entity | What it is | Source of truth? |
|---|---|---|
| `QuranSurah` | the 114 seeded rows; `total_ayahs` is *the definitive denominator* (§4.5) | reference |
| `QuranProgressLog` | discrete closed ayah ranges, tagged `category` | **yes** |
| `StudentSurahProgress` | self-healing coverage cache, O(1) reads | **never** — see §4.5 |
| `LevelSurah` | which Surahs a Level's curriculum teaches | reference |

Section C added **no table, no column and no migration**. The audit that opened
it found the model already expressed the requirement; what was missing was
reach, a curriculum-aware form, and one category rule.

### Why `QuranProgressLog` carries no `level_id`

The entry form asks for a Level, the server validates it, and the audit row
records it — **but the log does not store it**. Memorisation is a fact about
`(student, surah)`: BR-13's union is computed per Surah, and a Level column
would make a second, forkable answer to *how much of this Surah does she know*.
R73 §0 refused a `subject_id` here for exactly the same reason, and §7 still
calls storing one a defect.

**The consequence is deliberate**: a Surah in two Levels' syllabuses shows the
same figure under both. That is not ambiguity — it is one fact, displayed in two
contexts, and the Level heading says which context is being read.

## Memorisation is the union of the MEMORISATION logs

`recalculateFor` merges **only** `new_memorization` rows. BR-13's arithmetic is
untouched — still the union of merged, non-overlapping closed intervals, still
computed by the one routine in `policies/quran-coverage.ts`. What changed is
which logs go into it.

Every log used to count, so مراجعة raised the percentage. Two consequences, the
second worse:

* revising ayahs 1–4 that were **never memorised** created 4 ayahs of
  memorisation out of nothing;
* and because BR-11 reads this same percentage, a Level could be reported
  **complete** on revision alone.

`category` exists precisely to tell the two apart, and §4.5 is titled *Quran
**Memorization** Tracking*.

> **Ratified by SRS Revision 95** (Document Owner, 2026-08-20). §4.5 and BR-13
> define coverage as the union of *"all"* logged intervals, and *all* read
> literally included revision — which is how the engine behaved. R95 qualifies
> the word rather than rewriting it in place, so the original wording and the
> correction stay legible side by side: **`new_memorization` intervals are the
> only inputs to memorization coverage; `revision` intervals never are.** BR-13's
> merge is untouched, and its worked example still holds exactly — those three
> ranges carry no category. **BR-11 follows automatically**: level completion
> reads memorization coverage only and cannot be raised by revision activity.

Revision is not discarded. `revision_log_count` and `last_revised_at` come back
with every coverage row, and the log itself is preserved and displayed — *has
this been revised, and when last* is the question revision actually answers.

## `LevelSurah` is normative for ENTRY

A Surah may be logged against a Level only when both hold:

1. the مستفيدة has a live enrolment in that Level;
2. that Level's syllabus configures that Surah.

Both refusals are server-side and coded — `LEVEL_NOT_ENROLLED` (as `NOT_FOUND`,
§20 rule 17) and `SURAH_NOT_IN_LEVEL`. **The form narrowing its options is
convenience; this is the authority**, and a forged request naming another Level
or a Surah outside it never reaches the log.

**A missing `levelId` is refused explicitly**, and that is not defensive noise:
`{ levelId: undefined }` in a Prisma `where` means *no filter*, so the guard
silently matched any enrolment and any syllabus row. The integration suite
proved it by passing 27/27 with the field absent.

## Who may enter, and for whom

Authority is [`teaching-authority.md`](teaching-authority.md)'s, unchanged —
`studentsTaughtBy` narrowed by R73's `tracks_quran_progress` marker. Section C
corrected one consumer and widened none:

| Caller | Reaches |
|---|---|
| **Super Admin** | every **beneficiary** — a live enrolment plus R79's `is_beneficiary` |
| **Admin** | the same, bounded by their managed branches |
| **مؤطِّرة / assistant** | the beneficiaries whose **Quran** she teaches, on **today** |

**Beneficiaries, never Users.** The Super Admin arm read `{ deletedAt: null }` —
every account on the platform — so the selector offered parents, مؤطِّرات and
administrators as candidates for memorisation entry.

### The R92 correction

`studentsTaughtBy`'s occurrence arm read `audienceWhere(session.schedule)` — the
schedule's *inherited* audience — and so ignored the occurrence's own
`SessionAudienceBranch` rows. `audienceForSession`'s docstring already named
*"the Quran occurrence arm"* among its consumers; **the consumer had never been
connected**. A مؤطِّرة teaching a combined Quran lesson could not log the visiting
branch's memorisation.

It composes the canonical resolver now, and the arm covers both the one-off
cover *and* the regular مؤطِّرة, so a combined audience reaches whoever actually
teaches it. **It widens nothing permanently**: the query is bound to the date, so
the next ordinary occurrence resolves to the schedule's own branch again — a
property that follows from the date rather than from a rule anybody must
remember.

## The three surfaces

**One workspace, two portals.** `/admin/quran` and `/teacher/quran` render the
same `QuranWorkspace`. What differs is what `/quran-students` answers for the
caller's token — never the screen, never a second form. Building an
administrative variant would have duplicated three dependent selectors and their
validation so that two screens could ask one question (rule C).

**`/admin/quran` is not in §14.1**, and is recorded rather than papered over —
the same footing as `/admin/level-surahs`. The *capability* has been normative
since R73; only the node is new, which is why it ships without an SRS revision.

**One request for three selectors.** `/quran-students` answers
`{ students, levels }`, each level carrying its syllabus. `GET
/admin/levels/{id}/surahs` answers **403** for a مؤطِّرة, so a curriculum-driven
Surah list was unreachable for the role that needs it most — **rule O: a smaller
question, never a wider permission**. Only the Levels her own roster reaches
appear.

**حفظي shows the syllabus, not the log.** Every Surah `LevelSurah` configures,
including the ones still at zero, each with the shared `ProgressBar`; grouped by
`{Category} — {Level}` when there is more than one, through `levelLabel`. The
raw history stays, below. The old screen listed only Surahs she had logs for, so
a مستفيدة who had memorised nothing saw an empty page and one halfway through
could not tell what remained.

## The guards

| Guard | What it pins |
|---|---|
| [`policies/quran-coverage.test.ts`](../../backend/src/policies/quran-coverage.test.ts) | BR-13's worked example · adjacency · re-logging never inflating |
| [`services/quran.integration.test.ts`](../../backend/src/services/quran.integration.test.ts) | the engine, R73's subject narrowing, the self-heal guard, BR-11 completion |
| [`services/quran-entry.integration.test.ts`](../../backend/src/services/quran-entry.integration.test.ts) | whole-Level · Group · Circle · assistant parity · unrelated Subject · R88 grants nothing · R91 dated authority and the one-off cover · R92 combined and NOT widened · beneficiaries not Users · multi-Level · `LevelSurah` refusals · ayah bounds · **revision never inflating** · audit actor and level |
| [`components/quran/quran-entry.test.ts`](../../frontend/src/components/quran/quran-entry.test.ts) | one workspace and one writer · the curriculum drives the Surah list · no 114 · no `level_ids[0]` · error ≠ empty · the ARIA meter contract · no second progress meter · Level grouping |
| [`scripts/ci/check-progress-css.sh`](../../scripts/ci/check-progress-css.sh) | the meter fills by **logical** size, clips its track, and honours `prefers-reduced-motion` — in `scripts/ci/` because `?raw` on a `.css` file yields `''` under vitest and such a guard passes while reading nothing |
| [`scripts/dev/browser/verify-quran-entry.mjs`](../../scripts/dev/browser/verify-quran-entry.mjs) | the whole matrix driven as ten identities: Admin, مؤطِّرة, assistant, Group, Circle, Tafseer-only, R91's pair, and two beneficiaries reading حفظي |
