# Implementation Plan — بذور الأمل Platform

**Mutable companion document (SRS §16.3).** Milestone build order derived from SRS §8 (MVP delivery plan) and §18 (module acceptance checklists). This file never overrides `docs/SRS.md`; it is re-sequenced only by the Document Owner. The granular, agent-updated checklist lives in `docs/TASKS.md`; the completion ledger in `docs/CHANGES.log`.

## Milestone Order

| Milestone | Focus | Primary SRS authority | §8 week |
|---|---|---|---|
| M0 — Bootstrap | Repo layout, agent workspace files, TD-13 env inventory + fail-fast validation, §3.1a version pins, CI skeleton | §16, §3.1a, TD-13, §19.2 | 1 |
| M1 — Infrastructure & Platform Core | docker-compose, Nginx same-origin routing, MinIO dual buckets, Prisma schema + hand-written SQL migrations, seeds, Google OAuth + sessions, error envelope, pg-boss, healthz, AuditLog, Branch/Room CRUD | §3.1, §4.1b, §7, §15, TD-1…TD-16 | 1–2 |
| M2 — Registration, Approvals, Family | Unified registration transaction, ConsentRecord, approval bundles, FamilyLink, `X-Active-Child-ID` middleware, teacher scoping (§4.4c), user management | §4.1–§4.3, §4.10, TD-4 | 2 |
| M3 — Scheduling & Calendar | Event layer for non-teaching activity, four-way scope joins, visibility tiers, Hijri overlay | §4.4, TD-11 | 3 |
| **M3b — Educational Model (SRS Revision 43)** | Administrative Groups · Teaching Groups · `Enrollment` with its composite-FK invariant · Recurring Course Schedules with conflict detection against materialized Sessions · `session.materialize` + Session lifecycle · approval assigning Levels and groups · public calendar + public Educational Library · expand–migrate–contract retirement of the `Group` schedule columns | §4.4, §4.4c, §4.9, TD-1, TD-4, TD-6, TD-7 | 3b |
| M4 — Quran Progress | Interval-merge engine, StudentSurahProgress self-healing cache, synchronous recalculation | §4.5, BR-13, TD-4.11 | 4 |
| M5 — Exams & Grading | Exam builder, bp scoring, submission lifecycle, absent-zero, pass/fail overrides | §4.6, TD-1 | 5 |
| M6 — Content, Consent & Storage | Single-shot presigned uploads, magic-byte validation, bucket transitions, consent re-evaluation engine, resources directory | §4.9, §4.1a, TD-9 | 6 |
| M7 — Hardening & Launch Data | Performance vs ceiling fixtures, RTL pass, rate limits, restore runbook + script, offsite backups, manual launch-data entry | §8 wk 7, TD-11a, §6, §4.10 | 7 |
| M8 — Rehearsal, UAT, Launch | §19.1 pipeline on the production VPS, E2E journeys J1–J8, named regression tests, UAT, launch | §19.1, §17, §19.2, §18 | 8 |

**Definition of done is per module, not per week (§18):** a milestone completes only when its §18 checklist is green, its §19.2 test gates pass, and its §17 journeys run.

**Postponement guard (§10.1 / §20 rule 16):** no milestone builds the weight-template engine, in-app recorder, FR/EN catalogs, Committees, `/admin/audit` page, print exam layout, notifications, CSV import/export, multipart uploads, the Trash UI, **or attendance and session announcements — specified by Revision 43 in §4.7/§10.1 and deliberately unbuilt**.
