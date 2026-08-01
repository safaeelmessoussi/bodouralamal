# Claude Code Instructions

## Project Context
You are working on the بذور الأمل Platform.
- Framework: React (frontend) & Express with Prisma (backend).
- Database: PostgreSQL.
- Storage: MinIO.
- Source of truth: `docs/SRS.md`. This file never overrides it.

## Execution Guardrails
- Always read `docs/CHANGES.log` and `docs/TASKS.md` to see the latest progress and
  the current checklist before starting a task.
- NEVER read `docs/SRS.md` fully unless explicitly asked. Refer only to the
  section(s) you are implementing (the SRS is cross-referenced by §/BR-x/TD-x
  identifiers for exactly this purpose).
- `docs/SRS.md` is IMMUTABLE to you. Never edit it. If you believe it is wrong,
  stop and report to the Document Owner.
- The binding AI guardrails are `docs/SRS.md` §20 — read §20 once per session.
- Build order comes from `docs/IMPLEMENTATION_PLAN.md`; tick off items in
  `docs/TASKS.md` as you complete them.
- Write explicit transactional queries in services; do not bypass repositories.
- Keep commits atomic. Push any completed sub-task to the `develop` branch.
- Document what you built in `docs/CHANGES.log` immediately after completing a task.
- If the SRS is silent or two sections conflict: stop and ask; report the conflict.

## Documentation is part of Done (SRS §16.4 — binding)
- **A feature is not complete until its documentation is updated — in the same
  commit.** Documentation drift is a defect, not a follow-up task. The rule is
  normative in `docs/SRS.md` §16.4; this bullet is a pointer to it.
- **Before writing any production code, read
  `docs/development/engineering-principles.md`** and audit the requested feature
  against every principle. During implementation, continuously look for
  opportunities to extract reusable components, services, hooks, utilities and
  API clients. **Never duplicate an existing solution if it can be generalised.**
  Before declaring the feature complete, verify compliance with every principle
  and **report any intentional exception with its justification**.
- **Before implementing anything, read the relevant project documentation and
  decide which documents the task affects** (mandatory per SRS §16.3, Revision
  37.1). This is the step that finds the decision already recorded, the concept's
  existing home, and the true size of the task. Do it before writing code.
- **During:** keep documentation moving with the code — never defer it.
- **After:** update every affected document, then cross-references and indexes.
  Ask what else the task taught (a design decision, a constraint, an operational
  consideration, a trap) and record anything a future maintainer would want.
- **Undocumented knowledge you discover is technical debt — document it
  immediately**, even if nobody asked and even if it is unrelated to the task.
  The moment of discovery is the cheapest moment to record it; deferring loses it.
- **"Task completed" means all six:** implementation done · tests passing ·
  documentation updated · cross-references verified
  (`bash scripts/ci/check-doc-links.sh`) · `docs/CHANGES.log` updated · SRS
  revised **only if a normative requirement changed** — and that is the Document
  Owner's call, so stop and report rather than editing.
- **Report completion in six fixed sections** (mandatory per SRS §16.3, Revision
  37.2), in order: user-visible changes · engineering highlights · documentation
  updates · additional defects discovered · verification · remaining work. Use
  all six headings even when one is short (write "None"), and keep the first free
  of `§`/`BR-x`/`TD-x` jargon. The structure and its rationale are in
  `docs/development/README.md` under *Reporting completion*.
- The handbook lives in `docs/` and is indexed by `docs/README.md`. It is
  **mutable by you**, unlike `docs/SRS.md`, and it **cites the SRS rather than
  restating it** (§16.4).
- Which page to update for which kind of change is listed in
  `docs/development/documentation-policy.md` — read it once per session, as you
  do §20.
- **One source of truth per concept.** Never restate a rule that already lives
  somewhere; link to it. On this project every duplicated requirement has
  drifted, and the copy that drifts still passes its own tests.
- Explain **why**, and what you rejected — not just what the code does. The
  target is that an engineer who has never seen this repository could rebuild
  the platform from the documentation alone.
- Run `bash scripts/ci/check-doc-links.sh` before committing; CI runs it too.
