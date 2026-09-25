[Documentation](../README.md) › [Development](README.md) › **Getting started**

# Getting started

**Prerequisites:** Docker + Compose v2 · Node 24.11 (`.nvmrc`; host-side tests/tooling only) · Google OAuth client credentials for anything touching login.

## Run the stack
```bash
cp .env.example .env && cp infra.env.example infra.env   # fill Required values; the Postgres password must match DATABASE_URL
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db minio
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm api npx prisma migrate deploy
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm api npm run seed:production
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
curl --fail-with-body -sS --max-time 15 http://localhost/healthz
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm api npm run seed:fixtures   # dev data; refuses NODE_ENV=production
```
- Always both compose files. The dev overlay is deliberately not `docker-compose.override.yml` (deployment must never merge it); it publishes PostgreSQL on `127.0.0.1:5433` and MinIO on `9001` — not 5432, so a host Postgres can never be silently hit instead.
- Rebuilding the api after a code change: `exec -T api npm run --silent ops:active-recordings </dev/null` → `build api` → `up -d --no-deps api` → wait for `/healthz` 200 → `exec -T api npx prisma migrate deploy` → `cd frontend && npm run build` (nginx serves `frontend/dist`).

## Everyday commands
| Where | Commands |
|---|---|
| `backend/` | `npm run lint` · `npm run typecheck` · `npm test` · `npm run openapi:generate` · `npm run seed:fixtures` |
| `frontend/` | `npm run lint` · `npx tsc --noEmit -p .` · `npx vitest run` · `npm run dev` · `npm run build` |
| root | integration on a disposable stack: `FFMPEG_PATH=/usr/bin/ffmpeg bash scripts/ci/test-integration.sh src/<file>.integration.test.ts` (against the running dev stack: `bash scripts/dev/test-integration.sh`) · guards: `for g in scripts/ci/check-*.sh; do bash "$g"; done` · seed drill: `PRODUCTION_SEED_DESTRUCTIVE_FIXTURE=1 bash scripts/seed/verify-production-seed.sh` · screenshots: `bash scripts/dev/browser/shoot-pages.sh` |

Tests live beside the code: `*.test.ts` (unit) · `*.integration.test.ts` (database) · `*.http.integration.test.ts` (HTTP surface) · `scripts/dev/browser/verify-*.sh` (real Chrome over CDP).

## First change, end to end
`TASKS.md` + `tail CHANGES.log` → read only the cited §/BR/TD → silent or contradictory: stop and ask → implement within the [layering](conventions.md#layering) → tests asserting the property → docs in the same commit ([policy](documentation-policy.md)) → regenerate the contract if a route moved → guards → `CHANGES.log` entry, `TASKS.md` row removed → atomic commit citing the clause.

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `PrismaClientValidationError` that reads like a logic bug; editor says a model/column does not exist while typecheck is green | stale Prisma client — `npx prisma generate` |
| Migration checksum mismatch | a migration was edited after being applied — repair the recorded checksum, never reset the database |
| Integration tests cannot reach the database | dev overlay not up, or 5433 taken |
| `SignatureDoesNotMatch` on storage | the `/storage/` location no longer strips the prefix / rewrites `Host` consistently with the signed endpoint |
| A test passes but the change is not there | the container runs old code — rebuild the image; a passing test on a stale container proves nothing |
| Postgres refuses to start | PG 18 mounts the volume at `/var/lib/postgresql`, not `/data` |
| `timeout dc …` exits 0 doing nothing | `dc` is GNU dc under `timeout`; spell out `docker compose -f … -f …` |

## Fails review
Business logic in a controller · Prisma from a service · a new dependency without approval · a hardcoded user-facing string · a raw colour or a primitive token in a component · `prisma db push` · a route absent from the generated contract · a page missing empty/error/no-permission · docs not in the same commit.

**Next:** [conventions](conventions.md) · **Related:** [testing](testing.md), [environments](../operations/environments.md)
