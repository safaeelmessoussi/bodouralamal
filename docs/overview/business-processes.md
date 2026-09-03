[Documentation](../README.md) › [Overview](README.md) › **Business processes**

# Business processes

How the institute's work actually happens in the platform. Each process below names the
rules that govern it and links to the technical detail.

---

## 1. Registration and approval

**Nobody gets access without a human deciding.** That is
[`BR-4`](../reference/business-rules.md#br-4), and everything here serves it.

### The flow is OAuth-first

The registration form is **never shown before Google authentication succeeds**. The
verified email arrives first, so an account can never be created against an address nobody
proved they own — and the email field on the form is pre-filled and read-only.

```
Visitor → "Continue with Google" → Google verifies email
   │
   ├─ Known identity          → sign in, route by account status
   ├─ Pre-provisioned email   → bind the identity, then route by status
   └─ Nobody we know          → registration form → Pending
```

### Four ways a person enters the system

| Path | Who initiates | Result |
|---|---|---|
| **Adult self-registration** | An adult learner | One `Pending` account |
| **Unified parent + child** | A parent with no account | One Pending parent request plus one or more child applications. Each accepted child account, link, consent history, placement and authorization are created atomically at approval |
| **هيئة التأطير request** | A prospective مؤطّرة | One `Pending` account plus general framing willingness (physical/online/both and one/multiple/all physical branches); **no authority** |
| **Staff pre-provisioning** | Staff, in person | An account carrying the beneficiary's Google address, which binds when that person first logs in |

The unified registration is atomic by rule, not by luck: the Pending parent, identity,
one-or-more child applications, request-level data-processing decision and single-use token
record all commit together or none do. Media release is a separate explicit decision on each
child application, so siblings may differ without one request-level value overriding them.
Each child likewise retains her own requested Category and Branch. Every French name is
optional as a pair: both personal and family parts, or neither. A phone is mandatory on every
new public registration; nullable legacy accounts are neither backfilled nor refused on login.

### Registration records requests and willingness; it never places or authorizes

An ordinary learner requests one branch and stage. A هيئة التأطير applicant states
whether she can frame in person, online or both; physical willingness may name one, several,
or every current and future branch. Neither answer is placement or RBAC scope. No applicant
chooses a Room, Level, Group or role authority; approval records the administrative decision.
After approval the same general preference remains visible read-only on the teaching profile,
beside—but never inferred into—the independently stated weekly availability ranges.

The approval queue is deliberately reachable to approvers and shows the request/willingness.
Its table stays compact; `عرض التفاصيل` exposes the submitted guardian contact/consent data
and one complete block per child. A registration notification links to that applicant's exact
still-pending review. A stale or already-decided coordinate says it is unavailable rather than
opening a blank screen or falling back to the whole queue.
Pending and Rejected applicants do not also appear in ordinary user administration or
operational people-pickers: account management contains approved Active/Suspended accounts,
while operational selectors contain Active accounts only.
For a staff applicant, a single willing branch may be preselected as a convenience; multiple
or all branches require an explicit scope decision so willingness is never silently promoted
to authority.

### Approval

An Admin reviews the queue and approves or rejects with a reason. For every admitted
beneficiary, approval atomically creates the placement, sets the durable beneficiary fact and
ensures one explicit Student role at that placement's branch; an approval spanning ambiguous
Student branches is refused rather than guessed. Activating a children-only guardian creates
no beneficiary fact, Student role or Enrollment for the parent. Each child application creates
its child account, consent history, approved family link, placement and Student role in that
child's own decision, using that child's requested Category/Branch only. Rejection
is **terminal** — a rejected applicant cannot re-register themselves; that
requires staff action. Rejecting also revokes every live refresh session for that account in
the same transaction as the state change and mandatory audit records. A retained credential
cannot renew, and a later authorized account recovery would require a fresh authentication
rather than reviving the old sessions.

**Every placement approval creates names the academic period that covers today**, and there
must be one: with no period open the approval is refused rather than enrolling into an
unrecorded semester. Opening the year's periods is therefore part of starting an academic
year, alongside creating the year itself.

> SRS §4.1, §4.1b, R122 · TD-4.1, TD-4.2 ·
> [Identity and access](../architecture/identity-and-access.md)

### Platform Owner continuity

The initial Owner is pre-provisioned and binds her real Google subject on first verified
login; she does not register and no placeholder identity exists. Ownership is then independent
of seed configuration. To change it, the current Owner selects another already-active Global
Super Admin and confirms the dedicated transfer. The former Owner remains a Global Super Admin.
Until that succeeds, every suspend/delete/de-identify/demote path is refused. This is one
atomic lifecycle handoff, not a role rename.

Only the required live global Super Admin assignment is protected. The Owner may hold Teacher,
Student or any other ordinary functional role concurrently, and those additional roles keep
their normal scopes and edit lifecycle. The user form's main Save includes the currently
configured role; «إضافة دور» begins another row rather than secretly committing the first.

### Actionable changes reach the existing in-app inbox

Registration submission/decision, family-link lifecycle, role/scope changes, ownership
receipt, placement changes, explicit Session/Event restaffing and physical Exam lifecycle
changes now create delivered facts in the affected person's own inbox. Automatic notices
commit with the change they announce; the existing optional Session/Event audience prompt
still happens only after the saved change and can be declined.

Recipients come from the authoritative domain rows, never a list supplied by the browser.
The actor is excluded, unrelated people receive nothing, and a dual-role Exam participant
receives separate assignment and attendance notices because those require different action.
Retries and unchanged saves do not duplicate or resurface anything; a genuine later transition
withdraws the stale opposite fact and makes the one current semantic row unread again.

Hidden scheduling items are also hidden in the inbox: only the responsible teacher for a
Session, responsible Event staff member, or Exam supervisor retains a target-bearing notice.
Changing an item to hidden withdraws already-delivered coordinates from students and
assistants. Upload completion remains silent because it is storage finalization, not a
deliberate content-publication event.

> SRS §4.8, Revision 116 · [API notifications](../reference/api-endpoints.md#notifications)

---

## 2. Consent

Consent is a **versioned record**, never a checkbox column
([`BR-1`](../reference/business-rules.md#br-1), and rule 2 of the AI guardrails).

Every registration captures a general data-processing consent. Registrations for teens and
children additionally capture an **explicit, separate parental media release**: *"I consent
to my child's voice/recordings being published on public class content."*

Each decision is stored with who granted it, when, by what method (online form or recorded
by staff in person), and **the exact version of the consent text agreed to**. Revocation is
a new state change with its own actor and timestamp — history is never overwritten.

**Absence of a record means no consent.** Never assumed, never inferred, never defaulted
true.

### The Session consent gate

This is where consent becomes structural rather than administrative.

> If a Session's resolved audience has **even one** beneficiary without effective media
> consent, every recording linked to it is forced private. Shared recordings use the union
> of all linked Session audiences.
> — [`BR-2`](../reference/business-rules.md#br-2)

Crucially, this is **not a check performed at upload time**. It is a continuously
maintained invariant, re-evaluated automatically whenever any of three things happen:

1. a beneficiary joins/leaves/moves in an enrollment or Teaching Group, or a Session-content
   link or R92 occurrence-audience branch changes,
2. a consent is granted or revoked for an enrolled student,
3. a recording is uploaded, imported, or replaced.

Retained live Sessions stay in this trigger graph even when their recurring schedule has been
soft-deleted. Deployment startup also walks live recording-linked Sessions in bounded batches
and inserts the same idempotent reevaluation obligations, so older backlog converges without a
separate policy path.

A recording published while everyone consented **flips to private** when a non-consenting
beneficiary later joins the resolved audience, or when consent is revoked. Application reads
and the stable public storage origin fail closed when re-evaluation commits; the durable
worker pins, copies and hashes the exact canonical key, retires its network-internal public
copy, then commits private placement. Replacement/deletion retain exact old-key obligations,
so stale work cannot delete newer bytes. General visibility editing remains separate.

**Only an Admin can lift a consent-forced private state, and only with a written
justification** that is recorded in the audit log. A teacher can never do it
([`BR-3`](../reference/business-rules.md#br-3)).

One edge case is worth stating because it looks like a bug: a Session whose resolved audience
is empty has no non-consenting beneficiary, so the gate does not engage. The first audience
mutation adding a beneficiary without consent triggers re-evaluation and forces the flip.

> SRS §4.1a, §4.9 · [Storage](../architecture/storage.md#consent-gating) ·
> [Background jobs](../architecture/background-jobs.md)

---

## 3. Scheduling

**Organisation and delivery are separate, and that separation is the whole design**
(SRS Revision 43). Until that revision one entity was a roster, a timetable slot, a room
booking and a teacher assignment all at once, which is why a student could sit in only one
slot per level and why a level could not teach two subjects at different times to
differently-split students.

**Administrative Group** — the permanent organisational unit inside a Level. It carries a
level, a branch, and a name, and **nothing else**: no room, no teacher, no schedule, no
capacity. It is the roster used for organisation, reporting, communication, the default
timetable and (later) attendance. A student belongs to one or more Levels and to **exactly
one Administrative Group in each**. That group is also the answer to *which branch is this
person at* — the branch chosen at registration is a request, not a placement.

**Teaching Group** — a subject-specific split, belonging to a Subject and a Level. It
exists **only** when a subject needs students divided differently from the administrative
roster. تفسير القرآن may be taught to the whole level while حفظ القرآن runs in three
parallel groups, and the splits are **independent between subjects**: one student may be in
Administrative Group 1, حفظ القرآن Group 2 and ترتيل وتجويد القرآن Group 1 at once.

**Recurring Course Schedule** — the unit of delivery. Subject, teaching mode, branch, room,
teacher, assistants, times, recurrence. The **teaching mode** — entire level, one
administrative group, or one teaching group — belongs here and nowhere else, because the
same level teaches one subject whole and another split.

**Session** — one dated occurrence, materialized ahead of time by a background job. Each
session carries its own date, time, room and teacher, defaulted from its schedule and
individually changeable, which is what makes a cancellation, a room change or a makeup
class an *edit to a session* rather than a second scheduling mechanism. Notes, recordings,
linked content and (later) attendance all hang here.

**Events are the non-teaching layer**: holidays, ceremonies, exams, one-off activities. An
event may apply to several branches, categories, levels, or administrative groups at once,
and those relationships are **written explicitly at creation time** rather than evaluated
as wildcards at read time. **Events never generate sessions**, and a class is never an
event.

Recurrence is **one shared vocabulary** used by both schedules and events — none, daily,
weekly, multiple weekdays, **biweekly-alternating** ("week on, week off"), monthly, yearly
— deliberately not modelled twice. The alternating pattern is modelled and tested
explicitly because it is the one naive implementations get wrong, and because conflict
detection has to see that a weekly and a biweekly class collide only on alternate weeks.
That last point is why sessions are materialized eagerly rather than computed on read:
overlap is checked against real rows, so the answer is exact.

### Two rules that look small and are not

**Times are wall-clock, never UTC instants.** Morocco observes UTC+1 but **suspends DST
during Ramadan every year**. A weekly class stored as a UTC instant would silently shift by
an hour, twice a year, for every class in the system. A class at 17:00 is at 17:00 on the
wall clock, always.

**Room capacity informs; it never refuses.** The number is shown to whoever is planning and
constrains nothing — no enrolment, placement or scheduling action is blocked by it. The
person assigning the room is responsible for its suitability, and administrative groups
carry no capacity at all because they have no room.

**Branches have an operational start date.** Calendar grids scoped to a branch grey out
every date before it. When a branch activates, an Admin performs a **manual backfill** to
attach the applicable global and recurring events — or knowingly skips it. The gap is never
silently auto-filled and never silently ignored.

> [`BR-17`](../reference/business-rules.md#br-17) ·
> [`BR-21`](../reference/business-rules.md#br-21) ·
> [`BR-22`](../reference/business-rules.md#br-22) ·
> [`BR-23`](../reference/business-rules.md#br-23) · SRS §4.4, §4.4c, TD-11 ·
> [Calendar and Hijri](../architecture/calendar-and-hijri.md)

---

### Attendance replaces the paper sheet, and changes nothing else

The association kept two kinds of paper sheet and the platform keeps both. A
**register** — a class or an exam — opens with the enrolled names already on it
and the مؤطِّرة marks the ones who came. A **blank list** — a lecture, an
activity — starts empty and names are added as people arrive. Which one an
occurrence gets is a property of its type; **عطلة and حفل get neither**, and the
server refuses attendance for them outright.

Somebody who is not enrolled in that class may still attend and be marked: the
enrolment says who is *expected*, not who is *allowed*. Nobody is ever recorded
as absent — an expected person who was not marked simply has no row — and
**attendance decides nothing**: not a grade, not a certificate, not a level
completion. An absence here routinely means *watched the recording*.

In المرأة, a class may be set so each woman records her own presence; she may
record **only her own**. In اليافعات and الطفل a مؤطِّرة always records it, and
the server refuses a self check-in for them whatever an occurrence is configured
to say.

> SRS §4.7 (built by R123) · [Identity and access](../architecture/identity-and-access.md)

## 4. The Hijri calendar

The platform displays Hijri dates alongside Gregorian ones. How it obtains them is a
genuine architectural decision, and one of the more instructive stories in this project.

**Morocco fixes each Hijri month by local moon sighting**, announced by the **Ministry of
Habous and Islamic Affairs** on the evening of the 29th. It regularly differs from Umm
al-Qura and from every calendar library's algorithm.

The platform therefore **computes nothing**. It reproduces the Ministry's official
announcements, recorded month by month by a Super Admin. An earlier design used a library
algorithm with a globally adjustable ±2-day offset; Revision 31 removed it, because an
offset can only approximate a sighting-based calendar and it approximates it *uniformly*,
while the actual divergence varies month to month.

Three consequences follow, all deliberate:

- **A month that has not been recorded and published carries no Hijri label at all.** Where
  the official answer is genuinely not yet known, the platform says nothing rather than
  guessing.
- **This is recurring administrative work** — roughly one recording per month, plus any
  correction the Ministry issues.
- **The Super Admin records, and does not decide.** The vocabulary is enforced across the
  specification, the API, the interface, and the code: *record official month start*,
  *publish official month*, *official Ministry announcement*. The words *choose*, *define*,
  and *set* are prohibited, because language that reads as a choice invites treating the
  value as editorial judgement — and the platform's entire claim is that it reproduces an
  external authority.

**There is no importer.** An investigation is recorded in the specification: the Ministry
publishes prose news announcements with no API, no feed, and no dataset, and because months
are fixed by observation a year cannot be published in advance. A shipped import endpoint
could only ever answer *not configured* — a promise the system cannot keep, which invites
clients to build against it. Adding one later needs no redesign: a single write path and a
provenance column already exist for exactly that.

> SRS §4.4, §5.7 · Revisions 31, 32 ·
> [Calendar and Hijri](../architecture/calendar-and-hijri.md#the-hijri-overlay)

---

## 5. Quran memorization tracking

**القرآن الكريم is the curriculum domain, not a Subject** (SRS R107–R108). Its initial
atomic Subjects are أحكام القرآن, حفظ القرآن, ترتيل وتجويد القرآن, and تفسير القرآن;
the list is extensible. Only حفظ القرآن carries `tracks_quran_progress`: staffing the
marked Subject is the structural fact that authorises a مؤطرة to record memorisation for
the schedule's current audience. Teaching any unmarked Quran-domain Subject grants no
memorisation authority.

`LevelSurah` is the حفظ القرآن memorisation syllabus and the set BR-11 completion reads;
تفسير القرآن follows those same Surahs per Level. It has no Subject foreign key because
progress remains a student + Surah fact. Tafsir alignment does not grant memorisation
authority or change coverage; أحكام and ترتيل وتجويد use ordinary `LevelSubject` curriculum.

A teacher logs what a student has memorized as **ayah ranges** — Surah 2, ayahs 10 to 20 —
tagged as new memorization or revision.

Coverage is the **mathematical union** of those ranges, per Surah:

```
Logged:  [10–20]   [10–30]   [30–123]
Merged:  [10–123]  →  114 ayahs  →  114 / total_ayahs of that Surah
```

Overlapping logs must never inflate progress
([`BR-13`](../reference/business-rules.md#br-13)). Logging the same range twice changes
nothing.

**Corrections propagate immediately.** Creating, editing, *or deleting* a log recomputes
that Surah's coverage **synchronously, in the same request**, and returns the fresh value.
Never a background job.

The reason is not responsiveness — it is correctness. Coverage drives **level completion**
([`BR-11`](../reference/business-rules.md#br-11)). A teacher correcting a mis-logged range
must see the corrected percentage immediately, and a stale figure after a deletion could
wrongly signal that a student has completed a level.

There is a read cache for speed, but it is **self-healing and never authoritative**: every
consumer compares the cached row against the latest log and repairs it in place on
mismatch, so a crash between the write and the cache update cannot produce a wrong number.

> SRS §4.5 · [Backend](../architecture/backend.md)

---

## 6. Exams and grading

**Exams are independent of calendar bounds.** Each carries a date, a level, and optionally
a subject or Surah. *Rounds* (roughly semesters) are optional sorting labels, not
restrictions.

The exam builder supports multiple-choice questions (auto-graded) and free-text answers
(marked by a teacher). Every question carries an **immutable UUID**, and submissions
reference those UUIDs rather than array positions — so reordering a question cannot silently
re-attach an answer to the wrong one.

### Scoring is integer-only

All scores — question maxima, auto-scores, subjective marks, final totals — are stored as
**integer basis points** of the exam total (0–10,000). No floating-point number appears
anywhere in scoring storage or arithmetic. Division rounds half-up **exactly once**, at
final persistence. The association's /20 scale is a *display* conversion applied at render
time.

### Draft until published

Nothing is visible to students or parents until an explicit publish action
([`BR-8`](../reference/business-rules.md#br-8)).

**Absent means zero, flagged as absent** ([`BR-7`](../reference/business-rules.md#br-7)) —
and those rows are created the moment a teacher **first saves a draft**, so intermediate
averages on a teacher's dashboard already include absentees rather than being inflated by
their omission. The row stays replaceable for a late entry or a makeup.

Teachers and Admins can override pass/fail per student, with actor and reason recorded.
**A manual override always wins** and is never clobbered by recalculation
([`BR-12`](../reference/business-rules.md#br-12)).

### What is deliberately absent

The **weighted grading-template engine** — which would compute round averages from
basis-point weights — is postponed. MVP grades are **per-exam and informational**; no
averages are displayed anywhere.

This is a coherent state of the model rather than a hack: every exam already defaults to
0 bp, so "no templates exist" simply means all grades are informational entries. The
instruction attached is emphatic: **do not hardcode an interim average formula**, because
an interim formula is a second grading engine that would have to be torn out.

> SRS §4.6 · [`BR-6`](../reference/business-rules.md#br-6)…[`BR-12`](../reference/business-rules.md#br-12)

---

## 7. Educational content

Teachers and Admins attach files — PDFs, images, slides, audio recordings — to a level, and
optionally to a calendar event, for pre-class preparation or post-class follow-up.

**Three visibility tiers**, stored as an enum and never a boolean:

| Tier | Who sees it | Where the file lives |
|---|---|---|
| **Public** | Everyone, including anonymous visitors | Public bucket, stable URL |
| **Private** | Logged-in students and parents in the target level or group | Private bucket, short-lived signed URL after a permission check |
| **Hidden** | Staff only | Private bucket |

Changing tier **physically moves the object between buckets**. A stale public link then
lands on a friendly page explaining that access changed — never a raw storage error.

**Global scope is a privilege.** Content with no branch appears across every branch. Only
Admins and Super Admins may assign it; teachers are locked to their own branches, and an
attempt to publish platform-wide is refused
([`BR-20`](../reference/business-rules.md#br-20)).

Teachers record on their phone's own voice recorder and upload the file. The in-app
recorder is postponed — it was the most cross-browser-fragile piece of the build, and the
upload pipeline already accepts everything phones produce.

> SRS §4.9 · [Storage](../architecture/storage.md)

---

## 8. Accountability

Two separate mechanisms, often confused, both present:

| | **Audit log** | **Trash** |
|---|---|---|
| For | Accountability — who did what, when, why | Restoration — putting a record back |
| Content | Actor, timestamp, action, target, detail | A full JSON snapshot of the deleted row |
| Deletable? | Only by one sanctioned job, on an enumerated allowlist | Purged after 90 days |

**Nothing is destroyed silently** ([`BR-15`](../reference/business-rules.md#br-15)). Every
deletion is soft, snapshotted, and attributable. Hard deletion happens only through the
90-day quarantine purge.

The audit coverage grid is a **minimum** — adding coverage is allowed, removing it is not.
It includes things that are not obviously "changes": viewing a child's case file is
audited, because in a safeguarding context *who looked* is as important as *who edited*.

Restoring a soft-deleted record in the MVP runs through a **locked CLI script**, not raw
SQL in a database session. The reason is stated bluntly in the specification: a raw session
enforces nothing, and accountability would depend on developer goodwill. The script wraps
the snapshot restore, the reinstatement of cascaded relationship rows, and the audit row in
a single transaction — because a user restored without their links and roles is a
half-restored, silently broken account.

> SRS §4.10, TD-8 · [Runbooks](../operations/runbooks.md)

---

**Next:** [User journeys](user-journeys.md) · **Related:**
[Business rules](../reference/business-rules.md), [Architecture](../architecture/README.md)
