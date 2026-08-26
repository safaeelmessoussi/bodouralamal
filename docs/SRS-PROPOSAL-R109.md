[Documentation](README.md) › **SRS Proposal — Revision 109**

# SRS Proposal — Revision 109

**A scheduling item's visibility is its own fact, on all three kinds — and
`hidden` means the person responsible for it, not every Admin.**

**Status:** **PROPOSED — awaiting the Document Owner.** The decisions below are
already ratified (NEW B §B, 2026-08-26, and the readiness audit's supersession
table); what is proposed here is the **normative wording**, because `docs/SRS.md`
is the Document Owner's to edit and this agent must never touch it.

The implementation shipped with this proposal (NEW B §C). **It implements the
ratified decisions, not this text** — if the Owner's wording differs, the code is
the thing that changes.

---

## 1 · Why the four clauses had to move

Before this revision only an `Event` carried a tier.

| Kind | What the SRS said | What that meant in practice |
|---|---|---|
| نشاط | Three tiers on `Event.visibility` | Fine |
| حصة | §4.4 — *"Sessions are PUBLIC — anonymous visitors browse the timetable"* | A class could not be arranged quietly, at all |
| امتحان | §4.6 — *"An exam has no visibility tier of its own"* | **A statement about AUDIENCE**, answering nothing about publication |

So the association could announce a celebration and not a class, and could not
arrange a sitting quietly under any circumstances. §4.6's clause is the subtler
of the two: *"it appears to the audience that can see the level it belongs to"*
describes **who the paper is for**. Whether the sitting is announced is a
different question, and nothing answered it.

## 2 · The proposed revision

> **Revision 109 (Document Owner decision — a scheduling item's visibility is its
> own fact, 2026-08-26):**
>
> **(1) Every kind of scheduling item carries a visibility tier**, drawn from the
> single `visibility` enum §4.4 already defines (`public | private | hidden`):
> `Event`, `RecurringCourseSchedule`, `Session` and `Exam`. §4.4's *"Sessions are
> PUBLIC — anonymous visitors browse the timetable"* and §4.6's *"An exam has no
> visibility tier of its own"* are **superseded**. Every row that existed before
> this revision is `public`, so the browsable timetable is unchanged in fact; what
> changes is that it becomes a decision an administrator takes rather than a
> property of the model.
>
> **(2) The tier travels schedule → occurrence through the mechanism that already
> exists.** `RecurringCourseSchedule.visibility` is the **default**;
> `session.materialize` **snapshots** it onto each occurrence exactly as it
> snapshots `room_id` (Revision 43.4) and `delivery_mode` (Revision 97); a future,
> un-protected occurrence is resynced by a schedule edit; and an `overridden`
> occurrence is never rewritten. **There is no second override marker** — a
> `visibility_overridden` column would give *«did a human decide about this
> occurrence?»* two answers that drift. An `Exam` takes one column and no
> snapshot, because a sitting materializes nothing. The Revision 50 split carries
> the tier onto the successor and may change it.
>
> **(3) `hidden` means the RESPONSIBLE PERSON, plus Super Admins, and nobody
> else.** §4.4's *"Visible to Teachers only for events whose scope intersects
> their own teaching scope … and to **all Admins regardless of branch scope**"* is
> **superseded in both arms**. Who is responsible is a fact each kind already
> records: `EventStaff.position = 'responsible'` (R71.3), `SessionStaff.position =
> 'teacher'`, `ExamStaff.position = 'supervisor'`. **This NARROWS reach that
> exists today** — every Admin currently sees every hidden Event — and the
> narrowing is deliberate. An assistant does **not** read a hidden item: R87 §G
> makes an assistant the main teacher for *operational authorization* on the class
> she staffs, and `hidden` is not an operation on the class but a statement of who
> it belongs to, exactly as R71.3 already separates *both positions see* from
> *only `responsible` may edit*.
>
> **(4) A hidden حصة resolves its responsible مؤطِّرة on THAT OCCURRENCE'S OWN
> DATE**, never as of now. Revision 91 withdrew `@@unique([scheduleId, userId])`,
> so *"at most one main teacher on any given date"* is an enforced invariant while
> *"one main teacher for the series"* is not true at all. Resolving as of today
> would strip a replaced مؤطِّرة of the occurrences she actually taught and hand her
> ones she did not. `SessionStaff` is the resolution: Revision 43.4's snapshot is
> written from `CourseScheduleStaff` effective on that occurrence's own date, and
> where the two can differ — a past, overridden or otherwise protected occurrence
> — the snapshot is the correct answer, in Revision 91's own words (*"schedule
> staffing answers who is assigned for this period; `SessionStaff` answers who
> took this class"*).
>
> **(5) `Event.visibility` defaults to `public` for NEW rows only.** The schema
> default was `private`, which made *«nobody outside the office can see this»* the
> outcome an administrator got by not choosing. Stored tiers are untouched:
> rewriting them would publish activities somebody deliberately hid.
>
> **(6) The tier is a PUBLICATION rule, not an administration one.** It gates the
> calendar and the public occurrence surfaces — `GET /calendar`, `GET
> /me/calendar`, the §5.2 session page, and the sessions a content item is used by
> — where a caller who may not read an item receives **`404`, never `403`** (§20
> rule 17). It is **not** applied to the management lists (`GET /admin/events`,
> `/admin/course-schedules`, `/admin/exams`), which remain governed by role and
> branch scope: an Admin who could no longer see a hidden class in the management
> list could no longer un-hide it, so applying the tier there would make hidden
> items *unadministrable* rather than confidential.
>
> **(7) The `private` tier is unchanged.** §4.4(2) stands as written, including its
> two accepted trade-offs: private is not filtered by a student's own branch or
> group (Risk R-6), and staff are bounded by branch scope — so a branch-scoped
> Admin sees less private material than any approved beneficiary does. Risk R-7
> (existence leaking through conflict detection) now applies to a hidden حصة for
> the same reason it applied to a hidden نشاط.

## 3 · Clauses this supersedes, named

| Clause | Says today | Superseded by |
|---|---|---|
| §4.4 — *"Sessions are PUBLIC"* | حصة has no tier | (1); legacy backfill `public` **preserves the behaviour exactly** |
| §4.6 — *"An exam has no visibility tier of its own"* | امتحان has no tier | (1) |
| §4.4 tier 3 — *"and to all Admins regardless of branch scope"* | Admins see every hidden item | (3) — **the one place this revision removes access** |
| §7 — `Event.visibility` default `private` | New activities are private by default | (5), new rows only |

## 4 · What is NOT proposed

* **No new entity, no new marker, no second mechanism.** The tier reuses the
  `visibility` enum, the R43.4 snapshot, the `overridden` flag and the R50 split.
* **No change to `private`.** Only `hidden` moves.
* **No change to who may reach a management surface.** TD-2 is untouched.
* **No change to §4.9 content visibility**, which is a different concept on a
  different entity and stays where it is.

---

**Related:** [Calendar and Hijri → Three visibility
tiers](architecture/calendar-and-hijri.md#three-visibility-tiers--on-all-three-kinds-r109),
[BR-14](reference/business-rules.md#br-14), [`SRS.md`](SRS.md) §4.4, §4.6, §7
