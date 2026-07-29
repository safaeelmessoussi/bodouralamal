[Documentation](../README.md) › **Reference**

# Reference

Lookup tables. These pages are **indexes into the specification**, not replacements for it —
each entry says what a rule is, where it is enforced in the code, and where its authoritative
text lives.

| | |
|---|---|
| [Business rules](business-rules.md) | BR-1 … BR-20 — the domain invariants |
| [Technical design constraints](technical-design.md) | TD-1 … TD-16 — state machines, contracts, transactions |
| [API endpoints](api-endpoints.md) | Every route, its audience, and its status |
| [Error codes](error-codes.md) | The canonical catalogue, with client guidance |
| [Decision log](decision-log.md) | Every specification revision |

## How to use these

**Looking up a rule you saw cited in code?** Business rules or technical design, depending on
the prefix.

**Wondering why something is the way it is?** The [decision log](decision-log.md) — most
non-obvious choices in this codebase have a numbered revision explaining what was rejected.

**Integrating against the API?** [Endpoints](api-endpoints.md) and
[error codes](error-codes.md), then [`openapi.json`](../openapi.json) for exact schemas.

## Precedence

> Where any section of the specification appears to conflict with a business rule, **the
> business rule wins, and the conflict must be reported** — not silently resolved.

Business rules are stated **technology-independently** on purpose: they must survive any
future migration away from Node, Prisma, or PostgreSQL intact.

---

**Related:** [Glossary](../overview/glossary.md), [`SRS.md`](../SRS.md)
