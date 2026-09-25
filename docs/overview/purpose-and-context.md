[Documentation](../README.md) › [Overview](README.md) › **Purpose and context**

# Purpose and context

## The association

- جمعية بذور الأمل (Bodour Al-Amal, "Seeds of Hope"): nonprofit educational association, Marrakesh, Morocco.
- Teaches تحفيظ القرآن الكريم (Quran memorization), العلوم الشرعية (Tafsir, Fiqh), محو الأمية (adult literacy).
- Beneficiaries: women, teenagers, children; small cohorts at physical branches; in person, in Arabic, fixed weekly timetable.

## The problem

| Activity | Today | Failure |
|---|---|---|
| Scheduling | Hand-maintained weekly timetable | Room double-bookings; changes spread by word of mouth or not at all |
| Account approval | Paper, decided in person | No record of who approved what, when |
| Grade tracking | Per-teacher spreadsheets | Coverage recomputed by hand, wrongly; corrections do not propagate |

The platform replaces exactly these three for the first live branch cohort; deferrals in [Scope and roadmap](scope-and-roadmap.md).

## Who uses it

| | |
|---|---|
| Staff | Super Admin, branch Admins, مؤطِّرات |
| Beneficiaries | Adults directly; teenagers and children through a parent's account |
| Public | Branch directory, calendar, public resources |

Detail: [Users and roles](users-and-roles.md).

## Sizing

~900 users at launch, 5,000-user ceiling without re-architecture; hence no cache layer, read replica, search cluster or horizontal scaling (building any is a defect). [Performance and scale](../architecture/performance-and-scale.md), SRS §2.4.

## The four constraints that shaped everything

### 1. Data residency — Moroccan law

- Law 09-08 and the CNDP: Moroccan citizens' personal data stays on Moroccan infrastructure.
- Production on a Moroccan-provider VPS (not AWS/GCP/Azure); backups to a second Moroccan location, never abroad.
- Staging frontend is hosted outside Morocco and never touches real data (mocks only).
- No managed cloud service (hosted Postgres, S3, CDN); PostgreSQL and MinIO in containers on one box.

> [`BR-18`](../reference/business-rules.md#br-18) · [Environments](../operations/environments.md)

### 2. Connectivity — unreliable mobile networks

- Large-file operations minimised; audio uploads capped at 100 MB.
- No web font (Arabic face 200 KB–1 MB); character from scale, weight, rhythm ([Design system](../architecture/design-system.md)).
- Calendar makes two requests, never a third; reference data in one composite document ([Calendar](../architecture/calendar-and-hijri.md)).

### 3. Digital literacy — and the Google-only decision

- Google OAuth only; no passwords, hashes, reset flows or password columns.
- Structurally excludes some beneficiaries (literacy programme; no smartphone or email); accepted for the MVP because credential storage, reset flows and staff-assisted recovery for people who cannot receive a reset email is larger and riskier work.
- Mitigations: staff help create a Google account at in-person registration; staff pre-provision an account that binds on first login; local username/password is the first post-MVP item, the identity layer being provider-abstracted so it lands without touching `User`.
- Risk R-1 (HIGH), SRS §11: if the registration drive surfaces a large excluded population before launch, escalate; do not launch a system the first cohort cannot log into.

### 4. Safeguarding — most records are about children

- Minors have no login; reachable only through an approved parent link or a staff role.
- Every request touching a child's data re-verifies the link against the database, not the session or token.
- Consent is a versioned record, never a boolean; no record = no consent ([`BR-1`](../reference/business-rules.md#br-1)).
- Out-of-scope access returns `404`, never `403`.

> [Identity and access](../architecture/identity-and-access.md) · [Security](../architecture/security.md) · [`BR-5`](../reference/business-rules.md#br-5), [`BR-16`](../reference/business-rules.md#br-16)

## One institute, deliberately

- Strict single-tenant: no tenant tables, columns or token claims; multi-tenant-ready design removed (R11) as dormant plumbing paid for in every query and scoping bug.
- Second institute = separate deployment (own VPS, database, domain) or deliberate re-architecture; speculative tenant columns prohibited.

## How the project is built

- Specification-first: [`SRS.md`](../SRS.md) (Revision 173) is authoritative and immutable to contributors and agents; changes only via a numbered revision approved by the Document Owner.
- Silent or contradictory spec → stop and escalate, never invent; resolutions become revision entries ([decision log](../reference/decision-log.md)).

**Next:** [Users and roles](users-and-roles.md) · **Related:** [Scope and roadmap](scope-and-roadmap.md), [System overview](../architecture/system-overview.md)
