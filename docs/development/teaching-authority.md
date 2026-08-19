[Documentation](../README.md) › [Development](README.md) › **Teaching authority**

# Teaching authority — who may act on whom, and when

**One page for the question every teaching feature asks.** It cites
[`docs/SRS.md`](../SRS.md) §4.4c and Revisions 73, 87, 88, 90 and 91 rather than
restating them; where a rule below has an SRS home, the SRS wins.

---

## The three facts, and what each one may answer

| Fact | Where it lives | May it authorise? |
|---|---|---|
| **Capability / availability** — *«I can teach Quran», «I am free Thursdays»* | `TeacherSubjectCapability` · `TeacherCategoryCapability` · `TeacherAvailability` (R88) | **never** |
| **Effective assignment** — *she staffs this class from X to Y* | `CourseScheduleStaff` with `effective_from` / `effective_until` (R91) | **yes**, on dates inside the period |
| **Occurrence staffing** — *she took this lesson* | `SessionStaff` (R43.4) | **yes**, for that occurrence — and it **overrides** the schedule |

**The first must never answer for the second.** A مؤطِّرة with a flawless profile
and no assignment reaches nothing; one assigned a Subject she never declared
holds full authority from the moment of assignment. Both halves are asserted in
`teaching-candidates.http.integration.test.ts` and in the browser.

## The period model, stated once

Both bounds are **inclusive calendar dates** (TD-11 — never instants).

```
effective_from = NULL   →  from the schedule's own beginning
effective_until = NULL  →  through the schedule's own end (itself possibly open)
```

Every row written before R91 carries two NULLs, which is why the migration
needed **no backfill**: a time-blind row already meant *the schedule's whole
life*. Deriving an `effective_from` from `anchor_date` was rejected — it would
assert an assignment date nobody recorded.

The arithmetic lives in
[`policies/effective-staffing.ts`](../../backend/src/policies/effective-staffing.ts)
and **nowhere else**. `effectiveOn(date)` and `effectiveWithin(from, to)` are
Prisma fragments, so a caller composes them into its own single query rather than
materialising a list of ids — the snapshot argument `roster-resolution.ts`
records, unchanged.

### Touching IS overlapping here

`intervalsOverlap` treats two periods that share one day as overlapping, unlike
`teaching-profile.overlaps` for availability ranges. The difference is
deliberate: two availability ranges that touch describe one continuous free
period, while two assignments that share a day mean **two people are the main
teacher that day** — exactly what R91 §6 forbids.

## Which date each consumer asks about

**This table is the answer to "do not simply default everything to today".**

| Consumer | Date it asks about | Why |
|---|---|---|
| `studentsTaughtBy` — teacher roster, `/quran-students` | **today** | *whom do I teach now*; the screens act on current students |
| `teacherBranchIds` — content upload scope, branch list | **today** | uploading is something somebody does now |
| `teachesQuran` → `GET /me` → the «إدخال الحفظ» menu | **today** | the marker must agree with the roster, or the menu opens an empty screen |
| `teacherEventScope` — Hidden-event visibility | **today** | what she teaches today decides what she may see today |
| `assertExamInTeacherScope` | **the exam's own date** | a replacement authoring a paper for a sitting inside her period is authorised for it |
| `staffsSession` | **the occurrence's date**, after `SessionStaff` | the occurrence's own truth first, the schedule as it stood on that date second |
| Personal calendars · notifications · content on an occurrence | **the occurrence's own `SessionStaff`** | materialization already wrote the right person per date |
| R90 candidate conflicts | **the proposed class's period** | a finished assignment is not a clash |
| `readableScope` — which class DEFINITIONS she may read | **any period** | hiding a class she taught last term would hide her own history and grant nobody anything |

## History is never rewritten

The rule R91 states as non-negotiable, and the mechanism that keeps it:

* Materialization snapshots **each occurrence with the assignments effective on
  its own date**, so one edit produces October→Safa, November→Amina,
  December→Safa with **no occurrence touched by hand**.
* Resync reaches **only future, un-overridden, still-`scheduled`** occurrences —
  §4.4's existing protection predicate, unchanged.
* A past occurrence is **never** resolved through the schedule. Asking the
  schedule is precisely what would let today's handover rewrite last month.

## The occurrence override

A one-off cover is a `SessionStaff` fact about one date. The person named holds
full operational authority for that occurrence and none beyond it; the schedule
is untouched; the next occurrence resolves normally. It is edited from
«مؤطّرة هذه الحصة» on `/admin/schedules/{id}/sessions`, and the dialog says
*this occurrence only* rather than leaving an administrator to infer it from what
did not change.

`studentsTaughtBy` carries an **occurrence arm** for exactly this: a مؤطِّرة with
no schedule assignment at all reaches that occurrence's audience on its day. It
was added because R87 §J opened «إدخال الحفظ» for a cover while the resolver, which
knew only about schedules, handed her an empty list — rule **P** inverted.

## Where the invariants are enforced, and why not in SQL

`assertStaffIntervals` in
[`course-schedule.service.ts`](../../backend/src/services/course-schedule.service.ts)
holds the schedule's staffing rows `FOR UPDATE` (TD-15.2's existing pattern) and
then checks:

1. at most one **main** مؤطِّرة active on any date;
2. no overlapping periods for the same person on one schedule;
3. every period intersects the schedule's own life — **refused, never clipped**.

PostgreSQL could express (1) as `EXCLUDE USING gist`, but that needs
`btree_gist`, which §3.1's deployment does not install and TD-13 does not list.
R91 declines the extension dependency and takes the lock instead. **The lock is
what makes two administrators racing impossible**: the second transaction blocks
and then sees the first's rows.

## The guards

| Guard | What it pins |
|---|---|
| [`policies/effective-staffing.test.ts`](../../backend/src/policies/effective-staffing.test.ts) | inclusive bounds · open ends · touching = overlapping · single-day periods · schedule-life containment |
| [`controllers/effective-staffing.http.integration.test.ts`](../../backend/src/controllers/effective-staffing.http.integration.test.ts) | migration compatibility · all three interval refusals · **two rows for one person** · per-occurrence materialization · roster/marker/calendar boundaries · assistant parity · the occurrence override · R90 conflict clean-up · R88 untouched · concurrency |
| [`scripts/dev/browser/verify-effective-staffing.mjs`](../../scripts/dev/browser/verify-effective-staffing.mjs) | the replacement driven as Admin, Safa, Amina and an assistant: dated rows on the form, Safa twice, per-date occurrences, four different answers on one class at one moment, and a handover that leaves the past alone |
| [`components/scheduling/staffing-periods.test.ts`](../../frontend/src/components/scheduling/staffing-periods.test.ts) | blank date = open-ended, converted once at the wire · many assistants · one person on several rows · each refusal in Arabic |
