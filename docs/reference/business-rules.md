[Documentation](../README.md) › [Reference](README.md) › **Business rules**

# Business rules

Twenty-three domain invariants, stated **without reference to any technology** — they must
survive any future re-platforming intact.

> **Precedence: where any other section conflicts with a business rule, the business rule
> wins, and the conflict must be reported rather than silently resolved.**

Authoritative text: SRS §12. This page adds where each rule is enforced and what it costs to
break.

---

## Consent

### BR-1
**Consent default.** Absence of a media-release consent record means **no consent**. Consent
is never assumed, inferred, or defaulted to true.

*Enforced:* effective status is always derived from the most recent record; consent is never
a boolean column. *Why:* a default-true would publish a child's voice on the strength of a
missing row.
→ [Business processes](../overview/business-processes.md#2-consent)

### BR-2
**Session consent gate.** If **any** student in the audience a session resolves to lacks
effective media-release consent, **every recording of that session is non-public.** The
audience is the set of students the session is *for* — the whole level at that place, one
organisational group, or one subject-specific group. A continuously maintained invariant —
re-evaluated on enrolment change, split-group membership change, consent change, and upload
— **not a point-in-time check.**

*Before SRS Revision 43* this rule named a "group"; once a session could be for a
subject-specific split or an entire level, that word had no referent.

*Enforced:* a job recomputes the whole session state and forces bucket migration. Content
referenced by several sessions is gated by the **union** of their audiences — otherwise
privacy would depend on which route a viewer took to the file.
→ [Storage](../architecture/storage.md#consent-gating)

### BR-3
**Consent override authority.** Releasing a consent-gated resource to the public is an
**Admin-level decision requiring a recorded justification.** Teachers can never perform it.

*Enforced:* server-side, and tested at the **API** level rather than by hiding the control.

---

## Access and safeguarding

### BR-4
**Approval before access.** No registered account — person or parent-child bundle — gains
any data access before explicit staff approval. Parent-child links grant no visibility until
approved. Pending users see nothing beyond public content.

*Enforced:* no endpoint but `GET /me` and logout returns data to a Pending session, plus a
client route guard. Both tested independently.

### BR-5
**Minors are login-less, and child access is verified per action.** Minor students have no
credentials. All access to a minor's data flows through an approved parent link or a staff
role, and the relationship is **verified on every individual access** — never assumed from
an earlier action in the session.

*Enforced:* the child-context middleware matches **both** parent and child on an approved
link, every request. *Why per request:* revocation then takes effect on the very next call.
→ [Identity and access](../architecture/identity-and-access.md#child-context)

### BR-16
**Sensitive case-file data is need-to-know.** Minors' social, health, and family data is
visible only to Admins, Super Admins, and the student's **specifically assigned** teachers —
**never to students, never to guardians including the child's own linked parents, and never
to teachers at large.**

*Note:* the earlier wording said *"unrelated* guardians", which wrongly implied a related
guardian might qualify. Corrected in Revision 28. Restriction is **field-level**, and
**reads are audited as well as writes**.

### BR-20
**Global reach is a privilege.** Publishing content or events across all branches is reserved
to administrators; branch-scoped teaching staff can only publish within their own scope.

*Why:* it prevents a single-branch teacher accidentally publishing platform-wide.

---

## Grading

### BR-6
**Grading formula completeness.** A formula takes effect only when its weights total exactly
100 %. Incomplete formulas compute nothing — **partial denominators are never used.**

*Status:* the weight engine is post-MVP; this rule ships with it.

### BR-7
**Absent means zero.** A weighted exam with no mark for an enrolled student records a zero
**flagged as absent**, replaceable via makeup. Weights are **never silently renormalized**
around missing grades.

*Enforced:* absent-zero rows are created at **first draft save**, so intermediate teacher
dashboards are not inflated by omission.

### BR-8
**Draft until published.** No grade or exam is visible to students or parents before an
explicit publish action. Recalculated grades require explicit **re-publish**.

### BR-9
**Curriculum drives grading components.** Assigning a Surah or Subject to a level
automatically creates its draft grading components, so curriculum and grading configuration
**cannot drift apart.** R107–R108's carve-out covers حفظ القرآن and تفسير القرآن: their
`LevelSubject` rows create no generic component because `LevelSurah` is the shared per-Level
Surah selection. A Surah assignment creates future memorisation and Tafsir components, but
only حفظ participates in the memorisation progress engine.

### BR-10
**Issued documents are immutable.** Certificates and transcripts snapshot exact values at
generation; later formula edits never retroactively change an issued document.

### BR-11
**Level completion.** 100 % Quran memorisation coverage, plus passing the level's final exam **only if one
is configured.** No configured final exam → coverage alone completes the level.

### BR-12
**Manual overrides win.** A manual pass/fail override always takes precedence over computed
results and is **never clobbered by recalculation.**

### BR-13
**Coverage is a union, always current.** Quran memorisation progress is the union of
non-overlapping `new_memorization` intervals per Surah; revision intervals never raise it
(R95). Re-logging never inflates coverage. **Any change to the logs —
including corrections and deletions — is reflected immediately and synchronously.**

*Why synchronous:* coverage drives [BR-11](#br-11). A stale figure after a deletion could
wrongly signal level completion.
→ [Business processes](../overview/business-processes.md#5-quran-memorization-tracking)

---

## Content and data

### BR-14
**Visibility tiers.** Content and events have exactly three visibility states — public,
private, hidden. **Consent gating can force non-public regardless of the chosen tier.**

### BR-15
**Nothing is destroyed silently.** All deletions are soft, with a restorable snapshot and a
90-day permanent-delete window. Every destructive or sensitive action is attributable to an
actor and timestamp.

*Note:* the restoration **interface** may be manual in early phases; **the snapshot and the
window are non-negotiable.**

---

## Scheduling and organisation

### BR-17
**Schedule-driven teaching; organisation is separate from delivery.** A student's class
times come from the recurring course schedules that target them; those schedules produce
dated occurrences, and an occurrence may be changed or cancelled **without changing the
schedule it came from**. **The group a student is organised into is not the group they are
taught in** — a subject may split its students differently, and one student may sit in
several such splits at once, one per subject. Non-teaching activity is a separate layer and
**never the source of the routine timetable.** Week starts Monday.

*Before SRS Revision 43* this rule read *"a student's weekly class time is implied by group
enrolment"*, which held only while one group could mean one timetable slot.

### BR-21
**One organisational group per level, and it is where the student's place is.** A student
may be enrolled in several levels at once and belongs to **exactly one** organisational
group in each. That group also states **which branch the student attends** — the branch an
applicant *requested* at registration is a request and never the answer. A student's level
membership is **never recorded separately** from their group membership; the two cannot be
allowed to disagree.

*Enforced:* a unique constraint on (student, level), made possible by a composite foreign
key that forces the enrolment's level to agree with its group's. **The database refuses a
disagreeing row** — this is not a service-layer check.

### BR-22
**A subject-specific split is optional, and an unplaced student is never silent.** A subject
is taught to the whole level unless deliberately split; where it has been, each student
holds **at most one** split-group for that subject in that level. A student enrolled in the
level who has not been placed into any split-group for a split subject **must be surfaced as
unplaced** — such a student has no classes for that subject, and the platform is required to
say so rather than let the gap pass unnoticed.

### BR-23
**Room capacity informs, it never refuses.** The stated capacity of a room is displayed to
help whoever is planning and **constrains nothing**. No enrolment, placement or scheduling
action is refused on capacity grounds; the person assigning the room is responsible for its
suitability.

*Consequence:* there is no "group full" error and no capacity row-lock. **Re-introducing a
capacity rule would require re-introducing the lock** that guarded it.

---

## Legal and localization

### BR-18
**Data residency.** All real personal data, **including backups**, resides on Moroccan
infrastructure. Environments outside Morocco hold fixture data only.

*Enforced:* the fixtures guard, the prohibition on copying production dumps, and the
mock-only staging frontend.
→ [Environments](../operations/environments.md#the-residency-firewall)

### BR-19
**Ordering is intentional.** Structural entities display in admin-defined order, falling back
to **correct Arabic alphabetical order — never codepoint order.**

*Enforced:* columns are natively collated, so correct ordering is the default in every query.
**Never add a per-query collation workaround; fix the column.**

---

## Quick index

| | Rule | Domain |
|---|---|---|
| [BR-1](#br-1) | Consent default is no consent | Consent |
| [BR-2](#br-2) | Session consent gate | Consent |
| [BR-3](#br-3) | Override is Admin-only, justified | Consent |
| [BR-4](#br-4) | Approval before access | Access |
| [BR-5](#br-5) | Minors login-less, verified per action | Safeguarding |
| [BR-6](#br-6) | Formula completeness | Grading |
| [BR-7](#br-7) | Absent means zero | Grading |
| [BR-8](#br-8) | Draft until published | Grading |
| [BR-9](#br-9) | Curriculum drives components | Grading |
| [BR-10](#br-10) | Issued documents immutable | Grading |
| [BR-11](#br-11) | Level completion | Grading |
| [BR-12](#br-12) | Manual overrides win | Grading |
| [BR-13](#br-13) | Coverage is a union, always current | Quran |
| [BR-14](#br-14) | Three visibility tiers | Content |
| [BR-15](#br-15) | Nothing destroyed silently | Data |
| [BR-16](#br-16) | Case-file data need-to-know | Safeguarding |
| [BR-17](#br-17) | Schedule-driven teaching | Scheduling |
| [BR-18](#br-18) | Data residency | Legal |
| [BR-19](#br-19) | Ordering is intentional | Localization |
| [BR-20](#br-20) | Global reach is a privilege | Content |
| [BR-21](#br-21) | One organisational group per level | Scheduling |
| [BR-22](#br-22) | Split is optional; unplaced is never silent | Scheduling |
| [BR-23](#br-23) | Room capacity informs, never refuses | Scheduling |

---

**Related:** [Technical design](technical-design.md),
[Business processes](../overview/business-processes.md)
