# Agent entry — Codex / Cursor / Blackbox

Read and follow [CLAUDE.md](CLAUDE.md), the existing shared guide (§16.3).
Its repository map, authority pointers and verification links are the entry path;
do not create a competing guide. Neither file overrides [docs/SRS.md](docs/SRS.md).

- Read current `docs/TASKS.md` and recent `docs/CHANGES.log` entries before work;
  search history only when relevant, rather than loading the whole ledger.
- Before production code, read `docs/development/engineering-constitution.md`,
  audit every principle, reuse existing solutions and report justified exceptions.
- PostgreSQL CHECK constraints and ICU collations are hand-written in
  `backend/prisma/migrations/` SQL, never Prisma schema syntax (TD-6a).
  Never run `prisma db push`.
- Backend routes use the TD-3.8 unified error envelope.
- Documentation is part of Done (§16.4): update affected docs in the same commit,
  append output to `docs/CHANGES.log`, and run
  `bash scripts/ci/check-doc-links.sh`. Documentation drift is a defect.
- Follow the efficiency policy linked by CLAUDE.md: completed slices, focused
  evidence first; never trade correctness, security or documentation for savings.
- Report these six sections (§16.3): **user-visible changes · engineering highlights ·
  documentation updates · additional defects discovered · verification · remaining work**.
