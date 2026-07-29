# AI Agent Instructions (Codex/Cursor/Blackbox)

- Read `docs/CHANGES.log` to understand what was completed in the prior session.
- Follow the guidelines in `/CLAUDE.md` (repository root). The source of truth is
  `docs/SRS.md`; neither this file nor CLAUDE.md overrides it.
- When writing database schema changes, remember PostgreSQL-specific CHECK
  constraints and ICU collations are hand-written in `backend/prisma/migrations/`
  SQL files (SRS TD-6a). Do not try to write them in `schema.prisma`.
  Never run `prisma db push`.
- When modifying backend routes, always use the unified error response format
  defined in `docs/SRS.md` under section TD-3.8.
- Log your output directly into the next empty row of `docs/CHANGES.log`.
- **Documentation is part of Done (SRS §16.4 — binding).** Update the affected
  pages in `docs/` (indexed by `docs/README.md`) in the **same commit** as the
  code change; documentation drift is a defect. The handbook cites the SRS and
  never restates it. Which page to update for which change is in
  `docs/development/documentation-policy.md`. Verify with
  `bash scripts/ci/check-doc-links.sh`.
- **Report completion in the six fixed sections** — user-visible changes,
  engineering highlights, documentation updates, additional defects discovered,
  verification, remaining work. See `docs/development/README.md` under
  *Reporting completion*.
