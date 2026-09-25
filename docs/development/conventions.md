[Documentation](../README.md) › [Development](README.md) › **Conventions**

# Conventions

Binding; several are CI-enforced.

## Layering
| Layer | Owns | Never |
|---|---|---|
| `controllers/` | HTTP: Zod validation, one service call, response shaping | business logic (unreachable from jobs/other endpoints → gets copied) |
| `services/` | business logic, TD-4 transactions, TD-1 state machines, permission enforcement, audit writes | Prisma directly (soft-delete filtering must be by construction) |
| `repositories/` | the sole data access; uniform soft-delete filtering | — |
→ [backend § layering](../architecture/backend.md#layering)

## Code
- **TypeScript strict**; no `any` in services/repositories. Errors are typed domain errors mapped centrally to the TD-3.8 envelope — no ad-hoc `res.status()`.
- **Naming:** `camelCase` variables/functions · `PascalCase` components/classes/types · `snake_case` DB columns and JSON fields · `kebab-case` files and API paths. UUID primary keys (exception: Surah 1–114).
- **Validation:** Zod at every API boundary is the single home of field limits; constants shared with the frontend.
- **Raw SQL:** migrations; in app code only inside repositories for `SELECT … FOR UPDATE` and job-row inserts via `JobsRepository`.
- **i18n:** every user-facing string is a key in `frontend/src/i18n/ar.ts` (the Owner's catalogue).
- **Styling:** semantic tokens only; a new component = a file + a line in `styles.css` (import order is the cascade); verify with `css-resolve.py` + built-CSS diff + `shoot-pages.sh`. → [design-system](../architecture/design-system.md), [`design.mmd`](../../design.mmd)
- **Comments** explain *why* and what was rejected, not what the code does.

## Versions
- **Phase 1 (now):** patch updates only, each in its own commit stating the reason (bug, CVE, compatibility), full CI re-run, version tables updated, `CHANGES.log` row. Never an unprompted side effect. Minor/major upgrades and new frameworks/infra need Owner approval.
- **Phase 2 (freeze):** digests locked, lockfiles regenerated, dependency/security review, RC cut; then even a patch is an approved task.
- **Floors:** Node 22 LTS · PostgreSQL 17 · Prisma 6 · React 19 · Vite 6 · Express 5 · TypeScript 5 strict · pg-boss 10. React + Vite only — **no Next.js** (breaks same-origin routing).

## Commits
Atomic per sub-task; cite the clause (`§4.3`, `TD-12`, `BR-5`); docs in the same commit; `CHANGES.log` ≤6 lines; push completed work to `develop` when asked.

## The specification
| Situation | Action |
|---|---|
| Need a rule | read only the cited section |
| Seems wrong / silent / two clauses conflict | stop and report (business rules win in a conflict); never edit, never invent |
| Code contradicts it | the code is the bug |

**Next:** [engineering-constitution](engineering-constitution.md) · **Related:** [testing](testing.md), [ci-cd](ci-cd.md)
