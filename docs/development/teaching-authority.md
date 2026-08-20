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

## Who ATTENDS is a different question from who teaches (R92)

Two occurrence-specific dimensions, resolved independently:

| Question | Answered by |
|---|---|
| **who teaches this occurrence** | R91's effective assignment, then the occurrence's own `SessionStaff` |
| **who attends this occurrence** | `audienceForSession` — the schedule's audience, unless the occurrence states its own branches |

`SessionAudienceBranch` exists for one real case: the association occasionally
delivers a lesson **once instead of twice**, so two branches' classes meet
together, physically at one of them, for that occurrence only.

**Replacement, not addition.** No rows → the audience is inherited. Rows → they
*are* the audience's branches. An additive reading leaves nobody able to say
whether the schedule's own branch still counts; the dialog seeds the override
with it already selected, so *combine* is expressed by adding the second.

**Physical location is not audience.** `Session.branch_id` is not overloaded and
is not written: the class stays at its venue while people come to it from
elsewhere. `GET /sessions/{id}/roster` reports both, side by side, so nobody
infers one from the other.

**Scope, never a roster** (§20 rule 22): branch populations resolved against live
Enrollments at read time. No Enrollment is mutated, no Session duplicated, no
per-student row created — each asserted rather than trusted.

**One resolver, or none of it works.** `audienceForSession` is composed by the
personal calendar, the roster, the notification recipients, the audit count and
the Quran occurrence arm. A cross-branch `OR` written independently in one
service is the failure the revision exists to prevent: honoured by notifications
and not by the calendar leaves a beneficiary told about a class she cannot see.

> **The Quran arm was the proof of that, by being missing** (fixed 2026-08-20).
> This list already named it while `studentsTaughtBy` still read
> `audienceWhere(session.schedule)` — the schedule's *inherited* audience — so a
> مؤطِّرة teaching a combined Quran lesson could not log the visiting branch's
> memorisation. **A consumer named in a docstring is not a consumer.** The arm
> now covers the regular مؤطِّرة as well as the one-off cover, and stays bound to
> the date, so the next ordinary occurrence narrows again on its own. See
> [Quran progress](quran-progress.md).

**Whole-Level only, and the rest is refused rather than invented.** In the other
two modes the branch is carried by the target itself, so a branch list has no
meaning; the write refuses it and the action is not offered. Whether combining
Groups or Circles across branches means anything is an **open Owner question**.

**The counterpart is never guessed.** Two branches' schedules are structurally
independent — nothing identifies *the corresponding lesson* — so the platform
does not cancel the other branch's occurrence. The administrator combines the
audience and then cancels the counterpart explicitly, through the flow that
already asks whether to tell people.

## An Event is not a class, and being assigned to one is its own news (R93)

`EventStaff` (R71) and `CourseScheduleStaff` (R91) are separate concepts and
must stay separate — §20 rule 22. Nothing about event staffing touches teaching
authority, and nothing here is effective-dated.

**A مؤطرة staffs the event she answers for, and only that.** She may name the
assistants; she may not make anybody else responsible, and the server refuses
it (`RESPONSIBLE_MUST_BE_SELF`) rather than the interface hiding it. Admin reach
is unchanged.

**Two narrow reads exist because the grant would otherwise be unreachable.**
`GET /admin/users` and `GET /admin/levels` both answer **403** for her, so her
assistants control and her scope selector were empty and she could fill the whole
form before finding out. `GET /me/event-staff-options` answers *whom may I name
here*; `GET /me/event-scope-options` answers *what may I address this to* — the
Administrative Groups she teaches, through §4.4c and bounded by R91's effective
staffing. **Neither widens anything**: the admin endpoints still refuse her.

> **The standing rule this is the third instance of:** when a screen cannot
> work, the fix is a *smaller question*, never a wider permission (rule O).

### The assignment notice

| | |
|---|---|
| `event_created` | this activity is happening — to the people it is **for**, and **optional** (R82.5) |
| `event_staff_assigned` | **you are working on this** — to the person named, and **automatic** |

Announcing an assignment as `event_created` would tell her the association is
holding a celebration: true, and not the thing she has to act on.

**Only the newly assigned are told** — the difference between the staffing in
force and the staffing submitted — so an edit to the title tells nobody again. A
person removed and later re-added **is** newly assigned: her row was withdrawn in
between, so the notice returns unread to the top rather than duplicating. The
actor is excluded (R78.3), and **the rule is about being assigned, not about who
assigns** — an Admin naming an assistant tells her exactly as a مؤطرة does.

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
| [`controllers/session-audience.http.integration.test.ts`](../../backend/src/controllers/session-audience.http.integration.test.ts) | **R92** — inherited audience unchanged · both branches included · unrelated excluded · venue unmoved · next occurrence untouched · clearing restores · notifications follow the actual audience · staffing × audience independent · no Enrollment mutated, no Session duplicated · refusals and version conflict |
| [`components/scheduling/session-audience.test.ts`](../../frontend/src/components/scheduling/session-audience.test.ts) | **R92** — seeded with the inherited branch (replacement said unambiguously) · venue as text, never a control · action offered only where the server accepts it · roster shown, not inferred · `dirty` passed |
| [`services/quran-entry.integration.test.ts`](../../backend/src/services/quran-entry.integration.test.ts) | **R91 × R92 × R73** — whole-Level, Group and Circle rosters · assistant parity · an unrelated Subject and an R88 declaration granting nothing · dated authority both ways · the one-off cover · a combined occurrence reached and then NOT permanently widened |
| [`scripts/dev/browser/verify-quran-entry.mjs`](../../scripts/dev/browser/verify-quran-entry.mjs) | the same matrix driven through real screens as ten identities, ending at the beneficiary's own حفظي |
| [`scripts/dev/browser/verify-cross-branch.mjs`](../../scripts/dev/browser/verify-cross-branch.mjs) | **R91 × R92** — six identities: the Admin combines it, both beneficiaries share it, the unrelated one does not, the covering مؤطِّرة has it and the schedule's does not, cancelling tells exactly the right people, and next week is normal on both dimensions |
