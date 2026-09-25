[Documentation](../README.md) › [Development](README.md) › **Engineering efficiency**

# Engineering efficiency

One sentence: **completed slices, focused evidence first, full gates once at the coherent boundary — and never economise on the five below.** Efficiency is measured in the whole task's cost (tokens, wall-clock, reruns, review), not in one step's brevity.

## Five non-negotiables
| Never skipped | Home |
|---|---|
| Correctness | — |
| Architectural integrity | [constitution](engineering-constitution.md) |
| Security | SRS §20, [security](../architecture/security.md) |
| Specification compliance | `SRS.md`, immutable to implementers |
| Documentation, same commit | [documentation-policy](documentation-policy.md) — the one most often deferred and the most expensive to have deferred |

## Context management
- Read what the task needs: `TASKS.md`, `tail` of `CHANGES.log`, SRS §20 + the clauses touched, the handbook pages the change affects. Never the whole SRS, the archive, or a ledger's history unless the task cites it.
- The pre-implementation read is not waste; loading pages the task does not touch is.
- Bounded commands: `timeout`, `head`/`tail`, focused test paths; diagnose a hang, do not wait it out.

## Waste, concretely
Re-running an established suite for an unrelated edit · re-deriving facts already in the conversation · restating a rule a page already states · broad greps where the map names the file · narrating options not taken · reports that repeat the diff.

## Planning
Slice the task into completed, verifiable pieces; finish one before opening the next. Name upfront what the final gate set is (constitution §8).

## Verification
- **Focused checks while editing** (typecheck, the affected test file, one guard); **the full established gates once** at the coherent boundary (CLAUDE.md « Commands »).
- Skipping is legitimate only for the established (evidence from this session), never for the likely.
- **Measure, don't infer:** «verified» means the command ran and exited 0 in this session, and you saw it. A cache, a partial pass or a wrapper's exit code is not evidence.
- Integration after any service rule change; the seed drill before pushing anything touching seeds or materialisation; a real browser for new write endpoints.

## Reporting
Spent from the same budget: six sections, facts and evidence, no diff narration; name skipped checks and why.

## Autonomy
Ordinary obstacles (errors, timeouts, locks, empty results) are diagnosed and worked through. Stop only for the Owner's decisions, deliberate guardrails, or actions that need authorization.

## Process optimisation
Subordinate to implementation: a process idea goes into the relevant handbook page or a `TASKS.md` row, never into the next report, and a pending proposal never blocks the task.

## Capacity, not only value
When the context is near its limit, finish the current slice, record state where a fresh session can resume (docs, `TASKS.md`, the commit), and say what is done and what is not — evidence, not feeling. Compaction is not free; the default is not to recommend it.

This policy is frozen; changes are the Owner's.
