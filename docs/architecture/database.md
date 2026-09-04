[Documentation](../README.md) › [Architecture](README.md) › **Database**

# Database

PostgreSQL 18.4, accessed through Prisma 7.9. The database is not a passive store here — it
carries a meaningful share of the system's invariants, and several of them **cannot be
expressed in Prisma's schema language at all**.

## The entity model

```mermaid
erDiagram
    User ||--o{ UserIdentity : "binds"
    User ||--o{ UserBranchRole : "holds"
    User ||--o| PlatformOwner : "owns platform"
    User ||--o| FramingPreference : "states willingness"
    User ||--o{ TeacherAvailability : "states windows"
    FramingPreference ||--o{ FramingPreferenceBranch : "physical branches"
    Branch ||--o{ FramingPreferenceBranch : "willingness"
    User ||--o{ FamilyLink : "parent of"
    User ||--o{ RefreshSession : "sessions"
    RefreshSession ||--o{ RefreshToken : "generations"
    User ||--o{ ConsentRecord : "subject of"
    Role ||--o{ UserBranchRole : ""
    Branch ||--o{ UserBranchRole : "scopes"
    Branch ||--o{ Room : ""
    Branch ||--o{ AdministrativeGroup : ""
    Branch ||--o{ RecurringCourseSchedule : ""
    Category ||--o{ Level : ""
    Level ||--o{ AdministrativeGroup : ""
    Level ||--o{ TeachingGroup : ""
    Level ||--o{ LevelSubject : ""
    Level ||--o{ LevelSurah : ""
    Subject ||--o{ LevelSubject : ""
    Subject ||--o{ TeachingGroup : ""
    Subject ||--o{ RecurringCourseSchedule : ""
    QuranSurah ||--o{ LevelSurah : ""
    QuranSurah ||--o{ QuranProgressLog : ""
    Room ||--o{ RecurringCourseSchedule : ""
    AdministrativeGroup ||--o{ Enrollment : "roster"
    TeachingGroup ||--o{ StudentTeachingGroup : "subject split"
    RecurringCourseSchedule ||--o{ CourseScheduleStaff : "teacher + assistants"
    RecurringCourseSchedule ||--o{ Session : "materialized"
    Session ||--o{ SessionContent : "references"
    EducationalContent ||--o{ SessionContent : ""
    Event ||--o{ EventBranch : ""
    Event ||--o{ EventCategory : ""
    Event ||--o{ EventLevel : ""
    Event ||--o{ EventAdministrativeGroup : ""
    Exam ||--o{ StudentExamSubmission : ""
    Exam ||--o{ Grade : ""
    User ||--o{ QuranProgressLog : "student"
    User ||--o| StudentSurahProgress : "coverage cache"
```

Plus the platform-level tables: `PlatformOwner`, `AuditLog`, `Trash`, `SystemSetting`, `AcademicYear`,
`AcademicPeriod`, `Attendance`, `ExamQuestion`, `ExamQuestionOption`,
`StudentExamAnswer`, `StudentExamAnswerOption`,
`EducationalContent`, `ConsumedToken`, `RateLimitCounter`, and `HijriMonthStart`.

> The authoritative field-by-field definition is SRS §7. This page explains the parts that
> are non-obvious.

## Entities that carry a design decision

### `User` — one table, several kinds of person

Staff, parents, adult students, and minors are all `User` rows. What differs is what hangs
off them.

| Column | Why it exists |
|---|---|
| `account_status` | The lifecycle: pending → active → suspended, with rejected terminal. Separate from a per-branch `user_status` |
| `sex` | The **person-side half** of the level's `gender_restriction`. Without it the restriction is unenforceable — nothing could compare a person against a girls-only level. Captured **at registration**, in the same transaction that creates the person, because the registration exists before the `User` does |
| `pre_provisioned_email` | The address authorized to claim this account **before any external identity exists**. Unique among non-null values. **Retained after binding**, never cleared, so provenance survives and the address cannot be claimed twice |
| `public_display_name` | An optional name the person chooses to publish. Distinct from `nickname`, which is an internal search convenience — this is a publication choice |
| `version` | Optimistic locking on staff edits |

### `UserIdentity` — completed bindings only

Keyed by `(provider, provider_subject_id)`, unique. MVP has one provider: Google.

**Placeholder rows are prohibited.** A row with a null, empty, or synthetic subject id
standing in for an unbound account would make *"has an identity"* stop meaning *"has
authenticated"* — and that predicate is what the entire login routing rests on. An account
awaiting its first binding is represented by `pre_provisioned_email` and nothing else.

### `NormalizedEmailLock` — synchronization, not ownership

`User.pre_provisioned_email` and active `UserIdentity.email` are separate representations of
one normalized-address claim. Their indexes cannot constrain one another and cannot lock an
address absent from both tables. `NormalizedEmailLock(email, created_at)` supplies one stable
row per address for the production ownership writers to lock before deciding.

It deliberately has no User foreign key. Adding one would make it a third ownership record
that could disagree with the two SRS fields; deleting it on account lifecycle changes would
also reopen the race. Rows may therefore outlive an active claim and remain harmless lock
targets. The availability decision always comes from an under-lock re-read of the actual
ownership channels.

### `UserBranchRole` — the whole authorization model

Unique on `(user_id, role_id, branch_id)`, so one person may hold the same role once per
branch. **`branch_id IS NULL` means all branches for that assignment** — not "Super Admin".
Super Admin's bypass follows from its role.

### `PlatformOwner` — singleton lifecycle, not RBAC

The one row has fixed key `platform` and a unique restricted FK to its owner User. PostgreSQL
triggers require that User to remain active, undeleted and assigned a live global Super Admin
role; deleting the singleton is refused. Transfer locks the singleton first, then the current
and target Users in id order, so two concurrent attempts cannot create two successors or a
zero-owner interval. The relationship is what the Users screen labels; it is not represented
by another Role row.

### Framing preference and availability mode — planning only

`FramingPreference` records `in_person | online | both`. Physical modes require either
explicit `FramingPreferenceBranch` rows or future-inclusive `all_branches = true`; online
requires neither. Deferred constraint triggers validate the final transaction state so nested
creation is legal while incomplete committed preferences are not.

`TeacherAvailability.mode` reuses the vocabulary per weekly interval and is nullable. Null is
legacy/not stated; no migration guesses a value. These records affect advisory scheduling
warnings only. Authority still comes from `CourseScheduleStaff` / `SessionStaff`.

### `RefreshSession` and `RefreshToken` — one stable chain, rotating generations

Rotation, revocation, the grace window, and revoke-on-suspension all need per-token server
state that no other entity holds.

`RefreshSession` is deliberately only `(id, user_id, created_at)`: it is the stable row locked
by refresh, logout, revoke-all and `token.purge`, not another credential or revocation source.
Token generations cannot fill that role at `READ COMMITTED`: rotation may insert a successor
outside a lock statement's snapshot and purge may delete the predecessor on which a waiter was
queued. The anchor is removed only when purge, while holding it, finds no token generation left.
PostgreSQL advisory locks were rejected because §16.2 permits repository raw SQL for row locks,
and a UUID cannot be represented by PostgreSQL's 64-bit advisory key without collision.

The anchor is intentionally session-scoped, not user-scoped. The already-stable `User` row is
the higher-level lock for the two operations that must govern anchors which do not exist yet:
identity binding, new login/session creation, current-role credential decisions and user-wide
revocation, including Pending → Rejected. Their order is User first, then existing
`RefreshSession` ids in UUID order. The
explicit User mode is `FOR NO KEY UPDATE`: `User.id` is immutable, while all protected status,
deletion and role decisions still conflict with this lock. A successful login re-reads status
and assignments while holding it; rejection and suspension hold it while changing status and
enumerating/revoking all anchors. The shared session issuer independently re-checks that the
account is Active or Pending under this lock, so a helper call cannot bypass that boundary.

Refresh, logout and purge never request that **explicit** User lock. Refresh-token and audit
inserts can nevertheless acquire an **implicit `KEY SHARE`** on the referenced User during FK
validation. That real database edge is why `FOR NO KEY UPDATE` matters: it is compatible with
`KEY SHARE`, whereas `FOR UPDATE` allowed a refresh/logout holding a session anchor to wait on
User while suspension holding User waited on that same anchor. Session-first operations now
finish their FK write and release the anchor without weakening User-wide serialization.

| Field | Consumer |
|---|---|
| `token_hash` | **Hashed, never raw** — a stolen database dump must not yield usable 30-day credentials. Unique |
| `session_id` | The stable id of one rotation chain. Makes "revoke this session" a single indexed `UPDATE` instead of a recursive walk of predecessors |
| `rotated_from_id` | The immediate predecessor. **This one field decides all three refresh outcomes**: current → rotate, immediate predecessor within grace → accept, anything older → reuse detected |
| `revoked_at` / `revoked_reason` | The revocation check is `revoked_at IS NULL`. The reason separates a normal logout, detected replay, suspension, R102 rejection, deletion, and R101's one-time cookie-Path rollout; NULL remains reserved for ordinary rotation |

The fields **deliberately excluded** are documented in the specification with their reasons,
so a later implementer does not re-add them by reflex: `created_at` (identical to
`issued_at`), `revoked_by` (duplicates the audit actor, and two actor records will
eventually disagree), `created_by_ip` and `user_agent_hash` (personal data on a population
including minors, with no consumer and no retention rule), `last_used_at` (under mandatory
rotation a token is used exactly once).

### `HijriMonthStart` — the calendar's sole source

One row per Hijri month: year, month, the Gregorian date it officially began, and a status
of `draft | published`. **Only published months render anywhere**, so a year can be entered
progressively and reviewed first.

`source` records provenance on the row — `manual` today, an importer's identifier if one is
ever added — so the two are distinguishable without a schema change. Every write goes
through one service method, which is what makes a future importer inherit its ordering rule,
locking, draft state, and audit trail rather than reimplementing them.

> [Calendar and Hijri](calendar-and-hijri.md)

### `StudentSurahProgress` — a cache that cannot go stale

Coverage percentage plus the merged interval set, keyed by `(student_id, surah_id)`,
carrying `last_log_id` / `last_log_at` stamps of the newest governing log.

**It is never the source of truth — the logs are.** Every consumer compares the stamp
against the student+surah's latest log (a cheap indexed max) and, on mismatch, recomputes
from the logs and repairs the row in place *before* using the value. That makes a stale read
structurally impossible, including after a crash between the log commit and the cache
upsert.

**List pages run the guard as one joined query** — cache rows left-joined against each
pair's latest log id — never as per-row cache reads plus per-row max lookups, which would be
an N+1 wearing a cache costume.

### `Subject.tracks_quran_progress` — authorization, not curriculum type

SRS R107–R108 keeps the existing boolean and partial unique index, and narrows their meaning.
The broad Quran domain القرآن الكريم has no Subject row; its atomic Subjects are scheduled
normally. Only حفظ القرآن may carry the marker, and a current staffing assignment for that
Subject authorises memorisation entry for its resolved audience.

The database enforces **at most one live marker**. It deliberately cannot enforce “exactly
one”: an empty database must exist before bootstrap, and absence is a valid fail-closed
configuration. The Production seed establishes and asserts exactly one for launch. It
refuses a different marked Subject or duplicate live حفظ القرآن rows rather than guessing
or rewriting Owner-managed reference data.

`LevelSurah` records the Level's حفظ القرآن Surah syllabus, which تفسير القرآن follows
pedagogically. `QuranProgressLog` remains keyed by student and Surah with no Subject foreign
key, because the marker answers *who may write* while the log answers *what was memorised*.
Tafsir remains unmarked and does not participate in the coverage engine; أحكام القرآن,
ترتيل وتجويد القرآن and any later unmarked Quran-domain Subject use ordinary
`LevelSubject` curriculum. The eight-row Production seed is an additive baseline and does
not constrain or rewrite later Super-Admin additions.

### `SessionRecording` → `EducationalContent` — a nullable UNIQUE that is the whole idempotency design (R99)

One column, `session_recording.educational_content_id`: **nullable, unique, FK `RESTRICT`** —
an optional 1:1. Each half is load-bearing.

**Nullable**, because most of a recording's life is spent before there is anything to point at:
it is `NULL` while capturing, while the provider finalises, and while the import job runs.

**Unique**, because a provider may deliver the same completion twice, a pg-boss job may be
retried, and a worker may be killed between the server-side copy and the row write. All three
must converge on **one** `EducationalContent`. The ingestion job reads this column first and
returns the existing result when it is set — and the unique index is what makes that check hold
under concurrency rather than merely usually.

**`RESTRICT`**, because deleting the library item must not silently erase the record that a
class was recorded. The link is severed deliberately or not at all.

**And it is why there is no `available` status value.** *«متاح»* is exactly
`educational_content_id IS NOT NULL`. A status enum carrying `available` would be a second fact
about the same thing, and the two can disagree — the disagreement looking like a working library
item whose object is absent, which R99.14 calls worse than an honest failure. **Derive the
state from the row that proves it.**

`ingestion_failure_reason` sits beside it and is deliberately **not** the same column as
`failure_reason`: the provider failing to record and the platform failing to accept what it
recorded are different events with different remedies, and only the second is fixed by retrying.

### No generic free-text collection

**A personal-data field must have a specific, documented purpose** (Owner
decision, 2026-09-02; SRS R121).

`User.notes` was 2 000 characters of unbounded free text on the **public
registration form**, so an applicant could volunteer a health condition, a
custody arrangement or a judicial matter into a platform that collects none of
them — and no requirement stated what it was for or who had to read it. R62.1
had already excluded it from the child shape for exactly that reason; R121
extends the rule to every person. Migration
`20260902220000_drop_user_notes` drops the column behind a guard that refuses a
non-blank value.

The bounded free-text fields that **do** have a stated purpose are untouched:
`ChildApplication.internal_note` (R62.8), `FamilyLink.decision_reason`,
`Session.cancellation_reason`. The `notes` key on the §5.2 Session page
projection is a different field on a different entity and is unrelated.

### No health, medical or social-case-file data

**The platform collects none of it** (Owner decision, 2026-09-02; SRS R120).

A `StudentSocialProfile` entity used to hold a child's health condition, family
situation, home address, siblings count and both parents' names and professions,
behind the strictest authorization in the system. **No product surface ever
collected any of it** — not registration, not «تسجيل طفل», not the beneficiary
profile, and no parent, مؤطِّرة or administrative screen; the frontend contained
no reference to it at all.

The Owner withdrew the capability rather than leave it unused, because **an
unused capability is still a capability**: an endpoint nobody calls is a live
ability to collect health data about a minor, and an empty column is a declared
purpose. Migration `20260902200000_drop_student_social_profile` drops the table
behind a guard that **refuses a non-empty one** and reports the row count, since
the drop is irreversible and the table was the only place that data ever lived.
Localhost and Staging both held **0 rows** when it was written; Production is
not deployed.

> **Data-minimisation policy:** the platform does not collect categories of
> personal data that are not necessary for the association's current operational
> purposes.

This states a technical fact about what the software does. It is **not** a legal
conclusion about which CNDP regime applies — that assessment is the Owner's and
their counsel's, and nothing here should be read as making it.

### `ConsentRecord` and `AuditLog` — append-only by design

Consent is a **state-change history**, never overwritten. Effective status is always
derived from the most recent record, and absence means no consent.

**`LegalConsentText` is the wording each record was given against** (R119). It
carries the exact Arabic text, a unique human-readable `version_label`, a
SHA-256 digest, `draft | active | superseded`, and creation and activation
provenance. Three properties are load-bearing:

* **Immutable once in force.** A version that has ever been activated cannot be
  edited; new wording is a new version. Enforced in the service, because *has
  this been used* is a question about other tables that a CHECK cannot ask.
* **Exactly one active version, enforced by the DATABASE** —
  `legal_consent_text_one_active`, a partial unique index over
  `status = 'active'`. A service-level check alone is a race, and this is the
  invariant whose violation means somebody could be recorded as agreeing to
  wording nobody put in force.
* **Never deleted.** There is no delete verb, and both `consent_record` and
  `child_application` reference it `ON DELETE RESTRICT`, so consent evidence
  cannot lose the words it was given against.

`consent_record.consent_text_id` is **nullable only for legacy**: rows written
before R119 name a version whose wording was never stored, none was
manufactured for them, and NULL states honestly that the wording is not
resolvable. `consent_text_version` is retained beside the reference because it
is what an export, an audit row and a compliance reader act on.

`AuditLog.actor_user_id` is **nullable**, and a null means *system-initiated*, not
*attribution lost*. Two mandated actions genuinely have no human actor: replay-detected
session revocation (triggered by an unauthenticated request presenting a stolen secret) and
the consent job's forced visibility changes.

## Constraints the application layer cannot be trusted with

### Uniqueness

| Constraint | Guards |
|---|---|
| `UserIdentity (provider, provider_subject_id)` | One external identity, one account |
| `UserIdentity (provider, email)` among active | Case variants cannot become distinct identities |
| `ConsumedToken (jti)` | **The onboarding-token replay guard.** A replay hits this violation, the transaction aborts, and the request fails — enforcement is mechanical, not aspirational |
| `FamilyLink (student_id, parent_id)` **where not deleted** | A revoked link can be requested again later |
| `AcademicYear` exactly one `is_current` | Partial unique index |
| `ExamQuestion (exam_id, display_order)` **where not deleted** | **Two questions cannot claim one place** (R124). Partial, so a removed question frees its position rather than blocking the one that takes it — and the reorder writes through a negative range first, because writing `1,2,3` over `3,1,2` collides halfway otherwise |
| `ExamQuestionOption (question_id, display_order)` **where not deleted** | The same, for a question's own choices: their order is part of what the student saw |
| `StudentExamAnswer (submission_id, question_id)` | **One answer per question.** The `answers` jsonb column it replaces asked for *"keyed by question UUID, never by array position"* — the right instinct, expressed where nothing could enforce it. This is that key, as a foreign key |
| `Attendance (session_id, event_id, exam_id, occurrence_date, student_id)` **where not deleted**, `NULLS NOT DISTINCT` | **One presence per person per occurrence** (R123). `NULLS NOT DISTINCT` is what makes it work with two of the three occurrence columns null — without it PostgreSQL treats every NULL as unique and the index would permit unlimited duplicates, which is exactly the double-tap on «تسجيل حضوري» the rule exists for |
| `AcademicPeriod (academic_year_id, sequence)` | One الفصل 1، one الفصل 2 per year — a second row for the same semester would make *which period is this enrolment in* ambiguous |
| `RateLimitCounter (user_id, bucket, window_start)` | What makes the increment safe under concurrency |
| `User.pre_provisioned_email` among non-null | Two accounts must never claim one address, or a first login is ambiguous about which it binds |
| `NormalizedEmailLock.email` | One collision-free transaction boundary across pre-provisioned and completed identity ownership, including absent-row creation |
| `RefreshToken.token_hash` | Makes "presented token → exactly one row" a lookup, not a scan |
| `RefreshToken.session_id → RefreshSession.id` | Every generation has one stable, database-enforced serialization target |
| `Enrollment (student_id, level_id, academic_period_id)` **where not deleted** | **Exactly one live enrolment per Level per academic period** (BR-21, narrowed by R122). Only expressible because `level_id` sits on the enrolment row — see below. **The period is part of the key on purpose:** the same student enrols in the same Level again next semester, and the previous row is history that must survive |
| `AdministrativeGroup (id, level_id)` | Redundant against the primary key **on purpose**: PostgreSQL requires a unique constraint on the referenced pair before `Enrollment` can declare its composite foreign key |
| `StudentTeachingGroup` — at most one per `(student, subject, level)` **where not deleted** | At most one split-group per subject (BR-22). `subject` and `level` come from the teaching group, so this is a **functional** index over the join, hand-written |
| `Session (schedule_id, date)` | What makes `session.materialize` idempotent — a second run creates no duplicate occurrence |

#### The composite foreign key on `Enrollment`

`Enrollment` carries `level_id` **as well as** `administrative_group_id`, which looks like
duplication and is not. A composite foreign key
`(administrative_group_id, level_id) → AdministrativeGroup(id, level_id)` makes the database
**refuse** a row whose level disagrees with its group's.

That is the whole point. The invariant "exactly one group per enrolled level" spans two
hops, and a plain unique index cannot express it. The alternatives were a trigger or a
service-layer check — both of which can be bypassed and neither of which the database
enforces. With the composite FK the redundant column is a *constraint*, not a copy, so
there is no second source of truth to drift.

**Never drop this FK to "simplify" the schema.** Removing it turns `Enrollment.level_id`
into exactly the kind of copy that the platform has been burned by before.

### Checks

- `QuranProgressLog`: `start_ayah >= 1 AND start_ayah <= end_ayah`. The upper bound against
  the Surah's total crosses tables, so it is a **trigger** plus a service check.
- All stored scores: `>= 0 AND <= 10000`. **No float score column exists anywhere.**
- `display_order >= 0`; `RecurringCourseSchedule.start_time < end_time`;
  `Session.start_time < end_time`; `Room.capacity > 0` **when present — a shape check only,
  because nothing compares a roster against it** (BR-23).
- `RecurringCourseSchedule`: **exactly one target FK is non-null and it matches
  `teaching_mode`.** A mode without its target, or a target without its mode, is a schedule
  nothing can resolve a roster for. Also `recurrence <> 'none'` — a non-recurring occurrence
  is an Event, not a schedule.
- `AcademicYear.label` matches `^\d{4}-\d{4}$`.
- `Exam`: **exactly one target, and it matches the declared arm**
  (`exam_target_check`, R124). R58 stored the narrower sitting as a non-null
  `administrative_group_id` and read NULL as *the whole Level*; with a Session, a
  Teaching Group and a single beneficiary added, that inference stops being
  decidable, so the arm is stored. Same idiom as
  `course_schedule_mode_target_check`.
- `ExamQuestion`: `justification = 'none'` unless the kind is a choice
  (`exam_question_justification_check`) — **a text answer IS its own
  justification**, so asking for a second one would ask the same question twice.
  Prompts and option labels are refused blank.
- `Attendance`: **exactly one** of `session_id`, `event_id`, `exam_id` is
  non-null (`attendance_one_occurrence_check`) — the same idiom `Notification`
  uses for its four targets. A row naming none would be presence at nothing; one
  naming two would be presence in two places at once.
- `AcademicPeriod`: `sequence >= 1` and `end_date >= start_date`. **Overlap between two
  periods of one year is refused in the service, not by the database** — an exclusion
  constraint over a date range needs the `btree_gist` extension, and the platform's
  deployment contract does not install extensions. The service check is the enforcement, and
  this line records that it is the *only* one.
- `HijriMonthStart`: month 1–12; year 1300–1600 (brackets any date this platform will render
  while rejecting a mistyped Gregorian year); **two months of one year may not share a start
  date, and month *n+1* must start after month *n*** — an out-of-order pair would make date
  resolution ambiguous.
- `CHECK (email = lower(email))` on both email columns. The application lowercases on every
  write; **this is the backstop**, so a single unlowered code path — a form, an import — can
  never create a case variant that slips past the unique index.

## Arabic collation

The single `name` column on Branch, Category, Level, and Subject, plus sortable person-name
columns, are **natively collated `ar-x-icu` at the column level**.

This matters more than it sounds. Default `C`/`en_US` collation sorts Arabic by codepoint
and produces orderings that look wrong to every user. Collating the column means sorting is
correct **by default, in every query**, with no per-query `COLLATE` clause anywhere.

> **Never add a per-query `COLLATE` workaround. Fix the column.**
> [`BR-19`](../reference/business-rules.md#br-19) · [Internationalization](internationalization.md)

## Search

Substring matching, not prefix-only and not whole-word — `سعاد` matches `أم سعاد`. Minimum
query length 2, case-insensitive.

**Normalization is applied identically to the query and the stored value:** strip tashkeel
and tatweel, fold أإآ→ا, ة→ه, ى→ي; lowercase and fold Latin accents for French names; strip
spaces and `+` from phone numbers.

The implementation matters: each searchable column is paired with a **generated normalized
shadow column**, indexed, and queried with `ILIKE '%…%'` against the shadow. Normalization
is **never** applied per row at query time — that would defeat every index.

**No fuzzy matching in the MVP.** No trigram similarity, no Levenshtein, no search engine.
Paper-roster spelling variance is absorbed by the normalization rules, which collapse the
dominant variant classes; genuine misspellings are a data-entry problem, not a
search-engine problem. Revisiting this is an explicit decision, not an implementer's
initiative.

## A model with no `@@map` silently targets a different table

Every table on this project is `snake_case` and every Prisma model is
`PascalCase`, so **the mapping is what connects them**. Drop `@@map("exam")`
while editing a model and Prisma does not complain: it generates a client that
queries `"Exam"`, a table that does not exist, and the schema still *validates*
because a mapping is optional.

The failure surfaces far from the cause — `The table public.Exam does not exist`
from whatever runs first, which reads as an unapplied migration. It cost a slice
here: R58's model block was rewritten by hand after `prisma format` mangled it,
and the rewrite lost the `@@map` **and** the `@@index`. The migration was correct
and applied; the endpoints were unreachable anyway.

Two habits, both cheap:

* **Rewriting a model block means re-checking its trailing `@@` lines** — they
  sit at the bottom, which is exactly where a hand-written replacement stops.
* **Run something that touches the table before believing the model.** A
  typecheck cannot see this; one integration test can. It is the general rule of
  [measure, don't infer](../development/engineering-efficiency.md) in its
  cheapest form.

## Migrations

### Hand-written SQL

Prisma **cannot declare** custom collations, CHECK constraints, partial or functional unique
indexes, or triggers. An agent that writes them into `schema.prisma` will fail to compile
or — worse — silently drop the validation.

The mandatory workflow:

1. Model tables, columns, enums, FKs, and plain unique indexes in `schema.prisma` normally.
2. For every PostgreSQL-specific element, run **`prisma migrate dev --create-only`** and
   **hand-write the SQL** into the generated file before applying.
3. The very first hand-written migration **registers the collation explicitly**:
   ```sql
   CREATE COLLATION IF NOT EXISTS "ar-x-icu" (provider = icu, locale = 'ar', deterministic = true);
   ```
   Not relying on it being predefined is what makes the migration history self-contained and
   portable.
4. **`prisma db push` is prohibited in every environment** — it bypasses the history and
   silently drops the hand-written SQL. CI enforces this.

### The R124 legacy mapping

`20260904090000_r124_assessment_builder` is the migration most worth reading
before trusting, because it does two things this policy normally forbids in one
file: it **drops two `jsonb` columns** and it **writes a value no old column
proves**. Both were audited on 2026-09-04 and the reasoning is recorded here so
the next person does not have to re-derive it. The operational half — three
counts that must be run against production first — is in
[Deployment](../operations/deployment.md#the-r124-migration-has-a-mandatory-preflight-and-it-is-three-counts).

**`target_kind` is derived from a real fact.** R58 stored the narrower sitting as
a non-null `administrative_group_id` and read `NULL` as *the whole Level* — its
own schema comment says so: *«`null` is **the whole Level**, never "no target"»*.
The migration re-encodes that inference exactly: `NULL → level`,
`NOT NULL → administrative_group`. **Nothing is fabricated**, and the inference
had to be made explicit because with a Session, a Teaching Group and a single
beneficiary added, *which target is this* stopped being decidable from which
columns happen to be null.

**`status = 'published'` is a CHOICE, and it is inert.** `is_published` existed
since the schema's first migration and **no application code ever wrote or read
it** — established by search, not assumed — so there was no better fact to
consult. What makes the choice safe rather than merely convenient is that
**every reader of `exam.status` is scoped `mode = 'online'`**: they are all in
`assessment.service.ts`, and a physical sitting's `status` is consulted by
nothing. `published` is the conservative direction *if* that ever changes: a
future feature reading the column without scoping to the mode would show an
arranged sitting rather than hide one. `createPhysicalExam` writes the same
value for the same reason, so legacy and new physical rows agree.

**Neither blob is discarded.** A non-empty `exam.questions` or
`student_exam_submission.answers` is snapshotted into `Trash` before the column
goes. **That is a safety net, not a retention plan** — the snapshot carries the
ordinary 90-day `purge_after` — which is why the production preflight refuses to
migrate at all when either is non-empty, rather than relying on it. On this
installation both were empty except one development fixture, whose blob held an
auto-scoring shape (`correctIndex`, `maxPointsBp`) that v1 deliberately does not
have; migrating it would have meant inventing a marking key the builder cannot
edit.

**The `NOT NULL` window is inside one transaction.** `ADD COLUMN` → `UPDATE` →
`SET NOT NULL` would be a gap if a row could be inserted between them; Prisma
applies each migration file in a single transaction, and the application is not
running during step 5 of the deployment runbook.

### Compatibility policy

- **Forward-only in production.** Down-migrations are never written or run. Rollback means
  restoring the pre-deployment backup.
- **Migrations preserve data — always.** A migration that loses rows is a defect regardless
  of what it enables. Every deployment takes a `pg_dump` **immediately before** applying
  migrations, so the rollback point matches the pre-migration state exactly.
- **Destructive operations follow expand–migrate–contract.** Dropping a column, or
  tightening a constraint on populated data, is permitted only as the final *contract* step
  of a three-phase sequence, with the drop in a **separate, later migration** after no
  released code references the old structure. A single migration that adds and drops is
  prohibited.
- **No direct renames.** Prisma renders a naive rename as DROP + ADD, which destroys data.
  A rename is expand–migrate–contract.
- **New NOT NULL columns** on populated tables ship with a default or an in-migration
  backfill.
- **Every migration is rehearsed** against ceiling-scale fixtures. Duration matters: an
  `ALTER` rewriting a million audit rows must be known about beforehand, not discovered
  during a deploy window.

CI enforces the append-only history, the `db push` ban, the presence of the hand-written
SQL, and flags every `DROP`/`RENAME` for human review with its contract-phase justification.

### Current migration history

```
20260724194811_init_schema
20260724210945_add_rate_limit_counter
20260724222514_add_pre_provisioned_email
20260725123714_add_refresh_token
20260728132320_add_user_sex_and_generic_categories
20260728222630_r31_hijri_month_start
20260728222900_r31_hijri_month_start_checks
20260728223400_r31_remove_hijri_day_offset
20260729045246_r35_branch_public_contact_fields
20260729045400_r35_branch_public_field_checks
20260729060000_r36_1_display_name_not_blank
20260729150624_r36_1_public_display_name
20260801194116_r39_user_intended_branch
20260802131723_r40_arabic_name_parts
20260802135318_r41_french_name_parts
20260804101500_r43_educational_model_expand
20260804101600_r43_educational_model_constraints
20260804180000_r43_4_session_staff_snapshot
20260804200000_r43_contract_drop_retired_model
20260805190000_r49_requested_role
20260805200000_r49_intended_category
20260805210000_r50_effective_until
20260809120000_r57_schedule_title
20260809180000_r58_exam_mode
20260809190000_r58_exam_branch_date_index
20260811120000_r62_child_applications
20260811180000_r64_child_application_branch
20260811210000_r66_enrollment_branch
20260812090000_r68_identity_review
20260812150000_r71_event_staff
20260812170000_r73_quran_subject_marker
20260818120000_r77_session_cancellation_notification
20260818160000_r78_assignment_and_reschedule_events
20260818200000_r79_beneficiary_fact
20260818220000_r80_sex_not_null
20260819000000_r81_exam_max_grade
20260819120000_r82_notification_targets
20260819160000_r83_optional_reason
20260819200000_r88_teaching_profile
20260819230000_r91_effective_staffing
20260820010000_r92_session_audience_branch
20260820120000_r93_event_staff_assigned
20260820160000_r96_user_qr_identity
20260820180000_r97_delivery_mode
20260821090000_r99_recording
20260821140000_r99_recording_ingestion
20260821200000_r101_refresh_cookie_path_reason
20260821200100_r101_invalidate_legacy_refresh_sessions
20260823100000_r101_refresh_session_anchor
20260823190000_r102_rejection_revocation_reason
20260823210000_normalized_email_ownership_lock
20260826120000_r109_scheduling_visibility
20260826140000_r110_scheduling_type_catalogue
20260827120000_new_i_branch_phone_secondary
20260827160000_new_kl_category_level_description
20260828140000_new_n_partner
20260828170000_one_role_per_account
20260828190000_holiday_structural_kind
20260828190100_holiday_catalogue
20260828200000_partner_description
20260830100000_name_part_sort_columns
20260831100000_platform_owner_and_framing_preferences
20260901100000_r116_actionable_notifications
20260901103000_r116_exam_changed_notification
20260901110000_r117_registration_review_details
20260901220000_partner_deletion_provenance
20260902160000_scheduling_type_on_schedule_and_exam
20260902180000_versioned_legal_consent_text
20260902200000_drop_student_social_profile
20260902220000_drop_user_notes
20260903090000_r122_academic_period_enrollment
20260903180000_r123_attendance
20260904090000_r124_assessment_builder
20260904100000_drop_exam_access_policy
20260904110000_soft_delete_rejected_family_links
20260904120000_r130_birth_date
20260904130000_r132_self_managed_claim
20260904140000_self_managed_authority_index
20260904150000_r131_full_deletion_request
20260904160000_full_deletion_executed_at
20260904170000_account_return_request
20260904190000_assessment_published_notification
20260905100000_drop_account_return_request
20260905110000_drop_full_deletion_request
20260905120000_account_status_decided_at
```

Note the pattern: schema changes and their hand-written constraints are **separate
migrations**, and revision-driven changes carry the revision number in the name.

R101 deliberately uses two adjacent migrations. PostgreSQL cannot safely add an enum value
and consume it in persisted rows inside the same migration transaction. The first migration
adds `cookie_path_migration`; after Prisma commits it, the second uses one data-modifying CTE
to write system audit and revoke every still-live pre-cutover token atomically. Deployment
stops the old issuer before either migration, so no narrow-Path credential can be minted after
the sweep. `_prisma_migrations` is the one-time cutover marker: a repeated `migrate deploy`
does not execute the data migration again and therefore cannot revoke sessions issued by the
new application. Running migration SQL manually after cutover is prohibited.

The later R101 anchor migration is ordinary forward-only schema evolution: it creates one
`RefreshSession` per existing distinct `session_id`, refuses an inconsistent chain spanning
more than one user, then adds the foreign key. It does not repeat the cookie-path invalidation
and therefore cannot sign out sessions merely because `migrate deploy` is run again.

R102 is a forward-only enum extension only. It adds the durable `rejection` attribution value;
the application transaction performs each actual Pending → Rejected revocation, so rerunning
`migrate deploy` has no session side effect.

The normalized-email migration creates and backfills only lock targets; it does not choose an
owner. Before backfill it checks the union of retained pre-provisioned addresses and active
identities and aborts if one email already names more than one User. Automatically clearing a
pre-provisioned address or merging people would destroy provenance and make a person-level
decision in migration SQL. Reconcile such rows explicitly using the deployment runbook, then
rerun `migrate deploy`; a clean retry is forward-only and backfill is idempotent.

### Filename order is apply order — and it bit us

Look at the two `r36_1` entries. The **constraint** is `…060000`; the migration that **adds the
column it constrains** is `…150624`, nine hours later. Prisma applies migrations in **filename
order**, so on a clean database the CHECK ran first and failed:

```
ERROR: column "public_display_name" does not exist   (SQLSTATE 42703)
```

**Every existing database was fine**, because the two were applied in the order they were
*authored* and `_prisma_migrations` recorded both as done. The break was therefore invisible to
every developer and to CI, and would have surfaced **exactly once**: at the first production
deployment, where [§19.1 step 5](../operations/deployment.md) runs `prisma migrate deploy` against an empty
database. It was found in Revision 39 only because Prisma's shadow-database replay refused to
create the *next* migration.

**The repair was to make both migrations idempotent and order-independent — not to renumber
one.** A directory name is recorded in `_prisma_migrations`, so renaming it orphans the row on
every database that has already applied it. Instead the constraint migration now creates the
column `IF NOT EXISTS` before constraining it, and the column migration is `IF NOT EXISTS` too,
so either order produces the same schema.

Editing an applied migration changes its checksum, which Prisma refuses. Because nothing is in
production yet, the two recorded checksums were re-computed in place (`sha256` of the file, the
same value Prisma stores) rather than resetting a developer database. **A future occurrence
would not have that luxury** — which is the argument for the guard below.

**The rule:** a migration must be **runnable on an empty database, in filename order, with no
predecessor it does not name in its own filename**. When a constraint and its column are split
across two migrations, the constraint's timestamp must be the later one. `check-migrations.sh`
verifies presence; ordering is verified by the only test that actually proves it — running
`migrate deploy` against a freshly created database, which is now part of the release check.

## Soft delete and cascade

Every soft-deletable table carries `(deleted_at, deleted_by)`. Deleting writes a **Trash
snapshot** and an **audit row** in the same transaction.

Cascade rules are per entity and mostly *prohibitive*:

| Entity | Rule |
|---|---|
| Branch, Room, Category, Level, Group | **Deletion prohibited** while dependents reference them → `409` |
| User | **Soft delete only.** Anonymize sensitive fields in the live row (full snapshot in Trash), deactivate identities, **revoke every live refresh token in the same transaction**, cascade-remove family links and group assignments. Grades and progress logs are **retained** as historical record |
| Un-enrolment | Soft-deletes the enrolment row **only**. Never touches grades, submissions, or progress logs — a transferred student keeps their history |
| Content | Soft delete moves the object to a quarantine prefix pending the 90-day window. A **purge** removes the quarantined object too — a destroyed row beside surviving bytes is an orphan, not a deletion |
| Hijri month | **Only the last recorded month may be withdrawn** (R59.5). The months are a contiguous sequence §5.7's conversion walks, so a hole would reach a reader as *missing Ministry data* rather than as the deletion that caused it |
| Exam | Soft delete cascades to `ExamStaff` only, which is why it is the first cascading type that **restore** reinstates (R59.3) |

### What gets a Trash entry, and what does not (R59.2)

The rule BR-15 states is *every deletion is soft with a restorable snapshot*. What it did
not state — and what four deletions shipped without — is the **test for whether a write is
a deletion at all**:

> A deletion **a person deliberately performed** gets its own Trash entry. Rows removed
> **as a consequence** of that deletion do not; the parent's snapshot describes them.

So un-enrolling a student, removing a Teaching Group member, unassigning a Subject from a
Level and unlinking content from a Session each get an entry — every one of them a
deliberate act that was previously audited and **invisible on the one screen that answers
*what was deleted and by whom***. Whereas `SessionStaff` reconciliation during a session
edit and `UserBranchRole` revocation during a role change get none: each is one field of an
*update* wearing a tombstone, and an entry apiece would fill the screen with rows nobody
deleted.

The same rule applies to the Quran curriculum join: deliberately unassigning a Surah writes
a `LevelSurah` Trash entry. When either unique curriculum pair is assigned again, the service
revives the existing row and removes that exact stale Trash entry in the same transaction;
the unique key makes inserting a replacement row impossible.

`services/trash-coverage.integration.test.ts` enforces this by parsing each exported
delete/remove/unassign operation and checking its own body — not merely asking whether some
other function in the same file writes a snapshot. That old file-wide test missed both
`unassignSurahFromLevel` and `deletePartner` because their files happened to contain an
unrelated compliant deletion. The guard remains structural because a functional test of the
domain removal can pass while the second Trash write is absent.

### Restoring children: one timestamp per deletion

Where a restore reinstates declared children (R59.3), it identifies *the rows this deletion
removed* by comparing their tombstone against **the record's own** `deleted_at`. That works
only if the deleting service stamps the record and its children from **one** `new Date()`.

`deleteExam` called `new Date()` twice, four milliseconds apart, and wrote the Trash entry
from a third reading. The restore compared against the entry's timestamp, the staff rows
fell before it, and **a restored exam came back with nobody supervising it** — a clean `200`,
a row on every screen, and a silent half-restore of exactly the kind §7 describes. It was
found by exercising the flow, not by any test that existed.

Two rules follow, and both are cheap:

* **One `now` per deletion**, passed to every statement in it including the snapshot.
* **The restore keys on the record's tombstone, never the Trash entry's** — the entry is
  written after the rows it describes, so it is always the later reading.
* **A parent snapshot names exact consequence ids.** Subject and Level deletion record the
  `LevelSubject`, `LevelSurah`, and empty `AdministrativeGroup` ids they tombstoned. Restore
  and purge use only those ids. A legacy snapshot without them fails closed on restore and
  deletes no guessed child during purge; PostgreSQL then refuses the parent if a child remains.

### Hard deletion

Two paths, and only two:

* **`DELETE /admin/trash/{id}`** (R59.1) — a Super Admin destroying a record deliberately.
  The children it removes are **declared per entity type** in `PURGEABLE`, never inferred;
  anything else that references the row is a record in its own right, and the `Restrict`
  foreign key makes PostgreSQL refuse. *The database is the authority on what still points
  at a row* — a hand-maintained list of blockers would be a second copy of the schema.
* **The quarantine-purge job after 90 days** — the queue now handles exact replacement,
  deletion and deliberate manual-purge storage obligations, but its automatic age arm remains
  intentionally absent (R59.4). `purge_after` is written on every tombstone and nothing reads
  it, so BR-15's automatic window is still not in force pending the Owner decision.

> **A `RESTRICT` violation is not `P2003`.** `P2003` is *foreign key constraint failed*,
> PostgreSQL `23503`. A relation declared `onDelete: Restrict` — which is how essentially
> every relation on this schema is declared — raises **`23001` `restrict_violation`**, and
> the Prisma 7 driver adapter surfaces it as **`P2039`** with the SQLSTATE buried in
> `meta.driverAdapterError.cause.code`. Matching only `P2003` therefore lets the raw error
> escape as a `500` for the single most likely refusal a purge endpoint has. Match the
> SQLSTATE, not the Prisma code.

## Connection budget

Pinned, not defaulted — the real concurrency risk on a 4 GB box is **pool exhaustion**, not
deadlock:

```
Prisma connection_limit = 10
pg-boss pool           ≤ 5
Postgres max_connections = 30
statement_timeout        = 10s
shared_buffers = 256MB · work_mem = 8MB
```

Interactive transactions must finish well inside the statement timeout.

---

**Next:** [API](api.md) · **Related:** [Backend](backend.md),
[Performance and scale](performance-and-scale.md), [Runbooks](../operations/runbooks.md)
