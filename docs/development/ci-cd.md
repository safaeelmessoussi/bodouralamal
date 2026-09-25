[Documentation](../README.md) › [Development](README.md) › **CI/CD**

# CI/CD

`.github/workflows/ci.yml` on every push to `develop`: **guards · contract · backend · integration · frontend · seed-drill · production-smoke · release-images** (8 jobs; release waits for every gate). A red gate stops promotion.

## Guards (`scripts/ci/check-*.sh`) — each proven by reintroducing its bug
| Guard | Fails on |
|---|---|
| `check-env-not-committed` | an `.env` committed; the template dropping `NODE_ENV` |
| `check-no-db-push` | `prisma db push` anywhere (drops hand-written SQL) |
| `check-migrations` · `check-migration-order` (+ selftest) · `check-migration-drop-rename` | hand-written SQL missing; a migration using a column a later one adds; DROP/RENAME without justification |
| `check-prisma-mass-write` | a mass write skipping soft-delete filtering |
| `check-contract-dto` | a service result handed to `res.json`; a spread in `dto.ts` |
| `check-openapi-td3` · `check-openapi-current` | an endpoint contradicting/absent from TD-3; `openapi.json` not describing the served API |
| `check-no-local-clock` | backend reading the process's local clock |
| `check-display-identity` · `check-active-role-presentation` · `check-association-terminology` · `check-western-digits` | raw names in the frontend; UI reading the full role list; superseded Arabic vocabulary; Arabic-Indic digits |
| `check-design-tokens` · `check-header-nav-exclusive` · `check-dialog-hidden-when-closed` · `check-progress-css` · `check-shared-layout` · `check-logo-alpha` | raw CSS values / primitive tokens / unimported sheet; burger + nav both visible; closed dialog rendering; direction-blind progress; page-header or button system redefined; matted logo |
| `check-security-headers` · `check-storage-edge` · `check-provider-seam` | an Nginx location dropping HSTS; MinIO reached outside the proxy policy; provider details escaping the seam |
| `check-backup-tooling` · `check-release-artifacts` · `check-host-preflight` · `check-compose-operations` | floating restic image / unsafe restore; release able to precede a green gate or lacking the exact commit tag; loss of the host preflight; unbounded logs or missing health probes |
| `check-doc-links` | broken relative link or missing anchor (§16.4, §19.2) |
| `scripts/backup/test_*.py` | the backup scripts' own unit tests (12) |

Locally: `for g in scripts/ci/check-*.sh; do bash "$g" || echo "FAILED: $g"; done`.

## Contract job (order matters)
1 `npm run openapi:generate` (from the live Express router — fails on documented-but-unmounted or served-but-undocumented) → 2 `git diff --exit-code docs/openapi.json` → 3 `check-openapi-current.sh` (same question, runnable locally — added after the file went stale a week with 24 unmapped endpoints while every guard was green) → 4 `check-openapi-td3.sh`. Lesson: a guard on the committed artifact is not a guard that the artifact is current.

## Integration job
`scripts/ci/test-integration.sh` builds a uniquely named disposable Compose project (base graph + `scripts/ci/fixtures/docker-compose.integration.yml`; loopback ports; fixture-only credentials; all migrations; production + fixture seeds; waits for the real health contract), runs `scripts/test/run-integration-suite.sh` — which digests every table before/after and fails on residue — and always tears the project down. Never a shared database.

## Not yet in CI (each a dedicated task — `TASKS.md` E3/E6)
Generated permission-matrix tests · authenticated E2E journeys · ≥80 % coverage gate on services/policies · `TD3_REQUIRE_COMPLETE=1` · `verify-backup-restore.sh`.

## Release flow (Owner, 2026-08-25)
`develop` → CI on a clean checkout → deploy **that exact commit** to Staging → Staging acceptance → (when Production exists) deploy the same commit → smoke. Each gate sees what the previous cannot: clean checkout (stale `node_modules`/Prisma client/containers), Staging (real TLS, headers on the wire, memory ceilings, worker registration, the storage edge). The host checks out the commit detached; both images carry it in their revision label — nothing overtakes it.

## Deployment
No automatic deploys. A green push publishes the backend and web images to GHCR under the 40-char SHA (no `latest`; the workflow holds no host/DNS/TLS/OAuth/DB credential). The host pulls that tag via `docker-compose.release.yml` + exactly one tier overlay, `--no-build` (the ~2 GB frontend build never runs on a host). → [deployment](../operations/deployment.md).

## Adding a guard
Script in `scripts/ci/` → reintroduce the bug, see red → revert, see green → wire it with a name that says the rule → row here. Shell traps already met: `grep -q` inside a pipeline under `pipefail` reports «not found» on found (capture first, then match); `printf '%s'` without `\n` concatenates a loop's output. When a guard reports «everything» or «nothing», suspect the harness first.

**Related:** [testing](testing.md) · [deployment](../operations/deployment.md) · [environments](../operations/environments.md)
