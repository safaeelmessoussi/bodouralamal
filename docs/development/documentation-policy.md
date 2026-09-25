[Documentation](../README.md) › [Development](README.md) › **Documentation policy**

# Documentation policy

## The rule
**Documentation drift is a defect.** A code change that makes a page inaccurate updates that page **in the same commit** (SRS §16.4 — normative; every other mention cites it). Never a follow-up, never a ticket.

## Undocumented knowledge is technical debt
Payable at the moment of discovery — the only moment the reasoning is still intact. Decisions, pitfalls, rejected alternatives and reusable patterns learned during a task are written where the concept lives, whether or not they were asked for.

## Workflow
| When | Do |
|---|---|
| **1. Before implementing** | Read the pages covering the area; list which documents the task affects. Finds the recorded decision, the concept's authoritative home, and the honest size of the task. |
| **2. During** | Write decisions as you make them. |
| **3. After** | Update every affected page, then the connective tissue: cross-references both ways, the section `README.md`, [`docs/README.md`](../README.md) if a page was added or repurposed, then the table below. |

## What to update, by change type
| Changed | Update |
|---|---|
| API endpoint | [api-endpoints](../reference/api-endpoints.md); conventions/governance in [api](../architecture/api.md); regenerate `openapi.json` |
| Database schema | [database](../architecture/database.md) |
| Business rule | SRS (Owner only) → [business-rules](../reference/business-rules.md), the [overview](../overview/business-processes.md) page |
| Auth / authorization | [identity-and-access](../architecture/identity-and-access.md); [security](../architecture/security.md) if the posture moved |
| Frontend structure or pattern | [frontend](../architecture/frontend.md) |
| Cross-cutting UI rule | [ux-architecture](ux-architecture.md) |
| User-visible behaviour | [frontend](../architecture/frontend.md), the overview page, `i18n/ar.ts` only on the Owner's word |
| Tokens / stylesheet | [design-system](../architecture/design-system.md), [`design.mmd`](../../design.mmd) |
| Deployment, config, infra | [deployment](../operations/deployment.md), [configuration](../operations/configuration.md), [environments](../operations/environments.md) |
| Background job | [background-jobs](../architecture/background-jobs.md) |
| Tests / CI | [testing](testing.md), [ci-cd](ci-cd.md) |
| Architectural decision | its architecture page, incl. what was rejected and why |
| Anything | ≤6 lines in [`CHANGES.log`](../CHANGES.log); remove the row from [`TASKS.md`](../TASKS.md) |

## Single source of truth
One authoritative home per rule; every other page links to it. A duplicate found → delete the copy, keep the link. **The SRS is the exception in the other direction:** immutable to implementers; a normative change is a Document Owner revision — stop and report.

## Style (token-lean)
- Cite (`§4.3`, `BR-5`, `TD-12`, «R131»), never restate. Relative links only. Breadcrumb at the top.
- Tables and bullets; prose only where a «because» must be carried. No history — a page states current facts; at most «since R<n>».
- Say «deliberately» when it is. Arabic terms get a gloss on first use. Diagrams are Mermaid or ASCII.
- Where something is specified but not built, say so where it is described — never present tense for the unbuilt.
- Do not pad; a short page beats one that repeats a neighbour.

## Enforcement
| Check | Effect |
|---|---|
| `scripts/ci/check-doc-links.sh` | fails the build on a broken relative link or missing anchor (§19.2) |
| Review | the documentation diff is read against the code diff — accuracy is not automatable |
| SRS §16.4 / §20 | the obligation is normative |

**Related:** [conventions](conventions.md) · [ci-cd](ci-cd.md) · [docs map](../README.md)
