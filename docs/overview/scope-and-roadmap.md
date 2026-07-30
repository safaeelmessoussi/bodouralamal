[Documentation](../README.md) › [Overview](README.md) › **Scope and roadmap**

# Scope and roadmap

## Current status

> **Under active development.** A **pre-MVP** site is publicly live at
> [bodouralamal.com](https://bodouralamal.com) — the Arabic RTL client only. **The platform
> API is not served there**, no beneficiary data is held there, and nothing on that site is
> backed by the endpoints below. The full stack runs in local development.

| Milestone | Focus | Status |
|---|---|---|
| **M0** | Bootstrap — repo, env inventory, version pins, CI skeleton | ✅ Complete |
| **M1** | Infrastructure & platform core — compose, Nginx, MinIO, schema, OAuth, sessions, audit | ✅ Backend complete |
| **M2** | Registration, approvals, family — the transaction, consent, child context | ✅ Backend complete |
| **M3** | Scheduling & calendar — groups, events, visibility tiers, Hijri overlay | ✅ Backend complete |
| **M4** | Quran progress — interval merge, self-healing cache | ⬜ Not started |
| **M5** | Exams & grading | ⬜ Not started |
| **M6** | Content, consent & storage | ⬜ Not started |
| **M7** | Hardening & launch data | ⬜ Not started |
| **M8** | Rehearsal, UAT, launch | ⬜ Not started |

**The frontend is a public shell.** Landing page, login, OAuth error states, account status
screens, the public branch directory, the **full dual calendar**, and the **educational library** (built against a mock adapter — no content endpoint exists yet). There are **no authenticated
screens yet**, so the endpoints M1–M3 delivered currently have no interface driving them.

Live counts: **102 backend unit · 487 integration · 91 frontend tests**, **47 API
operations across 35 paths**, **ten CI guards**.

> Granular checklist: [`TASKS.md`](../TASKS.md) · Build order:
> [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) · What was built and why:
> [`CHANGES.log`](../CHANGES.log)

---

## In scope for the MVP

- Dockerized deployment to a Moroccan VPS
- **Google OAuth only**, provider-abstracted, OAuth-first onboarding
- Unified parent + child registration as one transaction
- Approvals and **versioned consent records**, with continuous re-evaluation and forced-private enforcement
- **Branch-scoped access control**, teacher scoping through group assignment, per-request child-context verification
- Group timetables plus an event exception layer, with explicit scope joins and branch-activation backfill
- Dual Gregorian/Hijri calendar, the Hijri side reproducing the Ministry's recorded announcements
- Family dashboards, link queues, login-less minors
- Quran interval-merge coverage with synchronous recalculation
- Online exam builder and per-exam basis-point grading
- Dual-bucket storage with signed private reads and immutable keys
- Arabic-only RTL interface on natively collated columns
- Background jobs, first-class audit log, soft delete with snapshots
- Offsite Moroccan backups with a tested restore

## Out of scope — and what each postponement bought

Postponements here are **deliberate and defended**, not backlog. Building any of them now
is prohibited by the AI guardrails (§20 rule 16), and each entry records what the deferral
protected.

| Postponed | Why | What ships instead |
|---|---|---|
| **Weighted grading-template engine** | The largest remaining piece of business logic; deferring it recovered the schedule slack that protects the launch date | Per-exam informational grades. Every exam already defaults to 0 bp, so this is a coherent state of the model — **not** an interim formula, which is explicitly prohibited |
| **In-app audio recorder** | The most cross-browser-fragile component in the build (iOS screen-lock suspension, per-browser containers) | Teachers record on their phone and upload. The pipeline already accepts every container phones produce, and Risk R-4 was **retired** by this |
| **FR/EN interface translation** | Content work, not build work | Arabic-only launch. Every string already flows through an i18n key, so the catalogs are a translation task with no code change |
| **In-app notifications** | A five-event framework with tiered delivery and per-child preferences | The association's existing channels — in person, phone, WhatsApp — plus state visible on dashboards |
| **CSV/Excel import/export** | Removed a Week-7 data-sanitation dependency | Manual data entry through the admin UI, with budgeted hours (Risk R-5) |
| **Resumable multipart uploads** | Single-shot is simpler and the 100 MB cap bounds the damage | Single-shot signed PUT with progress and retry. **First** post-MVP storage item (Risk R-9) |
| **Trash restoration UI** | The snapshot and the 90-day window are what matter; the interface is convenience | A locked CLI restore script, audit-logged |
| **`/admin/audit` browsing page** | Audit **writing** is what carries the accountability guarantee | Reads through a documented SQL runbook |
| **Committees** | A purely informational tag with zero permission function | Nothing — the tables are not pre-created |
| **Print-ready exam layout** | Paper sittings are prepared outside the platform | Marks entered as ordinary grades |
| **Hijri calendar importer** | **There is no machine-readable source to import from.** The Ministry publishes prose announcements after each sighting | Manual recording — which is the *primary* path, not a fallback |
| **Local username/password auth** | Would need credential storage and staff-assisted recovery | Google OAuth only. **First** post-MVP auth item, retiring Risk R-1 |

The postponement annotations in the specification are **load-bearing**: they are what an
automated guardrail check enforces against, and deleting one would let a postponed feature
quietly re-enter scope.

---

## Roadmap

### Immediate next phase

Auth and access
: Local username/password authentication with staff-assisted reset — retires Risk R-1.

Grading
: The basis-point weight-template engine: templates, the self-limiting allocator, the
  draft↔active lifecycle, freeze-on-demotion, recalculation, averages. Purely additive —
  nothing in the MVP schema references its tables.

Storage
: S3 multipart resumable uploads — retires Risk R-9. The key structure is already
  compatible, so this is a drop-in change to the upload path.

Content and comms
: The in-app recorder; in-app notifications; FR/EN catalogs; CSV import/export; the Trash
  restoration UI; the audit browsing page; committees; the print exam layout; automated
  Quran-completion exam triggers; attendance; certificates.

Calendar
: A Hijri importer — **if and when** the Ministry publishes something importable. No
  redesign needed: the single write path and the provenance column already exist.

### Payments

Deferred, with a concrete direction. **Stripe is removed entirely** — it does not accept
Moroccan-issued cards for local entities. The Moroccan market runs on **CMI** (the
interbank gateway) or an aggregator such as **PayZone**. A banking decision requiring
re-verification when the phase starts.

### Later

Duplicate-account merge tooling · QR-code self-check-in · second-institute onboarding as a
**separate deployment** (there is no dormant tenancy layer, by decision).

---

## Open risks

| | Risk | Level |
|---|---|---|
| **R-1** | Google-only auth structurally excludes beneficiaries without smartphones or email — a population the association explicitly serves | **HIGH** |
| **R-2** | Google OAuth consent-screen verification can take weeks | Medium |
| **R-3** | A 4 GB VPS running Postgres + MinIO + Node + jobs may hit memory ceilings | Medium |
| **R-5** | Manual launch-data entry burden, with paper-roster spelling variance | Medium |
| **R-9** | Single-shot uploads restart from zero on unreliable networks | Medium → Low |
| **R-10** | Non-Moroccan dev/staging versus data residency | Medium |
| **R-6** | Any logged-in student sees Private events across all branches | Low, accepted |
| **R-7** | Room-conflict checks reveal that *something* occupies a slot | Low, accepted |
| **R-8** | Mixed content / SSL on mobile | Low, designed out |
| **R-4** | — **RETIRED** by deferring the in-app recorder | — |

R-1 carries a standing instruction: *if the registration drive surfaces a large excluded
population before launch, escalate — do not launch a system the first cohort cannot log
into.*

> Full text: SRS §9, §10, §11

---

**Next:** [Glossary](glossary.md) · **Related:**
[Purpose and context](purpose-and-context.md), [`TASKS.md`](../TASKS.md)
