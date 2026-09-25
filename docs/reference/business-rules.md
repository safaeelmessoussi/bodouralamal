[Documentation](../README.md) › [Reference](README.md) › **Business rules**

# Business rules

Twenty-three technology-independent invariants (SRS §12). A business rule wins over any conflicting section; the conflict is reported, never silently resolved.

## Consent

### BR-1
- Absence of a media-release consent record means no consent; never assumed, inferred or defaulted true.
- Enforced: effective status derived from the most recent record; never a boolean column. → [Business processes](../overview/business-processes.md#2-consent)

### BR-2
- A WARNING since R170 §3 (Owner, 2026-09-21): if any student in a session's resolved audience (§4.4c) lacks effective consent, every recording of it carries `media_consent_missing`, shown to staff in «مكتبة المحتوى» and the class dialog; nothing is forced, visibility stays the Category default or staff choice.
- Re-evaluated on enrolment, split-membership, consent change and upload, both directions (a later grant clears it).
- Until R170 it forced non-public and moved bytes to the private bucket; before R43 it named a "group".
- Enforced: one job recomputes the session graph and writes the flag (audited `content.consent_warning`); multi-session content is warned by the union of audiences; `null` for non-staff. → [Storage](../architecture/storage.md#consent-gating)

### BR-3
- WITHDRAWN by R170 §3: no consent-forced state exists; whoever may edit visibility sets it, and is warned. TD-2's «override consent gate» row and `CONSENT_GATE_LOCKED` went with it.

## Access and safeguarding

### BR-4
- No registered account or parent-child bundle gains data access before explicit staff approval; unapproved links grant no visibility; Pending sees only public content.
- Enforced: only `GET /me` and logout answer a Pending session, plus a client route guard; both tested independently.

### BR-5
- Minors have no credentials; access to a minor's data flows through an approved parent link or a staff role, verified on every individual access.
- Enforced: child-context middleware matches both parent and child on an approved link per request, so revocation applies on the next call. → [Identity and access](../architecture/identity-and-access.md#child-context)

### BR-16
- Minors' social, health and family data: Admins, Super Admins and the student's specifically assigned teachers only; never students, guardians (including linked parents) or teachers at large (R28 corrected "unrelated guardians"). Field-level; reads audited as well as writes.

### BR-20
- Global reach is a privilege: cross-branch publishing of content or events is reserved to administrators; branch-scoped teaching staff publish within their scope only.

## Grading

### BR-6
- A formula takes effect only when weights total exactly 100 %; incomplete formulas compute nothing; partial denominators never used. Post-MVP with the weight engine.

### BR-7
- A weighted exam with no mark for an enrolled student records a zero flagged absent, replaceable via makeup; weights never silently renormalized.
- Enforced: absent-zero rows created at first draft save.

### BR-8
- No grade or exam is visible to students or parents before explicit publish; recalculated grades require explicit re-publish.

### BR-9
- Assigning a Surah or Subject to a Level auto-creates its draft grading components.
- R107–R108 carve-out: حفظ القرآن and تفسير القرآن `LevelSubject` rows create no generic component (`LevelSurah` is the shared per-Level Surah selection); a Surah assignment creates memorisation and Tafsir components; only حفظ feeds the memorisation progress engine.

### BR-10
- Certificates and transcripts snapshot exact values at generation; later formula edits never change an issued document.

### BR-11
- For every Surah of the Level's «مقرر الحفظ»: 100 % memorisation coverage and, only where the Level teaches تفسير (by-Surah, not the tracker), an exam of that Surah *taken*; no تفسير → coverage alone; no syllabus → neither complete nor incomplete.
- *Taken* = a recorded mark not «غائبة», or a submitted remote paper; no pass mark exists (R166 §1). One rule, `policies/level-completion.ts`, derived on read, never stored; shown on «حفظي» and the مؤطِّرة's Quran screen.
- Attendance gates nothing (§4.7, R123): never a grade, certification or completion input (Fluid Engagement Model: absence often means *watched the recording*); no absence row — present is a live `Attendance` row, not-marked is its absence.

### BR-12
- A manual pass/fail override always beats computed results and is never clobbered by recalculation.

### BR-13
- Coverage is the union of non-overlapping `new_memorization` intervals per Surah; revision intervals never raise it (R95); re-logging never inflates; every log change including corrections and deletions is reflected immediately and synchronously (it drives [BR-11](#br-11)). → [Business processes](../overview/business-processes.md#5-quran-memorization-tracking)

## Content and data

### BR-14
- Content and every scheduling kind (نشاط, حصة, امتحان — R109) have exactly three visibility states: public, private, hidden; consent gating can force non-public. Readers per tier and why `hidden` = responsible person + Super Admins: [Three visibility tiers](../architecture/calendar-and-hijri.md#three-visibility-tiers--on-all-three-kinds-r109).

### BR-15
- All deletions are soft with a restorable snapshot and a 90-day permanent-delete window; every destructive or sensitive action is attributable to actor and timestamp. The restoration interface may be manual early; snapshot and window are non-negotiable.

## Scheduling and organisation

### BR-17
- Class times come from recurring schedules targeting the student; they produce dated occurrences, changeable or cancellable without changing the schedule.
- The organisational group is not the teaching group: a subject may split differently, one student in several splits (one per subject). Non-teaching activity never sources the routine timetable. Week starts Monday. Before R43: "class time implied by group enrolment".

### BR-21
- Several Levels at once, exactly one organisational group per Level; the group states the attended branch (the requested branch is never the answer); Level membership is never recorded apart from group membership.
- Per academic period (R122): unique `(student_id, level_id, academic_period_id)` where `deleted_at IS NULL`; `deleted_at` = *ended by a human*; currency read from the period's dates ([Database](../architecture/database.md#uniqueness)).
- Enforced by the database: a composite foreign key forces the enrolment's Level to match its group's; not a service check.

### BR-22
- A subject is taught to the whole Level unless deliberately split; each student holds at most one split-group per subject per Level; an enrolled student unplaced in a split subject must be surfaced as unplaced (she has no classes for it).

### BR-23
- Room capacity is displayed and constrains nothing; no enrolment, placement or scheduling action is refused on capacity; the assigner is responsible. No "group full" error, no capacity row-lock; reintroducing the rule means reintroducing the lock.

## Legal and localization

### BR-18
- All real personal data, including backups, resides on Moroccan infrastructure; environments outside Morocco hold fixture data only.
- Enforced: the fixtures guard, the ban on copying production dumps, the mock-only staging frontend. → [Environments](../operations/environments.md#the-residency-firewall)

### BR-19
- Structural entities display in admin-defined order, falling back to correct Arabic alphabetical order, never codepoint order.
- Enforced by native column collation; never a per-query workaround, fix the column.

### BR-20
- Seeded does not mean immutable (Owner addendum, 2026-08-26): every user-visible catalogue has an Admin/Super Admin management path; the seed is the initial state, never a whitelist; seed runs are additive, idempotent, find by live name, create only what is absent, preserve every rename/reorder/re-flag. Worked example: [scheduling-type catalogue (R110)](../architecture/calendar-and-hijri.md#the-scheduling-type-catalogue-r110).

**Related:** [Technical design](technical-design.md), [Business processes](../overview/business-processes.md)
