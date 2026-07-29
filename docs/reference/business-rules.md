[Documentation](../README.md) › [Reference](README.md) › **Business rules**

# Business rules

Twenty domain invariants, stated **without reference to any technology** — they must survive
any future re-platforming intact.

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
**Group consent gate.** If **any** currently-enrolled student in a group lacks effective
media-release consent, **every session-recording resource of that group is non-public.** A
continuously maintained invariant — re-evaluated on enrolment change, consent change, and
upload — **not a point-in-time check.**

*Enforced:* a job recomputes the whole group state and forces bucket migration.
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
**cannot drift apart.**

### BR-10
**Issued documents are immutable.** Certificates and transcripts snapshot exact values at
generation; later formula edits never retroactively change an issued document.

### BR-11
**Level completion.** 100 % Quran coverage, plus passing the level's final exam **only if one
is configured.** No configured final exam → coverage alone completes the level.

### BR-12
**Manual overrides win.** A manual pass/fail override always takes precedence over computed
results and is **never clobbered by recalculation.**

### BR-13
**Coverage is a union, always current.** Quran progress is the union of non-overlapping
logged intervals per Surah; re-logging never inflates coverage. **Any change to the logs —
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

### BR-17
**Group-driven scheduling.** A student's weekly class time is implied by group enrolment;
events are exceptions layered on top, **never the source of the routine schedule.** Week
starts Monday.

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
| [BR-2](#br-2) | Group consent gate | Consent |
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
| [BR-17](#br-17) | Group-driven scheduling | Scheduling |
| [BR-18](#br-18) | Data residency | Legal |
| [BR-19](#br-19) | Ordering is intentional | Localization |
| [BR-20](#br-20) | Global reach is a privilege | Content |

---

**Related:** [Technical design](technical-design.md),
[Business processes](../overview/business-processes.md)
