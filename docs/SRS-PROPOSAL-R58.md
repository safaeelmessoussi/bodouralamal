[Documentation](README.md) › **SRS proposal — Revision 58**

# Draft SRS Revision 58 — scheduling an Exam

> **Status: DRAFT — awaiting the Document Owner.** Not applied, because the requested field
> list and §4.6 describe **two different things**, and which one the association actually does is
> a question about the world rather than about the code.
>
> The architecture extension the request also asked for **is** done and shipped: `exam` is one
> entry in `scheduling-types.ts` plus one section component away from working.

---

## The conflict, first

The request asks an exam to carry **branch, room, target groups and responsible staff**. Those
four describe a **physical sitting**: people in a room at a time, supervised.

§4.6 says the MVP exam is not that:

> **Format (Revision 12):** digital exams only in MVP; the standardized print-ready CSS layout is
> postponed to §10.1 — **paper sittings are prepared outside the platform** until then, and their
> marks entered as grades normally.

and §4.6 opens by making exams deliberately *unscheduled*:

> **Exam Independence & Floating Rounds:** Exams are created **independently of strict calendar
> bounds** or rounds.

So an MVP `Exam` is an **instrument**: a title, a Level, an optional Subject or Surah, a date, a
question array, an access policy, submissions and grades. A student opens it and answers it.
There is no room because nobody sits anywhere, and no invigilator because nothing is invigilated.

**This is not an objection to what was asked for.** It is that two coherent products are being
described, and they want different models.

## Reading A — an exam is a digital assessment with a window

Then "scheduling" it means *when it is open*, and the additions are small:

| Field | Status | Note |
|---|---|---|
| `title` | **exists** | §7 |
| `description` | **missing** | Every other schedulable item has one (R57) |
| `date` | **exists** | The day it belongs to |
| `opens_at` / `closes_at` | **missing** | Wall-clock, TD-11 — the availability window |
| `level_id` | **exists** | Who it is for |
| `subject_id` / `surah_id` | **exists** | Optional, per §4.6 |
| `academic_year_id` | **missing** | **A real gap regardless of this revision** — content and schedules both carry one, grades aggregate per year, and an exam does not |
| `branch_id` | **missing** | Nullable = every branch, mirroring §4.9's Global scope for content |
| room, staff, target groups | **not applicable** | Nothing is sat |

**Recommended.** It follows §4.6 as written, needs four columns, and every one of them earns its
place. `academic_year_id` should arrive whatever else is decided.

## Reading B — an exam is a sitting the association organises

Then it genuinely needs a room, invigilators, a start and end time, and a target narrower than a
Level. But **that is a different fact from the instrument**, and putting both on `Exam` would
make one row mean *the question paper* and *the event where it is answered* at once — the
organisation-versus-delivery conflation §20 rule 22 exists to prevent, and the same mistake
Revision 43 removed from Groups.

Two honest ways to model it:

1. **The sitting is an Event** that references the exam. Events already carry a date, a time and
   a four-way scope; they lack a room, which is the one thing missing — and §4.4 gives them none
   deliberately, so this would be a real change to the Event model.
2. **The sitting is its own entity** (`ExamSitting`: exam, branch, room, start/end, invigilators,
   target group), leaving `Exam` as the instrument. Cleanest, and the largest.

**I would not choose between these without knowing whether exams are actually sat on the
premises in the association's practice.** §4.6 currently says they are prepared outside the
platform, which is why nothing here models them.

## Target groups deserve their own note

§4.6 targets an exam at a **Level**. Narrowing to an Administrative or Teaching Group is a real
and plausible want — the same three teaching modes a Course Schedule has (§4.4c) — and it is
independent of the room question. If it is wanted, the honest shape is the one that already
exists: a `teaching_mode` plus one `target_id`, **not** three nullable columns.

## What is already done

The unified Scheduling architecture now declares each kind in one place
(`adapters/scheduling-types.ts`): whether it is available and why not, which shared fields apply,
whether it has materialized occurrences to drill into, and what it routes to. `exam` is declared
there and refused with a stated reason (§14.4).

**Adding it is one entry, one section component and one arm of `saveSchedulingItem`.** The form,
the recurrence editor, the list and the calendar view do not change — and the parity guard
asserts the form branches on no type at all, so that claim is checked rather than promised.

## What I need from the Owner

1. **Are exams sat on the premises, or answered online?** Reading A or Reading B.
2. If B: should the sitting be an Event with a room, or its own entity?
3. Should an exam be targetable at a **group**, not only a Level?
4. `academic_year_id` on `Exam` — I recommend it regardless. Confirm and it goes in with whatever
   else is decided.

Nothing here is blocked on the answer except the exam type itself, which is M5 work in any case.
