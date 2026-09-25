[Documentation](../README.md) › [Overview](README.md) › **Business processes**

# Business processes

## 1. Registration and approval

No access without a human decision ([`BR-4`](../reference/business-rules.md#br-4)).

- OAuth-first: no form before Google verifies the email; email pre-filled, read-only.
- Known identity → sign in by status; pre-provisioned email → bind, then by status; unknown → form → `Pending`.

| Path | Initiator | Result |
|---|---|---|
| Adult self-registration | Adult learner | One `Pending` account |
| Unified parent + child | Parent without account | Pending parent request + ≥1 child applications (each child created atomically at approval, see below) |
| هيئة التأطير request | Prospective مؤطّرة | `Pending` account + framing willingness (physical/online/both; one/multiple/all physical branches); no authority |
| Staff pre-provisioning | Staff, in person | Account holding the Google address; binds on first login |

- Unified registration commits parent, identity, child applications, request-level data-processing decision and single-use token together or not at all.
- Media release is a separate decision per child; siblings may differ; no request-level override.
- Each child keeps her own requested Category and Branch.
- French name optional as a pair (both parts or neither).
- Phone mandatory on new public registrations; nullable legacy accounts neither backfilled nor refused.

### Registration records requests and willingness; it never places or authorizes

- Learner requests one branch and stage; مؤطّرة applicant states physical/online/both and one/several/all current-and-future branches.
- Neither is placement or RBAC scope; nobody chooses Room, Level, Group or role; approval records the decision.
- Preference stays read-only on the teaching profile beside (never inferred into) weekly availability.
- Queue shows request/willingness; `عرض التفاصيل` shows guardian contact/consent data and one block per child.
- Registration notification links to the exact pending review; stale/decided coordinate → "unavailable", never blank or the whole queue.
- Pending/Rejected absent from user administration (Active/Suspended) and operational pickers (Active only).
- Staff applicant: one willing branch may be preselected; multiple/all need an explicit scope decision.

### Approval

- Admin approves or rejects with a reason.
- Beneficiary approval atomically creates placement, durable beneficiary fact and one Student role at that branch; ambiguous branch → refused.
- Children-only guardian gets no beneficiary fact, Student role or Enrollment.
- Each child application creates account, consent history, family link, placement, Student role in its own decision from its own Category/Branch.
- Rejection terminal (re-registration needs staff); refresh sessions revoked in the same transaction as state change and audit rows; recovery needs fresh authentication.
- Placement approval names the academic period covering today; none open → refused.

> SRS §4.1, §4.1b, R122 · TD-4.1, TD-4.2 · [Identity and access](../architecture/identity-and-access.md)

### Platform Owner continuity

- Initial Owner pre-provisioned, binds real Google subject on first login; no placeholder; ownership then independent of seed.
- Transfer: Owner picks another active Global Super Admin and confirms; former Owner stays Global Super Admin; until then suspend/delete/de-identify/demote of the Owner is refused. Atomic handoff, not a rename.
- Only the live global Super Admin assignment is protected; Owner may hold other roles normally.
- User form Save includes the configured role; «إضافة دور» starts another row without committing the first.

### Actionable changes reach the existing in-app inbox

- Registration submission/decision, family-link lifecycle, role/scope changes, ownership receipt, placement changes, explicit Session/Event restaffing, physical Exam lifecycle → inbox facts committed with the change.
- Optional Session/Event audience prompt only after save, declinable.
- Recipients from domain rows, never the browser; actor excluded; dual-role Exam participant gets separate assignment and attendance notices.
- Retries/unchanged saves never duplicate; a later transition withdraws the stale opposite fact and marks the current row unread.
- Hidden items: only the responsible Session teacher, Event staff or Exam supervisor keeps a target-bearing notice; hiding withdraws coordinates from students/assistants.
- Upload completion is silent.

> SRS §4.8, R116 · [API notifications](../reference/api-endpoints.md#notifications)

## 2. Consent

Versioned record, never a checkbox ([`BR-1`](../reference/business-rules.md#br-1); AI guardrail 2).

- Every registration: general data-processing consent; teens/children add a separate parental media release ("I consent to my child's voice/recordings being published on public class content").
- Stored: who, when, method (online form / staff in person), exact consent-text version.
- Revocation is a new state change with actor and timestamp; history never overwritten.
- No record = no consent; never assumed, inferred or defaulted true.

### The Session consent gate

- Since R170 §3 a warning, not a lock: one beneficiary in a Session's resolved audience without effective media consent → every linked recording warned; shared recordings use the union of linked audiences; staff switch to private themselves ([`BR-2`](../reference/business-rules.md#br-2)).
- Not an upload-time check; re-evaluated on (1) enrollment/Teaching Group membership, Session-content link or R92 occurrence-audience branch change, (2) consent grant/revoke for an enrolled student, (3) recording upload/import/replace.
- Retained live Sessions stay in the trigger graph after schedule soft-delete; startup walks live recording-linked Sessions in bounded batches with the same idempotent obligations.
- Shown on «مكتبة المحتوى» (visibility control, tier badge) and on the occurrence dialog before recording; teachers, Admins, Super Admins only.
- A later grant or roster change removing the last non-consenting beneficiary clears it.
- Until R170 the job forced private (bytes to private bucket), release only by Admin with written justification; BR-3 withdrawn.
- Empty resolved audience → no warning until a non-consenting beneficiary is added.

> SRS §4.1a, §4.9 · [Storage](../architecture/storage.md#consent-gating) · [Background jobs](../architecture/background-jobs.md)

## 3. Scheduling

Organisation and delivery are separate (R43).

| Entity | Carries | Rule |
|---|---|---|
| Administrative Group | level, branch, name only | Roster for organisation, reporting, communication, default timetable, attendance; exactly one per Level a student is in; answers "which branch" (registration branch is a request) |
| Teaching Group | Subject + Level, created in a Branch (R172 §15; authority the Level's, R43.3) | Only when a subject splits differently from the roster; splits independent between subjects |
| Recurring Course Schedule | subject, teaching mode, branch, room, teacher, assistants, times, recurrence | Teaching mode (level / administrative group / teaching group) lives here only |
| Session | own date, time, room, teacher, defaulted from schedule | Materialized ahead by a job; cancellation, room change, makeup = session edit; notes, recordings, content, attendance hang here |
| Event | holidays, ceremonies, exams, one-offs; branch/category/level/group links written at creation | Never generates sessions; a class is never an event |

- One recurrence vocabulary for both: none, daily, weekly, multiple weekdays, biweekly-alternating, monthly, yearly.
- Eager materialization so overlap (weekly vs biweekly) is checked on real rows.
- Times are wall-clock, never UTC (Morocco suspends DST in Ramadan).
- Room capacity informs, never refuses; administrative groups have none.
- Branch operational start date greys out earlier grid dates; on activation an Admin backfills global/recurring events manually or knowingly skips.

> [`BR-17`](../reference/business-rules.md#br-17) · [`BR-21`](../reference/business-rules.md#br-21) · [`BR-22`](../reference/business-rules.md#br-22) · [`BR-23`](../reference/business-rules.md#br-23) · SRS §4.4, §4.4c, TD-11 · [Calendar and Hijri](../architecture/calendar-and-hijri.md)

### Attendance replaces the paper sheet, and changes nothing else

- Register (class, exam) opens with enrolled names; blank list (lecture, activity) fills on arrival; عطلة and حفل get neither (server refuses).
- Non-enrolled may be marked; nobody is recorded absent (no row); attendance decides no grade, certificate or completion.
- المرأة: optional self check-in, own presence only; اليافعات and الطفل: مؤطِّرة records, self check-in always refused.

> SRS §4.7 (R123) · [Identity and access](../architecture/identity-and-access.md)

## 4. The Hijri calendar

- Morocco fixes months by moon sighting, announced by the Ministry of Habous and Islamic Affairs on the 29th; differs from Umm al-Qura and algorithms.
- Platform computes nothing; a Super Admin records the announcements; ±2-day global offset removed (R31).
- Unrecorded/unpublished month → no Hijri label.
- About one recording per month plus corrections.
- Vocabulary: *record official month start*, *publish official month*, *official Ministry announcement*; *choose/define/set* prohibited.
- No importer: Ministry publishes prose only, months unknowable in advance; a "not configured" endpoint rejected; write path + provenance column allow one later.

> SRS §4.4, §5.7 · R31, R32 · [Calendar and Hijri](../architecture/calendar-and-hijri.md#the-hijri-overlay)

## 5. Quran memorization tracking

- القرآن الكريم is the curriculum domain, not a Subject (R107–R108); atomic Subjects أحكام القرآن, حفظ القرآن, ترتيل وتجويد القرآن, تفسير القرآن; extensible.
- Only حفظ القرآن carries `tracks_quran_progress`; staffing it authorises recording memorisation for the schedule's current audience; others grant none.
- `LevelSurah` = حفظ القرآن syllabus and BR-11 completion set; تفسير follows the same Surahs; no Subject FK (student + Surah fact); Tafsir grants no authority; أحكام and ترتيل use `LevelSubject`.
- Logs: ayah ranges tagged new or revision.
- Coverage = union per Surah ([10–20]+[10–30]+[30–123] → [10–123] = 114/total_ayahs); duplicates never inflate ([`BR-13`](../reference/business-rules.md#br-13)).
- Create/edit/delete recomputes synchronously in the request (drives completion, [`BR-11`](../reference/business-rules.md#br-11)); never a job.
- Read cache self-healing, never authoritative: consumers compare with the latest log and repair.

> SRS §4.5 · [Backend](../architecture/backend.md)

## 6. Exams and grading

- Independent of calendar bounds: date, level, optional subject/Surah; Rounds are optional labels.
- MCQ auto-graded, free-text teacher-marked; immutable question UUIDs referenced by submissions.
- Integer basis points of exam total (0–10,000) everywhere; no floats; round half-up once at final persistence; /20 is display-only.
- Draft until explicit publish ([`BR-8`](../reference/business-rules.md#br-8)).
- Absent = zero flagged absent ([`BR-7`](../reference/business-rules.md#br-7)), rows created at first draft save, replaceable later.
- Pass/fail override with actor and reason always wins over recalculation ([`BR-12`](../reference/business-rules.md#br-12)).
- Postponed: weighted grading-template engine; MVP grades per-exam, informational, default 0 bp, no averages; do not hardcode an interim formula.

> SRS §4.6 · [`BR-6`](../reference/business-rules.md#br-6)…[`BR-12`](../reference/business-rules.md#br-12)

### Online assessments are built question by question, and marked by hand

- Types: short/long answer, single/multiple choice, optional or required reason.
- Audience: Level, Administrative Group, occurrence, subject circle or one beneficiary.
- Answers saved and resumable; sending is a confirmed act, then immutable; once anyone has sent, the paper is fixed.
- Marked by hand out of 20 on the common sheet; mark invisible until published; paper and mark publish separately.

> SRS §4.6 (R124) · [API endpoints](../reference/api-endpoints.md)

## 7. Educational content

Files (PDF, image, slides, audio) attach to a level, optionally an event.

| Tier | Sees it | Lives |
|---|---|---|
| Public | Everyone incl. anonymous | Public bucket, stable URL |
| Private | Logged-in students/parents of target level/group | Private bucket, signed URL after permission check |
| Hidden | Staff only | Private bucket |

- Enum, never boolean; tier change moves the object between buckets; stale public links get a friendly page.
- Global (no-branch) content needs Admin/Super Admin; teachers locked to their branches ([`BR-20`](../reference/business-rules.md#br-20)).
- Phone recorder + upload; in-app recorder postponed.

> SRS §4.9 · [Storage](../architecture/storage.md)

## 8. Accountability

| | Audit log | Trash |
|---|---|---|
| For | Who, what, when, why | Restoration |
| Content | Actor, timestamp, action, target, detail | Full JSON snapshot |
| Deletable? | One sanctioned job, enumerated allowlist | Purged after 90 days |

- Nothing destroyed silently ([`BR-15`](../reference/business-rules.md#br-15)): soft, snapshotted, attributable; hard delete only via 90-day purge.
- Audit grid is a minimum (add yes, remove no); viewing a child's case file is audited.
- MVP restore = locked CLI script, one transaction (snapshot, cascaded links, audit row); raw SQL rejected.

> SRS §4.10, TD-8 · [Runbooks](../operations/runbooks.md)

**Next:** [User journeys](user-journeys.md) · **Related:** [Business rules](../reference/business-rules.md), [Architecture](../architecture/README.md)
