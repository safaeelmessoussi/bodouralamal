# Documentation — منصة بذور الأمل

Everything written about this platform, arranged so you can stop reading at the depth you need.

New here? Start with the [project README](../README.md), then come back for whichever
section below matches what you are about to do.

---

## The two kinds of document in this repository

This distinction governs every page here, so it is worth thirty seconds. It is **normative** —
defined in [`SRS.md`](SRS.md) §16.4 (Revision 37), not a convention this directory invented.

| | **The specification** | **The handbook** |
|---|---|---|
| Where | [`SRS.md`](SRS.md) | everything else in `docs/` |
| Answers | *what the system must do* | *why it is built this way, and how it fits together* |
| Authority | **normative** — the code conforms to it | explanatory — it conforms to the code and the SRS |
| Changed by | a numbered revision approved by the Document Owner | any contributor, in the same commit as the change it describes |
| Style | rules, constraints, identifiers (`§4.3`, `BR-5`, `TD-12`) | prose, diagrams, rationale, worked examples |

**The handbook never restates a rule from the specification — it cites it.** When you
see a link like [`BR-5`](reference/business-rules.md#br-5) or `§4.3`, that is the
authoritative text, and the surrounding paragraphs are there to explain what it means and
why it exists.

This is not stylistic tidiness. Duplicated requirements have drifted **every single time**
they appeared twice in this project — `TD-15`'s version-column list, `BR-15`'s purge
window, `TD-10`'s pagination rule. The copy that drifts still passes its own tests, so the
divergence stays invisible until something breaks. One statement, many references.

---

## Read this much, get this far

### 10 minutes — what is this?

1. [Purpose and context](overview/purpose-and-context.md) — the association, the problem, the constraints that shaped everything else
2. [Users and roles](overview/users-and-roles.md) — who uses it and what each of them can do

### 1 hour — how is it built?

3. [Architecture overview](architecture/README.md) — the guided tour, in reading order
4. [System overview](architecture/system-overview.md) — containers, the request path, why it is a single box
5. [Identity and access](architecture/identity-and-access.md) — the part with the most consequence if you get it wrong

### A day — how do I work on it?

6. [Getting started](development/getting-started.md) — running the stack locally
7. [Conventions](development/conventions.md) — the rules code review will hold you to
8. [Engineering constitution](development/engineering-constitution.md) — **the laws every implementation must satisfy**
9. [Documentation policy](development/documentation-policy.md) — why this directory is part of the definition of Done
10. [Engineering efficiency](development/engineering-efficiency.md) — choosing the workflow, and the five things it may never economise on

### Everything else — in the sections below.

---

## Sections

### [Overview](overview/README.md) — the platform in business terms
No stack knowledge required. Suitable for the association, funders, and new joiners on day one.

| | |
|---|---|
| [Purpose and context](overview/purpose-and-context.md) | Who this is for, what it replaces, and the constraints that follow |
| [Users and roles](overview/users-and-roles.md) | The six user classes and the shape of their access |
| [Business processes](overview/business-processes.md) | Registration, approval, scheduling, progress, grading, content, consent |
| [User journeys](overview/user-journeys.md) | Eight end-to-end paths, from a visitor's first click to a corrected Quran log |
| [Scope and roadmap](overview/scope-and-roadmap.md) | What launches, what is deliberately postponed, and why |
| [Glossary](overview/glossary.md) | Arabic and English terms, and the identifiers used throughout |

### [Architecture](architecture/README.md) — how the system is built
The technical core. Written for an engineer who has never seen the repository.

| | |
|---|---|
| [System overview](architecture/system-overview.md) | Containers, request path, single-tenant posture, the shape of the whole |
| [Backend](architecture/backend.md) | Layering, module map, transactions, error handling |
| [Frontend](architecture/frontend.md) | React structure, routing, adapters, state, accessibility |
| [API](architecture/api.md) | Contract governance, conventions, envelopes, pagination, versioning |
| [Database](architecture/database.md) | Schema, constraints, migrations, collation, concurrency |
| [Identity and access](architecture/identity-and-access.md) | OAuth, sessions, tokens, roles, branch scope, child context |
| [Security](architecture/security.md) | The posture as a whole — CSRF, CSP, existence leaks, PII, residency |
| [Storage](architecture/storage.md) | Dual-bucket MinIO, presigned URLs, immutable keys, consent gating |
| [Background jobs](architecture/background-jobs.md) | pg-boss, the job catalog, transactional enqueue |
| [Calendar and Hijri](architecture/calendar-and-hijri.md) | Scheduling, recurrence, wall-clock time, the official Hijri calendar |
| [Design system](architecture/design-system.md) | Tokens, the cascade, RTL, the visual language |
| [Internationalization](architecture/internationalization.md) | Arabic-only launch, RTL, native collation, i18n keys |
| [Performance and scale](architecture/performance-and-scale.md) | Targets, the design envelope, caching, what not to build |

### [Compliance](compliance/personal-data-audit.md) — personal data and the law
| | |
|---|---|
| [Personal data & CNDP readiness audit](compliance/personal-data-audit.md) | Every personal-data field: purpose, necessity, access, retention, and what needs a lawyer rather than an engineer |
| [Data-collection decision](compliance/data-collection-decision.md) | The recommended profile per person type, what to reject and why, and the decisions that block R62 |
| [R62 design decisions](compliance/r62-design-decisions.md) | The nine architectural questions the parent/child model turns on, resolved with their impact |

### [Operations](operations/README.md) — running it
| | |
|---|---|
| [Environments](operations/environments.md) | Development, staging, production — and the data-residency firewall |
| [Configuration](operations/configuration.md) | Every environment variable and runtime setting |
| [Deployment](operations/deployment.md) | The deterministic pipeline to the production VPS |
| [Observability](operations/observability.md) | Health checks, structured logs, what is alerted |
| [Resilience](operations/resilience.md) | Backup, restore, and behaviour when a dependency is down |
| [Runbooks](operations/runbooks.md) | Step-by-step procedures for the things that will actually happen |

### [Development](development/README.md) — contributing
| | |
|---|---|
| [Getting started](development/getting-started.md) | From clone to a running stack |
| [Conventions](development/conventions.md) | Layering, naming, TypeScript, commits |
| [Testing](development/testing.md) | The four layers, what each is for, and how to run them |
| [CI/CD](development/ci-cd.md) | Every gate, what it catches, and why it was added |
| [**Engineering constitution**](development/engineering-constitution.md) | **The laws every implementation must satisfy — required reading** |
| [Documentation policy](development/documentation-policy.md) | Documentation as part of Done — the workflow and per-change routing |
| [Engineering efficiency](development/engineering-efficiency.md) | Progress per unit of context — slicing, verification proportionality, and what efficiency may never buy |

### [Reference](reference/README.md) — lookup tables
| | |
|---|---|
| [Business rules](reference/business-rules.md) | BR-1 … BR-20, with where each is enforced |
| [Technical design constraints](reference/technical-design.md) | TD-1 … TD-16, with where each lives in the code |
| [API endpoints](reference/api-endpoints.md) | Every route, its audience, and its status |
| [Error codes](reference/error-codes.md) | The canonical catalogue and what a client should do with each |
| [Decision log](reference/decision-log.md) | Every specification revision, dated and summarised |

---

## The specification and its companions

| File | What it is | Mutable? |
|---|---|---|
| [`SRS.md`](SRS.md) | **The normative specification.** Revision 43.6 | Document Owner only |
| [`SRS-PROPOSAL-R44.md`](SRS-PROPOSAL-R44.md) | **Draft revision awaiting the Document Owner** — the completion-report format. Delete once applied or rejected | Contributors may draft; only the Owner applies |
| [`SRS-PROPOSAL-R45.md`](SRS-PROPOSAL-R45.md) | **Draft revision awaiting the Document Owner** — one endpoint, role-scoped. **The behaviour is already live**, so rejecting this one requires a code change | Contributors may draft; only the Owner applies |
| [`SRS-PROPOSAL-R46.md`](SRS-PROPOSAL-R46.md) | **Draft revision awaiting the Document Owner** — reference-data selectors in TD-3. **The endpoints are already live**, on the Owner's explicit instruction | Contributors may draft; only the Owner applies |
| [`SRS-PROPOSAL-R47.md`](SRS-PROPOSAL-R47.md) | **Draft revision awaiting the Document Owner** — curriculum taxonomy CRUD in TD-3, and how a Level's deletion meets TD-4.6b. **The endpoints are already live** | Contributors may draft; only the Owner applies |
| [`SRS-PROPOSAL-R48.md`](SRS-PROPOSAL-R48.md) | **Draft revision awaiting the Document Owner** — user management in TD-3, and whether `super_admin` is grantable through the application. **The endpoints are already live** | Contributors may draft; only the Owner applies |
| [`SRS-PROPOSAL-R49.md`](SRS-PROPOSAL-R49.md) | **Draft revision awaiting the Document Owner** — staff registration requests and role assignment at approval. **No endpoint was added**; three contracts gained an optional field each | Contributors may draft; only the Owner applies |
| [`SRS-PROPOSAL-R58.md`](SRS-PROPOSAL-R58.md) | **APPLIED to `SRS.md`** (2026-08-09). An Exam has a mode; a physical exam is scheduled. Supersedes §4.6's digital-only rule and narrows exam independence | Superseded by the SRS |
| [`SRS-PROPOSAL-R57.md`](SRS-PROPOSAL-R57.md) | **APPLIED to `SRS.md`** (2026-08-09). A Course Schedule carries its own name. Retained for why the Subject was not already one, and why a required column still arrived nullable | Superseded by the SRS |
| [`SRS-PROPOSAL-R56.md`](SRS-PROPOSAL-R56.md) | **APPLIED to `SRS.md`** (2026-08-06). One Scheduling page with a List and a Calendar view. Retained for why the models stay separate and why the event categories are **not** a column | Superseded by the SRS |
| [`SRS-PROPOSAL-R55.md`](SRS-PROPOSAL-R55.md) | **APPLIED to `SRS.md`** (2026-08-06). Dependent selection everywhere, the split taxonomy nodes, the Users columns, and R50's recurrence bound reaching the contract. Retained for the **curriculum inconsistency found while implementing** | Superseded by the SRS |
| [`SRS-PROPOSAL-R54.md`](SRS-PROPOSAL-R54.md) | **DRAFT — awaiting the Document Owner.** Account deletion, self-deletion, and permanent deletion from the Trash. Not applied: it reverses R52's explicit prohibition, and `User` restore is a milestone-sized dependency | Pending decision |
| [`SRS-PROPOSAL-R53.md`](SRS-PROPOSAL-R53.md) | **APPLIED to `SRS.md`** (2026-08-06). Content replacement and deletion get a contract. Retained for why replacement extends the upload flow instead of becoming a route of its own | Superseded by the SRS |
| [`SRS-PROPOSAL-R52.md`](SRS-PROPOSAL-R52.md) | **APPLIED to `SRS.md`** (2026-08-05) with the Owner's amendment — ship now with **per-entity** restore capability rather than deferring restore wholesale. Retained for the cascade analysis | Superseded by the SRS |
| [`SRS-PROPOSAL-R51.md`](SRS-PROPOSAL-R51.md) | **APPLIED to `SRS.md`** (2026-08-05). Retained for the rationale — what could not be shared between the two scheduling screens, and why | Superseded by the SRS |
| [`SRS-PROPOSAL-R50.md`](SRS-PROPOSAL-R50.md) | **APPLIED to `SRS.md`** (2026-08-05, Owner-authorised direct edit). Retained for the rationale — the rejected exception model and the implementation traps — which the specification states as rules rather than arguments | Superseded by the SRS |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | Milestone build order | Document Owner only |
| [`TASKS.md`](TASKS.md) | Granular delivery checklist — the fastest read on what is done | Contributors |
| [`CHANGES.log`](CHANGES.log) | Append-only ledger of what was built and why | Contributors, append-only |
| [`openapi.json`](openapi.json) | The API contract | **Generated — never hand-edited** |

### [`archive/`](archive/) — historical snapshots

[`archive/2026-07-29-pre-restructure/`](archive/2026-07-29-pre-restructure/) is a
byte-exact copy of every document as it stood before this hierarchy existed, with
checksums. It makes *"nothing was lost"* checkable rather than merely asserted. It is
never updated, and the live documents always win.

---

## Conventions used throughout

**Identifiers.** `§4.3` is a section of the SRS. `BR-x` is a business rule (§12). `TD-x`
is a technical design constraint (§13). `R31` or "Revision 31" is a numbered specification
revision (§0). These are stable — code comments and commit messages cite them, so any
behaviour traces back to the clause that requires it.

**Arabic.** Entity names, user-facing text, and the association's own vocabulary appear in
Arabic, with a translation on first use. The interface is Arabic-only and RTL at launch;
that is a product decision, not an omission ([why](architecture/internationalization.md)).

**"Deliberately not."** Where a document says something was *rejected* or is *deliberately
absent*, that is load-bearing. It records a decision someone already made with context you
may not have, and re-adding the thing is a specification question, not a code change.
