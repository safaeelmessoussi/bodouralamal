[Documentation](../README.md) › **Development**

# Development

Contributing to the platform.

## Pages

| | |
|---|---|
| [**Engineering constitution**](engineering-constitution.md) | **The laws every implementation must satisfy — required reading before any production code** |
| [**Platform UX & atomic design**](ux-architecture.md) | **Cross-cutting UI rules — data-first pages, one concept → one component, the Level label, scope, verdicts. Consult before implementing any UI request** |
| [Getting started](getting-started.md) | From clone to a running stack |
| [Conventions](conventions.md) | Layering, naming, TypeScript, commits, version policy |
| [Testing](testing.md) | Four layers, what each is for, how to run them |
| [CI/CD](ci-cd.md) | Every gate, what it catches, and why it was added |
| [Documentation policy](documentation-policy.md) | Documentation as part of Done — the workflow and the per-change routing |
| [SRS proposal — Revision 73](../SRS-PROPOSAL-R73.md) | Quran progress: a reachable node, `quranlog.create`, and Quran-specific scope. **Drafted, NOT applied** — §73.4 needs an Owner decision |
| [M4 Quran Progress — audit](audit-2026-08-12-quran.md) | The schema, the 114 surahs, the CHECK **and the cross-table trigger** all exist; no code does. **Quran-as-Subject is already decided by R43** — progress is associated through scope, not a column. Awaiting Owner decisions |
| [SRS proposal — Revision 71](../SRS-PROPOSAL-R71.md) | An event has somebody responsible for it. **Applied** — `EventStaff`, and event scope as a union |
| [مؤطرات, responsibilities and scope — audit](audit-2026-08-12-roles.md) | The model already separates person · capability · scope. **One real gap: an Event has an audience but nobody responsible for it** — plus two terminology defects. Awaiting Owner approval |
| [SRS proposal — Revision 70](../SRS-PROPOSAL-R70.md) | Grade entry gets a home, an audience and an audit row. **Applied** — the M5a revision |
| [Exams & assessment — audit and proposal](audit-2026-08-12-exams.md) | The model already exists and the exam half is built; **grade entry is the whole gap**. Retroactive recording needs nothing. Three small SRS clauses required — **awaiting Owner review** |
| [Audit — 2026-08-11](audit-2026-08-11.md) | Level creation's branch coupling · per-child placement · the deletion model · deployment readiness. **Four questions audited to a decision, none implemented** |
| [Platform-wide UX & IA correction — audit](audit-2026-08-17-ux-architecture.md) | The atomic foundation already existed; the defects were **drift at the edges**. Five dropdown-gated pages, a second button system, three copies of the Level label. **Applied** — two unlisted TD-3 reads reported in §Z |
| [Engineering efficiency](engineering-efficiency.md) | Progress per unit of context — slicing, verification proportionality, and the five things it may never economise on |

**Constitution, conventions, or UX architecture?** [The constitution](engineering-constitution.md)
states *what must be true of any implementation* — the generic-first law, atomic composition, the
reuse audit, the Definition of Done. [Conventions](conventions.md) states *how this codebase
writes things down* — layering, naming, commits, the version policy. [Platform UX & atomic
design](ux-architecture.md) states *how the platform's surfaces behave and how its components
compose* — it is the constitution's §2 made concrete, naming the concepts and what each one
does. The first is why; the second is how; the third is what the UI must look and behave like. [Engineering efficiency](engineering-efficiency.md) is neither: it states *how
to choose the work and the verification*, and is the only one of the three that constrains the
process rather than the artefact.

## The working agreement, in short

1. **Read [`CHANGES.log`](../CHANGES.log) and [`TASKS.md`](../TASKS.md) before starting.**
   They are the fastest read on the current state.
2. **Read the documentation covering the area you are about to change, and decide which
   documents your task affects — *before* writing code**
   ([why](documentation-policy.md#1-before-implementing)). It is how you find the decision
   already recorded, the concept's existing home, and the honest size of the task.
3. **Consult only the specification sections you are implementing.** It is cross-referenced
   by `§`/`BR-x`/`TD-x` identifiers for exactly that purpose — do not read it end to end for
   every task.
4. **Never edit [`SRS.md`](../SRS.md).** It is immutable to contributors. If you believe it
   is wrong, **stop and report**.
5. **If the specification is silent, or two clauses conflict — stop and ask.** Do not invent
   behaviour, and do not silently pick a reading.
6. **Write the tests.** Especially the one that asserts the *security property*, not the code
   path.
7. **Update the documentation in the same commit** — every affected page, plus
   cross-references and indexes. A feature is not Done without it.
8. **Record what you built** in `CHANGES.log`; tick `TASKS.md`.
9. **Regenerate the API contract** if you touched a route.
10. **Run the guards**, then commit atomically to `develop`.

**Done is defined once**, and it covers implementation, reuse, tests, design tokens,
accessibility, responsiveness and record-keeping — not only "the code works".
See the [Definition of Done](engineering-constitution.md#9-definition-of-done).

## Reporting completion

> **The structure is normative** — SRS §16.3 makes it a mandatory content of `CLAUDE.md` and
> `AGENTS.md` (Revision 37.2), so it survives a rewrite of either file. This page owns the
> **wording, the per-section guidance and the rationale**; the specification states only that
> the six sections are required.

When work is finished, report it in **these six sections, in this order**:

| Section | Contains |
|---|---|
| **1. User-visible changes** | What changed, in terms a non-developer understands |
| **2. Engineering highlights** | **Decisions, not description** — a trade-off, a rejected alternative, a constraint discovered |
| **3. Documentation updates** | **Which document now owns what was learned** — not a list of files |
| **4. Additional defects discovered** | Unrelated defects found and fixed along the way, **and where the knowledge was recorded** |
| **5. Verification** | What was **actually run** — plus a skipped check where the reason is non-obvious |
| **6. Remaining work** | **The highest-value next target first**, then everything else still open |

### The report is ephemeral; the ledger is not

**A completion report is read once and is gone at the next context compaction.**
[`CHANGES.log`](../CHANGES.log), the handbook and the code are what survive.

**So no fact of lasting value may exist only in a report.** Record it where it lasts, and let
the report *point* at it. This is §16.4's own rule turned on the report itself: a report is
not where knowledge is **stored**, it is where knowledge is **surfaced** so the Document Owner
can act on it.

That single rule removes more volume than any restructuring, because the longest part of a
report — the rationale — becomes a pointer instead of prose. It is also the fix for a
duplication that is easy to miss precisely because one of the two copies is a chat message:
writing the same slice's reasoning into both the ledger and the report is
[two authoritative homes](engineering-constitution.md#12--one-authoritative-home-per-concept)
for one explanation.

**The test each section must pass:**

> **Does this answer a question the commit and the ledger cannot answer?**

A file list does not — `git show` has it. A convention settled three sessions ago does not. A
diff narrated in prose does not. A *decision*, a *constraint*, an *unrun check* and *what is
still open* all do, and that is why those are the six.

**Use all six headings even when a section is short.** Write *"None"* rather than omitting
one, so a missing section never reads as an oversight.

**Keep section 1 free of identifiers and jargon** — no `§`, `BR-x` or `TD-x`. Those belong in
sections 2 and 3, where the reader is looking for them.

### Write them compactly

**A report is spent from the same context budget as the work**
([why](engineering-efficiency.md)). The six sections are normative; their *length* is not,
and length is where reports actually get expensive.

- **Bullets, not paragraphs.** Three to five per section is a working target.
- **Only what has future engineering value.** Assume the reader can inspect the commit —
  do not narrate the diff.
- **Never restate an established convention.** The DTO discipline, `parse.ts`, the guarded
  router, `.strict()` writes, the R43.3 authority split and their like are settled; mention
  one only when **this slice changed it**.
- **Do not re-explain a decision already recorded** in `CHANGES.log` or the handbook. Link or
  name it.
- **An empty section is one word.** *"None"* — never a paragraph explaining what did not
  happen.
- **Section 6 leads with the single highest-value next target**, then lists anything else
  still open. The lead is for direction; the remainder is the part that keeps a scope
  reduction the Document Owner's decision (§16.3).
- **Verification states what was run.** Name a *skipped* check only when the reason is
  non-obvious — which, per the [efficiency
  policy](engineering-efficiency.md#verification), is exactly when it must be named.

**The two long-form exceptions.** Write at length when a slice produced a **design decision or
constraint a future maintainer would need** — and then write it into the documentation, with
the report merely pointing at it — or when something **unusual happened**: a conflict in the
specification, a defect whose mechanism is not obvious from the fix, or a deliberate departure
from a convention. Everything else is bullets.

### Why the structure is fixed

The Document Owner reads reports to make decisions, so the answers to *"what changed for the
people using this"*, *"what did it cost"* and *"what is still open"* should always be in the
same place rather than distributed through prose at the author's discretion.

Two sections exist because of things this project has learned:

- **Section 4** exists because incidental knowledge and incidental fixes are treated as
  [technical debt to be paid immediately](documentation-policy.md#undocumented-knowledge-is-technical-debt).
  A defect fixed in passing must be *surfaced*, not buried in a diff where only a reviewer
  reading every line would find it.
- **Section 6** exists so deferred work is **stated rather than assumed**. Scaling work down
  is the Document Owner's call, and they can only make it if they know what was left.

## The one habit worth copying

**Prove the guard, do not trust it.**

Every CI guard in this repository was verified by *reintroducing the bug it exists to catch*
and confirming the build went red. A guard that has never failed is a guard nobody has
tested — and this project has already had three cases where a check appeared to pass while
silently testing nothing.

The same applies to mutation testing: **a surviving mutant is worth distrusting until the
mutation is proven to have shipped.** Three separate harness failures here produced false
negatives — a broken build that left a stale container running, a shell that did not
word-split a variable so zero tests ran, and a test runner using a different failure format
for single-file runs.

---

**Related:** [Architecture](../architecture/README.md), [Operations](../operations/README.md)
