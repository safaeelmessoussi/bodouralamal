# منصة بذور الأمل — Bodour Al-Amal Platform

A management platform for the learning institute run by **جمعية بذور الأمل**, a Moroccan
educational and charitable association in **Marrakesh**.

The institute teaches **Quran memorization**, **Islamic studies**, and **adult literacy** to
women, teenagers, and children. It has been running on paper registers and spreadsheets. This
platform replaces the parts that cost the most and break the most often: **scheduling**,
**account approvals**, and **grade tracking**.

The interface is **Arabic-only and right-to-left**. It is sized for roughly **900 users at
launch** against a 5,000-user ceiling, and runs on a **single Moroccan server** — because
Moroccan law requires the data to stay in the country.

> **Status: under active development.** A pre-MVP site is live at
> **[bodouralamal.com](https://bodouralamal.com)** — the public pages only. Milestones M0–M3
> are complete on the backend; M4–M8 have not started.
> See **[Scope and roadmap](docs/overview/scope-and-roadmap.md)** for exactly what runs.

---

## Why it exists

Three things break repeatedly when an institute this size runs on paper:

| | Today | What goes wrong |
|---|---|---|
| **Scheduling** | A weekly timetable maintained by hand | Rooms get double-booked; a change reaches people by word of mouth, or not at all |
| **Approvals** | Registration on paper, decided in person | No record of who approved what, or when |
| **Grades** | Per-teacher spreadsheets | Memorization coverage is recomputed by hand and gets it wrong; a correction does not propagate |

## Who uses it

| | |
|---|---|
| **Staff** | A system owner, branch coordinators, and the مؤطِّرات (instructors) who teach and mark |
| **Adult learners** | Their own accounts |
| **Teenagers and children** | **No accounts of their own** — reached through a parent's account |
| **Parents** | See their linked children's schedules, progress, and grades |
| **The public** | The branch directory, the calendar, and public resources are open to anyone |

→ [Users and roles](docs/overview/users-and-roles.md)

## What it does

**Registration and approval** — someone signs up, and a staff member approves them before
they see anything. A parent registering a child creates the parent, the child, and the link
between them in one indivisible step.

**Scheduling** — a *group* is a cohort with a fixed weekly time, room, and instructor.
Enrolling in a group is what gives a student their timetable. One-off events — holidays,
exams, ceremonies — layer on top.

**A dual calendar** — Gregorian and Hijri side by side. The Hijri dates **reproduce the
official announcements of the Ministry of Habous and Islamic Affairs**, recorded month by
month. The platform computes nothing, and a month the Ministry has not yet announced simply
carries no Hijri label.

**Quran memorization tracking** — teachers log the ayah ranges a student has memorized, and
coverage is the mathematical union of those ranges, so logging the same passage twice never
inflates progress. A correction takes effect immediately.

**Exams and grading** — an online exam builder with auto-marked multiple choice and
teacher-marked free text. Nothing is visible to students until a teacher publishes it.

**Teaching materials** — files and audio recordings, in three visibility tiers.

**Consent, taken seriously** — parental consent for publishing a child's voice is a *record*,
not a checkbox. If even one student in a group has not consented, **every recording for that
group is automatically private** — and stays that way, re-checked whenever anyone joins,
leaves, or changes their mind.

→ [Business processes](docs/overview/business-processes.md) ·
[User journeys](docs/overview/user-journeys.md)

## What shaped it

Four constraints explain almost every decision in this codebase.

**Moroccan law.** Personal data must stay on Moroccan infrastructure. No AWS, no Google
Cloud, no managed database — everything runs in containers on a Moroccan server, with backups
to a second Moroccan location.

**Unreliable connections.** Users are on mobile networks that drop. Pages are small, no web
font is loaded, and the calendar makes two requests rather than five.

**Low digital literacy.** Many beneficiaries are *in an adult literacy programme*. Sign-in is
Google-only for now, which is a real and recorded problem — some people the association
serves do not have a smartphone or an email address. Staff help create accounts, and
username-and-password sign-in is the first thing being added after launch.

**Most records are about children.** Safeguarding is not a feature; it is a property the
whole system has to hold. Access to a child's record is re-verified on *every single
request*, and a response never reveals whether a particular child exists.

→ [Purpose and context](docs/overview/purpose-and-context.md)

## How it is built

```
                      ┌──────────── Nginx — one domain, one certificate ────────────┐
   browser  ──TLS──▶  │  /            the Arabic web client                         │
                      │  /api/v1/     the API        (Node + Express)               │
                      │  /storage/    files          (MinIO)                        │
                      └────────────────────────────────────────────────────────────┘
                                     │                        │
                              ┌──────▼──────┐          ┌──────▼──────┐
                              │ PostgreSQL  │          │    MinIO    │
                              │ + job queue │          │   files     │
                              └─────────────┘          └─────────────┘
```

One server, one domain, five containers. Everything is served from a **single origin**, which
is what keeps sessions secure without any cross-origin configuration anywhere.

| | |
|---|---|
| **Client** | React 19, Vite 8 — Arabic, right-to-left, mobile-first |
| **API** | Node.js 24, Express 5, Prisma 7, TypeScript strict |
| **Database** | PostgreSQL 18 — which also holds the job queue |
| **Files** | MinIO, self-hosted |
| **Edge** | Nginx, Let's Encrypt |

→ [System overview](docs/architecture/system-overview.md)

## The specification comes first

This repository is built **specification-first**. [`docs/SRS.md`](docs/SRS.md) is the
authoritative requirements document — currently at **Revision 36.2** — and the code conforms
to it, not the other way around.

- It is **immutable** to contributors and to AI agents. It changes only through a numbered
  revision approved by the Document Owner.
- Every section is cross-referenced by stable identifiers, so any behaviour traces back to
  the clause that requires it.
- Where it is silent or self-contradictory, the rule is to **stop and ask** — never to invent
  behaviour.

That last rule is why [the decision log](docs/reference/decision-log.md) reads as a history of
arguments rather than a changelog: thirty-six revisions, each recording a decision **and what
was rejected**.

---

## Documentation

**Everything is in [`docs/`](docs/README.md), organised so you can stop at the depth you
need.**

| | |
|---|---|
| **[Overview](docs/overview/README.md)** | The platform in business terms — no technical knowledge needed |
| **[Architecture](docs/architecture/README.md)** | How the system is built, and why |
| **[Operations](docs/operations/README.md)** | Running, deploying, and recovering it |
| **[Development](docs/development/README.md)** | Contributing |
| **[Reference](docs/reference/README.md)** | Business rules, technical constraints, endpoints, error codes, decisions |

**Start here:**

- New to the project? [Purpose and context](docs/overview/purpose-and-context.md) — 10 minutes
- New engineer? [Architecture](docs/architecture/README.md) — the one-hour tour
- About to contribute? [Getting started](docs/development/getting-started.md)

> **Documentation is part of the implementation here.** A feature is not done until its
> documentation is updated, in the same commit —
> [the policy](docs/development/documentation-policy.md).

---

## Running it locally

```bash
git clone <repository-url> && cd bodouralamal

cp .env.example .env             # fill every Required value
cp infra.env.example infra.env   # the database password

docker compose up -d db minio
docker compose run --rm api npx prisma migrate deploy
docker compose run --rm api npm run seed:production
docker compose up -d

curl http://localhost/healthz    # expect 200, all components green
```

Full instructions, including test fixtures and troubleshooting:
**[Getting started](docs/development/getting-started.md)**.

## Tests

**102 backend unit · 473 integration · 48 frontend**, plus **ten CI guards**.

Integration tests run against a **real** PostgreSQL, MinIO, and Nginx rather than mocks —
because the properties they check (transaction atomicity, constraint enforcement, signed URLs
surviving the proxy) **do not exist in a mock**.

→ [Testing](docs/development/testing.md) · [CI/CD](docs/development/ci-cd.md)

## Repository layout

```
backend/    API, database schema, migrations, seeds
frontend/   the React client
nginx/      routing, TLS, rate limits
scripts/    CI guards and development tools
docs/       the specification, and all documentation
```

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) or [`AGENTS.md`](AGENTS.md) first — they carry the binding
working agreement, including the guardrails in SRS §20.

The short version: consult only the specification sections you are implementing, **never edit
the specification**, keep the checklist and the ledger current, **update the documentation in
the same commit**, and **stop and ask when the specification is silent or two clauses
conflict** rather than guessing.

---

*جمعية بذور الأمل — مراكش، المغرب*
