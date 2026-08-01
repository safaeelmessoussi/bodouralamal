[Documentation](../README.md) › [Development](README.md) › **Getting started**

# Getting started

## Prerequisites

- **Docker** with Compose v2
- **Node.js 24.11.0** — pinned in `.nvmrc`; needed only for tests and tooling on the host
- **Google OAuth client credentials** — for anything touching login

## Run the stack

```bash
git clone <repository-url> && cd bodouralamal

cp .env.example .env            # every Required value must be filled
cp infra.env.example infra.env  # the Postgres password — must match DATABASE_URL

docker compose up -d db minio
docker compose run --rm api npx prisma migrate deploy
docker compose run --rm api npm run seed:production
docker compose up -d

curl http://localhost/healthz   # expect 200, all components green
```

Then load development fixtures so there is something to look at:

```bash
docker compose run --rm api npm run seed:fixtures
```

Fixtures **refuse to run when `NODE_ENV=production`** — the same guard is the data-residency
firewall.

## The development overlay

Host-run integration tests need to reach PostgreSQL directly, and the base compose file
deliberately does not publish its port:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

It is **not** named `docker-compose.override.yml` on purpose, so Compose cannot merge it
automatically — the deployment steps run a plain `docker compose up -d` and must never pick
it up.

Ports bind to `127.0.0.1` only, on **5433** (PostgreSQL) and **9001** (MinIO), because a host
PostgreSQL commonly occupies 5432 and **a silent connection to the wrong database is far
worse than a port clash.**

## Everyday commands

```bash
# Backend — from backend/
npm run lint
npm run typecheck
npm test                    # unit tests, no stack required
npm run seed:fixtures
npm run openapi:generate    # regenerate the API contract

# Frontend — from frontend/
npm run lint
npm run typecheck
npm test
npm run dev                 # Vite dev server
npm run build

# Integration tests — from the repository root, with the stack up
bash scripts/dev/test-integration.sh

# The CI guards — from the repository root
for g in scripts/ci/check-*.sh; do bash "$g" || echo "FAILED: $g"; done
```

Current totals: **102 backend unit · 498 integration · 135 frontend**.

## Your first change, end to end

1. **Read the state.** `docs/CHANGES.log` (most recent entries) and `docs/TASKS.md`.
2. **Find your authority.** The task names a `§`/`BR-x`/`TD-x`. Read **that section only** —
   the specification is cross-referenced precisely so you do not read it whole.
3. **If it is silent or contradictory — stop and ask.** Do not pick a reading.
4. **Implement**, respecting the [layering](conventions.md#layering).
5. **Test** — including the one that asserts the security property rather than the code path.
6. **Update the documentation** in the same commit
   ([policy](documentation-policy.md)).
7. **Regenerate the contract** if you touched a route.
8. **Run the guards.**
9. **Record it** in `CHANGES.log`; tick `TASKS.md`.
10. **Commit atomically**, citing the clause, and push to `develop`.

## Where things are

```
backend/src/
  controllers/   HTTP only
  services/      business logic, transactions
  repositories/  all database access
  policies/      permission checks
  lib/           shared primitives
frontend/src/
  pages/  components/  adapters/  contexts/  i18n/  styles/
scripts/ci/      the guard scripts
docs/            this documentation, and the specification
```

Tests live **beside** the code: `*.test.ts` (unit), `*.integration.test.ts` (needs a
database), `*.http.integration.test.ts` (drives the HTTP surface).

## Troubleshooting

| Symptom | Cause |
|---|---|
| `PrismaClientValidationError` that reads like a logic bug | **A stale Prisma client after a schema change.** Run `npx prisma generate`. This has cost time twice |
| Migration checksum mismatch | A migration file was edited after being applied. **Repair the recorded checksum** — do not reset the database |
| Integration tests cannot reach the database | The dev overlay is not up, or something else holds 5433 |
| `SignatureDoesNotMatch` on storage | The `/storage/` location stopped stripping the prefix or rewriting `Host` consistently with the signed endpoint |
| The container runs old code | The image did not rebuild. Verify the change actually shipped before concluding anything from a test result |
| Postgres refuses to start | The volume is mounted at `/var/lib/postgresql/data`. **PG 18+ requires `/var/lib/postgresql`** |

That last-but-one row is worth internalising: **a passing test on a stale container proves
nothing.** Three false negatives in this project traced to exactly that.

## Things that will fail review

- Business logic in a controller
- Prisma called from a service
- A new dependency added without approval
- A hardcoded user-facing string instead of an i18n key
- A raw colour or a reach past the semantic token layer
- `prisma db push`, in any form
- A route that is not in the generated contract
- A page missing its empty, error, or no-permission state
- **Documentation not updated in the same commit**

---

**Next:** [Conventions](conventions.md) · **Related:**
[Testing](testing.md), [Environments](../operations/environments.md)
