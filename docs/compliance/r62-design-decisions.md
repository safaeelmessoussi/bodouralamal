[Documentation](../README.md) › [Compliance](personal-data-audit.md) › **R62 design decisions**

# R62 — Architectural Decisions Before Drafting

- SUPERSEDED IN PART: this proposed *narrowing* the case file (`StudentSupport` / `MinorSafeguarding`); on 2026-09-02 the Owner withdrew it entirely (R120: no surface ever collected it; no categories not operationally needed). The platform collects no health, medical or social-case-file data; proposals on `healthCondition`, `familySituation`, `homeAddress`, `siblingsCount`, parents' names/professions are moot, kept as the reasoning trail.
- Date 2026-08-11 · follows the [audit](personal-data-audit.md) → [data-collection decision](data-collection-decision.md) · for approval; nothing implemented. Tags: **[SRS]** · **[CODE]** verified · **[INFER]** reasoning · **[CONFIRM]** needs the CNDP or a Moroccan privacy lawyer.
- Settled direction assumed: no date of birth · reference code · remove the three dead fields · remove child free-text notes · bounded accessibility model · `familySituation`/`homeAddress` blocked pending legal review · parent-as-discriminator · admin-decided matching · read-only parent. Updated 2026-08-11: `schoolingStage` enum replaces date of birth as the placement signal (Decision D).

## Decision 1 — Multiple approved parents per child: YES
- [CODE] uniqueness is on the pair (`familyLink.findFirst({ parentId, studentId })`), not the child; `resolveActingStudent` matches parent and child; two approved links are independent authorizations; `ConsentRecord.grantedByUserId` records which parent consented.
- [INFER] refusing would cause shared credentials and misattributed audit rows; custody/separation is handled by per-link approval and revocation effective on the next request (re-checked per request, not cached in the token).
- Impact: SRS must state it (silence is the defect); database none; the child appears in both switchers.
- [CONFIRM] whether a legally restricted parent must be provably removable within a defined period.

## Decision 2 — Relationship types: exactly `mother` · `father` · `legal_guardian`
- No free text, no `other`: the only question is *may this person act for this child*; a grandparent acting legally is a legal guardian; `other` + note would reintroduce unbounded text. One enum column on `FamilyLink`; mother/father reveals family structure, proportionate; a later value is a migration.

## Decision 3 — Adding another child with no Parent Dashboard
- [CODE] `roleHomePath('parent')` resolved to `/dashboard/parent`, which the model deletes. Decided: `homeForRole('parent')` resolves to the first approved child's dashboard; the switcher's ولي الأمر group carries a persistent «＋ تسجيل طفل» row; with zero approved children the group still shows only that action (hiding strands the holder; an empty list is a dead end). §14.1 removes `/dashboard/parent`; the action only creates a pending application.

## Decision 4 — Linking an adult's account to a parent: NO
- [SRS] minors have no login; a minor is structurally a student account with no `UserIdentity`, no date of birth needed. An adult consents for herself; linking a parent would hand a third party her record; registration refuses with a clear reason.
- 4a: a minor gaining a login — parent links must not silently survive: flag for review (Resolved A); [CONFIRM] revocation at majority. 4b: dependent adults are outside §4.3; not built, noted as unsupported.

## Decision 5 — The student reference code
| Property | Choice |
|---|---|
| Applies to | Students (adult + minor); staff have other identifiers |
| Generation | Random from a large space, unique index; never sequential (leaks enrolment order/headcount, invites enumeration) |
| Alphabet | Digits + unambiguous Latin letters, excluding `0/O` and `1/I/l` (read aloud, hand-copied) |
| Length / format | 6–8 characters, e.g. `BA-7K4M2` |
| Secrecy | Not secret, never a credential: identifies, never authorises; every lookup by code runs the same authorization as by id |
| Display | Student's own dashboard · staff screens · the parent's child list |
| Immutability | Never changes |
- SRS states field, generation rule and *identifies, never authorises*; one column + unique index + backfill; no personal data.

## Decision 6 — The admin screen for a multi-child request
- One queue item per request, one decidable block per child. Parent block: name, phone, branch, consent status, whether she already has approved children. Per child: name, sex, requested stage, the existing Level/Group controls (R49/R43), duplicate candidates as name + linked parent + reference code (no birth date). "Create new" is the deliberate choice, not the default. §5.6/§14.2; `ChildApplication`; the approval is the security boundary; R62's main build cost.

## Decision 7 — Independent per-child approval: YES, narrowing TD-4.2
- [CODE] `decide()` approved the applicant and every pending child link at once; [SRS] TD-4.2 named that atomicity, so this is a revision: atomicity becomes per child (parent activation + child + link + role grant in one transaction); `ChildApplication.status` per row.
- The parent's own account is an explicit separate decision on the same screen (Resolved B). A rejected child gets no `FamilyLink` row (created on approval), so partial approval cannot leak.

## Decision 8 — What a rejected parent sees; resubmission
- `rejectionReason` enum `duplicate_application · insufficient_information · not_eligible · other` shown to the parent; `internalNote VarChar(500)` staff-only, never shown (free text would carry safeguarding judgements). Resubmission as a NEW application; the decided one is immutable (natural rate-limit point). [CONFIRM] a right to the actual reason would change this.

## Decision 9 — Personal data R62 introduces
| Field | Classification |
|---|---|
| Child first/last name (Arabic), `sex` | Required and justified; already collected, R62 moves *when* |
| `FamilyLink.relationshipType` | Required and justified (Decision 2) |
| `ChildApplication.status`, `decidedAt`, `decidedById` | Required and justified; the accountability record |
| `rejectionReason` (enum) | Required and justified |
| `internalNote` (500 chars, staff-only) | Requires care: bounded, named purpose, out of every parent-facing payload |
| `referenceCode` | Not personal data |
| `guardianshipVerifiedAt` | Requires legal confirmation |
| Emergency contact | Not R62; justified, own decision |
- [CONFIRM] guardianship verification: a claim is recorded, not proof; whether a check date (never a scan) must be recorded is legal. R62 adds no new category of personal data, only a non-personal identifier.

## Final recommendation
- Proceed: one table, three columns, one enum; closes two specification conflicts (contents: see the approved scope below). [CODE] `/dashboard/student` did not exist, so R62 includes a minimal student dashboard rather than shipping against a placeholder.

## RESOLVED — Owner decisions of 2026-08-11
- A — a minor gaining a login: flag for admin review, no auto-revoke; a first `UserIdentity` binding on a student with approved `FamilyLink` rows raises a non-blocking review item in the approvals queue (blocking would lock a family out at first sign-in). [CONFIRM] revocation at majority.
- B — the parent's own application: explicit and separate, never inferred; one parent decision plus N independent child decisions.
- C — minimal Student Dashboard: identity block (name, reference code, category/level, branch), today's and upcoming sessions, basic information; Quran progress, grades, exams out. Makes the boundary testable end to end.
- D — placement: `schoolingStage` bounded enum, no date of birth ([data-collection decision §2.1](data-collection-decision.md)); placement stays administrative — the field informs, never gates, filters or auto-assigns, and the revision must say so.

## Compliance register
- No CNDP declaration filed; the Owner completes formalities after the MVP on what the finished system processes — defensible provided no field is justified by "declare later" and every compliance-sensitive decision is recorded when taken. These three documents are the register; every [CONFIRM] is an open item; keep the table current.

| Item | Where |
|---|---|
| `healthCondition` · `familySituation` · `homeAddress` for minors | audit A.2, decision 5 |
| `sex` as a protected characteristic | decision §1 |
| Audio recordings of minors | audit A.5 |
| Google OAuth as a foreign transfer | audit H.1 |
| Retention for a minor's educational record | audit F.5 |
| Erasure vs backup retention | audit H.4 |
| Guardianship verification | Decision 9 |
| Right to the actual rejection reason | Decision 8 |
| Parent link at majority | Decision A |
| Birth date on certificates | data-collection §2.1 |

## Final R62 scope — approved 2026-08-11
- Data model: `ChildApplication` (per-child status); `FamilyLink.relationshipType`; `User.referenceCode`; `User.schoolingStage` (informs placement, gates nothing); `ChildApplication.rejectionReason` + `internalNote`.
- Specification: TD-4.2 narrowed to per child; §5.4/§14.1 Family Dashboard removed; linking restricted to accounts with no login identity; multi-parent permitted; `parent` role granted automatically on first approval; placement explicitly administrative, no age/stage rule may gate it.
- Behaviour: adult student requests children from the student area; non-student parent in registration; switcher ولي الأمر expands to approved children + «＋ تسجيل طفل»; selecting a child → parent + child context → student dashboard; minimal student dashboard; bounded rejection reason, internal note never shared, resubmission = new application; minor gaining a login → non-blocking review item.
- NOT in R62: date of birth · emergency contact (own decision) · `familySituation`/`homeAddress` changes (blocked pending legal review) · accessibility redesign (own revision, different table and legal question) · new parent capability · Quran progress, grades, exams · staff HR data. Parent permissions read-only per TD-2; online exams (the only parent write) stay disabled by R58.

## Open questions
- A, B, C resolved above; F (CNDP declaration status) resolved: deferred to post-MVP, tracked by the register.
- D [CONFIRM] guardianship verification — if required, adds one date column. E [CONFIRM] right to the actual rejection reason — if required, the enum gains a shared free-text field; the internal note stays. Neither blocks drafting.
- R62 is drafted at SRS Revision 62 ([ledger](../archive/SRS-revisions.md)), audited against the live architecture in its §62.13, not applied. The audit changed the draft once: deferring the child's `User` to approval broke consent (`ConsentRecord.student_id` cannot precede the student), so §62.3b captures consent on the application at submission with the text version in force and materialises it at approval.
