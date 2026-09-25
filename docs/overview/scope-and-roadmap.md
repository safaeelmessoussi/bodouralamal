[Documentation](../README.md) › [Overview](README.md) › **Scope and roadmap**

# Scope and roadmap

## Current status

Under active development. A pre-MVP Arabic RTL client is live at [bodouralamal.com](https://bodouralamal.com); the API is not served there and no beneficiary data is held there; the full stack runs locally.

| Milestone | Focus | Status (R173, 2026-09-24) |
|---|---|---|
| M0–M7 | bootstrap · infrastructure · registration/approvals/family · scheduling/calendar · educational model (R43) · Quran progress · exams/grading · content/consent/storage · hardening | built, on Staging |
| M8 | rehearsal, UAT, launch | launch gate in [`TASKS.md`](../TASKS.md); go-live on hold (Owner) |

- Counts (2026-09-25): 375 backend unit · 123 integration files · 1 509 frontend tests; 191 API paths / 247 operations; 31 CI guards.
- [`TASKS.md`](../TASKS.md) · [`IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md) · [`CHANGES.log`](../CHANGES.log).

## In scope for the MVP

Dockerized deployment to a Moroccan VPS; Google OAuth only, provider-abstracted, OAuth-first; unified parent + child registration in one transaction; approvals and versioned consent with continuous re-evaluation and a staff warning (R170 §3; forced-private before); branch-scoped access control, teacher scoping via group assignment, per-request child-context verification; group timetables + event layer with explicit scope joins and branch-activation backfill; dual Gregorian/Hijri calendar from Ministry announcements; family dashboards, link queues, login-less minors; Quran interval-merge coverage with synchronous recalculation; online exam builder, per-exam basis-point grading; dual-bucket storage, signed private reads, immutable keys; Arabic-only RTL on natively collated columns; background jobs, audit log, soft delete with snapshots; offsite Moroccan backups with tested restore.

## Out of scope — and what each postponement bought

Deliberate; building any now is prohibited (§20 rule 16); the SRS postponement annotations are what the guardrail check enforces.

| Postponed | Why | Ships instead |
|---|---|---|
| Weighted grading-template engine | Largest remaining logic; protects the launch date | Per-exam informational grades, default 0 bp; interim formula prohibited |
| In-app audio recorder | Most cross-browser-fragile (iOS screen-lock, containers) | Phone recorder + upload; retires R-4 |
| FR/EN translation | Content work | Arabic-only; strings already i18n-keyed |
| In-app notifications | Five-event framework, tiered delivery, per-child preferences | Existing channels (in person, phone, WhatsApp) + dashboards |
| CSV/Excel import/export | Removed a Week-7 data-sanitation dependency | Manual admin entry, budgeted hours (R-5) |
| Resumable multipart uploads | Single-shot simpler; 100 MB cap | Single-shot signed PUT with progress/retry; first post-MVP storage item (R-9) |
| Trash restoration UI | Snapshot + 90-day window suffice | Locked CLI restore script, audited |
| `/admin/audit` page | Audit writing carries the guarantee | SQL runbook |
| Committees | Informational tag, no permissions | Nothing; tables not pre-created |
| Print-ready exam layout | Paper sittings prepared outside | Ordinary grade entry |
| Hijri importer | No machine-readable source (prose announcements) | Manual recording is the primary path |
| Local username/password auth | Needs credential storage, staff-assisted recovery | Google OAuth only; first post-MVP auth item, retires R-1 |

## Roadmap

- Auth: local username/password with staff-assisted reset (retires R-1).
- Grading: basis-point weight-template engine (templates, self-limiting allocator, draft↔active lifecycle, freeze-on-demotion, recalculation, averages); purely additive.
- Storage: S3 multipart resumable uploads (retires R-9); key structure already compatible.
- Content/comms: in-app recorder, notifications, FR/EN catalogs, CSV import/export, Trash UI, audit page, committees, print exam layout, Quran-completion exam triggers, attendance, certificates.
- Calendar: Hijri importer if the Ministry publishes something importable (write path + provenance column exist).
- Payments: deferred; Stripe removed (rejects Moroccan cards for local entities); CMI or an aggregator such as PayZone; banking decision re-verified at phase start.
- Later: duplicate-account merge tooling · QR self-check-in · second institute as a separate deployment (no dormant tenancy layer, by decision).

## Open risks

| | Risk | Level |
|---|---|---|
| R-1 | Google-only auth excludes beneficiaries without smartphones or email | HIGH |
| R-2 | Google OAuth consent-screen verification can take weeks | Medium |
| R-3 | 4 GB VPS (Postgres + MinIO + Node + jobs) memory ceiling | Medium |
| R-5 | Manual launch-data entry, paper-roster spelling variance | Medium |
| R-9 | Single-shot uploads restart from zero on bad networks | Medium → Low |
| R-10 | Non-Moroccan dev/staging vs data residency | Medium |
| R-6 | Any logged-in student sees Private events across all branches | Low, accepted |
| R-7 | Room-conflict checks reveal a slot is occupied | Low, accepted |
| R-8 | Mixed content / SSL on mobile | Low, designed out |
| R-4 | Retired by deferring the in-app recorder | — |

R-1 standing instruction: if the registration drive surfaces a large excluded population before launch, escalate; do not launch a system the first cohort cannot log into. Full text: SRS §9, §10, §11.

**Next:** [Glossary](glossary.md) · **Related:** [Purpose and context](purpose-and-context.md), [`TASKS.md`](../TASKS.md)
