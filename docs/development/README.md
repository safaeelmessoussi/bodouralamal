[Documentation](../README.md) › **Development**

# Development

| Page | What it is |
|---|---|
| [engineering-constitution](engineering-constitution.md) | **Laws every implementation satisfies** — read before production code |
| [ux-architecture](ux-architecture.md) | **Cross-cutting UI rules** (data-first pages, one concept → one component, filters, tables, forms, states) — read before any UI request |
| [`design.mmd`](../../design.mmd) | Visual rulebook: colour, type, touch, motion, page anatomy |
| [teaching-authority](teaching-authority.md) | Who may act on whom, and when — the period model |
| [getting-started](getting-started.md) | Clone → running stack |
| [conventions](conventions.md) | Layering, naming, TypeScript, commits, version policy |
| [testing](testing.md) | Four layers, [how to run them](testing.md#running-them) |
| [qa-inventory](qa-inventory.md) | What exists and how each part is verified |
| [ci-cd](ci-cd.md) | Every gate and what it catches |
| [documentation-policy](documentation-policy.md) | Docs as part of Done; per-change routing |
| [engineering-efficiency](engineering-efficiency.md) | Slicing, verification proportionality, the five non-negotiables |
| Domain notes | [class-delivery](class-delivery.md) · [online-classroom](online-classroom.md) · [online-class-provider](online-class-provider.md) · [quran-progress](quran-progress.md) · [account-and-membership](account-and-membership.md) · [person-identity](person-identity.md) · [email-lock-keying](email-lock-keying.md) · [personal-data-map](personal-data-map.md) |

Constitution = *what must be true*; conventions = *how this codebase writes it*; ux-architecture = *how surfaces behave*; efficiency = *how to choose the work and the checks*.

## Reporting completion
Six sections, this order (normative, SRS §16.3):

| # | Section | Contains |
|---|---|---|
| 1 | User-visible changes | what changed, in a non-developer's terms |
| 2 | Engineering highlights | decisions and trade-offs, not description |
| 3 | Documentation updates | which page now owns what was learned |
| 4 | Additional defects discovered | unrelated defects found/fixed, and where recorded |
| 5 | Verification | what actually ran (exit 0, seen); skipped checks and why |
| 6 | Remaining work | highest-value next target first |

The report is ephemeral; `CHANGES.log` (≤6 lines) and the handbook are the record. Anything written for the Owner starts «Written for: …».
