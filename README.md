# منصة بذور الأمل — Bodour Al-Amal Platform

Management platform for the learning institute run by **جمعية بذور الأمل** (Bodour Al-Amal), a
Moroccan educational association based in Marrakesh. The institute offers Quran memorization,
Islamic studies, and adult literacy to women, teens, and children.

The association currently runs on paper and spreadsheets. This platform replaces manual scheduling,
account approvals, and grade tracking for its first live branch cohort. The interface is
**Arabic-only and RTL-first**; it is sized for roughly 900 users at launch against a 5,000-user
design ceiling, deployed to a single Moroccan VPS.

> **Status: under active development.** A pre-MVP site is publicly live at
> **[bodouralamal.com](https://bodouralamal.com)**. Milestones M0 and M1 are essentially complete and
> M2 is in progress; M3–M8 have not been started. See [Current state](#current-state) for exactly
> what runs, and [Live pre-MVP site](#live-pre-mvp-site) for what is deployed.

---

## The specification is the source of truth

This repository is built **specification-first**. [`docs/SRS.md`](docs/SRS.md) is the authoritative
requirements document; the code conforms to it, not the other way around.

- The SRS is **immutable to contributors and agents.** It changes only through a numbered revision
  approved by the Document Owner. It is currently at **Revision 24**.
- Every section is cross-referenced by stable identifiers — `§4.3` for sections, `BR-x` for business
  rules, `TD-x` for technical-design constraints. Code comments and commit messages cite them, so
  any behaviour can be traced to the clause that requires it.
- Where the SRS is silent or self-contradictory, the rule is to **stop and escalate**, not to invent
  behaviour. Resolved ambiguities become revision entries in §0 of the SRS.

Three companion documents are mutable working artifacts that never override the SRS:

| File | Purpose |
|---|---|
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Milestone build order |
| [`docs/TASKS.md`](docs/TASKS.md) | Granular checklist; the fastest way to see what is done |
| [`docs/CHANGES.log`](docs/CHANGES.log) | Append-only record of what was built, and why |

`docs/openapi.json` is **generated**, never hand-edited — see [API contract](#api-contract).

---

## Architecture

A single-tenant application, deliberately without a tenancy layer (SRS Revision 11).

```
                    ┌──────────────────── Nginx (same origin) ─────────────────────┐
   browser  ──TLS──▶│  /            → static client bundle                          │
                    │  /api/v1/     → api        (Node + Express)                   │
                    │  /storage/    → minio      (SigV4 presigned PUT/GET)          │
                    └──────────────────────────────────────────────────────────────┘
                                          │                    │
                                    ┌─────▼─────┐        ┌─────▼─────┐
                                    │ PostgreSQL│        │   MinIO   │
                                    │  (+pg-boss│        │ public /  │
                                    │   queue)  │        │ private   │
                                    └───────────┘        └───────────┘
```

Everything is served from **one origin**, so the client never makes a cross-origin request and no
CORS allow-listing exists anywhere, in any environment.

**Layering is enforced** (SRS §16.2): controllers hold HTTP concerns only, services own business
logic and transaction boundaries, and repositories are the sole data-access layer. Raw SQL in
application code is restricted to row locks and same-transaction job inserts.

### Authentication and authorization

- **Google OAuth is the only identity provider.** No passwords exist anywhere in the system.
- Access tokens are carried **only** in the `Authorization` header, never in a cookie, which makes
  ordinary API mutations structurally immune to CSRF. `POST /auth/refresh` is the single
  cookie-authenticated route and requires a custom header plus an `Origin` match.
- Refresh tokens are stored **hashed, never raw**, and rotate on every use, with reuse outside a
  short grace window revoking the entire session chain.
- **Authorization is branch-scoped, and that is the sole axis** (§4.2). A user may hold the same
  role several times, each assignment scoped to one branch, several, or all of them. Scope resolves
  **per role** — a Teacher in Casablanca who is also an Admin in Marrakesh does not thereby
  administer Casablanca. Teachers derive teaching access exclusively through group assignment.
- High-risk endpoints **re-read the caller from the database on every request** rather than trusting
  an unexpired token, so suspending an account or revoking a role takes effect immediately.
- Access to a minor's data flows through an approved family link, verified per request via the
  `X-Active-Child-ID` header against **both** the authenticated parent and the child. Every failure
  mode returns an indistinguishable `404`, so responses cannot be used to probe which children exist.

---

## Current state

Accurate as of Revision 24. Counts are items in [`docs/TASKS.md`](docs/TASKS.md).

| Milestone | Status |
|---|---|
| **M0 — Bootstrap** | Complete (5/5) |
| **M1 — Infrastructure & Platform Core** | 29 done, 3 partial, 2 open |
| **M2 — Registration, Approvals, Family** | 4 done, 5 partial, 5 open |
| **M3–M8** | Not started |

"Partial" items name which dimension is finished — backend, tests, security verification, or
frontend — because *partial* alone hides whether the remaining risk is unwritten code or an unbuilt
screen.

### What runs today

**Backend endpoints** (45 operations across 33 paths; the full contract, including the TD-3.8 error
envelope schema, is in [`docs/openapi.json`](docs/openapi.json)):

- `GET /healthz` — component health for database, storage, and job queue
- `GET /auth/google`, `GET /auth/google/callback`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`
- `POST /registrations` — unified parent + child registration in one transaction
- `GET /admin/approvals`, `POST /admin/approvals/{id}/approve|reject`
- `POST /family-links`, `DELETE /admin/family-links/{id}`
- `GET`/`POST`/`PATCH /admin/users` — user management and staff pre-provisioning
- `GET`/`PUT /students/{id}/social-profile`, `GET`/`POST /students/{id}/consents`
- Branch and room CRUD under `/admin/branches` and `/admin/rooms`
- `GET`/`POST`/`PATCH`/`DELETE /admin/groups` — timetable, room/time conflict detection, capacity
- `GET`/`POST`/`DELETE /admin/groups/{id}/roster` and `.../instructors` — enrolment and co-teaching
- `POST`/`PATCH`/`DELETE /events`, `GET`/`POST /admin/branches/{id}/event-backfill`
- `GET /calendar` — **the one public endpoint**: anonymous callers get the public tier
- `GET`/`PUT`/`POST /admin/hijri-calendar/...` — recording the Ministry's official Hijri announcements

**Frontend:** a public shell only — landing page, login, the OAuth error states, and the account
status screens. **There are no authenticated screens yet**, so the endpoints above currently have no
UI driving them.

**Not started:** Quran progress tracking (M4), exams and grading (M5), and content/consent/storage
workflows (M6). Scheduling, the calendar and the Hijri overlay are complete on the backend.

### Live pre-MVP site

A **pre-MVP** site is publicly live at **[bodouralamal.com](https://bodouralamal.com)** — an Arabic,
RTL single-page client served over HTTPS.

It is a **front-end deployment only.** The platform API described above is not served there: every
path, including `/api/v1/healthz`, returns the same client shell. Nothing on the live site is backed
by the endpoints listed above, and no beneficiary data is held there.

The full stack — API, PostgreSQL, MinIO, and the job queue — currently runs only in local
development. Production deployment of the platform itself follows SRS §19.1 and lands with the
milestones above.

---

## Getting started

### Prerequisites

- Docker with Compose v2
- Node.js **24.11.0** (pinned in `.nvmrc`) — needed only to run tests and tooling on the host
- Google OAuth client credentials

### Run the stack

```bash
git clone <repository-url> && cd bodouralamal

cp .env.example .env          # application config; every Required value must be filled
cp infra.env.example infra.env # container bootstrap credentials (Postgres password)

docker compose up -d db minio
docker compose run --rm api npx prisma migrate deploy
docker compose run --rm api npm run seed:production
docker compose up -d

curl http://localhost/healthz   # expect 200 with all components green
```

The Super Admin then performs their first Google login, which binds the identity to the
pre-provisioned account.

> **Deploying to the production VPS differs in one step:** images are **built in CI and pulled**,
> never built on the server. The frontend build peaks near 2 GB, which would exhaust a 4 GB box
> already running PostgreSQL, MinIO, and Node. The full pipeline is SRS §19.1.

The first deployment also needs `SUPER_ADMIN_EMAIL` set: the seed grants that Google address the
Super Admin role, and the account binds to the identity on its first login. It is a **bootstrap-only
value** — once an active Super Administrator exists it is ignored permanently and may be removed,
after which administrators are managed entirely through the application.

Boot validation fails fast and by name on any missing required variable, so a misconfigured
deployment stops immediately rather than failing later inside a request.

### Development

Local development publishes database and storage ports to loopback through an explicit overlay,
which is opt-in so that the production compose command can never pick it up by accident:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

```bash
# Backend (run from backend/)
npm run lint • npm run typecheck • npm test        # unit tests, no stack required
npm run seed:fixtures                              # development fixtures; refuses to run in production
npm run openapi:generate                           # regenerate the API contract

# Integration tests — from the repository root, with the stack up
bash scripts/dev/test-integration.sh
```

The integration suite runs against a **real** PostgreSQL, MinIO, and Nginx rather than mocks,
because the properties it checks — transaction atomicity, constraint enforcement, presigned-URL
signatures surviving the proxy — do not exist in a mock. It runs serially, since the suites share one
database.

Current totals: **89 unit tests and 460 integration tests**.

---

## API contract

`docs/openapi.json` is generated from the implementation and is **never hand-edited**. CI enforces
this in both directions:

1. It regenerates the document and fails if the committed copy differs.
2. Generation walks the **live Express router** and fails on any operation that is documented but not
   served, or served but not documented.
3. A conformance check compares the result against the SRS endpoint registry, failing on any endpoint
   that contradicts the SRS or is implemented without documentation.

Rule 2 exists because it was needed: a route was once added to both the registry and the contract
while never being mounted, and every gate passed while the endpoint returned `404`.

Endpoints documented in the SRS but not yet built report as `PENDING` until their milestone lands.

---

## Repository layout

```
backend/
  prisma/           schema, migrations (including hand-written SQL), seeds
  src/
    controllers/    HTTP layer only — no business logic
    services/       business logic, transaction boundaries, state machines
    repositories/   all database access; the single mandated data-access layer
    policies/       permission and scope checks
    validators/     Zod schemas mirroring the SRS validation limits
    middleware/     auth, child context, request id, error envelope
    jobs/           pg-boss handlers
    lib/            storage, OAuth, tokens, config, search normalization
frontend/src/       React client — i18n, contexts, components, pages
nginx/              same-origin routing, TLS, rate limits, storage proxy
scripts/ci/         guard scripts run by CI
docs/               SRS and companion documents
```

## Conventions

- **Migrations are forward-only** and generated with `--create-only` so constraints can be written by
  hand. `prisma db push` is banned and CI enforces it; direct renames are prohibited.
- **Soft deletes** everywhere, with a snapshot written for restoration.
- **Every mutation of consequence writes an audit row**, and who/when/why must be reconstructable
  from the audit trail alone.
- **Arabic text is natively collated** (`ar-x-icu`) in the database, and search runs against indexed
  normalized shadow columns that fold Arabic diacritics, alef variants, and French accents.
- **Every user-facing string is an i18n key.** No hardcoded UI text.
- Commits are small and atomic, cite the SRS clause they implement, and land on `develop`.

## Technology

| | |
|---|---|
| Runtime | Node.js 24.11.0, TypeScript 6.0.3 |
| Backend | Express 5.2.1, Prisma 7.9.0 (`@prisma/adapter-pg`), Zod 4.4.3, pg-boss 12.26.2 |
| Frontend | React 19.2.8, Vite 8.1.5 |
| Data & storage | PostgreSQL 18.4, MinIO |
| Edge | Nginx stable-alpine, Certbot |
| Testing | Vitest 4.1.10 |

Dependency majors and minors are locked; during active development only patch-level updates are
permitted, each in its own commit with a stated reason and a full CI run.

## Contributing

Read [`CLAUDE.md`](CLAUDE.md) or [`AGENTS.md`](AGENTS.md) first — they carry the binding working
agreement for this repository, including the SRS guardrails in §20.

The short version: consult only the SRS sections you are implementing, never edit the SRS, tick
`docs/TASKS.md` as work completes, record what you built in `docs/CHANGES.log`, and **stop and ask
when the specification is silent or two clauses conflict** rather than guessing.
