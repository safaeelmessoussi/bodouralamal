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

## Efficiency is a primary objective (binding, all sessions)
- **You choose the workflow, not only the implementation.** Continuously pick the
  approach that delivers the most finished work per unit of context, and switch
  strategy on your own when a better one appears — explaining it in one line, not
  a comparison. The full policy, with its rationale and its limits, is
  `docs/development/engineering-efficiency.md`; **read it once per session**, as
  you do §20.
- **Efficiency is measured in completed vertical slices, never in tokens saved.**
  Doing less work is scope narrowing, which is the Document Owner's call. Finish
  the slice, then stop at the resource boundary — clean tree, docs updated,
  pushed.
- **It never buys savings from these five:** correctness · architectural
  integrity · security · SRS compliance · **documentation**. The last is the one
  an efficiency drive cuts first and the one this project has never recovered
  later.
- **Verify what the change could have broken, at the cheapest level that could
  observe it**, and **name in the completion report what you skipped and why.**
  Skipping is legitimate for a conclusion already *established*, never for one
  merely *likely* — and when a fact is cheap to measure, measure it rather than
  infer it.
- **Read only what the task requires; reuse conclusions already established.**
  Re-deriving a settled decision is duplicating it, and it drifts exactly as a
  copied rule does. The mandatory pre-implementation documentation read below is
  **not** an exception — it is the highest-return read available; make it
  targeted, not thorough.
- **The completion report is spent from the same budget.** The six sections are
  normative (§16.3) and stay; their *length* is not. Bullets over paragraphs,
  three to five per section, nothing that restates a settled convention or
  narrates a diff the Document Owner can read, and one word for an empty
  section. Write at length only for a decision a future maintainer needs — and
  then write it into the documentation, not the report. See
  `docs/development/README.md` under *Write them compactly*.
- **Implementation is the default activity; process work is subordinate to it.**
  Once a process improvement is proposed and handed over, that work is
  **complete** — do not revisit, refine, defend or extend it unless the Owner
  asks, new evidence would change the recommendation (not merely support it), or
  implementation cannot proceed correctly without the decision. **Record it in
  its own document and in `CHANGES.log`, then stop mentioning it** — a pending
  proposal must never reappear under *Remaining work*, which is how a handoff
  becomes a recurring topic paid for out of the implementation budget. Rules in
  force stay in force while a proposal is pending; it blocks nothing.
- **`/compact` is recommended on evidence, never on conversation size.** Message
  count, turn count and elapsed time are not reasons. The test is *would the
  next slice go faster from a compacted context than from this one* — which
  turns on whether the **live** context (files it will edit, fixtures it will
  copy, decisions in flight) survives a summary intact. **Spent context — closed
  decisions and finished process discussion, already recorded durably — is inert
  and is not a reason to compact.** Recommend only when the next slice's working
  set is largely disjoint from what is loaded; when it is close, stay silent and
  keep implementing. A recommendation names what is spent, what the next slice
  needs, and whether that need survives the summary. Never mid-slice; always
  with a handoff (branch + commit · what is done · next slice and its minimum
  files · settled conventions).
- **Weigh remaining capacity too, not only context value.** Running out
  mid-slice loses in-flight state that was never written down — the one thing a
  summary cannot reconstruct — so **under genuine uncertainty, err toward the
  boundary**. If the context is live but the budget probably will not finish the
  next slice, recommend, and **say the reason is capacity, not value**. Size the
  slice from the last comparable one, not from a feeling. **A slice too large
  for a fresh budget is too large: split it at a resource boundary** — splitting
  is the cheaper instrument and comes first.

## Documentation is part of Done (SRS §16.4 — binding)
- **A feature is not complete until its documentation is updated — in the same
  commit.** Documentation drift is a defect, not a follow-up task. The rule is
  normative in `docs/SRS.md` §16.4; this bullet is a pointer to it.
- **Before writing any production code, read
  `docs/development/engineering-constitution.md`** and audit the requested feature
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

## Platform UX & Atomic Design Rules (binding for any UI work)
- **Before implementing any UI request, read
  `docs/development/ux-architecture.md`.** It is cross-cutting, it is where the
  platform's UI decisions live, and a request is to be **interpreted against it**
  rather than implemented as an isolated change. Read it as you do §20 and the
  constitution — targeted, not thorough — and it wins over any local instinct.
- The nineteen rules it states are lettered A–S. The four that regress most often,
  named here so they are in front of you without a read:
  - **Data-first (A, F).** A management page shows the data it manages
    immediately. **Never gate primary data behind a dropdown.** Filters narrow
    what is visible; they are never the precondition for it appearing — and the
    API side of the same rule is that **every filter parameter is optional**.
  - **One concept → one atomic component (C, S).** Never hand-write a shared
    component's markup or classes. A different appearance is a **documented
    variant** on the shared component, never a second implementation. If the
    shared component cannot serve the case, **improve the shared component**.
  - **`{Category} — {Level}`, through `levelLabel`, everywhere (D).** Level names
    are not unique across Categories (§4.4b), so a bare name does not identify a
    Level.
  - **No engineering reference in user-facing text (M).** No `§`, `TD-`, `BR-`,
    revision number or commit hash on any screen a beneficiary, parent or مؤطرة
    sees. Comments citing the SRS are correct and stay.
- **Components never decide authorization (O).** The caller passes the permitted
  dataset, the component renders it, the server is the authority. **Never widen a
  permission to make a UI work** — and when a label misleads, fix the label.
- **The recurring defect on this project is a complete capability with no reach**
  (P): six instances so far. When a screen looks impossible, check whether the
  service already does it and only the route or node is missing.
- **Unsaved work is never lost to a stray click (U).** A `FormDialog` holding
  changes does not close on a backdrop click and asks before closing otherwise.
  **Every form must pass `dirty`** — it defaults to `false`, so omitting it
  silently restores the old lose-everything behaviour; that is why it is guarded.
- **A missing translation key ships as user-facing text (X).** `t()` returns its
  own argument on a miss, so a typo is invisible to the type checker and to
  review. `i18n/resolves.test.ts` resolves every literal key; **run it before
  believing any screen's copy.**
- **Before adding a field for a missing control, check whether the value already
  exists somewhere unreachable (Z)** — and whether the SRS has already *refused*
  the shape being asked for. The grading scale was seeded and unreachable; a
  per-exam scale was refused in terms by R58.
- Every rule there is guarded, and the guards are listed at the foot of that page.
  **When a guard fails because the code changed shape, restate the property — do
  not delete the guard.** Three were restated this way on 2026-08-17: they pinned
  an accordion, a row action's URL and a removed badge — none of which was the
  property.
- **One source of truth per concept.** Never restate a rule that already lives
  somewhere; link to it. On this project every duplicated requirement has
  drifted, and the copy that drifts still passes its own tests.
- Explain **why**, and what you rejected — not just what the code does. The
  target is that an engineer who has never seen this repository could rebuild
  the platform from the documentation alone.
- Run `bash scripts/ci/check-doc-links.sh` before committing; CI runs it too.
