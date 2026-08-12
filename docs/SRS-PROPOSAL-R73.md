[Documentation](README.md) › **SRS proposal — Revision 73**

# Draft SRS Revision 73 — Quran progress: a home, an audit row, and the scope that actually applies

**Status: DRAFTED, NOT APPLIED. One clause (73.4) is a genuinely new structural
decision and needs the Document Owner's approval before anything is written.**

Four of the Owner's five M4 decisions are already satisfied by the SRS as it
stands. This revision carries only what is genuinely missing — plus one thing the
Owner asked for that **cannot be implemented against the current schema at all**.

---

## 73.0 — What the Owner decided that the SRS already says

Recorded first, because it decides how small this revision is.

| Owner's decision | Status |
|---|---|
| Keep R43's model; Quran is a Subject for scheduling | **Already normative** (§7, R43.9) |
| `QuranProgressLog` stays keyed on `(student, surah)` | **Already normative** — §7 calls a `subject_id` there *"a defect"* |
| The teaching↔progress link is operational, not an FK | **Already how §4.4c works** |
| Teaching and assisting count equally | **Already normative** — R43 gave them one table and one rule |
| No new Role, no parallel authorization | **Nothing here adds one** |

**Decision 4 — TD-15 optimistic locking — is also already answered, and the
answer is no.** TD-15 item 5 states it directly:

> **"Quran logs need no special handling:** appends by co-teachers interleave
> freely; coverage is derived-on-read from committed rows (§4.5), so there is no
> aggregate to race on."

That conclusion still holds, though **half of its stated reason has gone stale**
and this revision corrects it: Revision 10 replaced derive-on-read with the
`StudentSurahProgress` cache, so there *is* an aggregate row now. It survives
because R10's **read-side self-heal guard** compares the cache's stamp against
the newest log and repairs on mismatch, which makes a stale aggregate
structurally unobservable rather than merely unlikely. **Appends need no lock.**

**The case TD-15.5 does not address is two staff correcting the SAME log row**,
which is last-write-wins today. It is left that way deliberately: a lost update
on one log's range is recoverable by re-correcting it, because BR-13 recomputes
the union from whatever rows exist — unlike a lost grade, which is a fact about
a person that nothing restores. **`QuranProgressLog` gains no `version` column.**

## 73.1 — §14.1: Quran logging has no reachable node

§14.1 lists `/teacher/students/{id}/quran`, whose path carries an id — so **no
menu can link to it**, and the teacher registry has no entry for it. This is the
third occurrence of one defect: Revision 69 fixed it for `مواد المستوى`,
Revision 70.1 for grade entry.

**`/teacher/quran` joins §14.1**, carrying the student as **`?student=`** — the
`/resources?level=` precedent §14.1 already sets and R69 and R70.1 each applied.
The screen asks which مستفيدة when the link does not supply one, choosing from
**the مؤطرة's own Quran students** (§73.3), so the selector cannot offer somebody
the server would refuse.

`/dashboard/student/quran` is unchanged: it carries no id, because a student
reads their own.

## 73.2 — TD-8 records the correction but not the entry

The grid carries `quranlog.update` and `quranlog.delete`. **The write that
precedes both has no action type**, so the most frequent Quran operation would
leave no trail — the same gap Revision 70.3 closed for `grade.enter`.

**`quranlog.create` joins TD-8**, detail *student, surah, range, category,
recalculated coverage*. Like every non-`auth.*` type it is outside Revision 19's
purge allowlist and is retained.

## 73.3 — Quran progress requires QURAN teaching scope

**The conflict, stated exactly.** TD-2's row reads *"Log / correct / soft-delete
Quran progress — Teacher ✔ (own students)"*, and *own students* is §4.4c's set:
**the union of the audiences of every schedule they staff, whichever Subject each
teaches.** So a مؤطرة who teaches a مستفيدة only Fiqh may today log that
مستفيدة's Quran memorization. The Owner's decision is that she may not.

**§4.4c is NOT amended.** It defines *which students a member of staff reaches*,
and that definition is correct and used by content, exams, social data and Quran
alike. What changes is **the TD-2 row that cites it**, which gains a qualifier:

> **Log / correct / soft-delete Quran progress — Teacher ✔ (own students **whose
> Quran they teach**).**

**The rule, precisely.** A مؤطرة may act on a مستفيدة's Quran progress when she
staffs a live Recurring Course Schedule whose **Subject is the Quran-tracking
Subject** and whose audience contains that مستفيدة — in any of §4.4c's three
teaching modes, which is what covers the Owner's three shapes:

| Delivery | Schedule |
|---|---|
| Quran taught to the **whole Level** | `entire_level` — that Level's students at the schedule's branch (`Enrollment.branch_id`, R66) |
| Level **subdivided into groups** | `administrative_group` |
| Quran **subdivided into circles** | `teaching_group` |

**Teaching and assisting count equally**, as R43 requires: one table, one rule,
and `position` is not consulted.

**It is a narrowing of an existing resolver, not a second one.**
`studentsTaughtBy` gains an optional Subject filter and remains the single
implementation of §4.4c. Admins and Super Admins are untouched — their scope is
the branch, and TD-2 grants them the row unqualified.

## 73.4 — **THE DECISION REQUIRED: nothing identifies the Quran Subject**

**§73.3 cannot be implemented against the current schema.** `Subject` carries
`name`, `display_order` and `version` — and nothing else. There is no way to ask
*which Subject is the Quran*, and:

* **matching on the name is prohibited.** Revision 27 made Subjects and
  Categories generic editable reference data, and §4.4b already requires rules to
  be *"checked generically … rather than hardcoded against a level name"*. A
  `name === 'القرآن'` test would hardcode reference data this document expects to
  be renamed, and would silently stop protecting anybody the day somebody edits
  it;
* **`LevelSurah` cannot answer it.** It joins a Level to a Surah and says nothing
  about which Subject delivers it.

**This is the same open gap Revision 64.7 recorded for the adult Category** —
where nothing marks the Category that holds its own login, the recommendation on
record is a structural marker, and the decision has never been taken.

**Recommendation: one nullable boolean on `Subject`.**

```
Subject.tracks_quran_progress   BOOLEAN NOT NULL DEFAULT false
```

* It makes an **existing** normative rule enforceable without inventing a
  concept — §4.5 already says memorization is tracked by Surah and ayah range;
  this only says *which Subject's teaching authorises it*.
* Names stay editable (R27).
* It is the honest answer to *"should Quran progress be a Subject-specific
  capability?"* — **yes, as one flag, and nothing more**: no per-Subject
  configuration table, no tracking modes, no second engine.
* At most one Subject may carry it (a partial unique index), because §4.5's
  engine is singular.

**The alternative, recorded rather than hidden:** a `SystemSetting` holding the
Subject's id needs no migration, but a settings row carries **no foreign key**,
so deleting that Subject would silently disable Quran authorization instead of
being refused. The column gets `ON DELETE RESTRICT` behaviour for free.

**Until this is decided, §73.3 cannot ship** — and shipping M4 without it means
shipping the behaviour the Owner explicitly rejected.

## 73.5 — What this revision does NOT do

* **No `subject_id` on `QuranProgressLog`** — §7 calls it a defect and R43 is kept.
* **No `version` on `QuranProgressLog`** — TD-15.5, reaffirmed above.
* **No change to §4.4c**, to `UserBranchRole`, or to any other Subject's scope.
* **No new Role and no parallel authorization**, per the Owner's decision 6.
* **No auto-exam trigger, no averages, no new formula** — BR-13's union is the
  only arithmetic, and §10.1 keeps the rest postponed.

## 73.6 — Audit against the live architecture

| Claim | Status |
|---|---|
| The four Quran models exist; 114 surahs are seeded | **[CODE]**, **[DATA]** |
| The `CHECK` **and** the cross-table trigger for `end_ayah ≤ total_ayahs` already exist | **[CODE]** initial migration |
| No Quran service, route, adapter, screen or test exists; 0 logs | **[CODE]**, **[DATA]** |
| `Subject` carries no marker of any kind | **[CODE]** `schema.prisma` |
| §4.4c's *own students* is subject-blind | **[CODE]** `studentsTaughtBy`; **[SRS]** §4.4c |
| TD-15 excludes Quran logs from optimistic locking, by name | **[SRS]** TD-15.5 |
| TD-15.5's *"derived-on-read"* reason predates R10's cache | **[SRS]** R10 vs TD-15.5 |
| `/teacher/students/{id}/quran` has no registry entry | **[CODE]** `teacher-modules.ts` |
| TD-8 has `quranlog.update`/`delete` and no create | **[SRS]** TD-8 grid |
