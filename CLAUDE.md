# Bodour Al Amal — agent guide

React frontend, Express/Prisma backend, PostgreSQL, MinIO/S3 and pg-boss.
This is the shared working guide; `AGENTS.md` bridges agents that do not load it.
Neither file overrides [docs/SRS.md](docs/SRS.md) (§16.3).

## Start here

1. Check branch, HEAD, status and the complete in-progress diff. Preserve inherited
   work; do not restart it from committed HEAD.
2. Read the current section of [TASKS](docs/TASKS.md) and the latest entries in
   [CHANGES](docs/CHANGES.log) (start with `tail -n 100 docs/CHANGES.log`; search
   earlier entries only for this task). [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md)
   owns milestone order; only the Document Owner re-sequences it.
3. Read SRS **§20 once per session** and the clauses relevant to this task.
   Never read the entire SRS unless explicitly asked. It is immutable to agents:
   if wrong, silent or contradictory, stop the decision-dependent work and report
   the smallest question to the Document Owner. Do not choose product policy.
4. Before implementation, identify and read the affected handbook pages through
   [docs/README](docs/README.md). Before production code, read the
   [engineering constitution](docs/development/engineering-constitution.md),
   audit every principle, and verify compliance at completion; justify exceptions.
   For UI work, also read the relevant
   [UX rules](docs/development/ux-architecture.md).
5. Read the [efficiency policy](docs/development/engineering-efficiency.md) and
   [documentation policy](docs/development/documentation-policy.md) once per session.
   Reuse established evidence; focused checks while editing, full established
   gates once at the coherent boundary. Keep commands bounded and diagnose hangs.

## Repository map and authority

| Area | Canonical location |
|---|---|
| Backend | `backend/src/{controllers,services,repositories,policies,validators,jobs,lib}`; HTTP → service transaction → repository |
| Frontend | `frontend/src/main.tsx`, `lib/route.ts`, portal registries; pages compose shared components/hooks and call adapters |
| Database | `backend/prisma/schema.prisma`, append-only `migrations/`, `seed/` |
| Infrastructure | Root `docker-compose*.yml`, `nginx/`, package Dockerfiles, `scripts/deploy/` and `scripts/backup/` |
| Tests | Colocated `*.test.ts(x)`; `backend/src/test-support/`; `scripts/test/`; Chrome/CDP in `scripts/dev/browser/` |
| Requirements / current architecture | SRS clauses/BRs/TDs; [architecture index](docs/architecture/README.md) routes to the relevant handbook |
| Security, privacy, domain decisions | SRS TD-2/TD-12/TD-14; [security](docs/architecture/security.md), [identity/access](docs/architecture/identity-and-access.md), [compliance](docs/compliance/personal-data-audit.md); domain pages via docs index |
| API | SRS TD-3 → `scripts/ci/td3-routes.txt`; `backend/scripts/generate-openapi.ts` generates tracked `docs/openapi.json`; never hand-edit generated output |
| Generated locally, not tracked | `backend/src/generated/prisma/`, both `dist/`, coverage and `*.tsbuildinfo`; package lockfiles remain tracked |

Do **not** load `docs/archive/`, dated `audit-*.md`, `SRS-PROPOSAL-*.md`,
the full CHANGES ledger, completed TASKS sections or old SRS revisions by default.
They preserve provenance, not an alternative current contract. Read them when the
task references that decision, migration or unresolved question. Do not delete
history or assume an old proposal's status describes today's implementation.

## Safe implementation

- No destructive Git, reset/stash/clean of inherited work, history rewriting or
  force push. Never modify `baseline/pre-codex-r100`.
- No Staging/Production deployment, infrastructure, DNS, secrets or data mutation
  without explicit Owner authorization. Never reset/reseed/clean Owner-populated
  localhost to make tests pass. Prefer disposable integration infrastructure.
- Never commit secrets or log credentials, PII or request bodies. Preserve applied
  migrations, audit/legal history and exact-key storage obligations.
- Keep HTTP in controllers, explicit transactional business operations in services,
  and data access in repositories (§16.2). Never bypass repositories. The server
  owns authorization, visibility, Hijri values and public display identity.
- PostgreSQL CHECKs, ICU collations, partial indexes and triggers belong in
  hand-written migration SQL, not Prisma schema syntax. Never run `prisma db push`.
- Routes use TD-3.8 unified errors; keep TD-3, generated OpenAPI and implementation
  synchronized. Do not remove a check solely because another layer looks similar.

## Verify, document, hand off

Canonical commands, focused-test examples and safe harness selection:
[Testing — Running them](docs/development/testing.md#running-them).
The exact final job set is [.github/workflows/ci.yml](.github/workflows/ci.yml);
[CI/CD](docs/development/ci-cd.md) explains the gates.

Documentation is part of Done (§16.4): update affected docs in the **same commit**,
cite their canonical source rather than restating it, append the completed output
to `docs/CHANGES.log`, and tick `docs/TASKS.md`. Documentation drift is a defect.
Run `bash scripts/ci/check-doc-links.sh` and `git diff --check`.
Commit coherent sections atomically, push completed work to `develop`, verify the
exact hosted run when required, and leave a clean synchronized worktree.

Report in six sections, in order: **user-visible changes · engineering highlights ·
documentation updates · additional defects discovered · verification · remaining work**.
Use the compact [reporting guidance](docs/development/README.md#reporting-completion);
name skipped checks and why. Do not broaden a completed task into another milestone.
